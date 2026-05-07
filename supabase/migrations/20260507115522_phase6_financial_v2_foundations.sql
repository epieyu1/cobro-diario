-- BR-6 materializa el contrato remoto V2 una vez que los enums ya fueron
-- comprometidos en la migracion previa del mismo rollout.
-- Flujo: originacion declara interest_mode + payment_application_mode ->
-- installments persisten saldos por componente como verdad remota ->
-- y PostgreSQL genera un cronograma canonico alineado con el modo del prestamo.
-- Riesgo: si algun write path vuelve a reconstruir componentes solo desde outstanding_amount,
-- los abonos dirigidos dejan de ser auditables y frontend/servidor vuelven a divergir.

alter table public.loans
  add column if not exists payment_application_mode public.loan_payment_application_mode;

update public.loans
set payment_application_mode = coalesce(
  public.loans.payment_application_mode,
  'oldest_first'::public.loan_payment_application_mode
)
where public.loans.payment_application_mode is null;

alter table public.loans
  alter column payment_application_mode set not null,
  alter column payment_application_mode set default 'oldest_first'::public.loan_payment_application_mode;

comment on column public.loans.interest_mode is
'Modo financiero del prestamo. V1 conserva simple_precomputed; BR-6 agrega compound_fixed_installment sin mutacion silenciosa entre contratos.';

comment on column public.loans.payment_application_mode is
'Regla autoritativa del abono para el prestamo. oldest_first mantiene V1; principal_only e interest_only habilitan los abonos dirigidos de BR-6.';

drop policy if exists "loans_insert_via_origination_context" on public.loans;

create policy "loans_insert_via_origination_context"
on public.loans
for insert
to authenticated
with check (
  private.origination_write_context_enabled()
  and private.can_originate_for_collector(collector_id)
  and created_by = auth.uid()
  and originated_at is not null
  and interest_mode in (
    'simple_precomputed'::public.loan_interest_mode,
    'compound_fixed_installment'::public.loan_interest_mode
  )
  and payment_application_mode in (
    'oldest_first'::public.loan_payment_application_mode,
    'principal_only'::public.loan_payment_application_mode,
    'interest_only'::public.loan_payment_application_mode
  )
);

alter table public.installments
  add column if not exists outstanding_principal_amount numeric(14, 2),
  add column if not exists outstanding_interest_amount numeric(14, 2),
  add column if not exists outstanding_fee_amount numeric(14, 2);

-- Los saldos legacy vienen de V1 y pueden reconstruirse desde outstanding_amount
-- porque su orden siempre fue fee -> interest -> principal.
update public.installments
set
  outstanding_fee_amount = public.installments.fee_amount
    - least(
      public.installments.scheduled_amount - public.installments.outstanding_amount,
      public.installments.fee_amount
    ),
  outstanding_interest_amount = public.installments.interest_amount
    - least(
      greatest(
        public.installments.scheduled_amount - public.installments.outstanding_amount - public.installments.fee_amount,
        0
      ),
      public.installments.interest_amount
    ),
  outstanding_principal_amount = public.installments.principal_amount
    - least(
      greatest(
        public.installments.scheduled_amount - public.installments.outstanding_amount - public.installments.fee_amount - public.installments.interest_amount,
        0
      ),
      public.installments.principal_amount
    )
where
  public.installments.outstanding_principal_amount is null
  or public.installments.outstanding_interest_amount is null
  or public.installments.outstanding_fee_amount is null;

alter table public.installments
  alter column outstanding_principal_amount set not null,
  alter column outstanding_interest_amount set not null,
  alter column outstanding_fee_amount set not null;

alter table public.installments
  drop constraint if exists installments_outstanding_principal_amount_bounds,
  drop constraint if exists installments_outstanding_interest_amount_bounds,
  drop constraint if exists installments_outstanding_fee_amount_bounds,
  drop constraint if exists installments_outstanding_components_match_total;

alter table public.installments
  add constraint installments_outstanding_principal_amount_bounds check (
    outstanding_principal_amount >= 0
    and outstanding_principal_amount <= principal_amount
  ),
  add constraint installments_outstanding_interest_amount_bounds check (
    outstanding_interest_amount >= 0
    and outstanding_interest_amount <= interest_amount
  ),
  add constraint installments_outstanding_fee_amount_bounds check (
    outstanding_fee_amount >= 0
    and outstanding_fee_amount <= fee_amount
  ),
  add constraint installments_outstanding_components_match_total check (
    round(outstanding_principal_amount + outstanding_interest_amount + outstanding_fee_amount, 2) = outstanding_amount
  );

