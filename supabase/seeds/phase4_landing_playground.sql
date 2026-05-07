-- Playground remoto para pruebas reales de negocio en LANDING.
-- Objetivo: dejar una cartera de prueba reseteable que soporte pagos parciales,
-- liquidacion total, mora y cuotas futuras sin contaminar el dataset minimo de smoke.
-- Si cambia el contrato financiero V1 o la semantica de record_payment, revisar este archivo.
do $$
declare
  v_now timestamptz := timezone('utc', now());
  v_business_date date := timezone('America/Bogota', v_now)::date;
  v_collector_email text := 'fase4.playground@cobrodiario.dev';
  -- Credencial de pruebas versionada para LANDING no productivo.
  -- Si cambia aqui, reejecutar el seed para no dejar divergencia entre Auth y documentacion.
  v_collector_password text := '123456';
  v_collector_id uuid;
begin
  select auth.users.id
  into v_collector_id
  from auth.users
  where auth.users.email = v_collector_email;

  if v_collector_id is null then
    v_collector_id := '50000000-0000-0000-0000-000000000010';

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
      v_collector_email,
      extensions.crypt(v_collector_password, extensions.gen_salt('bf', 10)),
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
      jsonb_build_object('full_name', 'Fase 4 Playground'),
      -- Auth exige phone no nulo y el indice de GoTrue es unico.
      -- El playground no puede reutilizar la cadena vacia del usuario de smoke.
      '+573000000099',
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
      '50000000-0000-0000-0000-000000000011',
      v_collector_id::text,
      v_collector_id,
      jsonb_build_object(
        'sub', v_collector_id::text,
        'email', v_collector_email,
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
    encrypted_password = extensions.crypt(v_collector_password, extensions.gen_salt('bf', 10)),
    email_confirmed_at = coalesce(auth.users.email_confirmed_at, v_now),
    confirmation_token = coalesce(auth.users.confirmation_token, ''),
    recovery_token = coalesce(auth.users.recovery_token, ''),
    email_change_token_new = coalesce(auth.users.email_change_token_new, ''),
    email_change = coalesce(auth.users.email_change, ''),
    raw_app_meta_data = coalesce(auth.users.raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', 'collector'),
    raw_user_meta_data = coalesce(auth.users.raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('full_name', 'Fase 4 Playground'),
    phone = coalesce(nullif(auth.users.phone, ''), '+573000000099'),
    phone_change = coalesce(auth.users.phone_change, ''),
    phone_change_token = coalesce(auth.users.phone_change_token, ''),
    reauthentication_token = coalesce(auth.users.reauthentication_token, ''),
    updated_at = v_now
  where auth.users.id = v_collector_id;

  insert into public.profiles (
    id,
    role,
    full_name,
    phone,
    active
  )
  values (
    v_collector_id,
    'collector',
    'Fase 4 Playground',
    '3000000099',
    true
  )
  on conflict (id) do update
  set
    role = excluded.role,
    full_name = excluded.full_name,
    phone = excluded.phone,
    active = excluded.active,
    updated_at = v_now;

  insert into public.devices (
    id,
    collector_id,
    device_uid,
    device_name,
    last_seen_at
  )
  values (
    '50000000-0000-0000-0000-000000000001',
    v_collector_id,
    'fase4-playground-device',
    'Fase 4 Playground Android',
    v_now
  )
  on conflict (id) do update
  set
    collector_id = excluded.collector_id,
    device_uid = excluded.device_uid,
    device_name = excluded.device_name,
    last_seen_at = excluded.last_seen_at,
    updated_at = v_now;

  -- Reset del playground: elimina pagos previos sobre estos prestamos para que la cartera
  -- vuelva a un estado canonico despues de pruebas reales de cobro o liquidacion.
  delete from public.payments
  where loan_id in (
    '50000000-0000-0000-0000-000000000201',
    '50000000-0000-0000-0000-000000000202',
    '50000000-0000-0000-0000-000000000203',
    '50000000-0000-0000-0000-000000000204',
    '50000000-0000-0000-0000-000000000205'
  );

  insert into public.customers (
    id,
    assigned_collector_id,
    created_by,
    full_name,
    government_id,
    phone,
    address_line,
    neighborhood,
    latitude,
    longitude,
    notes
  )
  values
    (
      '50000000-0000-0000-0000-000000000101',
      v_collector_id,
      v_collector_id,
      'Eliana Castro',
      '91010101',
      '3011000001',
      'Cra 18 #12-30',
      'Centro',
      4.710101,
      -74.071111,
      'PLAYGROUND: prestamo activo con cuota del dia y derrame a futura.'
    ),
    (
      '50000000-0000-0000-0000-000000000102',
      v_collector_id,
      v_collector_id,
      'Julián Mora',
      '92020202',
      '3011000002',
      'Calle 55 #24-18',
      'Galerias',
      4.648222,
      -74.095222,
      'PLAYGROUND: prestamo en mora con cuota parcial materializada sin historico.'
    ),
    (
      '50000000-0000-0000-0000-000000000103',
      v_collector_id,
      v_collector_id,
      'Karen Duarte',
      '93030303',
      '3011000003',
      'Tv 68 #88-21',
      'Normandia',
      4.688444,
      -74.107333,
      'PLAYGROUND: prestamo de una sola cuota para liquidacion total.'
    ),
    (
      '50000000-0000-0000-0000-000000000104',
      v_collector_id,
      v_collector_id,
      'Luis Parra',
      '94040404',
      '3011000004',
      'Calle 120 #9-45',
      'Usaquen',
      4.701555,
      -74.031444,
      'PLAYGROUND: prestamo saldado para validar estados cerrados.'
    ),
    (
      '50000000-0000-0000-0000-000000000105',
      v_collector_id,
      v_collector_id,
      'Martha Vélez',
      '95050505',
      '3011000005',
      'Cra 7 #142-19',
      'Cedritos',
      4.731222,
      -74.037444,
      'PLAYGROUND: prestamo activo con cuotas futuras para abonos sucesivos.'
    )
  on conflict (id) do update
  set
    assigned_collector_id = excluded.assigned_collector_id,
    created_by = excluded.created_by,
    full_name = excluded.full_name,
    government_id = excluded.government_id,
    phone = excluded.phone,
    address_line = excluded.address_line,
    neighborhood = excluded.neighborhood,
    latitude = excluded.latitude,
    longitude = excluded.longitude,
    notes = excluded.notes,
    archived_at = null,
    updated_at = v_now;

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
    payment_application_mode,
    originated_at,
    notes
  )
  values
    (
      '50000000-0000-0000-0000-000000000201',
      '50000000-0000-0000-0000-000000000101',
      v_collector_id,
      v_collector_id,
      'PG-ELI-001',
      115000.00,
      50000.00,
      0.000000,
      3,
      'COP',
      v_business_date - 1,
      v_business_date,
      'active',
      'daily',
      'simple_precomputed',
      'oldest_first',
      v_now,
      'PLAYGROUND: cuota del dia para pago parcial o liquidacion gradual.'
    ),
    (
      '50000000-0000-0000-0000-000000000202',
      '50000000-0000-0000-0000-000000000102',
      v_collector_id,
      v_collector_id,
      'PG-JUL-001',
      150000.00,
      60000.00,
      0.000000,
      3,
      'COP',
      v_business_date - 6,
      v_business_date - 4,
      'delinquent',
      'daily',
      'simple_precomputed',
      'oldest_first',
      v_now,
      'PLAYGROUND: cuota parcial sin historial para validar pagos reales sobre mora.'
    ),
    (
      '50000000-0000-0000-0000-000000000203',
      '50000000-0000-0000-0000-000000000103',
      v_collector_id,
      v_collector_id,
      'PG-KAR-001',
      70000.00,
      80000.00,
      0.000000,
      1,
      'COP',
      v_business_date - 2,
      v_business_date,
      'active',
      'daily',
      'simple_precomputed',
      'oldest_first',
      v_now,
      'PLAYGROUND: una sola cuota para liquidar en un solo pago.'
    ),
    (
      '50000000-0000-0000-0000-000000000204',
      '50000000-0000-0000-0000-000000000104',
      v_collector_id,
      v_collector_id,
      'PG-LUI-001',
      45000.00,
      50000.00,
      0.000000,
      1,
      'COP',
      v_business_date - 12,
      v_business_date - 5,
      'settled',
      'daily',
      'simple_precomputed',
      'oldest_first',
      v_now,
      'PLAYGROUND: referencia de prestamo completamente saldado.'
    ),
    (
      '50000000-0000-0000-0000-000000000205',
      '50000000-0000-0000-0000-000000000105',
      v_collector_id,
      v_collector_id,
      'PG-MAR-001',
      120000.00,
      45000.00,
      0.000000,
      3,
      'COP',
      v_business_date - 1,
      v_business_date + 1,
      'active',
      'daily',
      'simple_precomputed',
      'oldest_first',
      v_now,
      'PLAYGROUND: cuotas futuras para pruebas repetidas de abonos.'
    )
  on conflict (id) do update
  set
    customer_id = excluded.customer_id,
    collector_id = excluded.collector_id,
    created_by = excluded.created_by,
    external_loan_number = excluded.external_loan_number,
    principal_amount = excluded.principal_amount,
    installment_amount = excluded.installment_amount,
    interest_rate_daily = excluded.interest_rate_daily,
    total_installments = excluded.total_installments,
    currency_code = excluded.currency_code,
    disbursement_date = excluded.disbursement_date,
    first_due_date = excluded.first_due_date,
    status = excluded.status,
    payment_frequency = excluded.payment_frequency,
    interest_mode = excluded.interest_mode,
    payment_application_mode = excluded.payment_application_mode,
    originated_at = excluded.originated_at,
    notes = excluded.notes,
    updated_at = v_now;

  insert into public.installments (
    id,
    loan_id,
    installment_number,
    due_date,
    scheduled_amount,
    principal_amount,
    interest_amount,
    fee_amount,
    outstanding_amount,
    outstanding_principal_amount,
    outstanding_interest_amount,
    outstanding_fee_amount,
    status
  )
  values
    (
      '50000000-0000-0000-0000-000000000301',
      '50000000-0000-0000-0000-000000000201',
      1,
      v_business_date,
      50000.00,
      35000.00,
      10000.00,
      5000.00,
      50000.00,
      35000.00,
      10000.00,
      5000.00,
      'pending'
    ),
    (
      '50000000-0000-0000-0000-000000000302',
      '50000000-0000-0000-0000-000000000201',
      2,
      v_business_date + 1,
      50000.00,
      40000.00,
      10000.00,
      0.00,
      50000.00,
      40000.00,
      10000.00,
      0.00,
      'pending'
    ),
    (
      '50000000-0000-0000-0000-000000000303',
      '50000000-0000-0000-0000-000000000201',
      3,
      v_business_date + 2,
      50000.00,
      40000.00,
      10000.00,
      0.00,
      50000.00,
      40000.00,
      10000.00,
      0.00,
      'pending'
    ),
    (
      '50000000-0000-0000-0000-000000000304',
      '50000000-0000-0000-0000-000000000202',
      1,
      v_business_date - 4,
      60000.00,
      50000.00,
      5000.00,
      5000.00,
      20000.00,
      20000.00,
      0.00,
      0.00,
      'overdue'
    ),
    (
      '50000000-0000-0000-0000-000000000305',
      '50000000-0000-0000-0000-000000000202',
      2,
      v_business_date - 1,
      60000.00,
      50000.00,
      5000.00,
      5000.00,
      60000.00,
      50000.00,
      5000.00,
      5000.00,
      'overdue'
    ),
    (
      '50000000-0000-0000-0000-000000000306',
      '50000000-0000-0000-0000-000000000202',
      3,
      v_business_date + 1,
      60000.00,
      50000.00,
      5000.00,
      5000.00,
      60000.00,
      50000.00,
      5000.00,
      5000.00,
      'pending'
    ),
    (
      '50000000-0000-0000-0000-000000000307',
      '50000000-0000-0000-0000-000000000203',
      1,
      v_business_date,
      80000.00,
      70000.00,
      10000.00,
      0.00,
      80000.00,
      70000.00,
      10000.00,
      0.00,
      'pending'
    ),
    (
      '50000000-0000-0000-0000-000000000308',
      '50000000-0000-0000-0000-000000000204',
      1,
      v_business_date - 5,
      50000.00,
      45000.00,
      5000.00,
      0.00,
      0.00,
      0.00,
      0.00,
      0.00,
      'paid'
    ),
    (
      '50000000-0000-0000-0000-000000000309',
      '50000000-0000-0000-0000-000000000205',
      1,
      v_business_date + 1,
      45000.00,
      35000.00,
      10000.00,
      0.00,
      45000.00,
      35000.00,
      10000.00,
      0.00,
      'pending'
    ),
    (
      '50000000-0000-0000-0000-000000000310',
      '50000000-0000-0000-0000-000000000205',
      2,
      v_business_date + 2,
      45000.00,
      35000.00,
      10000.00,
      0.00,
      45000.00,
      35000.00,
      10000.00,
      0.00,
      'pending'
    ),
    (
      '50000000-0000-0000-0000-000000000311',
      '50000000-0000-0000-0000-000000000205',
      3,
      v_business_date + 3,
      45000.00,
      35000.00,
      10000.00,
      0.00,
      45000.00,
      35000.00,
      10000.00,
      0.00,
      'pending'
    )
  on conflict (id) do update
  set
    loan_id = excluded.loan_id,
    installment_number = excluded.installment_number,
    due_date = excluded.due_date,
    scheduled_amount = excluded.scheduled_amount,
    principal_amount = excluded.principal_amount,
    interest_amount = excluded.interest_amount,
    fee_amount = excluded.fee_amount,
    outstanding_amount = excluded.outstanding_amount,
    outstanding_principal_amount = excluded.outstanding_principal_amount,
    outstanding_interest_amount = excluded.outstanding_interest_amount,
    outstanding_fee_amount = excluded.outstanding_fee_amount,
    status = excluded.status,
    updated_at = v_now;
end;
$$;
