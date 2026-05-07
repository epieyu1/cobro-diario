-- Compuerta de BR-4 para separación visible de roles sin debilitar RLS.
-- Verifica que collector siga en su alcance, admin vea cartera agregada autorizada
-- e inactivos queden fuera de las vistas operativas.
begin;

do $$
declare
  v_admin_id uuid := '45000000-0000-0000-0000-000000000001';
  v_collector_id uuid := '45000000-0000-0000-0000-000000000002';
  v_inactive_collector_id uuid := '45000000-0000-0000-0000-000000000003';
  v_other_collector_id uuid := '45000000-0000-0000-0000-000000000004';
  v_customer_id uuid := '45000000-0000-0000-0000-000000000011';
  v_other_customer_id uuid := '45000000-0000-0000-0000-000000000012';
  v_loan_id uuid := '45000000-0000-0000-0000-000000000021';
  v_other_loan_id uuid := '45000000-0000-0000-0000-000000000022';
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
      'phase5-role-admin@example.com',
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
      v_collector_id,
      'authenticated',
      'authenticated',
      'phase5-role-collector@example.com',
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
      v_inactive_collector_id,
      'authenticated',
      'authenticated',
      'phase5-role-inactive@example.com',
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
      v_other_collector_id,
      'authenticated',
      'authenticated',
      'phase5-role-other@example.com',
      'not-used',
      timezone('utc', now()),
      jsonb_build_object('role', 'collector'),
      '{}'::jsonb,
      timezone('utc', now()),
      timezone('utc', now()),
      false,
      false
    );

  insert into public.profiles (id, role, full_name, active)
  values
    (v_admin_id, 'admin', 'Phase 5 Roles Admin', true),
    (v_collector_id, 'collector', 'Phase 5 Roles Collector', true),
    (v_inactive_collector_id, 'collector', 'Phase 5 Roles Inactive Collector', false),
    (v_other_collector_id, 'collector', 'Phase 5 Roles Other Collector', true);

  insert into public.customers (
    id,
    assigned_collector_id,
    created_by,
    full_name,
    government_id,
    phone,
    address_line,
    neighborhood,
    route_label
  )
  values
    (
      v_customer_id,
      v_collector_id,
      v_admin_id,
      'Cliente Alcance Propio',
      '905000100',
      '3004005001',
      'Calle 10 # 20-30',
      'Centro',
      'Ruta Centro'
    ),
    (
      v_other_customer_id,
      v_other_collector_id,
      v_admin_id,
      'Cliente Fuera de Alcance',
      '905000101',
      '3004005002',
      'Carrera 40 # 50-60',
      'Norte',
      'Ruta Norte'
    );

  insert into public.loans (
    id,
    customer_id,
    collector_id,
    created_by,
    external_loan_number,
    principal_amount,
    installment_amount,
    interest_rate_daily,
    total_installments,
    currency_code,
    disbursement_date,
    first_due_date,
    status,
    payment_frequency,
    interest_mode,
    originated_at
  )
  values
    (
      v_loan_id,
      v_customer_id,
      v_collector_id,
      v_admin_id,
      'CD-ROLE-001',
      120.00,
      60.00,
      0.000000,
      2,
      'COP',
      timezone('America/Bogota', now())::date,
      timezone('America/Bogota', now())::date,
      'active',
      'daily',
      'simple_precomputed',
      timezone('utc', now())
    ),
    (
      v_other_loan_id,
      v_other_customer_id,
      v_other_collector_id,
      v_admin_id,
      'CD-ROLE-002',
      120.00,
      60.00,
      0.000000,
      2,
      'COP',
      timezone('America/Bogota', now())::date,
      timezone('America/Bogota', now())::date,
      'delinquent',
      'daily',
      'simple_precomputed',
      timezone('utc', now())
    );
end;
$$;

set local role authenticated;

do $$
declare
  v_admin_id uuid := '45000000-0000-0000-0000-000000000001';
  v_collector_id uuid := '45000000-0000-0000-0000-000000000002';
  v_inactive_collector_id uuid := '45000000-0000-0000-0000-000000000003';
  v_other_customer_id uuid := '45000000-0000-0000-0000-000000000012';
  v_count integer;
