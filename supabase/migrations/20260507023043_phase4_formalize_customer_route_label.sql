-- BR-2 formaliza la ruta operativa actual sin abrir aun una tabla dedicada.
-- route_label pasa a ser la fuente remota vigente para la agrupacion diaria del cobrador,
-- mientras neighborhood se conserva como contexto geografico y fallback de compatibilidad.

alter table public.customers
  add column if not exists route_label text;

update public.customers
set route_label = coalesce(
  nullif(trim(public.customers.route_label), ''),
  nullif(trim(public.customers.neighborhood), ''),
  'Ruta sin zona'
)
where nullif(trim(public.customers.route_label), '') is null;

alter table public.customers
  alter column route_label set default 'Ruta sin zona',
  alter column route_label set not null;

comment on column public.customers.route_label is
'Fuente remota actual de la ruta operativa del cliente. Mientras no exista una entidad dedicada de rutas, esta etiqueta persiste la asignacion formal que bootstrap y UI deben leer.';

create index if not exists customers_assigned_collector_route_label_idx
on public.customers (assigned_collector_id, route_label);

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
  v_notes text;
  v_route_label_text text;
  v_installment jsonb;
  v_generated_installment record;
  v_inserted_installments integer := 0;
  v_installment_number integer;
  v_due_date date;
  v_scheduled_amount numeric(14, 2);
  v_installment_principal numeric(14, 2);
  v_installment_interest numeric(14, 2);
  v_installment_fee numeric(14, 2);
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
    v_route_label_text := coalesce(
      nullif(trim(p_customer_payload ->> 'route_label'), ''),
      nullif(trim(p_customer_payload ->> 'neighborhood'), '')
    );

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

    if v_route_label_text is null then
      raise exception 'customer_route_label_required';
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
  v_notes := nullif(trim(p_loan_payload ->> 'notes'), '');

  if v_principal_amount <= 0 then
    raise exception 'loan_principal_amount_invalid';
  end if;

  if v_installment_amount <= 0 then
    raise exception 'loan_installment_amount_invalid';
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

  if v_interest_mode_text <> 'simple_precomputed' then
    raise exception 'loan_interest_mode_not_supported';
  end if;

  v_payment_frequency := v_payment_frequency_text::public.loan_payment_frequency;

  if jsonb_array_length(p_installments) <> v_total_installments then
    raise exception 'installments_count_mismatch';
  end if;

  perform private.build_origination_schedule(
    v_principal_amount,
    v_installment_amount,
    v_total_installments,
    v_payment_frequency,
    v_disbursement_date,
    v_first_due_date
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
      route_label,
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
      v_route_label_text,
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
    'simple_precomputed'::public.loan_interest_mode,
    v_originated_at,
    v_notes
  );

  for v_generated_installment in
    select *
    from private.build_origination_schedule(
      v_principal_amount,
      v_installment_amount,
      v_total_installments,
      v_payment_frequency,
      v_disbursement_date,
      v_first_due_date
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
    v_outstanding_amount := coalesce(
      nullif(trim(v_installment ->> 'outstanding_amount'), '')::numeric(14, 2),
      0
    );
    v_installment_status := coalesce(nullif(trim(v_installment ->> 'status'), ''), 'pending');

    if v_installment_number is distinct from v_generated_installment.installment_number
      or v_due_date is distinct from v_generated_installment.due_date
      or v_scheduled_amount is distinct from v_generated_installment.scheduled_amount
      or v_installment_principal is distinct from v_generated_installment.principal_amount
      or v_installment_interest is distinct from v_generated_installment.interest_amount
      or v_installment_fee is distinct from v_generated_installment.fee_amount
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
      v_generated_installment.outstanding_amount,
      v_generated_installment.status
    );
  end loop;

  if v_inserted_installments <> v_total_installments then
    raise exception 'installments_count_mismatch';
  end if;

  perform set_config('app.origination_write_context', 'off', true);

  return jsonb_build_object(
    'created_customer', v_created_customer,
    'customer_id', v_customer_id,
    'loan_id', v_loan_id,
    'external_loan_number', v_external_loan_number
  );
exception
  when unique_violation then
    get stacked diagnostics v_constraint_name = constraint_name;

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
'RPC transaccional de originacion V1. Formaliza route_label como fuente remota de la ruta operativa actual y mantiene el write path cerrado a PostgreSQL.';
