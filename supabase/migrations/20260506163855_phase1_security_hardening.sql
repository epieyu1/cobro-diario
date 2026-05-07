-- Endurece la capa remota de Fase 1 sin abrir bypass del RPC financiero.
-- Riesgo cubierto: RLS por si sola no basta si Data API mantiene grants amplios y si
-- un perfil inactivo conserva sesion valida. Este cambio vuelve explicito el least privilege.

-- Este helper necesita SECURITY DEFINER porque lee public.profiles desde una policy
-- que tambien protege a public.profiles. Mantenerlo en private evita exponerlo por Data API.
create or replace function private.current_profile_is_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where public.profiles.id = auth.uid()
      and public.profiles.active
  );
$$;

revoke execute on function private.current_profile_is_active() from public;
grant execute on function private.current_profile_is_active() to authenticated;

comment on function private.current_profile_is_active() is
'Lee el estado active del perfil autenticado desde private para bloquear sesiones vigentes sin caer en recursion de RLS sobre public.profiles.';

create or replace function private.record_payment_write_context_enabled()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(current_setting('app.record_payment_write_context', true), 'off') = 'on';
$$;

revoke execute on function private.record_payment_write_context_enabled() from public;
grant execute on function private.record_payment_write_context_enabled() to authenticated;

comment on function private.record_payment_write_context_enabled() is
'Marca efimera de transaccion que solo public.record_payment habilita para insertar o actualizar tablas criticas sin abrir DML directo equivalente por Data API.';