begin
  perform set_config('request.jwt.claim.sub', v_collector_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', v_collector_id::text,
      'app_metadata', jsonb_build_object('role', 'collector')
    )::text,
    true
  );

  select count(*)
  into v_count
  from public.customers
  where public.customers.id in ('45000000-0000-0000-0000-000000000011', '45000000-0000-0000-0000-000000000012');
  if v_count <> 1 then
    raise exception 'phase5_roles_gate_collector_customer_scope_invalid';
  end if;

  if exists (
    select 1
    from public.customers
    where public.customers.id = v_other_customer_id
  ) then
    raise exception 'phase5_roles_gate_collector_leaked_foreign_customer';
  end if;

  select count(*)
  into v_count
  from public.loans
  where public.loans.id in ('45000000-0000-0000-0000-000000000021', '45000000-0000-0000-0000-000000000022');
  if v_count <> 1 then
    raise exception 'phase5_roles_gate_collector_loan_scope_invalid';
  end if;

  select count(*)
  into v_count
  from public.profiles
  where public.profiles.id in (
    '45000000-0000-0000-0000-000000000001',
    '45000000-0000-0000-0000-000000000002',
    '45000000-0000-0000-0000-000000000003',
    '45000000-0000-0000-0000-000000000004'
  );
  if v_count <> 1 then
    raise exception 'phase5_roles_gate_collector_profile_scope_invalid';
  end if;

  perform set_config('request.jwt.claim.sub', v_admin_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', v_admin_id::text,
      'app_metadata', jsonb_build_object('role', 'admin')
    )::text,
    true
  );

  select count(*)
  into v_count
  from public.customers
  where public.customers.id in ('45000000-0000-0000-0000-000000000011', '45000000-0000-0000-0000-000000000012');
  if v_count <> 2 then
    raise exception 'phase5_roles_gate_admin_customer_scope_invalid';
  end if;

  select count(*)
  into v_count
  from public.loans
  where public.loans.id in ('45000000-0000-0000-0000-000000000021', '45000000-0000-0000-0000-000000000022');
  if v_count <> 2 then
    raise exception 'phase5_roles_gate_admin_loan_scope_invalid';
  end if;

  select count(*)
  into v_count
  from public.profiles
  where public.profiles.id in (
    '45000000-0000-0000-0000-000000000001',
    '45000000-0000-0000-0000-000000000002',
    '45000000-0000-0000-0000-000000000003',
    '45000000-0000-0000-0000-000000000004'
  );
  if v_count <> 4 then
    raise exception 'phase5_roles_gate_admin_profile_scope_invalid';
  end if;

  perform set_config('request.jwt.claim.sub', v_inactive_collector_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', v_inactive_collector_id::text,
      'app_metadata', jsonb_build_object('role', 'collector')
    )::text,
    true
  );

  select count(*)
  into v_count
  from public.customers
  where public.customers.id in ('45000000-0000-0000-0000-000000000011', '45000000-0000-0000-0000-000000000012');
  if v_count <> 0 then
    raise exception 'phase5_roles_gate_inactive_collector_customer_scope_invalid';
  end if;

  select count(*)
  into v_count
  from public.loans
  where public.loans.id in ('45000000-0000-0000-0000-000000000021', '45000000-0000-0000-0000-000000000022');
  if v_count <> 0 then
    raise exception 'phase5_roles_gate_inactive_collector_loan_scope_invalid';
  end if;

  select count(*)
  into v_count
  from public.profiles
  where public.profiles.id in (
    '45000000-0000-0000-0000-000000000001',
    '45000000-0000-0000-0000-000000000002',
    '45000000-0000-0000-0000-000000000003',
    '45000000-0000-0000-0000-000000000004'
  );
  if v_count <> 0 then
    raise exception 'phase5_roles_gate_inactive_collector_profile_scope_invalid';
  end if;
end;
$$;

rollback;
