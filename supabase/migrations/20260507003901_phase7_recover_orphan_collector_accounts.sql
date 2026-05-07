-- Recupera cuentas Auth huerfanas creadas por el flujo roto anterior.
-- Flujo: si el email ya existe en auth.users pero no tiene public.profiles, el mismo
-- RPC de alta completa la provision del collector en vez de dejarlo atrapado como duplicado.
-- Riesgo cubierto: sin esta reconciliacion, el admin recibe "ya esta registrado" pero el
-- cobrador nunca aparece en la lista activa porque el frontend solo lee public.profiles.

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
  v_existing_user auth.users%rowtype;
  v_existing_profile public.profiles%rowtype;
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

  select *
  into v_existing_user
  from auth.users
  where lower(auth.users.email) = v_email
    and auth.users.deleted_at is null
  limit 1;

  if found then
    select *
    into v_existing_profile
    from public.profiles
    where public.profiles.id = v_existing_user.id;

    if found then
      raise exception 'collector_email_already_registered';
    end if;

    if coalesce(v_existing_user.raw_app_meta_data ->> 'role', '') not in ('', 'collector') then
      raise exception 'collector_email_already_registered';
    end if;

    v_collector_id := v_existing_user.id;
    v_auth_phone := coalesce(nullif(v_existing_user.phone, ''), v_auth_phone);

    -- Reconciliamos el usuario huerfano con el contrato operativo actual para no dejar
    -- identidades Auth atrapadas fuera de la lista de collectors por ausencia de profile.
    update auth.users
    set
      encrypted_password = extensions.crypt(v_password, extensions.gen_salt('bf', 10)),
      email_confirmed_at = coalesce(auth.users.email_confirmed_at, v_now),
      confirmation_token = coalesce(auth.users.confirmation_token, ''),
      recovery_token = coalesce(auth.users.recovery_token, ''),
      email_change_token_new = coalesce(auth.users.email_change_token_new, ''),
      email_change = coalesce(auth.users.email_change, ''),
      raw_app_meta_data = coalesce(auth.users.raw_app_meta_data, '{}'::jsonb)
        || jsonb_build_object(
          'provider', 'email',
          'providers', jsonb_build_array('email'),
          'role', 'collector'
        ),
      raw_user_meta_data = coalesce(auth.users.raw_user_meta_data, '{}'::jsonb)
        || jsonb_build_object('full_name', v_full_name),
      phone = v_auth_phone,
      phone_change = coalesce(auth.users.phone_change, ''),
      phone_change_token = coalesce(auth.users.phone_change_token, ''),
      reauthentication_token = coalesce(auth.users.reauthentication_token, ''),
      updated_at = v_now
    where auth.users.id = v_collector_id;

    update auth.identities
    set
      identity_data = coalesce(auth.identities.identity_data, '{}'::jsonb)
        || jsonb_build_object(
          'sub', v_collector_id::text,
          'email', v_email,
          'email_verified', true,
          'phone_verified', false,
          'full_name', v_full_name
        ),
      provider_id = v_collector_id::text,
      updated_at = v_now
    where auth.identities.user_id = v_collector_id
      and auth.identities.provider = 'email';

    if not exists (
      select 1
      from auth.identities
      where auth.identities.user_id = v_collector_id
        and auth.identities.provider = 'email'
    ) then
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
          'phone_verified', false,
          'full_name', v_full_name
        ),
        'email',
        v_now,
        v_now,
        v_now
      );
    end if;
  else
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
  end if;

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
      join public.profiles
        on public.profiles.id = auth.users.id
      where lower(auth.users.email) = v_email
        and auth.users.deleted_at is null
    ) then
      raise exception 'collector_email_already_registered';
    end if;

    raise;
end;
$$;

comment on function private.provision_collector_account(text, text, text, text) is
'Provisiona un cobrador completo en Auth y public.profiles. Si encuentra un auth.users huerfano sin profile, lo reconcilia con el contrato actual para que vuelva a la lista activa.';
