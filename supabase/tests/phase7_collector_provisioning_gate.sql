-- Compuerta remota del alta segura de cobradores.
-- Debe ejecutarse con ROLLBACK y mantenerse alineada con
-- public.provision_collector_account() y private.provision_collector_account().
begin;

do $$
declare
  v_admin_id uuid := '73000000-0000-0000-0000-000000000001';
  v_collector_actor_id uuid := '73000000-0000-0000-0000-000000000002';
  v_inactive_admin_id uuid := '73000000-0000-0000-0000-000000000003';
  v_orphan_collector_id uuid := '73000000-0000-0000-0000-000000000004';
begin
  insert into auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    is_sso_user,
    is_anonymous
  )
  values
    (
      '00000000-0000-0000-0000-000000000000',
      v_admin_id,
      'authenticated',
      'authenticated',
      'phase7-provision-admin@example.com',
      'not-used',
      timezone('utc', now()),
      jsonb_build_object('role', 'admin'),
      '{}'::jsonb,
      timezone('utc', now()),
      timezone('utc', now()),
      false,
      false
    ),
    (
      '00000000-0000-0000-0000-000000000000',
      v_collector_actor_id,
      'authenticated',
      'authenticated',
      'phase7-provision-collector@example.com',
      'not-used',
      timezone('utc', now()),
      jsonb_build_object('role', 'collector'),
      '{}'::jsonb,
      timezone('utc', now()),
      timezone('utc', now()),
      false,
      false
    ),
    (
      '00000000-0000-0000-0000-000000000000',
      v_inactive_admin_id,
      'authenticated',
      'authenticated',
      'phase7-provision-inactive-admin@example.com',
      'not-used',
      timezone('utc', now()),
      jsonb_build_object('role', 'admin'),
      '{}'::jsonb,
      timezone('utc', now()),
      timezone('utc', now()),
      false,
      false
    ),
    (
      '00000000-0000-0000-0000-000000000000',
      v_orphan_collector_id,
      'authenticated',
      'authenticated',
      'phase7-provision-orphan@example.com',
      'not-used',
      timezone('utc', now()),
      jsonb_build_object(
        'provider', 'email',
        'providers', jsonb_build_array('email')
      ),
      jsonb_build_object('full_name', 'Phase 7 Orphan Collector'),
      timezone('utc', now()),
      timezone('utc', now()),
      false,
      false
    );

  insert into public.profiles (id, role, full_name, active)
  values
    (v_admin_id, 'admin', 'Phase 7 Provision Admin', true),
    (v_collector_actor_id, 'collector', 'Phase 7 Provision Collector', true),
    (v_inactive_admin_id, 'admin', 'Phase 7 Provision Inactive Admin', false);

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
    v_orphan_collector_id::text,
    v_orphan_collector_id,
    jsonb_build_object(
      'sub', v_orphan_collector_id::text,
      'email', 'phase7-provision-orphan@example.com',
      'email_verified', false,
      'phone_verified', false,
      'full_name', 'Phase 7 Orphan Collector'
    ),
    'email',
    timezone('utc', now()),
    timezone('utc', now()),
    timezone('utc', now())
  );
end;
$$;

set local role authenticated;

do $$
declare
  v_admin_id uuid := '73000000-0000-0000-0000-000000000001';
  v_collector_actor_id uuid := '73000000-0000-0000-0000-000000000002';
  v_inactive_admin_id uuid := '73000000-0000-0000-0000-000000000003';
  v_orphan_collector_id uuid := '73000000-0000-0000-0000-000000000004';
  v_result jsonb;
  v_created_id uuid;
