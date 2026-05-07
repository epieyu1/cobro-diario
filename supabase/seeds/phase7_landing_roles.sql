-- Seed persistente para dejar credenciales operativas no productivas por rol en LANDING.
-- No reemplaza los seeds de cartera (`phase4_*`): solo crea identidades de acceso para
-- validar login, RLS y el wizard de originacion con `admin`.
-- Si cambia el shape requerido por GoTrue en auth.users, revisar este archivo junto con
-- `phase4_landing_smoke.sql` y `phase4_landing_playground.sql`.
do $$
declare
  v_now timestamptz := timezone('utc', now());
  v_admin_email text := 'fase7.admin@cobrodiario.dev';
  v_admin_password text := '123456';
  v_admin_id uuid;
begin
  select auth.users.id
  into v_admin_id
  from auth.users
  where auth.users.email = v_admin_email;

  if v_admin_id is null then
    v_admin_id := '72000000-0000-0000-0000-000000000001';

    -- Este fallback usa SQL directo porque no siempre tenemos un admin endpoint operativo
    -- en la sesion. Riesgo: si se cambia email/password aqui sin reejecutar el seed,
    -- la documentacion y Auth quedan divergentes.
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
      v_admin_id,
      'authenticated',
      'authenticated',
      v_admin_email,
      extensions.crypt(v_admin_password, extensions.gen_salt('bf', 10)),
      v_now,
      '',
      '',
      '',
      '',
      jsonb_build_object(
        'provider', 'email',
        'providers', jsonb_build_array('email'),
        'role', 'admin'
      ),
      jsonb_build_object('full_name', 'Fase 7 Admin'),
      '+573000000071',
      '',
      '',
      '',
      v_now,
      v_now,
      false,
      false
    );

    insert into auth.identities (
      id,
      provider_id,
      user_id,
      identity_data,
      provider,
      last_sign_in_at,
      created_at,
      updated_at
    )
    values (
      '72000000-0000-0000-0000-000000000011',
      v_admin_id::text,
      v_admin_id,
      jsonb_build_object(
        'sub', v_admin_id::text,
        'email', v_admin_email,
        'email_verified', true,
        'phone_verified', false
      ),
      'email',
      v_now,
      v_now,
      v_now
    );
  end if;

  update auth.users
  set
    encrypted_password = extensions.crypt(v_admin_password, extensions.gen_salt('bf', 10)),
    email_confirmed_at = coalesce(auth.users.email_confirmed_at, v_now),
    confirmation_token = coalesce(auth.users.confirmation_token, ''),
    recovery_token = coalesce(auth.users.recovery_token, ''),
    email_change_token_new = coalesce(auth.users.email_change_token_new, ''),
    email_change = coalesce(auth.users.email_change, ''),
    raw_app_meta_data = coalesce(auth.users.raw_app_meta_data, '{}'::jsonb)
      || jsonb_build_object('role', 'admin'),
    raw_user_meta_data = coalesce(auth.users.raw_user_meta_data, '{}'::jsonb)
      || jsonb_build_object('full_name', 'Fase 7 Admin'),
    phone = coalesce(nullif(auth.users.phone, ''), '+573000000071'),
    phone_change = coalesce(auth.users.phone_change, ''),
    phone_change_token = coalesce(auth.users.phone_change_token, ''),
    reauthentication_token = coalesce(auth.users.reauthentication_token, ''),
    updated_at = v_now
  where auth.users.id = v_admin_id;

  insert into public.profiles (
    id,
    role,
    full_name,
    phone,
    active
  )
  values (
    v_admin_id,
    'admin',
    'Fase 7 Admin',
    '3000000071',
    true
  )
  on conflict (id) do update
  set
    role = excluded.role,
    full_name = excluded.full_name,
    phone = excluded.phone,
    active = excluded.active,
    updated_at = v_now;
end;
$$;