comment on column public.installments.outstanding_principal_amount is
'Saldo pendiente de capital de la cuota. BR-6 lo persiste como fuente remota de verdad para soportar abonos dirigidos y reversos exactos.';

comment on column public.installments.outstanding_interest_amount is
'Saldo pendiente de interes de la cuota. No volver a derivarlo desde outstanding_amount una vez el prestamo admite modos dirigidos.';

comment on column public.installments.outstanding_fee_amount is
'Saldo pendiente del bucket fee/mora de la cuota. Hoy suele iniciar en cero, pero se mantiene separado para conservar el contrato por componente.';

create or replace function private.ensure_installment_outstanding_components()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_interest_mode public.loan_interest_mode;
  v_paid_amount numeric(14, 2);
begin
  if new.outstanding_principal_amount is not null
    and new.outstanding_interest_amount is not null
    and new.outstanding_fee_amount is not null then
    return new;
  end if;

  select public.loans.interest_mode
  into v_interest_mode
  from public.loans
  where public.loans.id = new.loan_id;

  if coalesce(v_interest_mode, 'simple_precomputed'::public.loan_interest_mode)
    = 'compound_fixed_installment'::public.loan_interest_mode then
    raise exception 'installment_outstanding_components_required';
  end if;

  v_paid_amount := new.scheduled_amount - new.outstanding_amount;
  new.outstanding_fee_amount :=
    new.fee_amount - least(v_paid_amount, new.fee_amount);
  new.outstanding_interest_amount :=
    new.interest_amount - least(greatest(v_paid_amount - new.fee_amount, 0), new.interest_amount);
  new.outstanding_principal_amount :=
    new.principal_amount - least(
      greatest(v_paid_amount - new.fee_amount - new.interest_amount, 0),
      new.principal_amount
    );

  return new;
end;
$$;

revoke execute on function private.ensure_installment_outstanding_components() from public;

comment on function private.ensure_installment_outstanding_components() is
'Normaliza inserts legacy de cuotas V1 antes de que entren las constraints de BR-6. Los prestamos compound de V2 deben llegar con los tres saldos por componente materializados.';

drop trigger if exists ensure_installment_outstanding_components on public.installments;

create trigger ensure_installment_outstanding_components
before insert or update on public.installments
for each row
execute function private.ensure_installment_outstanding_components();

create or replace function private.build_financial_schedule(
  p_principal_amount numeric,
  p_installment_amount numeric,
  p_total_installments integer,
  p_payment_frequency public.loan_payment_frequency,
  p_disbursement_date date,
  p_first_due_date date,
  p_interest_mode public.loan_interest_mode,
  p_interest_rate_daily numeric,
  p_payment_application_mode public.loan_payment_application_mode
)
returns table (
  installment_number integer,
  due_date date,
  scheduled_amount numeric(14, 2),
  principal_amount numeric(14, 2),
  interest_amount numeric(14, 2),
  fee_amount numeric(14, 2),
  outstanding_principal_amount numeric(14, 2),
  outstanding_interest_amount numeric(14, 2),
  outstanding_fee_amount numeric(14, 2),
  outstanding_amount numeric(14, 2),
  status public.installment_status
)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_total_scheduled_amount numeric(14, 2);
  v_total_interest_amount numeric(14, 2);
  v_regular_interest_amount numeric(14, 2);
  v_schedule_installment_number integer;
  v_interest_component numeric(14, 2);
  v_principal_component numeric(14, 2);
  v_due_dates date[] := '{}';
  v_growth_factors numeric[] := '{}';
  v_days_accrued integer[] := '{}';
  v_previous_date date;
  v_days_elapsed integer;
  v_growth_factor numeric;
  v_cumulative_growth_factor numeric := 1;
  v_discount_factor_sum numeric := 0;
  v_base_installment_amount numeric(14, 2);
  v_outstanding_principal_running numeric(14, 2);