create or replace function private.can_access_collector(target_collector_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select private.current_profile_is_active()
    and (
      private.is_admin()
      or auth.uid() = target_collector_id
    );
$$;

comment on function private.can_access_collector(uuid) is
'Autoriza alcance por cobrador solo si la sesion sigue activa y el actor es admin o el mismo collector.';

drop policy if exists "profiles_select_own_or_management" on public.profiles;
drop policy if exists "profiles_update_own_or_management" on public.profiles;
drop policy if exists "devices_access_by_collector_scope" on public.devices;
drop policy if exists "customers_access_by_collector_scope" on public.customers;
drop policy if exists "loans_access_by_collector_scope" on public.loans;
drop policy if exists "installments_select_by_loan_scope" on public.installments;
drop policy if exists "installments_insert_by_loan_scope" on public.installments;
drop policy if exists "installments_update_by_loan_scope" on public.installments;
drop policy if exists "payments_access_by_collector_scope" on public.payments;
drop policy if exists "payment_applications_select_by_payment_scope" on public.payment_applications;
drop policy if exists "payment_applications_insert_by_payment_scope" on public.payment_applications;
drop policy if exists "payment_events_access_by_payment_scope" on public.payment_events;
drop policy if exists "sync_events_access_by_collector_scope" on public.sync_events;

create policy "profiles_select_active_scope"
on public.profiles
for select
to authenticated
using (private.can_access_collector(id));

create policy "profiles_update_active_scope"
on public.profiles
for update
to authenticated
using (private.can_access_collector(id))
with check (private.can_access_collector(id));

create policy "devices_select_by_collector_scope"
on public.devices
for select
to authenticated
using (private.can_access_collector(collector_id));

create policy "customers_select_by_collector_scope"
on public.customers
for select
to authenticated
using (private.can_access_collector(assigned_collector_id));

create policy "loans_select_by_collector_scope"
on public.loans
for select
to authenticated
using (private.can_access_collector(collector_id));

create policy "loans_update_via_record_payment_context"
on public.loans
for update
to authenticated
using (
  private.record_payment_write_context_enabled()
  and private.can_access_collector(collector_id)
)
with check (
  private.record_payment_write_context_enabled()
  and private.can_access_collector(collector_id)
);

create policy "installments_select_by_loan_scope"
on public.installments
for select
to authenticated
using (
  exists (
    select 1
    from public.loans
    where public.loans.id = installments.loan_id
      and private.can_access_collector(public.loans.collector_id)
  )
);

create policy "installments_update_via_record_payment_context"
on public.installments
for update
to authenticated
using (
  private.record_payment_write_context_enabled()
  and exists (
    select 1
    from public.loans
    where public.loans.id = installments.loan_id
      and private.can_access_collector(public.loans.collector_id)
  )
)
with check (
  private.record_payment_write_context_enabled()
  and exists (
    select 1
    from public.loans
    where public.loans.id = installments.loan_id
      and private.can_access_collector(public.loans.collector_id)
  )
);

create policy "payments_select_by_collector_scope"
on public.payments
for select
to authenticated
using (private.can_access_collector(collector_id));

create policy "payments_insert_via_record_payment_context"
on public.payments
for insert
to authenticated
with check (
  private.record_payment_write_context_enabled()
  and private.can_access_collector(collector_id)
);

create policy "payment_applications_select_by_payment_scope"
on public.payment_applications
for select
to authenticated
using (
  exists (
    select 1
    from public.payments
    where public.payments.id = payment_applications.payment_id
      and private.can_access_collector(public.payments.collector_id)
  )
);

create policy "payment_applications_insert_via_record_payment_context"
on public.payment_applications
for insert
to authenticated
with check (
  private.record_payment_write_context_enabled()
  and exists (
    select 1
    from public.payments
    where public.payments.id = payment_applications.payment_id
      and private.can_access_collector(public.payments.collector_id)
  )
);

create policy "payment_events_select_by_payment_scope"
on public.payment_events
for select
to authenticated
using (
  exists (
    select 1
    from public.payments
    where public.payments.id = payment_events.payment_id
      and private.can_access_collector(public.payments.collector_id)
  )
);

create policy "payment_events_insert_via_record_payment_context"
on public.payment_events
for insert
to authenticated
with check (
  private.record_payment_write_context_enabled()
  and exists (
    select 1
    from public.payments
    where public.payments.id = payment_events.payment_id
      and private.can_access_collector(public.payments.collector_id)
  )
);

create policy "sync_events_select_by_collector_scope"
on public.sync_events
for select
to authenticated
using (private.can_access_collector(collector_id));

-- La Data API del cliente actual solo necesita lecturas directas y el DML minimo
-- que consume public.record_payment bajo SECURITY INVOKER. Todo lo demas queda revocado.
revoke all on table public.profiles from anon, authenticated;
revoke all on table public.devices from anon, authenticated;
revoke all on table public.customers from anon, authenticated;
revoke all on table public.loans from anon, authenticated;
revoke all on table public.installments from anon, authenticated;
revoke all on table public.payments from anon, authenticated;
revoke all on table public.payment_applications from anon, authenticated;
revoke all on table public.payment_events from anon, authenticated;
revoke all on table public.sync_events from anon, authenticated;

grant select on table public.profiles to authenticated;
grant select on table public.devices to authenticated;
grant select on table public.customers to authenticated;
grant select on table public.loans to authenticated;
grant select on table public.installments to authenticated;
grant select on table public.payments to authenticated;
grant select on table public.payment_applications to authenticated;
grant select on table public.payment_events to authenticated;
grant select on table public.sync_events to authenticated;

grant update on table public.loans to authenticated;
grant update on table public.installments to authenticated;
grant insert on table public.payments to authenticated;
grant insert on table public.payment_applications to authenticated;
grant insert on table public.payment_events to authenticated;

alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated;

-- Este RPC sigue siendo el unico camino autorizado para registrar el cobro confirmado.
-- Abre un contexto local de escritura solo durante la transaccion del RPC para que
-- el browser client no pueda replicar el mismo DML por REST fuera del contrato.
create or replace function public.record_payment(
  p_device_local_id text,
  p_payment_reference text,
  p_collector_id uuid,
  p_customer_id uuid,
  p_loan_id uuid,
  p_device_id uuid,
  p_payment_method text,
  p_paid_at timestamptz,
  p_latitude numeric,
  p_longitude numeric,
  p_notes text,
  p_applications jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_payment_id uuid;
  v_inserted_payment_id uuid;
  v_total_amount numeric(14, 2);
  v_application jsonb;
  v_application_installment_id uuid;
  v_loan public.loans%rowtype;
  v_installment public.installments%rowtype;
  v_expected_installment_id uuid;
  v_existing_payment public.payments%rowtype;
  v_device public.devices%rowtype;
  v_applied_amount numeric(14, 2);
  v_principal_component numeric(14, 2);
  v_interest_component numeric(14, 2);
  v_fee_component numeric(14, 2);
  v_component_total numeric(14, 2);
  v_remaining_amount numeric(14, 2);
  v_business_date date := timezone('America/Bogota', p_paid_at)::date;
  v_paid_principal numeric(14, 2);
  v_paid_interest numeric(14, 2);
  v_paid_fee numeric(14, 2);
  v_remaining_principal_component numeric(14, 2);
  v_remaining_interest_component numeric(14, 2);
  v_remaining_fee_component numeric(14, 2);
  v_installment_component_outstanding numeric(14, 2);
  v_expected_fee_component numeric(14, 2);
  v_expected_interest_component numeric(14, 2);
  v_expected_principal_component numeric(14, 2);
  v_remaining_to_allocate numeric(14, 2);
begin
  if nullif(trim(p_device_local_id), '') is null then
    raise exception 'device_local_id_required';
  end if;

  if p_paid_at is null then
    raise exception 'paid_at_required';
  end if;

  if not private.can_access_collector(p_collector_id) then
    raise exception 'collector_not_allowed';
  end if;

  -- La trazabilidad del dispositivo solo es confiable si el UUID pertenece al mismo cobrador.
  if p_device_id is not null then
    select *
    into v_device
    from public.devices
    where public.devices.id = p_device_id;

    if not found or v_device.collector_id <> p_collector_id then
      raise exception 'device_not_owned_by_collector';
    end if;
  end if;

  select *
  into v_existing_payment
  from public.payments
  where public.payments.device_local_id = p_device_local_id;

  if found then
    if v_existing_payment.loan_id = p_loan_id
      and v_existing_payment.customer_id = p_customer_id
      and v_existing_payment.collector_id = p_collector_id then
      return v_existing_payment.id;
    end if;

    raise exception 'device_local_id_conflict';
  end if;

  if jsonb_typeof(p_applications) <> 'array' or jsonb_array_length(p_applications) = 0 then
    raise exception 'payment_requires_applications';
  end if;

  if exists (
    select 1
    from (
      select application ->> 'installment_id' as installment_id
      from jsonb_array_elements(p_applications) as application
      group by application ->> 'installment_id'
      having count(*) > 1
    ) as duplicated_installments
  ) then
    raise exception 'duplicate_installment_application';
  end if;

  select *
  into v_loan
  from public.loans
  where public.loans.id = p_loan_id
  for update;

  if not found then
    raise exception 'loan_not_found';
  end if;

  if v_loan.customer_id <> p_customer_id then
    raise exception 'loan_customer_mismatch';
  end if;

  if v_loan.collector_id <> p_collector_id then
    raise exception 'loan_collector_mismatch';
  end if;

  if v_loan.status not in ('active'::public.loan_status, 'delinquent'::public.loan_status) then
    raise exception 'loan_status_not_payable';
  end if;

  select coalesce(sum((application ->> 'applied_amount')::numeric(14, 2)), 0)
  into v_total_amount
  from jsonb_array_elements(p_applications) as application;

  if v_total_amount <= 0 then
    raise exception 'payment_total_must_be_positive';
  end if;

  perform set_config('app.record_payment_write_context', 'on', true);

  insert into public.payments (
    id,
    customer_id,
    loan_id,
    collector_id,
    device_id,
    device_local_id,
    payment_reference,
    payment_method,
    total_amount,
    latitude,
    longitude,
    notes,
    paid_at
  )
  values (
    extensions.gen_random_uuid(),
    p_customer_id,
    p_loan_id,
    p_collector_id,
    p_device_id,
    p_device_local_id,
    p_payment_reference,
    coalesce(nullif(trim(p_payment_method), ''), 'cash'),
    v_total_amount,
    p_latitude,
    p_longitude,
    p_notes,
    p_paid_at
  )
  on conflict (device_local_id) do nothing
  returning id into v_inserted_payment_id;

  if v_inserted_payment_id is null then
    select *
    into v_existing_payment
    from public.payments
    where public.payments.device_local_id = p_device_local_id;

    if found
      and v_existing_payment.loan_id = p_loan_id
      and v_existing_payment.customer_id = p_customer_id
      and v_existing_payment.collector_id = p_collector_id then
      perform set_config('app.record_payment_write_context', 'off', true);
      return v_existing_payment.id;
    end if;

    raise exception 'device_local_id_conflict';
  end if;

  v_payment_id := v_inserted_payment_id;

  for v_application in
    select value from jsonb_array_elements(p_applications)
  loop
    if jsonb_typeof(v_application) <> 'object' then
      raise exception 'invalid_payment_application';
    end if;

    if nullif(v_application ->> 'installment_id', '') is null then
      raise exception 'installment_id_required';
    end if;

    v_application_installment_id := (v_application ->> 'installment_id')::uuid;

    select public.installments.id
    into v_expected_installment_id
    from public.installments
    where public.installments.loan_id = p_loan_id
      and public.installments.outstanding_amount > 0
      and public.installments.status not in ('paid'::public.installment_status, 'canceled'::public.installment_status)
    order by public.installments.due_date asc, public.installments.installment_number asc, public.installments.id asc
    limit 1
    for update;

    if not found then
      raise exception 'loan_without_payable_installments';
    end if;

    if v_expected_installment_id <> v_application_installment_id then
      raise exception 'installment_order_violation';
    end if;

    select *
    into v_installment
    from public.installments
    where public.installments.id = v_application_installment_id
      and public.installments.loan_id = p_loan_id
    for update;

    if not found then
      raise exception 'installment_not_found_for_loan';
    end if;

    if v_installment.status in ('paid'::public.installment_status, 'canceled'::public.installment_status) then
      raise exception 'installment_not_payable';
    end if;

    select
      coalesce(sum(public.payment_applications.principal_component), 0),
      coalesce(sum(public.payment_applications.interest_component), 0),
      coalesce(sum(public.payment_applications.fee_component), 0)
    into
      v_paid_principal,
      v_paid_interest,
      v_paid_fee
    from public.payment_applications
    where public.payment_applications.installment_id = v_installment.id;

    v_remaining_principal_component := v_installment.principal_amount - v_paid_principal;
    v_remaining_interest_component := v_installment.interest_amount - v_paid_interest;
    v_remaining_fee_component := v_installment.fee_amount - v_paid_fee;
    v_installment_component_outstanding :=
      v_remaining_principal_component + v_remaining_interest_component + v_remaining_fee_component;

    if v_remaining_principal_component < 0
      or v_remaining_interest_component < 0
      or v_remaining_fee_component < 0 then
      raise exception 'installment_component_balance_invalid';
    end if;

    if v_installment_component_outstanding <> v_installment.outstanding_amount then
      raise exception 'installment_component_balance_mismatch';
    end if;

    v_applied_amount := coalesce((v_application ->> 'applied_amount')::numeric(14, 2), 0);
    v_principal_component := coalesce((v_application ->> 'principal_component')::numeric(14, 2), 0);
    v_interest_component := coalesce((v_application ->> 'interest_component')::numeric(14, 2), 0);
    v_fee_component := coalesce((v_application ->> 'fee_component')::numeric(14, 2), 0);

    if v_applied_amount <= 0 then
      raise exception 'invalid_applied_amount';
    end if;

    if v_principal_component < 0 or v_interest_component < 0 or v_fee_component < 0 then
      raise exception 'negative_component_not_allowed';
    end if;

    v_component_total := v_principal_component + v_interest_component + v_fee_component;

    if v_component_total <> v_applied_amount then
      raise exception 'application_components_mismatch';
    end if;

    v_remaining_to_allocate := v_applied_amount;
    v_expected_fee_component := least(v_remaining_to_allocate, v_remaining_fee_component);
    v_remaining_to_allocate := v_remaining_to_allocate - v_expected_fee_component;
    v_expected_interest_component := least(v_remaining_to_allocate, v_remaining_interest_component);
    v_remaining_to_allocate := v_remaining_to_allocate - v_expected_interest_component;
    v_expected_principal_component := least(v_remaining_to_allocate, v_remaining_principal_component);
    v_remaining_to_allocate := v_remaining_to_allocate - v_expected_principal_component;

    if v_remaining_to_allocate <> 0 then
      raise exception 'application_exceeds_component_balance';
    end if;

    if v_fee_component <> v_expected_fee_component
      or v_interest_component <> v_expected_interest_component
      or v_principal_component <> v_expected_principal_component then
      raise exception 'application_order_violation';
    end if;

    if v_applied_amount > v_installment.outstanding_amount then
      raise exception 'applied_amount_exceeds_outstanding';
    end if;

    insert into public.payment_applications (
      payment_id,
      installment_id,
      applied_amount,
      principal_component,
      interest_component,
      fee_component
    )
    values (
      v_payment_id,
      v_installment.id,
      v_applied_amount,
      v_principal_component,
      v_interest_component,
      v_fee_component
    );

    v_remaining_amount := v_installment.outstanding_amount - v_applied_amount;

    update public.installments
    set
      outstanding_amount = v_remaining_amount,
      status = case
        when v_remaining_amount = 0 then 'paid'::public.installment_status
        when due_date < v_business_date then 'overdue'::public.installment_status
        when v_remaining_amount < scheduled_amount then 'partial'::public.installment_status
        else 'pending'::public.installment_status
      end
    where id = v_installment.id;
  end loop;

  update public.loans
  set status = case
    when status in ('written_off'::public.loan_status, 'canceled'::public.loan_status) then status
    when not exists (
      select 1
      from public.installments
      where public.installments.loan_id = p_loan_id
        and public.installments.outstanding_amount > 0
    ) then 'settled'::public.loan_status
    when exists (
      select 1
      from public.installments
      where public.installments.loan_id = p_loan_id
        and public.installments.outstanding_amount > 0
        and public.installments.due_date < v_business_date
    ) then 'delinquent'::public.loan_status
    else 'active'::public.loan_status
  end
  where id = p_loan_id;

  insert into public.payment_events (
    payment_id,
    actor_id,
    event_name,
    payload
  )
  values (
    v_payment_id,
    p_collector_id,
    'payment_recorded',
    jsonb_build_object(
      'device_local_id', p_device_local_id,
      'application_count', jsonb_array_length(p_applications),
      'derived_total_amount', v_total_amount,
      'business_date', v_business_date,
      'business_timezone', 'America/Bogota'
    )
  );

  perform set_config('app.record_payment_write_context', 'off', true);
  return v_payment_id;
exception
  when others then
    perform set_config('app.record_payment_write_context', 'off', true);
    raise;
end;
$$;

revoke execute on function public.record_payment(
  text,
  text,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  timestamptz,
  numeric,
  numeric,
  text,
  jsonb
) from public;

grant execute on function public.record_payment(
  text,
  text,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  timestamptz,
  numeric,
  numeric,
  text,
  jsonb
) to authenticated;

comment on function public.record_payment(
  text,
  text,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  timestamptz,
  numeric,
  numeric,
  text,
  jsonb
) is
'RPC V1 atomico e idempotente por device_local_id. Solo acepta device_id del mismo cobrador y abre un contexto local de escritura para evitar bypass directo del contrato por Data API.';
