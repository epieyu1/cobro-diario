-- BR-4 abre reportes administrativos sin debilitar RLS ni crear vistas privilegiadas.
-- El frontend solo debe leer métricas agregadas por este RPC, manteniendo PostgreSQL
-- como fuente de verdad y evitando reconstruir dashboards desde IndexedDB o joins sueltos.

create or replace function public.get_operational_report(
  p_collector_id uuid default null,
  p_route_label text default null,
  p_loan_status text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_business_date date := timezone('America/Bogota', now())::date;
  v_generated_at timestamptz := now();
  v_normalized_loan_status text := nullif(btrim(p_loan_status), '');
  v_normalized_route_label text := nullif(btrim(p_route_label), '');
begin
  if auth.uid() is null then
    raise exception 'authentication_required';
  end if;

  if not private.current_profile_is_active() then
    raise exception 'operator_inactive';
  end if;

  if not private.is_admin() then
    raise exception 'report_role_not_allowed';
  end if;

  if p_collector_id is not null and not private.can_access_collector(p_collector_id) then
    raise exception 'collector_not_allowed';
  end if;

  if v_normalized_loan_status is not null
     and v_normalized_loan_status not in ('draft', 'active', 'delinquent', 'settled', 'written_off', 'canceled') then
    raise exception 'loan_status_invalid';
  end if;

  return (
    with params as (
      select
        v_business_date as business_date,
        p_collector_id as collector_id,
        v_generated_at as generated_at,
        v_normalized_loan_status as loan_status,
        v_normalized_route_label as route_label
    ),
    scope_customers as (
      select
        public.customers.id,
        public.customers.assigned_collector_id,
        coalesce(nullif(btrim(public.customers.route_label), ''), 'Ruta sin zona') as route_label
      from public.customers
      cross join params
      where public.customers.archived_at is null
        and (params.collector_id is null or public.customers.assigned_collector_id = params.collector_id)
        and (
          params.route_label is null
          or coalesce(nullif(btrim(public.customers.route_label), ''), 'Ruta sin zona') = params.route_label
        )
    ),
    scope_loans as (
      select
        public.loans.id,
        public.loans.collector_id,
        public.loans.customer_id,
        public.loans.status
      from public.loans
      inner join scope_customers
        on scope_customers.id = public.loans.customer_id
      cross join params
      where params.loan_status is null or public.loans.status::text = params.loan_status
    ),
    open_loans as (
      select
        scope_loans.id,
        scope_loans.collector_id,
        scope_loans.customer_id
      from scope_loans
      where scope_loans.status in ('active', 'delinquent')
    ),
    scope_installments as (
      select
        public.installments.loan_id,
        public.installments.due_date,
        public.installments.outstanding_amount,
        public.installments.status
      from public.installments
      inner join scope_loans
        on scope_loans.id = public.installments.loan_id
    ),
    overdue_by_loan as (
      select distinct
        scope_installments.loan_id
      from scope_installments
      where scope_installments.status = 'overdue'
        and scope_installments.outstanding_amount > 0
    ),
    due_today_by_loan as (
      select distinct
        scope_installments.loan_id
      from scope_installments
      cross join params
      where scope_installments.due_date = params.business_date
        and scope_installments.status in ('pending', 'partial', 'overdue')
        and scope_installments.outstanding_amount > 0
    ),
    outstanding_by_loan as (
      select
        scope_installments.loan_id,
        coalesce(sum(scope_installments.outstanding_amount), 0) as outstanding_amount
      from scope_installments
      where scope_installments.status <> 'canceled'
      group by scope_installments.loan_id
    ),
    scope_payments_today as (
      select
        public.payments.id,
        public.payments.loan_id,
        public.payments.collector_id,
        public.payments.total_amount
      from public.payments
      inner join scope_loans
        on scope_loans.id = public.payments.loan_id
      cross join params
      where public.payments.status = 'posted'
        and timezone('America/Bogota', public.payments.paid_at)::date = params.business_date
    ),
    collector_base as (
      select distinct
        scope_loans.collector_id
      from scope_loans
    ),
    customers_by_collector as (
      select
        scope_customers.assigned_collector_id as collector_id,
        count(*) as customer_count
      from scope_customers
      group by scope_customers.assigned_collector_id
    ),
    open_by_collector as (
      select
        open_loans.collector_id,
        count(*) as open_loan_count
      from open_loans
      group by open_loans.collector_id
    ),
    overdue_by_collector as (
      select
        scope_loans.collector_id,
        count(*) as overdue_loan_count
      from scope_loans
      inner join overdue_by_loan
        on overdue_by_loan.loan_id = scope_loans.id
      group by scope_loans.collector_id
    ),
    due_today_by_collector as (
      select
        scope_loans.collector_id,
        count(*) as due_today_loan_count
      from scope_loans
      inner join due_today_by_loan
        on due_today_by_loan.loan_id = scope_loans.id
      group by scope_loans.collector_id
    ),
    payments_by_collector as (
      select
        scope_payments_today.collector_id,
        coalesce(sum(scope_payments_today.total_amount), 0) as collected_today_amount
      from scope_payments_today
      group by scope_payments_today.collector_id
    ),
    outstanding_by_collector as (
      select
        scope_loans.collector_id,
        coalesce(sum(outstanding_by_loan.outstanding_amount), 0) as outstanding_amount
      from scope_loans
      left join outstanding_by_loan
        on outstanding_by_loan.loan_id = scope_loans.id
      group by scope_loans.collector_id
    ),
    collector_rows as (
      select
        collector_base.collector_id,
        coalesce(public.profiles.full_name, collector_base.collector_id::text) as collector_name,
        coalesce(customers_by_collector.customer_count, 0) as customer_count,
        coalesce(open_by_collector.open_loan_count, 0) as open_loan_count,
        coalesce(overdue_by_collector.overdue_loan_count, 0) as overdue_loan_count,
        coalesce(due_today_by_collector.due_today_loan_count, 0) as due_today_loan_count,
        coalesce(payments_by_collector.collected_today_amount, 0)::text as collected_today_amount,
        coalesce(outstanding_by_collector.outstanding_amount, 0)::text as outstanding_amount
      from collector_base
      left join public.profiles
        on public.profiles.id = collector_base.collector_id
      left join customers_by_collector
        on customers_by_collector.collector_id = collector_base.collector_id
      left join open_by_collector
        on open_by_collector.collector_id = collector_base.collector_id
      left join overdue_by_collector
        on overdue_by_collector.collector_id = collector_base.collector_id
      left join due_today_by_collector
        on due_today_by_collector.collector_id = collector_base.collector_id
      left join payments_by_collector
        on payments_by_collector.collector_id = collector_base.collector_id
      left join outstanding_by_collector
        on outstanding_by_collector.collector_id = collector_base.collector_id
    ),
    route_base as (
      select distinct
        scope_customers.route_label
      from scope_customers
    ),
    customers_by_route as (
      select
        scope_customers.route_label,
        count(*) as customer_count
      from scope_customers
      group by scope_customers.route_label
    ),
    open_by_route as (
      select
        scope_customers.route_label,
        count(*) as open_loan_count
      from open_loans
      inner join scope_customers
        on scope_customers.id = open_loans.customer_id
      group by scope_customers.route_label
    ),
    overdue_by_route as (
      select
        scope_customers.route_label,
        count(*) as overdue_loan_count
      from scope_loans
      inner join overdue_by_loan
        on overdue_by_loan.loan_id = scope_loans.id
      inner join scope_customers
        on scope_customers.id = scope_loans.customer_id
      group by scope_customers.route_label
    ),
    due_today_by_route as (
      select
        scope_customers.route_label,
        count(*) as due_today_loan_count
      from scope_loans
      inner join due_today_by_loan
        on due_today_by_loan.loan_id = scope_loans.id
      inner join scope_customers
        on scope_customers.id = scope_loans.customer_id
      group by scope_customers.route_label
    ),
    payments_by_route as (
      select
        scope_customers.route_label,
        coalesce(sum(scope_payments_today.total_amount), 0) as collected_today_amount
      from scope_payments_today
      inner join scope_loans
        on scope_loans.id = scope_payments_today.loan_id
      inner join scope_customers
        on scope_customers.id = scope_loans.customer_id
      group by scope_customers.route_label
    ),
    outstanding_by_route as (
      select
        scope_customers.route_label,
        coalesce(sum(outstanding_by_loan.outstanding_amount), 0) as outstanding_amount
      from scope_loans
      inner join scope_customers
        on scope_customers.id = scope_loans.customer_id
      left join outstanding_by_loan
        on outstanding_by_loan.loan_id = scope_loans.id
      group by scope_customers.route_label
    ),
    route_rows as (
      select
        route_base.route_label,
        coalesce(customers_by_route.customer_count, 0) as customer_count,
        coalesce(open_by_route.open_loan_count, 0) as open_loan_count,
        coalesce(overdue_by_route.overdue_loan_count, 0) as overdue_loan_count,
        coalesce(due_today_by_route.due_today_loan_count, 0) as due_today_loan_count,
        coalesce(payments_by_route.collected_today_amount, 0)::text as collected_today_amount,
        coalesce(outstanding_by_route.outstanding_amount, 0)::text as outstanding_amount
      from route_base
      left join customers_by_route
        on customers_by_route.route_label = route_base.route_label
      left join open_by_route
        on open_by_route.route_label = route_base.route_label
      left join overdue_by_route
        on overdue_by_route.route_label = route_base.route_label
      left join due_today_by_route
        on due_today_by_route.route_label = route_base.route_label
      left join payments_by_route
        on payments_by_route.route_label = route_base.route_label
      left join outstanding_by_route
        on outstanding_by_route.route_label = route_base.route_label
    ),
    status_rows as (
      select
        scope_loans.status::text as status,
        count(*) as loan_count,
        coalesce(sum(outstanding_by_loan.outstanding_amount), 0)::text as outstanding_amount
      from scope_loans
      left join outstanding_by_loan
        on outstanding_by_loan.loan_id = scope_loans.id
      group by scope_loans.status
    )
    select jsonb_build_object(
      'businessDate', params.business_date,
      'generatedAt', params.generated_at,
      'filters', jsonb_build_object(
        'collectorId', params.collector_id,
        'routeLabel', params.route_label,
        'loanStatus', params.loan_status
      ),
      'metrics', jsonb_build_object(
        'customerCount', (select count(*) from scope_customers),
        'openLoanCount', (select count(*) from open_loans),
        'overdueLoanCount', (select count(*) from overdue_by_loan),
        'dueTodayLoanCount', (select count(*) from due_today_by_loan),
        'collectedTodayCount', (select count(*) from scope_payments_today),
        'collectedTodayAmount', coalesce((select sum(scope_payments_today.total_amount)::text from scope_payments_today), '0'),
        'outstandingAmount', coalesce((select sum(outstanding_by_loan.outstanding_amount)::text from outstanding_by_loan), '0')
      ),
      'collectors', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'collectorId', collector_rows.collector_id,
              'collectorName', collector_rows.collector_name,
              'customerCount', collector_rows.customer_count,
              'openLoanCount', collector_rows.open_loan_count,
              'overdueLoanCount', collector_rows.overdue_loan_count,
              'dueTodayLoanCount', collector_rows.due_today_loan_count,
              'collectedTodayAmount', collector_rows.collected_today_amount,
              'outstandingAmount', collector_rows.outstanding_amount
            )
            order by collector_rows.collector_name asc
          )
          from collector_rows
        ),
        '[]'::jsonb
      ),
      'routes', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'routeLabel', route_rows.route_label,
              'customerCount', route_rows.customer_count,
              'openLoanCount', route_rows.open_loan_count,
              'overdueLoanCount', route_rows.overdue_loan_count,
              'dueTodayLoanCount', route_rows.due_today_loan_count,
              'collectedTodayAmount', route_rows.collected_today_amount,
              'outstandingAmount', route_rows.outstanding_amount
            )
            order by route_rows.route_label asc
          )
          from route_rows
        ),
        '[]'::jsonb
      ),
      'statuses', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'status', status_rows.status,
              'loanCount', status_rows.loan_count,
              'outstandingAmount', status_rows.outstanding_amount
            )
            order by status_rows.status asc
          )
          from status_rows
        ),
        '[]'::jsonb
      )
    )
    from params
  );
end;
$$;

revoke execute on function public.get_operational_report(uuid, text, text) from public;
grant execute on function public.get_operational_report(uuid, text, text) to authenticated;

comment on function public.get_operational_report(uuid, text, text) is
'Reporte operativo de BR-4. Solo admin activo puede leer métricas agregadas de cartera, cobro del día y mora bajo el mismo alcance RLS del actor autenticado.';
