-- Compuerta de BR-2 para gestion de visita remota.
-- Verifica RLS de lectura por collector scope e idempotencia del RPC record_collection_action().
begin;

do $$
declare
  v_admin_id uuid := '25000000-0000-0000-0000-000000000001';
  v_collector_id uuid := '25000000-0000-0000-0000-000000000002';
  v_other_collector_id uuid := '25000000-0000-0000-0000-000000000003';
  v_customer_id uuid := '25000000-0000-0000-0000-000000000011';
  v_other_customer_id uuid := '25000000-0000-0000-0000-000000000012';
  v_loan_id uuid := '25000000-0000-0000-0000-000000000021';
  v_other_loan_id uuid := '25000000-0000-0000-0000-000000000022';
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
      'phase4-actions-admin@example.com',
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
      'phase4-actions-collector@example.com',
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
      'phase4-actions-other@example.com',
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
    (v_admin_id, 'admin', 'Phase 4 Actions Admin', true),
    (v_collector_id, 'collector', 'Phase 4 Actions Collector', true),
    (v_other_collector_id, 'collector', 'Phase 4 Actions Other', true);

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
      'Cliente Gestion Remota',
      '901100200',
      '3001002000',
      'Calle 1 # 2-3',
      'Centro',
      'Ruta Centro'
    ),
    (
      v_other_customer_id,
      v_other_collector_id,
      v_admin_id,
      'Cliente Otro Scope',
      '901100201',
      '3001002001',
      'Calle 4 # 5-6',
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
      'CD-20260506-ACT001',
      100.00,
      60.00,
      0.000000,
      2,
      'COP',
      '2026-05-06',
      '2026-05-13',
      'active',
      'weekly',
      'simple_precomputed',
      timezone('utc', now())
    ),
    (
      v_other_loan_id,
      v_other_customer_id,
      v_other_collector_id,
      v_admin_id,
      'CD-20260506-ACT002',
      100.00,
      60.00,
      0.000000,
      2,
      'COP',
      '2026-05-06',
      '2026-05-13',
      'active',
      'weekly',
      'simple_precomputed',
      timezone('utc', now())
    );

  insert into public.collection_actions (
    id,
    collector_id,
    created_by,
    customer_id,
    loan_id,
    device_local_id,
    outcome,
    notes,
    follow_up_at,
    recorded_at
  )
  values
    (
      '25000000-0000-0000-0000-000000000031',
      v_collector_id,
      v_admin_id,
      v_customer_id,
      v_loan_id,
      'seed-collection-action-1',
      'promise_to_pay',
      'Cliente confirma pago mañana.',
      '2026-05-07',
      '2026-05-06T12:00:00.000Z'
    ),
    (
      '25000000-0000-0000-0000-000000000032',
      v_other_collector_id,
      v_admin_id,
      v_other_customer_id,
      v_other_loan_id,
      'seed-collection-action-2',
      'not_found',
      'No atendieron en la dirección.',
      null,
      '2026-05-06T12:30:00.000Z'
    );
end;
$$;

set local role authenticated;

do $$
declare
  v_admin_id uuid := '25000000-0000-0000-0000-000000000001';
  v_collector_id uuid := '25000000-0000-0000-0000-000000000002';
  v_other_collector_id uuid := '25000000-0000-0000-0000-000000000003';
  v_customer_id uuid := '25000000-0000-0000-0000-000000000011';
  v_loan_id uuid := '25000000-0000-0000-0000-000000000021';
  v_first_action_id uuid;
  v_second_action_id uuid;
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
    select count(*)
    from public.collection_actions
    where public.collection_actions.collector_id = v_collector_id
  ) <> 1 then
    raise exception 'phase4_collection_actions_gate_collector_cannot_read_own_actions';
  end if;

  if (
    select count(*)
    from public.collection_actions
    where public.collection_actions.collector_id = v_other_collector_id
  ) <> 0 then
    raise exception 'phase4_collection_actions_gate_collector_can_read_foreign_actions';
  end if;

  v_first_action_id := public.record_collection_action(
    'device-action-1',
    v_collector_id,
    v_customer_id,
    v_loan_id,
    'return_visit',
    '2026-05-08',
    null,
    null,
    'Volver después de las 5 pm.',
    '2026-05-06T14:00:00.000Z'
  );

  v_second_action_id := public.record_collection_action(
    'device-action-1',
    v_collector_id,
    v_customer_id,
    v_loan_id,
    'return_visit',
    '2026-05-08',
    null,
    null,
    'Volver después de las 5 pm.',
    '2026-05-06T14:00:00.000Z'
  );

  if v_first_action_id <> v_second_action_id then
    raise exception 'phase4_collection_actions_gate_rpc_not_idempotent';
  end if;

  if (
    select count(*)
    from public.collection_actions
    where public.collection_actions.device_local_id = 'device-action-1'
  ) <> 1 then
    raise exception 'phase4_collection_actions_gate_rpc_duplicated_row';
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

  if (
    select count(*)
    from public.collection_actions
  ) <> 3 then
    raise exception 'phase4_collection_actions_gate_admin_missing_global_scope';
  end if;
end;
$$;

rollback;