begin
  if p_principal_amount is null or p_principal_amount <= 0 then
    raise exception 'loan_principal_amount_invalid';
  end if;

  if p_total_installments is null or p_total_installments <= 0 then
    raise exception 'loan_total_installments_invalid';
  end if;

  if p_disbursement_date is null then
    raise exception 'loan_disbursement_date_required';
  end if;

  if p_first_due_date is null then
    raise exception 'loan_first_due_date_required';
  end if;

  if p_first_due_date < p_disbursement_date then
    raise exception 'loan_first_due_date_before_disbursement';
  end if;

  if p_interest_mode = 'simple_precomputed'::public.loan_interest_mode
    and p_payment_application_mode <> 'oldest_first'::public.loan_payment_application_mode then
    raise exception 'loan_payment_application_mode_not_supported';
  end if;

  case p_interest_mode
    when 'simple_precomputed'::public.loan_interest_mode then
      if p_installment_amount is null or p_installment_amount <= 0 then
        raise exception 'loan_installment_amount_invalid';
      end if;

      v_total_scheduled_amount := round(p_installment_amount * p_total_installments, 2);

      if v_total_scheduled_amount < p_principal_amount then
        raise exception 'loan_total_scheduled_below_principal';
      end if;

      v_total_interest_amount := round(v_total_scheduled_amount - p_principal_amount, 2);
      v_regular_interest_amount := round(v_total_interest_amount / p_total_installments, 2);

      for v_schedule_installment_number in 1..p_total_installments loop
        installment_number := v_schedule_installment_number;
        scheduled_amount := round(p_installment_amount, 2);
        due_date := private.next_origination_due_date(
          p_first_due_date,
          p_payment_frequency,
          v_schedule_installment_number - 1
        );
        interest_amount := case
          when v_schedule_installment_number = p_total_installments then
            round(v_total_interest_amount - (v_regular_interest_amount * (p_total_installments - 1)), 2)
          else v_regular_interest_amount
        end;
        fee_amount := 0.00;
        v_principal_component := round(scheduled_amount - interest_amount, 2);

        if interest_amount < 0 or v_principal_component < 0 then
          raise exception 'loan_installment_component_invalid';
        end if;

        principal_amount := v_principal_component;
        outstanding_principal_amount := principal_amount;
        outstanding_interest_amount := interest_amount;
        outstanding_fee_amount := fee_amount;
        outstanding_amount := scheduled_amount;
        status := 'pending'::public.installment_status;

        return next;
      end loop;

    when 'compound_fixed_installment'::public.loan_interest_mode then
      if p_interest_rate_daily is null or p_interest_rate_daily < 0 then
        raise exception 'loan_interest_rate_daily_invalid';
      end if;

      for v_schedule_installment_number in 1..p_total_installments loop
        due_date := private.next_origination_due_date(
          p_first_due_date,
          p_payment_frequency,
          v_schedule_installment_number - 1
        );
        v_previous_date := case
          when v_schedule_installment_number = 1 then p_disbursement_date
          else v_due_dates[v_schedule_installment_number - 1]
        end;
        v_days_elapsed := due_date - v_previous_date;

        if v_days_elapsed < 0 then
          raise exception 'loan_first_due_date_before_disbursement';
        end if;

        v_growth_factor := case
          when p_interest_rate_daily = 0 or v_days_elapsed = 0 then 1
          else power((1 + p_interest_rate_daily)::numeric, v_days_elapsed)
        end;
        v_due_dates := array_append(v_due_dates, due_date);
        v_days_accrued := array_append(v_days_accrued, v_days_elapsed);
        v_growth_factors := array_append(v_growth_factors, v_growth_factor);
        v_cumulative_growth_factor := v_cumulative_growth_factor * v_growth_factor;
        v_discount_factor_sum := v_discount_factor_sum + (1 / v_cumulative_growth_factor);
      end loop;

      if v_discount_factor_sum <= 0 then
        raise exception 'compound_discount_factor_invalid';
      end if;

      v_base_installment_amount := round(p_principal_amount / v_discount_factor_sum, 2);
      v_outstanding_principal_running := round(p_principal_amount, 2);

      for v_schedule_installment_number in 1..p_total_installments loop
        installment_number := v_schedule_installment_number;
        due_date := v_due_dates[v_schedule_installment_number];
        fee_amount := 0.00;
        v_interest_component := round(
          v_outstanding_principal_running * (v_growth_factors[v_schedule_installment_number] - 1),
          2
        );
        v_principal_component := case
          when v_schedule_installment_number = p_total_installments then v_outstanding_principal_running
          else round(v_base_installment_amount - v_interest_component, 2)
        end;

        if v_principal_component <= 0 then
          raise exception 'compound_installment_not_covering_interest';
        end if;

        scheduled_amount := case
          when v_schedule_installment_number = p_total_installments then
            round(v_outstanding_principal_running + v_interest_component, 2)
          else round(v_principal_component + v_interest_component, 2)
        end;
        principal_amount := v_principal_component;
        interest_amount := v_interest_component;
        outstanding_principal_amount := principal_amount;
        outstanding_interest_amount := interest_amount;
        outstanding_fee_amount := fee_amount;
        outstanding_amount := scheduled_amount;
        status := 'pending'::public.installment_status;
        v_outstanding_principal_running := round(v_outstanding_principal_running - v_principal_component, 2);

        return next;
      end loop;

      if v_outstanding_principal_running <> 0 then
        raise exception 'compound_schedule_residual_balance';
      end if;

    else
      raise exception 'loan_interest_mode_not_supported';
  end case;
