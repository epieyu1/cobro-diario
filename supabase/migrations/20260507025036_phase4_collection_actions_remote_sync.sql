-- BR-2 formaliza la gestión de visita remota sin abrir DML directo por Data API.
-- collection_actions conserva continuidad offline via device_local_id y mantiene a PostgreSQL
-- como fuente de verdad de la auditoria de campo.

create table if not exists public.collection_actions (
  id uuid primary key default extensions.gen_random_uuid(),
  collector_id uuid not null references public.profiles (id),
  created_by uuid not null references public.profiles (id),
  customer_id uuid not null references public.customers (id),
  loan_id uuid not null references public.loans (id) on delete cascade,
  device_local_id text not null unique,
  outcome text not null check (
    outcome in ('promise_to_pay', 'not_found', 'return_visit', 'visited_no_payment')
  ),
  notes text,
  follow_up_at date,
  latitude numeric(9, 6),
  longitude numeric(9, 6),
  recorded_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.collection_actions enable row level security;

comment on table public.collection_actions is
'Auditoria remota de gestion de visita. device_local_id materializa idempotencia offline y created_by separa el actor autenticado del collector dueno del prestamo.';

create index if not exists collection_actions_collector_recorded_at_idx
on public.collection_actions (collector_id, recorded_at desc);

create index if not exists collection_actions_loan_recorded_at_idx
on public.collection_actions (loan_id, recorded_at desc);

create or replace function private.record_collection_action_write_context_enabled()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(current_setting('app.record_collection_action_write_context', true), 'off') = 'on';
$$;

revoke execute on function private.record_collection_action_write_context_enabled() from public;
grant execute on function private.record_collection_action_write_context_enabled() to authenticated;

comment on function private.record_collection_action_write_context_enabled() is
'Marca efimera de transaccion habilitada solo por public.record_collection_action() para insertar collection_actions sin abrir un bypass equivalente por REST.';

drop policy if exists "collection_actions_select_by_collector_scope" on public.collection_actions;
drop policy if exists "collection_actions_insert_via_record_collection_action_context" on public.collection_actions;

create policy "collection_actions_select_by_collector_scope"
on public.collection_actions
for select
to authenticated
using (private.can_access_collector(collector_id));

create policy "collection_actions_insert_via_record_collection_action_context"
on public.collection_actions
for insert
to authenticated
with check (
  private.record_collection_action_write_context_enabled()
  and private.can_access_collector(collector_id)
);

revoke all on table public.collection_actions from anon, authenticated;
grant select on table public.collection_actions to authenticated;
grant insert on table public.collection_actions to authenticated;

create or replace function public.record_collection_action(
  p_device_local_id text,
  p_collector_id uuid,
  p_customer_id uuid,
  p_loan_id uuid,
  p_outcome text,
  p_follow_up_at date,
  p_latitude numeric,
  p_longitude numeric,
  p_notes text,
  p_recorded_at timestamptz
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_action_id uuid := extensions.gen_random_uuid();
  v_constraint_name text;
  v_existing_action public.collection_actions%rowtype;
  v_customer public.customers%rowtype;
  v_loan public.loans%rowtype;
  v_outcome text := coalesce(nullif(trim(p_outcome), ''), '');
begin
  if v_actor_id is null then
    raise exception 'authentication_required';
  end if;

  if not private.current_profile_is_active() then
    raise exception 'operator_inactive';
  end if;

  if nullif(trim(p_device_local_id), '') is null then
    raise exception 'device_local_id_required';
  end if;

  if p_recorded_at is null then
    raise exception 'recorded_at_required';
  end if;

  if not private.can_access_collector(p_collector_id) then
    raise exception 'collector_not_allowed';
  end if;

  select *
  into v_existing_action
  from public.collection_actions
  where public.collection_actions.device_local_id = p_device_local_id;

  if found then
    if v_existing_action.loan_id = p_loan_id
      and v_existing_action.customer_id = p_customer_id
      and v_existing_action.collector_id = p_collector_id then
      return v_existing_action.id;
    end if;

    raise exception 'device_local_id_conflict';
  end if;

  if v_outcome not in ('promise_to_pay', 'not_found', 'return_visit', 'visited_no_payment') then
    raise exception 'collection_action_outcome_invalid';
  end if;

  if v_outcome in ('promise_to_pay', 'return_visit') and p_follow_up_at is null then
    raise exception 'collection_action_follow_up_required';
  end if;

  select *
  into v_customer
  from public.customers
  where public.customers.id = p_customer_id;

  if not found then
    raise exception 'customer_not_found';
  end if;

  if v_customer.archived_at is not null then
    raise exception 'customer_archived';
  end if;

  if v_customer.assigned_collector_id <> p_collector_id then
    raise exception 'customer_collector_mismatch';
  end if;

  select *
  into v_loan
  from public.loans
  where public.loans.id = p_loan_id;

  if not found then
    raise exception 'loan_not_found';
  end if;

  if v_loan.customer_id <> p_customer_id then
    raise exception 'loan_customer_mismatch';
  end if;

  if v_loan.collector_id <> p_collector_id then
    raise exception 'loan_collector_mismatch';
  end if;

  perform set_config('app.record_collection_action_write_context', 'on', true);

  insert into public.collection_actions (
    id,
    collector_id,
    created_by,
    customer_id,
    loan_id,
    device_local_id,
    outcome,
    notes,
    follow_up_at,
    latitude,
    longitude,
    recorded_at
  )
  values (
    v_action_id,
    p_collector_id,
    v_actor_id,
    p_customer_id,
    p_loan_id,
    trim(p_device_local_id),
    v_outcome,
    nullif(trim(p_notes), ''),
    p_follow_up_at,
    p_latitude,
    p_longitude,
    p_recorded_at
  );

  perform set_config('app.record_collection_action_write_context', 'off', true);

  return v_action_id;
exception
  when unique_violation then
    get stacked diagnostics v_constraint_name = constraint_name;

    if v_constraint_name = 'collection_actions_device_local_id_key' then
      raise exception 'device_local_id_conflict';
    end if;

    raise;
  when others then
    perform set_config('app.record_collection_action_write_context', 'off', true);
    raise;
end;
$$;

revoke execute on function public.record_collection_action(
  text,
  uuid,
  uuid,
  uuid,
  text,
  date,
  numeric,
  numeric,
  text,
  timestamptz
) from public;

grant execute on function public.record_collection_action(
  text,
  uuid,
  uuid,
  uuid,
  text,
  date,
  numeric,
  numeric,
  text,
  timestamptz
) to authenticated;

comment on function public.record_collection_action(
  text,
  uuid,
  uuid,
  uuid,
  text,
  date,
  numeric,
  numeric,
  text,
  timestamptz
) is
'RPC idempotente de gestion de visita. Persiste collection_actions con device_local_id estable, valida alcance por collector y mantiene el write path cerrado a PostgreSQL.';
