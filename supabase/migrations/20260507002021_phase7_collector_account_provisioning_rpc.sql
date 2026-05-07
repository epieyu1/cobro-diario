-- Provisiona cobradores desde un RPC controlado sin reabrir DML directo sobre public.profiles.
-- Flujo: browser -> public.provision_collector_account() -> private.provision_collector_account()
-- -> auth.users + auth.identities + public.profiles.
-- Riesgo cubierto: el hardening de Fase 1 revoco INSERT/UPDATE directos sobre public.profiles,
-- asi que el alta no puede depender de REST sobre esa tabla ni de un segundo cliente Auth en browser.

create or replace function private.provision_collector_account(
  p_email text,
  p_password text,
  p_full_name text,
  p_phone text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_now timestamptz := timezone('utc', now());
  v_collector_id uuid := extensions.gen_random_uuid();
  v_email text := lower(trim(coalesce(p_email, '')));
  v_password text := coalesce(p_password, '');
  v_full_name text := trim(coalesce(p_full_name, ''));
  v_profile_phone text := nullif(trim(coalesce(p_phone, '')), '');
  v_auth_phone text := '+579' || right(
    translate(replace(v_collector_id::text, '-', ''), 'abcdef', '123456'),
    10
  );
begin
  if v_actor_id is null then
    raise exception 'authentication_required';
  end if;

  if not private.current_profile_is_active() then
    raise exception 'collector_manager_inactive';
  end if;

  if not private.is_admin() then
    raise exception 'collector_manager_role_not_allowed';
  end if;

  if v_full_name = '' then
    raise exception 'collector_full_name_required';
  end if;

  if v_email = '' then
    raise exception 'collector_email_required';
  end if;

  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'collector_email_invalid';
  end if;

  if char_length(v_password) < 6 then
    raise exception 'collector_password_too_short';
  end if;

  if exists (
    select 1
    from auth.users
    where lower(auth.users.email) = v_email
      and auth.users.deleted_at is null
  ) then
    raise exception 'collector_email_already_registered';
  end if;

  -- Insertamos auth.users por SQL porque este flujo solo dispone del browser client
  -- con publishable key. La fuente de verdad del acceso sigue siendo Auth, pero el alta
  -- debe cerrarse del lado del servidor para no depender de grants directos sobre profiles.
  insert into auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    confirmation_token,
    recovery_token,
    email_change_token_new,
    email_change,
    raw_app_meta_data,
    raw_user_meta_data,
    phone,
    phone_change,
    phone_change_token,
    reauthentication_token,
    created_at,
    updated_at,
    is_sso_user,
    is_anonymous
  )
  values (
    '00000000-0000-0000-0000-000000000000',
    v_collector_id,
    'authenticated',
    'authenticated',
    v_email,
    extensions.crypt(v_password, extensions.gen_salt('bf', 10)),
    v_now,
    '',
    '',
    '',
    '',
    jsonb_build_object(
      'provider', 'email',
      'providers', jsonb_build_array('email'),
      'role', 'collector'
    ),
    jsonb_build_object('full_name', v_full_name),
    v_auth_phone,
    '',
    '',
    '',
    v_now,
    v_now,
    false,
    false
  );

  insert into auth.identities (
    provider_id,
    user_id,
    identity_data,
    provider,
    last_sign_in_at,
    created_at,
    updated_at
  )
  values (
    v_collector_id::text,
    v_collector_id,
    jsonb_build_object(
      'sub', v_collector_id::text,
      'email', v_email,
      'email_verified', true,
      'phone_verified', false
    ),
    'email',
    v_now,
    v_now,
    v_now
  );

  insert into public.profiles (
    id,
    role,
    full_name,
    phone,
    active
  )
  values (
    v_collector_id,
    'collector'::public.app_role,
    v_full_name,
    v_profile_phone,
    true
  );

  return jsonb_build_object(
    'full_name', v_full_name,
    'id', v_collector_id
  );
exception
  when unique_violation then
    if exists (
      select 1
      from auth.users
      where lower(auth.users.email) = v_email
        and auth.users.deleted_at is null
    ) then
      raise exception 'collector_email_already_registered';
    end if;

    raise;
end;
$$;

revoke execute on function private.provision_collector_account(text, text, text, text) from public;
grant execute on function private.provision_collector_account(text, text, text, text) to authenticated;

comment on function private.provision_collector_account(text, text, text, text) is
'Provisiona un cobrador completo en Auth y public.profiles desde private para no reabrir DML directo sobre profiles ni crear un segundo cliente Auth en el navegador.';

create or replace function public.provision_collector_account(
  p_email text,
  p_password text,
  p_full_name text,
  p_phone text default null
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.provision_collector_account(
    p_email,
    p_password,
    p_full_name,
    p_phone
  );
$$;

revoke execute on function public.provision_collector_account(text, text, text, text) from public;
revoke execute on function public.provision_collector_account(text, text, text, text) from anon;
grant execute on function public.provision_collector_account(text, text, text, text) to authenticated;

comment on function public.provision_collector_account(text, text, text, text) is
'RPC invocable desde el browser para que admin cree cobradores sin exponer service_role ni grants de escritura directa sobre public.profiles.';
