-- Compuerta remota del alta manual de administradores.
-- Debe ejecutarse con ROLLBACK y mantenerse alineada con
-- private.align_manual_admin_account() y el fallback seguro de current_app_role().
begin;

do $$
declare
  v_manual_admin_id uuid := '74000000-0000-0000-0000-000000000001';
  v_missing_name_id uuid := '74000000-0000-0000-0000-000000000002';
  v_existing_collector_id uuid := '74000000-0000-0000-0000-000000000003';
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
      v_manual_admin_id,
      'authenticated',
      'authenticated',
      'phase7-manual-admin@example.com',
      'not-used',
      timezone('utc', now()),
      jsonb_build_object(
        'provider', 'email',
        'providers', jsonb_build_array('email')
      ),
      jsonb_build_object('full_name', 'Phase 7 Manual Admin'),
      timezone('utc', now()),
      timezone('utc', now()),
      false,
      false
    ),
    (
      '00000000-0000-0000-0000-000000000000',
      v_missing_name_id,
      'authenticated',
      'authenticated',
      'phase7-manual-missing-name@example.com',
      'not-used',
      timezone('utc', now()),
      jsonb_build_object(
        'provider', 'email',
        'providers', jsonb_build_array('email')
      ),
      '{}'::jsonb,
      timezone('utc', now()),
      timezone('utc', now()),
      false,
      false
    ),
    (
      '00000000-0000-0000-0000-000000000000',
      v_existing_collector_id,
      'authenticated',
      'authenticated',
      'phase7-manual-upgrade@example.com',
      'not-used',
      timezone('utc', now()),
      jsonb_build_object(
        'provider', 'email',
        'providers', jsonb_build_array('email'),
        'role', 'collector'
      ),
      jsonb_build_object('full_name', 'Legacy Collector'),
      timezone('utc', now()),
      timezone('utc', now()),
      false,
      false
    );

  insert into public.profiles (id, role, full_name, phone, active)
  values (
    v_existing_collector_id,
    'collector',
    'Legacy Collector',
    '3000001111',
    false
  );
end;
$$;

set local role authenticated;

do $$
declare
  v_manual_admin_id uuid := '74000000-0000-0000-0000-000000000001';
begin
  perform set_config('request.jwt.claim.sub', v_manual_admin_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', v_manual_admin_id::text,
      'app_metadata', jsonb_build_object(
        'provider', 'email',
        'providers', jsonb_build_array('email')
      )
    )::text,
    true
  );

  if private.current_app_role() <> 'collector'::public.app_role then
    raise exception 'phase7_admin_manual_profile_gate_missing_role_should_stay_collector';
  end if;

  if exists (
    select 1
    from public.profiles
    where public.profiles.id = v_manual_admin_id
  ) then
    raise exception 'phase7_admin_manual_profile_gate_profile_should_not_exist_before_alignment';
  end if;

  begin
    perform private.align_manual_admin_account(v_manual_admin_id, 'Should Fail', null);
    raise exception 'phase7_admin_manual_profile_gate_authenticated_should_not_execute_helper';
  exception
    when others then
      if sqlerrm = 'phase7_admin_manual_profile_gate_authenticated_should_not_execute_helper' then
        raise;
      end if;
  end;
end;
$$;

reset role;

do $$
declare
  v_manual_admin_id uuid := '74000000-0000-0000-0000-000000000001';
  v_missing_name_id uuid := '74000000-0000-0000-0000-000000000002';
  v_existing_collector_id uuid := '74000000-0000-0000-0000-000000000003';
  v_result jsonb;
begin
  v_result := private.align_manual_admin_account(v_manual_admin_id, null, '3001234567');

  if coalesce(v_result ->> 'role', '') <> 'admin' then
    raise exception 'phase7_admin_manual_profile_gate_missing_admin_role';
  end if;

  if coalesce(v_result ->> 'full_name', '') <> 'Phase 7 Manual Admin' then
    raise exception 'phase7_admin_manual_profile_gate_wrong_full_name';
  end if;

  if not exists (
    select 1
    from auth.users
    where auth.users.id = v_manual_admin_id
      and auth.users.raw_app_meta_data ->> 'role' = 'admin'
      and auth.users.raw_app_meta_data ->> 'provider' = 'email'
      and auth.users.raw_app_meta_data ? 'providers'
      and auth.users.raw_user_meta_data ->> 'full_name' = 'Phase 7 Manual Admin'
  ) then
    raise exception 'phase7_admin_manual_profile_gate_auth_alignment_failed';
  end if;

  if not exists (
    select 1
    from public.profiles
    where public.profiles.id = v_manual_admin_id
      and public.profiles.role = 'admin'::public.app_role
      and public.profiles.full_name = 'Phase 7 Manual Admin'
      and public.profiles.phone = '3001234567'
      and public.profiles.active is true
  ) then
    raise exception 'phase7_admin_manual_profile_gate_profile_alignment_failed';
  end if;

  begin
    perform private.align_manual_admin_account(v_missing_name_id, null, null);
    raise exception 'phase7_admin_manual_profile_gate_missing_name_should_fail';
  exception
    when others then
      if sqlerrm <> 'admin_full_name_required' then
        raise;
      end if;
  end;

  v_result := private.align_manual_admin_account(v_existing_collector_id, 'Phase 7 Upgraded Admin', null);

  if coalesce(v_result ->> 'full_name', '') <> 'Phase 7 Upgraded Admin' then
    raise exception 'phase7_admin_manual_profile_gate_upgrade_wrong_name';
  end if;

  if not exists (
    select 1
    from auth.users
    where auth.users.id = v_existing_collector_id
      and auth.users.raw_app_meta_data ->> 'role' = 'admin'
      and auth.users.raw_user_meta_data ->> 'full_name' = 'Phase 7 Upgraded Admin'
  ) then
    raise exception 'phase7_admin_manual_profile_gate_upgrade_auth_failed';
  end if;

  if not exists (
    select 1
    from public.profiles
    where public.profiles.id = v_existing_collector_id
      and public.profiles.role = 'admin'::public.app_role
      and public.profiles.full_name = 'Phase 7 Upgraded Admin'
      and public.profiles.phone = '3000001111'
      and public.profiles.active is true
  ) then
    raise exception 'phase7_admin_manual_profile_gate_upgrade_profile_failed';
  end if;
end;
$$;

rollback;
