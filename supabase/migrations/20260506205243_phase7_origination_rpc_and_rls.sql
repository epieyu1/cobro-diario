-- OR-1 abre el write path transaccional de originacion sin debilitar el hardening de Fase 1.
-- Flujo: actor management autenticado -> public.originate_loan() -> contexto efimero de escritura
-- -> insercion atomica de customers/loans/installments -> confirmacion JSON para refresh de cartera.
-- Riesgo: si se reabre INSERT directo equivalente por Data API, se pierde la garantia de un solo
-- prestamo abierto por cliente dentro del write path autorizado y se fragmenta la trazabilidad.

create type public.loan_payment_frequency as enum ('daily', 'weekly', 'biweekly', 'monthly');
create type public.loan_interest_mode as enum ('simple_precomputed');

alter table public.loans
  add column if not exists created_by uuid references public.profiles (id),
  add column if not exists originated_at timestamptz,
  add column if not exists payment_frequency public.loan_payment_frequency,
  add column if not exists interest_mode public.loan_interest_mode;

-- Los prestamos legacy nacieron antes del contrato explicito de originacion.
-- Se backfillean contra created_at y el baseline diario/simple_precomputed documentado
-- para no dejar filas nulas cuando el nuevo RPC y futuros reportes lean estos metadatos.
update public.loans
set
  created_by = coalesce(
    public.loans.created_by,
    (
      select public.customers.created_by
      from public.customers
      where public.customers.id = public.loans.customer_id
    ),
    public.loans.collector_id
  ),
  originated_at = coalesce(public.loans.originated_at, public.loans.created_at),
  payment_frequency = coalesce(public.loans.payment_frequency, 'daily'::public.loan_payment_frequency),
  interest_mode = coalesce(public.loans.interest_mode, 'simple_precomputed'::public.loan_interest_mode)
where
  public.loans.created_by is null
  or public.loans.originated_at is null
  or public.loans.payment_frequency is null
  or public.loans.interest_mode is null;

alter table public.loans
  alter column created_by set not null,
  alter column originated_at set not null,
  alter column originated_at set default timezone('utc', now()),
  alter column payment_frequency set not null,
  alter column payment_frequency set default 'daily'::public.loan_payment_frequency,
  alter column interest_mode set not null,
  alter column interest_mode set default 'simple_precomputed'::public.loan_interest_mode;

comment on column public.loans.created_by is
'Actor autenticado que confirmo la originacion del prestamo. La fuente de verdad del alta vive en public.originate_loan y no en inserts directos del cliente.';

comment on column public.loans.originated_at is
'Marca temporal oficial del alta del prestamo. No inferirla desde IndexedDB ni desde el render del frontend.';

comment on column public.loans.payment_frequency is
'Frecuencia contractual materializada para preview, reporting y futuras reglas de originacion. V1 soporta daily, weekly, biweekly y monthly.';

comment on column public.loans.interest_mode is
'Modo financiero del prestamo. V1 de originacion queda congelado en simple_precomputed hasta que exista motor financiero V2.';

create or replace function private.origination_write_context_enabled()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(current_setting('app.origination_write_context', true), 'off') = 'on';
$$;

revoke execute on function private.origination_write_context_enabled() from public;
grant execute on function private.origination_write_context_enabled() to authenticated;

comment on function private.origination_write_context_enabled() is
'Marca efimera de transaccion que solo public.originate_loan habilita para insertar customers, loans e installments sin abrir un bypass equivalente por Data API.';

create or replace function private.can_originate_for_collector(target_collector_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select private.current_profile_is_active()
    and private.is_admin()
    and private.can_access_collector(target_collector_id);
$$;

revoke execute on function private.can_originate_for_collector(uuid) from public;
grant execute on function private.can_originate_for_collector(uuid) to authenticated;

comment on function private.can_originate_for_collector(uuid) is
'Autoriza originacion solo a admin activo dentro del alcance permitido del collector destino. Los collectors no originan en V1.';

drop policy if exists "customers_insert_via_origination_context" on public.customers;
drop policy if exists "loans_insert_via_origination_context" on public.loans;
drop policy if exists "installments_insert_via_origination_context" on public.installments;

create policy "customers_insert_via_origination_context"
on public.customers
for insert
to authenticated
with check (
  private.origination_write_context_enabled()
  and private.can_originate_for_collector(assigned_collector_id)
  and created_by = auth.uid()
);

create policy "loans_insert_via_origination_context"
on public.loans
for insert
to authenticated
with check (
  private.origination_write_context_enabled()
  and private.can_originate_for_collector(collector_id)
  and created_by = auth.uid()
  and originated_at is not null
  and interest_mode = 'simple_precomputed'::public.loan_interest_mode
);

create policy "installments_insert_via_origination_context"
on public.installments
for insert
to authenticated
with check (
  private.origination_write_context_enabled()
  and exists (
    select 1
    from public.loans
    where public.loans.id = installments.loan_id
      and private.can_originate_for_collector(public.loans.collector_id)
  )
);

grant insert on table public.customers to authenticated;
grant insert on table public.loans to authenticated;
grant insert on table public.installments to authenticated;

-- Este RPC centraliza la originacion V1 para conservar atomicidad y trazabilidad.
-- No fragmentar el alta en inserts desde frontend: el cliente debe llegar aqui con
-- customer/loan/installments ya materializados y dejar que PostgreSQL confirme o rechace todo.
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
  v_installment jsonb;
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

  for v_installment in
    select value
    from jsonb_array_elements(p_installments)
  loop
    if coalesce(jsonb_typeof(v_installment), '') <> 'object' then
      raise exception 'invalid_installment_payload';
    end if;

    v_inserted_installments := v_inserted_installments + 1;
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

    if v_installment_number <> v_inserted_installments then
      raise exception 'installment_number_sequence_invalid';
    end if;

    if v_due_date is null then
      raise exception 'installment_due_date_required';
    end if;

    if v_scheduled_amount <= 0 then
      raise exception 'installment_scheduled_amount_invalid';
    end if;

    if v_installment_principal < 0 or v_installment_interest < 0 or v_installment_fee < 0 then
      raise exception 'installment_component_negative';
    end if;

    if v_scheduled_amount <> v_installment_principal + v_installment_interest + v_installment_fee then
      raise exception 'installment_component_total_mismatch';
    end if;

    if v_outstanding_amount <> v_scheduled_amount then
      raise exception 'installment_outstanding_must_match_scheduled';
    end if;

    if v_installment_status <> 'pending' then
      raise exception 'installment_status_must_start_pending';
    end if;

    if v_inserted_installments = 1 and v_due_date <> v_first_due_date then
      raise exception 'installment_first_due_date_mismatch';
    end if;

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
      v_installment_number,
      v_due_date,
      v_scheduled_amount,
      v_installment_principal,
      v_installment_interest,
      v_installment_fee,
      v_outstanding_amount,
      'pending'::public.installment_status
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

revoke execute on function public.originate_loan(uuid, jsonb, jsonb, jsonb) from public;
grant execute on function public.originate_loan(uuid, jsonb, jsonb, jsonb) to authenticated;

comment on function public.originate_loan(uuid, jsonb, jsonb, jsonb) is
'RPC transaccional de originacion V1. Solo admin activo puede originar para un collector activo y el cliente no debe reemplazarlo por inserts directos a customers, loans o installments.';
