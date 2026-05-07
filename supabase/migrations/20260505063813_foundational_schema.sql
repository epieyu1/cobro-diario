-- Migracion fundacional.
-- Define el dominio base, seguridad inicial y el RPC transaccional para registrar pagos.
create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;

-- Tipos explicitos para que frontend, SQL y cache local hablen el mismo lenguaje de dominio.
create type public.app_role as enum ('admin', 'collector');
create type public.loan_status as enum ('draft', 'active', 'delinquent', 'settled', 'written_off', 'canceled');
create type public.installment_status as enum ('pending', 'partial', 'paid', 'overdue', 'canceled');
create type public.payment_status as enum ('posted', 'reversed');
create type public.sync_event_status as enum ('pending', 'processed', 'conflict');

-- Trigger comun para trazabilidad operativa. Si se elimina, se pierde consistencia de updated_at.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

-- Las funciones privadas encapsulan autorizacion reusable.
-- No moverlas a un esquema expuesto ni convertirlas en shortcuts inseguros.
create or replace function private.current_app_role()
returns public.app_role
language sql
stable
set search_path = ''
as $$
  select case coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '')
    when 'admin' then 'admin'::public.app_role
    else 'collector'::public.app_role
  end;
$$;

create or replace function private.is_admin()
returns boolean
language sql
stable
set search_path = ''
as $$
  select private.current_app_role() = 'admin'::public.app_role;
$$;

