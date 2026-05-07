-- Alinea administradores creados manualmente en Supabase Dashboard sin depender
-- de triggers sobre auth.users ni de SQL ad hoc copiado en cada alta.
-- Flujo: Auth > Add User -> SQL Editor -> private.align_manual_admin_account()
-- -> auth.users.raw_app_meta_data + auth.users.raw_user_meta_data + public.profiles.
-- Riesgo cubierto: current_app_role() debe seguir degradando a collector por defecto;
-- la elevacion a admin solo puede ocurrir por una accion manual y explicita.

create or replace function private.align_manual_admin_account(
  p_user_id uuid,
  p_full_name text default null,
  p_phone text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := timezone('utc', now());
  v_deleted_at timestamptz;
  v_email text;
  v_existing_full_name text;
  v_existing_phone text;
  v_phone text := nullif(trim(coalesce(p_phone, '')), '');
  v_profile_phone text;
  v_resolved_full_name text;
  v_user_meta jsonb;
begin
  if p_user_id is null then
    raise exception 'admin_user_id_required';
  end if;

  select
    auth.users.deleted_at,
    auth.users.email,
    auth.users.raw_user_meta_data
  into
    v_deleted_at,
    v_email,
    v_user_meta
  from auth.users
  where auth.users.id = p_user_id
  for update;

  if not found then
    raise exception 'admin_user_not_found';
  end if;

  if v_deleted_at is not null then
    raise exception 'admin_user_deleted';
  end if;

  select
    public.profiles.full_name,
    public.profiles.phone
  into
    v_existing_full_name,
    v_existing_phone
  from public.profiles
  where public.profiles.id = p_user_id;

  v_resolved_full_name := coalesce(
    nullif(trim(coalesce(p_full_name, '')), ''),
    nullif(trim(coalesce(v_existing_full_name, '')), ''),
    nullif(trim(coalesce(v_user_meta ->> 'full_name', '')), '')
  );

  if v_resolved_full_name is null then
    raise exception 'admin_full_name_required';
  end if;

  v_profile_phone := coalesce(v_phone, nullif(trim(coalesce(v_existing_phone, '')), ''));

  update auth.users
  set
    raw_app_meta_data = coalesce(auth.users.raw_app_meta_data, '{}'::jsonb)
      || jsonb_build_object('role', 'admin'),
    raw_user_meta_data = coalesce(auth.users.raw_user_meta_data, '{}'::jsonb)
      || jsonb_build_object('full_name', v_resolved_full_name),
    updated_at = v_now
  where auth.users.id = p_user_id;

  insert into public.profiles (
    id,
    role,
    full_name,
    phone,
    active
  )
  values (
    p_user_id,
    'admin'::public.app_role,
    v_resolved_full_name,
    v_profile_phone,
    true
  )
  on conflict (id) do update
  set
    role = 'admin'::public.app_role,
    full_name = excluded.full_name,
    phone = coalesce(excluded.phone, public.profiles.phone),
    active = true,
    updated_at = v_now;

  return jsonb_build_object(
    'active', true,
    'email', v_email,
    'full_name', v_resolved_full_name,
    'id', p_user_id,
    'role', 'admin'
  );
end;
$$;

revoke execute on function private.align_manual_admin_account(uuid, text, text) from public;

comment on function private.align_manual_admin_account(uuid, text, text) is
'Alinea una cuenta Auth creada manualmente para uso administrativo: fija app_metadata.role=admin, reconcilia raw_user_meta_data.full_name y asegura public.profiles activo sin abrir triggers ni DML directo al cliente.';
