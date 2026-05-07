-- Sanea residuos tecnicos del corte a admin/collector.
-- Flujo: normaliza datos legacy -> elimina helper privado ya inutil -> recrea el enum
-- de roles sin valores sobrantes -> limpia identidad semilla residual si no tiene trazas.
-- Riesgo: si se cambia el enum sin esta secuencia, current_app_role() y profiles.role
-- pueden quedar apuntando a tipos distintos y romper Auth o RLS en tiempo de ejecucion.

update public.profiles
set
  role = 'collector'::public.app_role,
  updated_at = timezone('utc', now())
where public.profiles.role::text not in ('admin', 'collector');

update auth.users
set
  raw_app_meta_data = coalesce(auth.users.raw_app_meta_data, '{}'::jsonb)
    || jsonb_build_object('role', 'collector'),
  updated_at = timezone('utc', now())
where coalesce(auth.users.raw_app_meta_data ->> 'role', '') not in ('', 'admin', 'collector');

drop policy if exists "profiles_insert_self" on public.profiles;

create policy "profiles_insert_self"
on public.profiles
for insert
to authenticated
with check (private.is_admin() or (select auth.uid()) = id);

do $$
declare
  v_legacy_helper text;
begin
  select format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
  into v_legacy_helper
  from pg_proc p
  join pg_namespace n
    on n.oid = p.pronamespace
  where n.nspname = 'private'
    and p.proname like 'is_admin_or_%'
    and pg_get_function_result(p.oid) = 'boolean'
  limit 1;

  if v_legacy_helper is not null then
    execute format('drop function %s', v_legacy_helper);
  end if;
end;
$$;

drop function private.current_app_role();

alter table public.profiles
  alter column role drop default;

alter type public.app_role rename to app_role_legacy;

create type public.app_role as enum ('admin', 'collector');

alter table public.profiles
  alter column role type public.app_role
  using (
    case public.profiles.role::text
      when 'admin' then 'admin'
      else 'collector'
    end
  )::public.app_role;

alter table public.profiles
  alter column role set default 'collector'::public.app_role;

create function private.current_app_role()
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

revoke execute on function private.current_app_role() from public;
grant execute on function private.current_app_role() to authenticated;

comment on function private.current_app_role() is
'Mapea el claim operativo del JWT al contrato final de roles. Cualquier valor fuera de admin degrada a collector para no reabrir privilegios legacy.';

create or replace function private.is_admin()
returns boolean
language sql
stable
set search_path = ''
as $$
  select private.current_app_role() = 'admin'::public.app_role;
$$;

revoke execute on function private.is_admin() from public;
grant execute on function private.is_admin() to authenticated;

comment on function private.is_admin() is
'Determina si el actor autenticado conserva privilegio de administracion. El unico rol privilegiado operativo es admin.';

drop type public.app_role_legacy;

with legacy_seed as (
  select public.profiles.id
  from public.profiles
  where public.profiles.full_name = 'Fase 7 Legacy Collector'
    and public.profiles.role = 'collector'::public.app_role
    and public.profiles.active is false
    and not exists (
      select 1
      from public.devices
      where public.devices.collector_id = public.profiles.id
    )
    and not exists (
      select 1
      from public.customers
      where public.customers.assigned_collector_id = public.profiles.id
         or public.customers.created_by = public.profiles.id
    )
    and not exists (
      select 1
      from public.loans
      where public.loans.collector_id = public.profiles.id
         or public.loans.created_by = public.profiles.id
    )
    and not exists (
      select 1
      from public.payments
      where public.payments.collector_id = public.profiles.id
    )
    and not exists (
      select 1
      from public.payment_events
      where public.payment_events.actor_id = public.profiles.id
    )
    and not exists (
      select 1
      from public.sync_events
      where public.sync_events.collector_id = public.profiles.id
    )
)
delete from auth.users
where auth.users.id in (
  select legacy_seed.id
  from legacy_seed
);
