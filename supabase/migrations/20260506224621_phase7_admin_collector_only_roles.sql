-- Reduce el modelo operativo a dos roles reales: admin y collector.
-- Intencion: alinear helpers, claims y comentarios con el contrato final sin abrir
-- atajos de RLS ni depender de que el cliente interprete privilegios por su cuenta.

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

comment on function private.can_originate_for_collector(uuid) is
'Autoriza originacion solo a admin activo dentro del alcance permitido del collector destino. Los collectors no originan en V1.';

comment on function public.originate_loan(uuid, jsonb, jsonb, jsonb) is
'RPC transaccional de originacion V1. Solo admin activo puede originar para un collector activo y el cliente no debe reemplazarlo por inserts directos a customers, loans o installments.';

-- Normaliza cualquier valor fuera del contrato final para que no sobrevivan privilegios
-- historicos en perfiles o claims de Auth. PostgreSQL sigue siendo la fuente de verdad.
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
