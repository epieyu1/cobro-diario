-- Compuerta de BR-2 para rutas formales.
-- Verifica que route_label ya exista como fuente remota persistida y que originate_loan
-- la materialice sin abrir lectura fuera de alcance.
begin;

do $$
declare
  v_admin_id uuid := '24000000-0000-0000-0000-000000000001';
  v_collector_id uuid := '24000000-0000-0000-0000-000000000002';
  v_other_collector_id uuid := '24000000-0000-0000-0000-000000000003';
  v_existing_customer_id uuid := '24000000-0000-0000-0000-000000000011';
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
      'phase4-routes-admin@example.com',
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
      'phase4-routes-collector@example.com',
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
      'phase4-routes-other@example.com',
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
    (v_admin_id, 'admin', 'Phase 4 Routes Admin', true),
    (v_collector_id, 'collector', 'Phase 4 Routes Collector', true),
    (v_other_collector_id, 'collector', 'Phase 4 Routes Other', true);

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
      v_existing_customer_id,
      v_collector_id,
      v_admin_id,
      'Cliente Rutas',
      '900100200',
      '3001002000',
      'Calle 1 # 2-3',
      'Centro',
      'Ruta Centro'
    );
end;
$$;

set local role authenticated;

do $$
declare
  v_admin_id uuid := '24000000-0000-0000-0000-000000000001';
  v_collector_id uuid := '24000000-0000-0000-0000-000000000002';
  v_other_collector_id uuid := '24000000-0000-0000-0000-000000000003';
  v_existing_customer_id uuid := '24000000-0000-0000-0000-000000000011';
  v_response jsonb;
  v_created_customer_id uuid;
begin
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', v_collector_id::text,
      'app_metadata', jsonb_build_object('role', 'collector')
    )::text,
    true
  );
  perform set_config('request.jwt.claim.sub', v_collector_id::text, true);

  if (
    select public.customers.route_label
    from public.customers
    where public.customers.id = v_existing_customer_id
  ) <> 'Ruta Centro' then
    raise exception 'phase4_routes_gate_collector_cannot_read_own_route_label';
  end if;

  if (
    select count(*)
    from public.customers
    where public.customers.assigned_collector_id = v_other_collector_id
  ) <> 0 then
    raise exception 'phase4_routes_gate_collector_can_read_foreign_routes';
  end if;

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', v_admin_id::text,
      'app_metadata', jsonb_build_object('role', 'admin')
    )::text,
    true
  );
  perform set_config('request.jwt.claim.sub', v_admin_id::text, true);

  v_response := public.originate_loan(
    null,
    jsonb_build_object(
      'assigned_collector_id', v_collector_id::text,
      'full_name', 'Cliente Nuevo Ruta',
      'government_id', '900100201',
      'phone', '3001002001',
      'address_line', 'Calle 4 # 5-6',
      'neighborhood', 'Galerias',
      'route_label', 'Ruta Galerias PM'
    ),
    jsonb_build_object(
      'collector_id', v_collector_id::text,
      'principal_amount', '100.00',
      'installment_amount', '60.00',
      'total_installments', 2,
      'payment_frequency', 'weekly',
      'disbursement_date', '2026-05-06',
      'first_due_date', '2026-05-13',
      'interest_mode', 'simple_precomputed',
      'interest_rate_daily', '0.000000'
    ),
    jsonb_build_array(
      jsonb_build_object(
        'installment_number', 1,
        'due_date', '2026-05-13',
        'scheduled_amount', '60.00',
        'principal_amount', '50.00',
        'interest_amount', '10.00',
        'fee_amount', '0.00',
        'outstanding_principal_amount', '50.00',
        'outstanding_interest_amount', '10.00',
        'outstanding_fee_amount', '0.00',
        'outstanding_amount', '60.00',
        'status', 'pending'
      ),
      jsonb_build_object(
        'installment_number', 2,
        'due_date', '2026-05-20',
        'scheduled_amount', '60.00',
        'principal_amount', '50.00',
        'interest_amount', '10.00',
        'fee_amount', '0.00',
        'outstanding_principal_amount', '50.00',
        'outstanding_interest_amount', '10.00',
        'outstanding_fee_amount', '0.00',
        'outstanding_amount', '60.00',
        'status', 'pending'
      )
    )
  );

  v_created_customer_id := (v_response ->> 'customer_id')::uuid;

  if (
    select public.customers.route_label
    from public.customers
    where public.customers.id = v_created_customer_id
  ) <> 'Ruta Galerias PM' then
    raise exception 'phase4_routes_gate_originated_customer_missing_route_label';
  end if;
end;
$$;

rollback;