end;
$$;

revoke execute on function private.build_financial_schedule(
  numeric,
  numeric,
  integer,
  public.loan_payment_frequency,
  date,
  date,
  public.loan_interest_mode,
  numeric,
  public.loan_payment_application_mode
) from public;
grant execute on function private.build_financial_schedule(
  numeric,
  numeric,
  integer,
  public.loan_payment_frequency,
  date,
  date,
  public.loan_interest_mode,
  numeric,
  public.loan_payment_application_mode
) to authenticated;

comment on function private.build_financial_schedule(
  numeric,
  numeric,
  integer,
  public.loan_payment_frequency,
  date,
  date,
  public.loan_interest_mode,
  numeric,
  public.loan_payment_application_mode
) is
'Genera el cronograma canonico V1/V2. V1 mantiene simple_precomputed + oldest_first; BR-6 agrega compound_fixed_installment y persiste saldos pendientes por componente desde la originacion.';

create or replace function public.originate_loan(
  p_existing_customer_id uuid,
  p_customer_payload jsonb,
  p_loan_payload jsonb,
  p_installments jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_assigned_collector_id uuid;
  v_created_customer boolean := false;
  v_customer_id uuid;
  v_customer public.customers%rowtype;
  v_target_collector public.profiles%rowtype;
  v_loan_id uuid := extensions.gen_random_uuid();
  v_external_loan_number text;
  v_originated_at timestamptz := timezone('utc', now());
  v_principal_amount numeric(14, 2);
  v_installment_amount numeric(14, 2);
  v_interest_rate_daily numeric(9, 6);
  v_total_installments integer;
  v_payment_frequency_text text;
  v_payment_frequency public.loan_payment_frequency;
  v_disbursement_date date;
  v_first_due_date date;
  v_currency_code text;
  v_interest_mode_text text;
  v_interest_mode public.loan_interest_mode;
  v_payment_application_mode_text text;
  v_payment_application_mode public.loan_payment_application_mode;
  v_notes text;
  v_installment jsonb;
  v_generated_installment record;
  v_inserted_installments integer := 0;
  v_installment_number integer;
  v_due_date date;
  v_scheduled_amount numeric(14, 2);
  v_installment_principal numeric(14, 2);
  v_installment_interest numeric(14, 2);
  v_installment_fee numeric(14, 2);
  v_outstanding_principal_amount numeric(14, 2);
  v_outstanding_interest_amount numeric(14, 2);
  v_outstanding_fee_amount numeric(14, 2);
  v_outstanding_amount numeric(14, 2);
  v_installment_status text;
  v_constraint_name text;
begin
  if v_actor_id is null then
    raise exception 'authentication_required';
  end if;

  if not private.current_profile_is_active() then
    raise exception 'originator_inactive';
  end if;

  if not private.is_admin() then
    raise exception 'originator_role_not_allowed';
  end if;

  if p_existing_customer_id is not null and p_customer_payload is not null then
    raise exception 'customer_mode_conflict';
  end if;

  if p_existing_customer_id is null then
    if coalesce(jsonb_typeof(p_customer_payload), '') <> 'object' then
      raise exception 'customer_payload_required';
    end if;
  elsif p_customer_payload is not null then
    raise exception 'customer_mode_conflict';
  end if;

  if coalesce(jsonb_typeof(p_loan_payload), '') <> 'object' then
    raise exception 'loan_payload_required';
  end if;

  if coalesce(jsonb_typeof(p_installments), '') <> 'array' then
    raise exception 'installments_payload_required';
  end if;

  if jsonb_array_length(p_installments) = 0 then
    raise exception 'installments_payload_required';
  end if;

  if p_existing_customer_id is not null then
    select *
    into v_customer
    from public.customers
    where public.customers.id = p_existing_customer_id;

    if not found then
      raise exception 'existing_customer_not_found';
    end if;

    if v_customer.archived_at is not null then
      raise exception 'existing_customer_archived';
    end if;

    v_customer_id := v_customer.id;
    v_assigned_collector_id := v_customer.assigned_collector_id;
  else
    v_assigned_collector_id := nullif(trim(p_customer_payload ->> 'assigned_collector_id'), '')::uuid;

    if v_assigned_collector_id is null then
      raise exception 'assigned_collector_id_required';
    end if;

    if nullif(trim(p_customer_payload ->> 'full_name'), '') is null then
      raise exception 'customer_full_name_required';
    end if;

    if nullif(trim(p_customer_payload ->> 'government_id'), '') is null then
      raise exception 'customer_government_id_required';
    end if;

    if nullif(trim(p_customer_payload ->> 'phone'), '') is null then
      raise exception 'customer_phone_required';
    end if;

    if nullif(trim(p_customer_payload ->> 'address_line'), '') is null then
      raise exception 'customer_address_line_required';
    end if;

    if nullif(trim(p_customer_payload ->> 'neighborhood'), '') is null then
      raise exception 'customer_neighborhood_required';
    end if;

    v_customer_id := extensions.gen_random_uuid();
    v_created_customer := true;
  end if;

  if not private.can_originate_for_collector(v_assigned_collector_id) then
    raise exception 'assigned_collector_not_allowed';
  end if;

  select *
  into v_target_collector
  from public.profiles
  where public.profiles.id = v_assigned_collector_id;

  if not found or v_target_collector.role <> 'collector'::public.app_role or not v_target_collector.active then
    raise exception 'assigned_collector_must_be_active_collector';
  end if;

  if p_loan_payload ? 'collector_id'
    and nullif(trim(p_loan_payload ->> 'collector_id'), '')::uuid <> v_assigned_collector_id then
    raise exception 'loan_collector_mismatch';
  end if;

  v_principal_amount := coalesce(nullif(trim(p_loan_payload ->> 'principal_amount'), '')::numeric(14, 2), 0);
  v_installment_amount := coalesce(
    nullif(trim(p_loan_payload ->> 'installment_amount'), '')::numeric(14, 2),
    0
  );
  v_interest_rate_daily := coalesce(
    nullif(trim(p_loan_payload ->> 'interest_rate_daily'), '')::numeric(9, 6),
    0
  );
  v_total_installments := coalesce(nullif(trim(p_loan_payload ->> 'total_installments'), '')::integer, 0);
  v_payment_frequency_text := coalesce(nullif(trim(p_loan_payload ->> 'payment_frequency'), ''), '');
  v_disbursement_date := nullif(trim(p_loan_payload ->> 'disbursement_date'), '')::date;
  v_first_due_date := nullif(trim(p_loan_payload ->> 'first_due_date'), '')::date;
  v_currency_code := coalesce(nullif(trim(p_loan_payload ->> 'currency_code'), ''), 'COP');
  v_interest_mode_text := coalesce(
    nullif(trim(p_loan_payload ->> 'interest_mode'), ''),
    'simple_precomputed'
  );
  v_payment_application_mode_text := coalesce(
    nullif(trim(p_loan_payload ->> 'payment_application_mode'), ''),
    'oldest_first'
  );
  v_notes := nullif(trim(p_loan_payload ->> 'notes'), '');

  if v_principal_amount <= 0 then
    raise exception 'loan_principal_amount_invalid';
  end if;

  if v_total_installments <= 0 then
    raise exception 'loan_total_installments_invalid';
  end if;

  if v_payment_frequency_text not in ('daily', 'weekly', 'biweekly', 'monthly') then
    raise exception 'loan_payment_frequency_invalid';
  end if;

  if v_disbursement_date is null then
    raise exception 'loan_disbursement_date_required';
  end if;

  if v_first_due_date is null then
    raise exception 'loan_first_due_date_required';
  end if;

  if v_first_due_date < v_disbursement_date then
    raise exception 'loan_first_due_date_before_disbursement';
  end if;

  if v_currency_code <> 'COP' then
    raise exception 'loan_currency_not_supported';
  end if;

  if v_interest_mode_text not in ('simple_precomputed', 'compound_fixed_installment') then
    raise exception 'loan_interest_mode_not_supported';
  end if;

  if v_payment_application_mode_text not in ('oldest_first', 'principal_only', 'interest_only') then
    raise exception 'loan_payment_application_mode_invalid';
  end if;

  if v_interest_mode_text = 'simple_precomputed' and v_payment_application_mode_text <> 'oldest_first' then
    raise exception 'loan_payment_application_mode_not_supported';
  end if;

  v_payment_frequency := v_payment_frequency_text::public.loan_payment_frequency;
  v_interest_mode := v_interest_mode_text::public.loan_interest_mode;
  v_payment_application_mode := v_payment_application_mode_text::public.loan_payment_application_mode;

  if jsonb_array_length(p_installments) <> v_total_installments then
    raise exception 'installments_count_mismatch';
  end if;

  perform private.build_financial_schedule(
    v_principal_amount,
    v_installment_amount,
    v_total_installments,
    v_payment_frequency,
    v_disbursement_date,
    v_first_due_date,
    v_interest_mode,
    v_interest_rate_daily,
    v_payment_application_mode
  );

  v_external_loan_number :=
    'CD-'
    || to_char(timezone('America/Bogota', v_originated_at), 'YYYYMMDD')
    || '-'
    || upper(substr(replace(v_loan_id::text, '-', ''), 1, 8));

  if exists (
    select 1
    from public.loans
    where public.loans.customer_id = v_customer_id
      and public.loans.status in (
        'draft'::public.loan_status,
        'active'::public.loan_status,
        'delinquent'::public.loan_status
      )
  ) then
    raise exception 'customer_open_loan_exists';
  end if;

  perform set_config('app.origination_write_context', 'on', true);

  if v_created_customer then
    insert into public.customers (
      id,
      assigned_collector_id,
      created_by,
      full_name,
      government_id,
      phone,
      address_line,
      neighborhood,
      latitude,
      longitude,
      notes
    )
    values (
      v_customer_id,
      v_assigned_collector_id,
      v_actor_id,
      trim(p_customer_payload ->> 'full_name'),
      trim(p_customer_payload ->> 'government_id'),
      trim(p_customer_payload ->> 'phone'),
      trim(p_customer_payload ->> 'address_line'),
      trim(p_customer_payload ->> 'neighborhood'),
      nullif(trim(p_customer_payload ->> 'latitude'), '')::numeric(9, 6),
      nullif(trim(p_customer_payload ->> 'longitude'), '')::numeric(9, 6),
      nullif(trim(p_customer_payload ->> 'notes'), '')
    );
  end if;

  insert into public.loans (
    id,
    customer_id,
    collector_id,
    created_by,
    external_loan_number,
    principal_amount,
    installment_amount,
    interest_rate_daily,
    total_installments,
    currency_code,
    disbursement_date,
    first_due_date,
    status,
    payment_frequency,
    interest_mode,
    payment_application_mode,
    originated_at,
    notes
  )
  values (
    v_loan_id,
    v_customer_id,
    v_assigned_collector_id,
    v_actor_id,
    v_external_loan_number,
    v_principal_amount,
    v_installment_amount,
    v_interest_rate_daily,
    v_total_installments,
    'COP',
    v_disbursement_date,
    v_first_due_date,
    'active'::public.loan_status,
    v_payment_frequency,
    v_interest_mode,
    v_payment_application_mode,
    v_originated_at,
    v_notes
  );

  for v_generated_installment in
    select *
    from private.build_financial_schedule(
      v_principal_amount,
      v_installment_amount,
      v_total_installments,
      v_payment_frequency,
      v_disbursement_date,
      v_first_due_date,
      v_interest_mode,
      v_interest_rate_daily,
      v_payment_application_mode
    )
  loop
    v_installment := p_installments -> (v_generated_installment.installment_number - 1);

    if coalesce(jsonb_typeof(v_installment), '') <> 'object' then
      raise exception 'invalid_installment_payload';
    end if;

    v_installment_number := coalesce(nullif(trim(v_installment ->> 'installment_number'), '')::integer, 0);
    v_due_date := nullif(trim(v_installment ->> 'due_date'), '')::date;
    v_scheduled_amount := coalesce(
      nullif(trim(v_installment ->> 'scheduled_amount'), '')::numeric(14, 2),
      0
    );
    v_installment_principal := coalesce(
      nullif(trim(v_installment ->> 'principal_amount'), '')::numeric(14, 2),
      0
    );
    v_installment_interest := coalesce(
      nullif(trim(v_installment ->> 'interest_amount'), '')::numeric(14, 2),
      0
    );
    v_installment_fee := coalesce(nullif(trim(v_installment ->> 'fee_amount'), '')::numeric(14, 2), 0);
    v_outstanding_principal_amount := coalesce(
      nullif(trim(v_installment ->> 'outstanding_principal_amount'), '')::numeric(14, 2),
      0
    );
    v_outstanding_interest_amount := coalesce(
      nullif(trim(v_installment ->> 'outstanding_interest_amount'), '')::numeric(14, 2),
      0
    );
    v_outstanding_fee_amount := coalesce(
      nullif(trim(v_installment ->> 'outstanding_fee_amount'), '')::numeric(14, 2),
      0
    );
    v_outstanding_amount := coalesce(
      nullif(trim(v_installment ->> 'outstanding_amount'), '')::numeric(14, 2),
      0
    );
    v_installment_status := coalesce(nullif(trim(v_installment ->> 'status'), ''), 'pending');

    if v_generated_installment.installment_number = 1
      and v_installment_amount is distinct from v_generated_installment.scheduled_amount then
      raise exception 'installment_schedule_mismatch';
    end if;

    if v_installment_number is distinct from v_generated_installment.installment_number
      or v_due_date is distinct from v_generated_installment.due_date
      or v_scheduled_amount is distinct from v_generated_installment.scheduled_amount
      or v_installment_principal is distinct from v_generated_installment.principal_amount
      or v_installment_interest is distinct from v_generated_installment.interest_amount
      or v_installment_fee is distinct from v_generated_installment.fee_amount
      or v_outstanding_principal_amount is distinct from v_generated_installment.outstanding_principal_amount
      or v_outstanding_interest_amount is distinct from v_generated_installment.outstanding_interest_amount
      or v_outstanding_fee_amount is distinct from v_generated_installment.outstanding_fee_amount
      or v_outstanding_amount is distinct from v_generated_installment.outstanding_amount
      or v_installment_status is distinct from v_generated_installment.status::text then
      raise exception 'installment_schedule_mismatch';
    end if;

    v_inserted_installments := v_inserted_installments + 1;

    insert into public.installments (
      loan_id,
      installment_number,
      due_date,
      scheduled_amount,
      principal_amount,
      interest_amount,
      fee_amount,
      outstanding_principal_amount,
      outstanding_interest_amount,
      outstanding_fee_amount,
      outstanding_amount,
      status
    )
    values (
      v_loan_id,
      v_generated_installment.installment_number,
      v_generated_installment.due_date,
      v_generated_installment.scheduled_amount,
      v_generated_installment.principal_amount,
      v_generated_installment.interest_amount,
      v_generated_installment.fee_amount,
      v_generated_installment.outstanding_principal_amount,
      v_generated_installment.outstanding_interest_amount,
      v_generated_installment.outstanding_fee_amount,
      v_generated_installment.outstanding_amount,
      v_generated_installment.status
    );
  end loop;

  if v_inserted_installments <> v_total_installments then
    raise exception 'installments_count_mismatch';
  end if;

  perform set_config('app.origination_write_context', 'off', true);

  return jsonb_build_object(
    'customer_id', v_customer_id,
    'loan_id', v_loan_id,
    'external_loan_number', v_external_loan_number,
    'created_customer', v_created_customer
  );
exception
  when unique_violation then
    get stacked diagnostics v_constraint_name = constraint_name;
    perform set_config('app.origination_write_context', 'off', true);

    if v_constraint_name = 'customers_government_id_idx' then
      raise exception 'customer_government_id_conflict';
    end if;

    raise;
  when others then
    perform set_config('app.origination_write_context', 'off', true);
    raise;
end;
$$;

comment on function public.originate_loan(uuid, jsonb, jsonb, jsonb) is
'RPC transaccional de originacion V1/V2. PostgreSQL genera el cronograma canonico y solo persiste el alta si la preview enviada por cliente coincide exactamente con el modo financiero y de abono declarados.';
