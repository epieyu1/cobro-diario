-- Seed persistente para validar la UI operativa y la regresion funcional de Fase 4 en LANDING.
-- No se ejecuta automaticamente en db reset local; se corre de forma explicita cuando haga falta
-- reconstruir el dataset remoto de smoke. Si cambian App.tsx, collector-workspace.ts,
-- payment-planning.ts o las reglas de RLS, revisar este archivo.
do $$
declare
  v_now timestamptz := timezone('utc', now());
  v_business_date date := timezone('America/Bogota', v_now)::date;
  v_collector_email text := 'fase4.collector@cobrodiario.dev';
  -- Fuente de verdad del acceso de smoke en LANDING.
  -- Riesgo: si cambia aqui pero no se reejecuta el seed remoto, el usuario existente
  -- seguira autenticando con la clave anterior y la UI parecera rota sin estarlo.
  v_collector_password text := '123456';
  v_collector_id uuid;
begin
  select auth.users.id
  into v_collector_id
  from auth.users
  where auth.users.email = v_collector_email;

  if v_collector_id is null then
    v_collector_id := '40000000-0000-0000-0000-000000000010';

    -- Este fallback existe porque no siempre tenemos un admin endpoint disponible en la sesion.
    -- Si en el futuro se reemplaza por auth.admin.createUser, mantener mismo email/password o limpiar
    -- primero esta identidad para no dejar divergencia entre SQL y Auth.
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
      jsonb_build_object('full_name', 'Fase 4 Collector'),
      -- Auth exige phone no nulo y el indice de GoTrue es unico.
      -- El seed de smoke usa un valor sintacticamente estable para no chocar
      -- con otros usuarios semilla como el playground.
      '+573000000001',
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
      '40000000-0000-0000-0000-000000000011',
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

  -- RLS depende de app_metadata.role. Sin este update la UI podria autenticar,
  -- pero no necesariamente leer la cartera que estamos sembrando.
  -- Tambien normalizamos columnas token/change de auth.users porque GoTrue las lee
  -- como strings en /token y un NULL rompe signInWithPassword antes de llegar a RLS.
  update auth.users
  set
    -- Restablecemos la clave de smoke en cada corrida para que LANDING conserve
    -- un acceso reproducible aunque el usuario ya existiera con otra contraseña.
    encrypted_password = extensions.crypt(v_collector_password, extensions.gen_salt('bf', 10)),
    email_confirmed_at = coalesce(auth.users.email_confirmed_at, v_now),
    confirmation_token = coalesce(auth.users.confirmation_token, ''),
    recovery_token = coalesce(auth.users.recovery_token, ''),
    email_change_token_new = coalesce(auth.users.email_change_token_new, ''),
    email_change = coalesce(auth.users.email_change, ''),
    raw_app_meta_data = coalesce(auth.users.raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', 'collector'),
    raw_user_meta_data = coalesce(auth.users.raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('full_name', 'Fase 4 Collector'),
    phone = coalesce(nullif(auth.users.phone, ''), '+573000000001'),
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
    'Fase 4 Collector',
    '3000000001',
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
    '40000000-0000-0000-0000-000000000001',
    v_collector_id,
    'fase4-device-landing',
    'Fase 4 Android',
    v_now
  )
  on conflict (id) do update
  set
    collector_id = excluded.collector_id,
    device_uid = excluded.device_uid,
    device_name = excluded.device_name,
    last_seen_at = excluded.last_seen_at,
    updated_at = v_now;

  -- Esta limpieza deja el dataset remoto en estado canonico aunque una corrida previa
  -- ya haya ejecutado cobros, originaciones o reversos de smoke bajo el mismo collector.
  -- Riesgo: si solo limpiamos los cuatro IDs canonicos, los casos OR4/RV6 quedan vivos,
  -- cambian los agregados visibles por RLS y rompen el smoke Auth/RLS aunque la app siga sana.
  -- payment_applications y payment_events caen por cascade desde payments; installments
  -- caen por cascade desde loans. collection_actions y sync_events se purgan aparte porque
  -- customer_id no tiene cascade y porque la cola remota debe volver a cero.
  delete from public.collection_actions
  where collector_id = v_collector_id
     or created_by = v_collector_id
     or loan_id in (
       select public.loans.id
       from public.loans
       where public.loans.collector_id = v_collector_id
     )
     or customer_id in (
       select public.customers.id
       from public.customers
       where public.customers.assigned_collector_id = v_collector_id
          or public.customers.created_by = v_collector_id
     );

  delete from public.sync_events
  where collector_id = v_collector_id;

  delete from public.payments
  where collector_id = v_collector_id
     or loan_id in (
       select public.loans.id
       from public.loans
       where public.loans.collector_id = v_collector_id
     )
     or customer_id in (
       select public.customers.id
       from public.customers
       where public.customers.assigned_collector_id = v_collector_id
          or public.customers.created_by = v_collector_id
     );

  delete from public.loans
  where collector_id = v_collector_id;

  delete from public.customers
  where assigned_collector_id = v_collector_id
     or created_by = v_collector_id;

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
      '40000000-0000-0000-0000-000000000101',
      v_collector_id,
      v_collector_id,
      'Ana Gomez',
      '10101010',
      '3001111111',
      'Cra 10 #20-30',
      'Centro',
      4.710989,
      -74.072090,
      'Escenario due-today con derrame a cuota futura para validar oldest-first.'
    ),
    (
      '40000000-0000-0000-0000-000000000102',
      v_collector_id,
      v_collector_id,
      'Brayan Rojas',
      '20202020',
      '3002222222',
      'Calle 45 #18-12',
      'Galerias',
      4.648625,
      -74.095543,
      'Escenario delinquent con cuota parcial vencida y otra vencida completa.'
    ),
    (
      '40000000-0000-0000-0000-000000000103',
      v_collector_id,
      v_collector_id,
      'Carolina Perez',
      '30303030',
      '3003333333',
      'Tv 72 #90-11',
      'Normandia',
      4.687937,
      -74.107194,
      'Prestamo liquidado para validar estados settled/paid.'
    ),
    (
      '40000000-0000-0000-0000-000000000104',
      v_collector_id,
      v_collector_id,
      'Diana Torres',
      '40404040',
      '3004444444',
      'Calle 145 #14-20',
      'Cedritos',
      4.732585,
      -74.037878,
      'Prestamo programado para probar gestion de visita y ruta futura.'
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
      '40000000-0000-0000-0000-000000000201',
      '40000000-0000-0000-0000-000000000101',
      v_collector_id,
      v_collector_id,
      'LD-ANA-001',
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
      'Prestamo activo con cuota del dia y derrame controlado a la cuota siguiente.'
    ),
    (
      '40000000-0000-0000-0000-000000000202',
      '40000000-0000-0000-0000-000000000102',
      v_collector_id,
      v_collector_id,
      'LD-BRA-001',
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
      'Prestamo con mora y cuota parcialmente pagada para validar reconstruccion de componentes.'
    ),
    (
      '40000000-0000-0000-0000-000000000203',
      '40000000-0000-0000-0000-000000000103',
      v_collector_id,
      v_collector_id,
      'LD-CAR-001',
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
      'Prestamo sin saldo para validar estados cerrados.'
    ),
    (
      '40000000-0000-0000-0000-000000000204',
      '40000000-0000-0000-0000-000000000104',
      v_collector_id,
      v_collector_id,
      'LD-DIA-001',
      80000.00,
      50000.00,
      0.000000,
      2,
      'COP',
      v_business_date - 1,
      v_business_date + 1,
      'active',
      'daily',
      'simple_precomputed',
      'oldest_first',
      v_now,
      'Prestamo programado para gestion local sin mora.'
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
      '40000000-0000-0000-0000-000000000301',
      '40000000-0000-0000-0000-000000000201',
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
      '40000000-0000-0000-0000-000000000302',
      '40000000-0000-0000-0000-000000000201',
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
      '40000000-0000-0000-0000-000000000303',
      '40000000-0000-0000-0000-000000000201',
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
      '40000000-0000-0000-0000-000000000304',
      '40000000-0000-0000-0000-000000000202',
      1,
      v_business_date - 4,
      60000.00,
      50000.00,
      5000.00,
      5000.00,
      15000.00,
      15000.00,
      0.00,
      0.00,
      'overdue'
    ),
    (
      '40000000-0000-0000-0000-000000000305',
      '40000000-0000-0000-0000-000000000202',
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
      '40000000-0000-0000-0000-000000000306',
      '40000000-0000-0000-0000-000000000202',
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
      '40000000-0000-0000-0000-000000000307',
      '40000000-0000-0000-0000-000000000203',
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
      '40000000-0000-0000-0000-000000000308',
      '40000000-0000-0000-0000-000000000204',
      1,
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
      '40000000-0000-0000-0000-000000000309',
      '40000000-0000-0000-0000-000000000204',
      2,
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