create or replace function private.can_access_collector(target_collector_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select private.is_admin() or (select auth.uid()) = target_collector_id;
$$;

-- Las policies de RLS dependen de estos helpers privados.
-- authenticated necesita USAGE sobre el esquema y EXECUTE explicito para que
-- login + lecturas operativas funcionen sin abrir el esquema a PUBLIC.
revoke all on schema private from public;
grant usage on schema private to authenticated;
revoke execute on function private.current_app_role() from public;
revoke execute on function private.is_admin() from public;
revoke execute on function private.can_access_collector(uuid) from public;
grant execute on function private.current_app_role() to authenticated;
grant execute on function private.is_admin() to authenticated;
grant execute on function private.can_access_collector(uuid) to authenticated;

-- Tablas transaccionales base del dominio.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.app_role not null default 'collector',
  full_name text not null,
  phone text,
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.devices (
  id uuid primary key default extensions.gen_random_uuid(),
  collector_id uuid not null references public.profiles (id) on delete cascade,
  device_uid text not null unique,
  device_name text,
  last_seen_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.customers (
  id uuid primary key default extensions.gen_random_uuid(),
  assigned_collector_id uuid not null references public.profiles (id),
  created_by uuid references public.profiles (id),
  full_name text not null,
  government_id text,
  phone text,
  address_line text,
  neighborhood text,
  latitude numeric(9, 6),
  longitude numeric(9, 6),
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  archived_at timestamptz
);

create table public.loans (
  id uuid primary key default extensions.gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  collector_id uuid not null references public.profiles (id),
  external_loan_number text,
  principal_amount numeric(14, 2) not null check (principal_amount > 0),
  installment_amount numeric(14, 2) not null check (installment_amount > 0),
  interest_rate_daily numeric(9, 6) not null default 0,
  total_installments integer not null check (total_installments > 0),
  currency_code text not null default 'COP',
  disbursement_date date not null,
  first_due_date date,
  status public.loan_status not null default 'draft',
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.installments (
  id uuid primary key default extensions.gen_random_uuid(),
  loan_id uuid not null references public.loans (id) on delete cascade,
  installment_number integer not null check (installment_number > 0),
  due_date date not null,
  scheduled_amount numeric(14, 2) not null check (scheduled_amount > 0),
  principal_amount numeric(14, 2) not null default 0,
  interest_amount numeric(14, 2) not null default 0,
  fee_amount numeric(14, 2) not null default 0,
  outstanding_amount numeric(14, 2) not null check (outstanding_amount >= 0),
  status public.installment_status not null default 'pending',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (loan_id, installment_number)
);

create table public.payments (
  id uuid primary key default extensions.gen_random_uuid(),
  customer_id uuid not null references public.customers (id),
  loan_id uuid not null references public.loans (id),
  collector_id uuid not null references public.profiles (id),
  device_id uuid references public.devices (id),
  device_local_id text not null unique,
  payment_reference text,
  payment_method text not null default 'cash',
  total_amount numeric(14, 2) not null check (total_amount > 0),
  status public.payment_status not null default 'posted',
  latitude numeric(9, 6),
  longitude numeric(9, 6),
  notes text,
  paid_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.payment_applications (
  id uuid primary key default extensions.gen_random_uuid(),
  payment_id uuid not null references public.payments (id) on delete cascade,
  installment_id uuid not null references public.installments (id),
  applied_amount numeric(14, 2) not null check (applied_amount > 0),
  principal_component numeric(14, 2) not null default 0,
  interest_component numeric(14, 2) not null default 0,
  fee_component numeric(14, 2) not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  unique (payment_id, installment_id)
);

create table public.payment_events (
  id uuid primary key default extensions.gen_random_uuid(),
  payment_id uuid not null references public.payments (id) on delete cascade,
  actor_id uuid references public.profiles (id),
  event_name text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create table public.sync_events (
  id uuid primary key default extensions.gen_random_uuid(),
  collector_id uuid not null references public.profiles (id),
  client_event_id text not null unique,
  entity_name text not null,
  entity_id uuid,
  status public.sync_event_status not null default 'pending',
  payload jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default timezone('utc', now())
);

comment on table public.payments is
'Registro transaccional confirmado en servidor. device_local_id es la llave de idempotencia para reintentos offline del mismo cobro.';

comment on column public.payments.device_local_id is
'Identificador estable generado por cliente/dispositivo. Debe reutilizarse solo al reintentar exactamente el mismo pago.';

comment on table public.payment_applications is
'Aplicaciones materializadas por cuota. El backend valida coherencia e idempotencia, pero no inventa la distribucion financiera.';

comment on column public.payment_applications.fee_component is
'Bucket temporal para mora y otros cargos hasta que exista un modelo financiero dedicado.';

comment on table public.sync_events is
'Cola y bitacora operativa para sincronizacion. PostgreSQL sigue siendo la fuente final de verdad del negocio.';

comment on column public.sync_events.client_event_id is
'Identificador idempotente del evento producido por la capa local. No debe reciclarse para otra operacion.';

-- Indices minimos para acceso por cobrador, cliente y flujo de pagos.
create index customers_assigned_collector_idx on public.customers (assigned_collector_id);
create unique index customers_government_id_idx on public.customers (government_id) where government_id is not null;
create index customers_created_by_idx on public.customers (created_by);
create index devices_collector_idx on public.devices (collector_id);
create index loans_collector_idx on public.loans (collector_id);
create index loans_customer_idx on public.loans (customer_id);
create index installments_loan_status_idx on public.installments (loan_id, status);
create index payments_collector_paid_at_idx on public.payments (collector_id, paid_at desc);
create index payments_customer_idx on public.payments (customer_id);
create index payments_loan_idx on public.payments (loan_id);
create index payments_device_idx on public.payments (device_id);
create index payment_applications_installment_idx on public.payment_applications (installment_id);
create index payment_events_payment_idx on public.payment_events (payment_id);
create index payment_events_actor_idx on public.payment_events (actor_id);
create index sync_events_collector_status_idx on public.sync_events (collector_id, status);

create trigger profiles_set_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

create trigger devices_set_updated_at
before update on public.devices
for each row
execute function public.set_updated_at();

create trigger customers_set_updated_at
before update on public.customers
for each row
execute function public.set_updated_at();

create trigger loans_set_updated_at
before update on public.loans
for each row
execute function public.set_updated_at();

create trigger installments_set_updated_at
before update on public.installments
for each row
execute function public.set_updated_at();

create trigger payments_set_updated_at
before update on public.payments
for each row
execute function public.set_updated_at();

-- Todas las tablas expuestas quedan con RLS.
-- No deshabilitar esto para "facilitar" el desarrollo.
alter table public.profiles enable row level security;
alter table public.devices enable row level security;
alter table public.customers enable row level security;
alter table public.loans enable row level security;
alter table public.installments enable row level security;
alter table public.payments enable row level security;
alter table public.payment_applications enable row level security;
alter table public.payment_events enable row level security;
alter table public.sync_events enable row level security;

-- Politicas por alcance de cobrador/administracion.
create policy "profiles_select_own_or_management"
on public.profiles
for select
to authenticated
using (private.is_admin() or (select auth.uid()) = id);

create policy "profiles_insert_self"
on public.profiles
for insert
to authenticated
with check (private.is_admin() or (select auth.uid()) = id);

create policy "profiles_update_own_or_management"
on public.profiles
for update
to authenticated
using (private.is_admin() or (select auth.uid()) = id)
with check (private.is_admin() or (select auth.uid()) = id);

create policy "devices_access_by_collector_scope"
on public.devices
for all
to authenticated
using (private.can_access_collector(collector_id))
with check (private.can_access_collector(collector_id));

create policy "customers_access_by_collector_scope"
on public.customers
for all
to authenticated
using (private.can_access_collector(assigned_collector_id))
with check (private.can_access_collector(assigned_collector_id));

create policy "loans_access_by_collector_scope"
on public.loans
for all
to authenticated
using (private.can_access_collector(collector_id))
with check (private.can_access_collector(collector_id));

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

create policy "installments_insert_by_loan_scope"
on public.installments
for insert
to authenticated
with check (
  exists (
    select 1
    from public.loans
    where public.loans.id = installments.loan_id
      and private.can_access_collector(public.loans.collector_id)
  )
);

create policy "installments_update_by_loan_scope"
on public.installments
for update
to authenticated
using (
  exists (
    select 1
    from public.loans
    where public.loans.id = installments.loan_id
      and private.can_access_collector(public.loans.collector_id)
  )
)
with check (
  exists (
    select 1
    from public.loans
    where public.loans.id = installments.loan_id
      and private.can_access_collector(public.loans.collector_id)
  )
);

create policy "payments_access_by_collector_scope"
on public.payments
for all
to authenticated
using (private.can_access_collector(collector_id))
with check (private.can_access_collector(collector_id));

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

create policy "payment_applications_insert_by_payment_scope"
on public.payment_applications
for insert
to authenticated
with check (
  exists (
    select 1
    from public.payments
    where public.payments.id = payment_applications.payment_id
      and private.can_access_collector(public.payments.collector_id)
  )
);

create policy "payment_events_access_by_payment_scope"
on public.payment_events
for all
to authenticated
using (
  exists (
    select 1
    from public.payments
    where public.payments.id = payment_events.payment_id
      and private.can_access_collector(public.payments.collector_id)
  )
)
with check (
  exists (
    select 1
    from public.payments
    where public.payments.id = payment_events.payment_id
      and private.can_access_collector(public.payments.collector_id)
  )
);

create policy "sync_events_access_by_collector_scope"
on public.sync_events
for all
to authenticated
using (private.can_access_collector(collector_id))
with check (private.can_access_collector(collector_id));

-- RPC transaccional del cobro.
-- No fragmentar este flujo en varias escrituras desde frontend porque se pierde atomicidad.
-- Este flujo es idempotente por device_local_id para soportar reintentos offline sin duplicar pagos.
-- La regla financiera final aun vive en la capa que construye p_applications: el backend valida
-- coherencia, alcance y estados pagables, pero no recalcula por si solo la distribucion del cobro.
-- Este RPC fija search_path vacio para no heredar resolucion insegura de nombres.
-- Toda funcion externa al catalogo debe ir calificada o fallara en runtime.
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

  -- Validamos alcance antes de tocar dinero o cuotas.
  if not private.can_access_collector(p_collector_id) then
    raise exception 'collector_not_allowed';
  end if;

  -- Reintentos del mismo cobro deben resolver al mismo registro remoto y no re-aplicar efectos.
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

  -- Cerramos alcance del prestamo antes de insertar el pago para evitar idempotencias cruzadas.
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

  -- El total del pago se deriva de las aplicaciones para evitar divergencia entre cliente y servidor.
  select coalesce(sum((application ->> 'applied_amount')::numeric(14, 2)), 0)
  into v_total_amount
  from jsonb_array_elements(p_applications) as application;

  if v_total_amount <= 0 then
    raise exception 'payment_total_must_be_positive';
  end if;

  -- El insert tambien protege carreras entre reintentos simultaneos del mismo device_local_id.
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

    -- V1 obliga atacar primero la cuota mas antigua con saldo.
    -- Esto evita que UI o sync oculten mora saltando cuotas viejas.
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

    -- Cada aplicacion deja rastro de componentes para preservar auditabilidad financiera.
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

    -- El estado de cuota se actualiza dentro de la misma transaccion para no dejar cobros "a medias".
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

  return v_payment_id;
end;
$$;

-- Solo usuarios autenticados pueden ejecutar el RPC y siempre bajo RLS y alcance asociado.
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
'RPC V1 atomico e idempotente por device_local_id. Obliga la cuota mas antigua primero y fee, interest, principal dentro de cada cuota usando America/Bogota como fecha operativa.';