begin
  perform set_config('request.jwt.claim.sub', v_admin_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', v_admin_id::text,
      'app_metadata', jsonb_build_object('role', 'admin')
    )::text,
    true
  );

  v_result := public.provision_collector_account(
    'phase7-provision-new@example.com',
    '123456',
    'Phase 7 Provisioned Collector',
    '3007778899'
  );

  v_created_id := (v_result ->> 'id')::uuid;

  if v_created_id is null then
    raise exception 'phase7_collector_provision_missing_id';
  end if;

  if coalesce(v_result ->> 'full_name', '') <> 'Phase 7 Provisioned Collector' then
    raise exception 'phase7_collector_provision_wrong_name';
  end if;
  perform set_config('app.phase7_collector_created_id', v_created_id::text, true);

  begin
    perform public.provision_collector_account(
      'phase7-provision-new@example.com',
      '123456',
      'Phase 7 Duplicate Collector',
      null
    );
    raise exception 'phase7_collector_provision_duplicate_email_should_fail';
  exception
    when others then
      if sqlerrm <> 'collector_email_already_registered' then
        raise;
      end if;
  end;

  perform set_config('request.jwt.claim.sub', v_collector_actor_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', v_collector_actor_id::text,
      'app_metadata', jsonb_build_object('role', 'collector')
    )::text,
    true
  );

  begin
    perform public.provision_collector_account(
      'phase7-provision-denied@example.com',
      '123456',
      'Phase 7 Denied Collector',
      null
    );
    raise exception 'phase7_collector_provision_collector_should_fail';
  exception
    when others then
      if sqlerrm <> 'collector_manager_role_not_allowed' then
        raise;
      end if;
  end;

  perform set_config('request.jwt.claim.sub', v_inactive_admin_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', v_inactive_admin_id::text,
      'app_metadata', jsonb_build_object('role', 'admin')
    )::text,
    true
  );

  begin
    perform public.provision_collector_account(
      'phase7-provision-inactive@example.com',
      '123456',
      'Phase 7 Inactive Admin Attempt',
      null
    );
    raise exception 'phase7_collector_provision_inactive_admin_should_fail';
  exception
    when others then
      if sqlerrm <> 'collector_manager_inactive' then
        raise;
      end if;
  end;

  perform set_config('request.jwt.claim.sub', v_admin_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', v_admin_id::text,
      'app_metadata', jsonb_build_object('role', 'admin')
    )::text,
    true
  );

  v_result := public.provision_collector_account(
    'phase7-provision-orphan@example.com',
    '123456',
    'Phase 7 Recovered Collector',
    '3007778800'
  );

  if (v_result ->> 'id')::uuid <> v_orphan_collector_id then
    raise exception 'phase7_collector_provision_orphan_should_reuse_auth_user';
  end if;
end;
$$;

reset role;

do $$
declare
  v_created_id uuid := nullif(current_setting('app.phase7_collector_created_id', true), '')::uuid;
begin
  if v_created_id is null then
    raise exception 'phase7_collector_provision_missing_setting';
  end if;

  if not exists (
    select 1
    from auth.users
    where auth.users.id = v_created_id
      and lower(auth.users.email) = 'phase7-provision-new@example.com'
      and auth.users.raw_app_meta_data ->> 'role' = 'collector'
      and auth.users.email_confirmed_at is not null
      and nullif(auth.users.phone, '') is not null
  ) then
    raise exception 'phase7_collector_provision_auth_row_missing';
  end if;

  if not exists (
    select 1
    from auth.identities
    where auth.identities.user_id = v_created_id
      and auth.identities.provider = 'email'
      and auth.identities.identity_data ->> 'email' = 'phase7-provision-new@example.com'
  ) then
    raise exception 'phase7_collector_provision_identity_missing';
  end if;

  if not exists (
    select 1
    from public.profiles
    where public.profiles.id = v_created_id
      and public.profiles.role = 'collector'::public.app_role
      and public.profiles.active
      and public.profiles.full_name = 'Phase 7 Provisioned Collector'
      and public.profiles.phone = '3007778899'
  ) then
    raise exception 'phase7_collector_provision_profile_missing';
  end if;

  if not exists (
    select 1
    from auth.users
    where auth.users.id = '73000000-0000-0000-0000-000000000004'::uuid
      and auth.users.raw_app_meta_data ->> 'role' = 'collector'
      and auth.users.email_confirmed_at is not null
      and nullif(auth.users.phone, '') is not null
  ) then
    raise exception 'phase7_collector_provision_orphan_auth_not_recovered';
  end if;

  if not exists (
    select 1
    from public.profiles
    where public.profiles.id = '73000000-0000-0000-0000-000000000004'::uuid
      and public.profiles.role = 'collector'::public.app_role
      and public.profiles.active
      and public.profiles.full_name = 'Phase 7 Recovered Collector'
      and public.profiles.phone = '3007778800'
  ) then
    raise exception 'phase7_collector_provision_orphan_profile_not_recovered';
  end if;
end;
$$;

rollback;
