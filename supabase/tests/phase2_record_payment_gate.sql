-- Compuerta transaccional de Fase 2 para record_payment.
-- Se ejecuta dentro de una transaccion con ROLLBACK para no dejar basura en LANDING.
-- Si cambia el contrato financiero V1, este archivo debe cambiar junto con payment-contract.ts y record_payment.
begin;

do $$
declare
  v_now timestamptz := '2026-05-05 10:00:00-05';
  v_collector_id uuid := '10000000-0000-0000-0000-000000000001';
  v_device_id uuid := '10000000-0000-0000-0000-000000000002';
  v_foreign_collector_id uuid := '10000000-0000-0000-0000-000000000004';
  v_foreign_device_id uuid := '10000000-0000-0000-0000-000000000005';
  v_customer_id uuid := '10000000-0000-0000-0000-000000000003';
  v_paid_payment_id uuid;
  v_retry_payment_id uuid;
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
  values (
    '00000000-0000-0000-0000-000000000000',
    v_collector_id,
    'authenticated',
    'authenticated',
    'phase2-collector@example.com',
    'not-used',
    timezone('utc', now()),
    jsonb_build_object('role', 'collector'),
    '{}'::jsonb,
    timezone('utc', now()),
    timezone('utc', now()),
    false,
    false
  );

  insert into public.profiles (id, role, full_name)
  values (v_collector_id, 'collector', 'Phase 2 Collector');

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
  values (
    '00000000-0000-0000-0000-000000000000',
    v_foreign_collector_id,
    'authenticated',
    'authenticated',
    'phase2-foreign-collector@example.com',
    'not-used',
    timezone('utc', now()),
    jsonb_build_object('role', 'collector'),
    '{}'::jsonb,
    timezone('utc', now()),
    timezone('utc', now()),
    false,
    false
  );

  insert into public.profiles (id, role, full_name)
  values (v_foreign_collector_id, 'collector', 'Phase 2 Foreign Collector');

  insert into public.devices (id, collector_id, device_uid, device_name)
  values (v_device_id, v_collector_id, 'phase2-device', 'Phase 2 Device');

  insert into public.devices (id, collector_id, device_uid, device_name)
  values (v_foreign_device_id, v_foreign_collector_id, 'phase2-foreign-device', 'Phase 2 Foreign Device');

  insert into public.customers (
    id,
    assigned_collector_id,
    created_by,
    full_name
  )
  values (
    v_customer_id,
    v_collector_id,
    v_collector_id,
    'Phase 2 Customer'
  );

  -- Caso 1: pago valido de una sola cuota y liquidacion total.
  insert into public.loans (
    id,
    customer_id,
    collector_id,
    created_by,
    principal_amount,
    installment_amount,
    interest_rate_daily,
    total_installments,
    disbursement_date,
    first_due_date,
    status
  )
  values (
    '10000000-0000-0000-0000-000000000101',
    v_customer_id,
    v_collector_id,
    v_collector_id,
    35.00,
    50.00,
    0.050000,
    1,
    date '2026-05-01',
    date '2026-05-04',
    'active'
  );

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
    status
  )
  values (
    '10000000-0000-0000-0000-000000000111',
    '10000000-0000-0000-0000-000000000101',
    1,
    date '2026-05-04',
    50.00,
    35.00,
    10.00,
    5.00,
    50.00,
    'pending'
  );

  v_paid_payment_id := public.record_payment(
    'phase2-single-payment',
    'REC-001',
    v_collector_id,
    v_customer_id,
    '10000000-0000-0000-0000-000000000101',
    v_device_id,
    'cash',
    v_now,
    4.710989,
    -74.072090,
    'single installment gate',
    jsonb_build_array(
      jsonb_build_object(
        'installment_id', '10000000-0000-0000-0000-000000000111',
        'applied_amount', 50.00,
        'fee_component', 5.00,
        'interest_component', 10.00,
        'principal_component', 35.00
      )
    )
  );

  if (select public.installments.outstanding_amount from public.installments where id = '10000000-0000-0000-0000-000000000111') <> 0 then
    raise exception 'phase2_gate_single_installment_not_paid';
  end if;

  if (select public.installments.status from public.installments where id = '10000000-0000-0000-0000-000000000111') <> 'paid'::public.installment_status then
    raise exception 'phase2_gate_single_installment_status_invalid';
  end if;

  if (select public.loans.status from public.loans where id = '10000000-0000-0000-0000-000000000101') <> 'settled'::public.loan_status then
    raise exception 'phase2_gate_single_loan_status_invalid';
  end if;

  -- Caso 2: pago parcial mantiene prestamo activo.
  insert into public.loans (
    id,
    customer_id,
    collector_id,
    created_by,
    principal_amount,
    installment_amount,
    interest_rate_daily,
    total_installments,
    disbursement_date,
    first_due_date,
    status
  )
  values (
    '10000000-0000-0000-0000-000000000201',
    v_customer_id,
    v_collector_id,
    v_collector_id,
    40.00,
    50.00,
    0.050000,
    1,
    date '2026-05-01',
    date '2026-05-06',
    'active'
  );

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
    status
  )
  values (
    '10000000-0000-0000-0000-000000000211',
    '10000000-0000-0000-0000-000000000201',
    1,
    date '2026-05-06',
    50.00,
    40.00,
    10.00,
    0.00,
    50.00,
    'pending'
  );

  perform public.record_payment(
    'phase2-partial-payment',
    'REC-002',
    v_collector_id,
    v_customer_id,
    '10000000-0000-0000-0000-000000000201',
    v_device_id,
    'cash',
    v_now,
    null,
    null,
    'partial gate',
    jsonb_build_array(
      jsonb_build_object(
        'installment_id', '10000000-0000-0000-0000-000000000211',
        'applied_amount', 15.00,
        'fee_component', 0.00,
        'interest_component', 10.00,
        'principal_component', 5.00
      )
    )
  );

  if (select public.installments.outstanding_amount from public.installments where id = '10000000-0000-0000-0000-000000000211') <> 35.00 then
    raise exception 'phase2_gate_partial_outstanding_invalid';
  end if;

  if (select public.installments.status from public.installments where id = '10000000-0000-0000-0000-000000000211') <> 'partial'::public.installment_status then
    raise exception 'phase2_gate_partial_installment_status_invalid';
  end if;

  if (select public.loans.status from public.loans where id = '10000000-0000-0000-0000-000000000201') <> 'active'::public.loan_status then
    raise exception 'phase2_gate_partial_loan_status_invalid';
  end if;

  -- Caso 2.1: cuota parcial sin historial materializado en payment_applications.
  -- El contrato V1 permite reconstruir fee/interes/capital pendientes desde outstanding_amount
  -- y el orden fee -> interest -> principal, igual que bootstrap remoto y frontend.
  insert into public.loans (
    id,
    customer_id,
    collector_id,
    created_by,
    principal_amount,
    installment_amount,
    interest_rate_daily,
    total_installments,
    disbursement_date,
    first_due_date,
    status
  )
  values (
    '10000000-0000-0000-0000-000000000251',
    v_customer_id,
    v_collector_id,
    v_collector_id,
    50.00,
    60.00,
    0.050000,
    1,
    date '2026-05-01',
    date '2026-05-04',
    'delinquent'
  );

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
    status
  )
  values (
    '10000000-0000-0000-0000-000000000261',
    '10000000-0000-0000-0000-000000000251',
    1,
    date '2026-05-04',
    60.00,
    50.00,
    5.00,
    5.00,
    15.00,
    'overdue'
  );

  perform public.record_payment(
    'phase2-partial-without-history',
    'REC-002A',
    v_collector_id,
    v_customer_id,
    '10000000-0000-0000-0000-000000000251',
    v_device_id,
    'cash',
    v_now,
    null,
    null,
    'partial without history gate',
    jsonb_build_array(
      jsonb_build_object(
        'installment_id', '10000000-0000-0000-0000-000000000261',
        'applied_amount', 15.00,
        'fee_component', 0.00,
        'interest_component', 0.00,
        'principal_component', 15.00
      )
    )
  );

  if (select public.installments.outstanding_amount from public.installments where id = '10000000-0000-0000-0000-000000000261') <> 0 then
    raise exception 'phase2_gate_partial_without_history_outstanding_invalid';
  end if;

  if (select public.installments.status from public.installments where id = '10000000-0000-0000-0000-000000000261') <> 'paid'::public.installment_status then
    raise exception 'phase2_gate_partial_without_history_status_invalid';
  end if;

  if (select public.loans.status from public.loans where id = '10000000-0000-0000-0000-000000000251') <> 'settled'::public.loan_status then
    raise exception 'phase2_gate_partial_without_history_loan_status_invalid';
  end if;

  -- Caso 3: pago distribuido en varias cuotas.
  insert into public.loans (
    id,
    customer_id,
    collector_id,
    created_by,
    principal_amount,
    installment_amount,
    interest_rate_daily,
    total_installments,
    disbursement_date,
    first_due_date,
    status
  )
  values (
    '10000000-0000-0000-0000-000000000301',
    v_customer_id,
    v_collector_id,
    v_collector_id,
    30.00,
    25.00,
    0.050000,
    2,
    date '2026-05-01',
    date '2026-05-03',
    'active'
  );

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
    status
  )
  values
    (
      '10000000-0000-0000-0000-000000000311',
      '10000000-0000-0000-0000-000000000301',
      1,
      date '2026-05-03',
      20.00,
      10.00,
      5.00,
      5.00,
      20.00,
      'pending'
    ),
    (
      '10000000-0000-0000-0000-000000000312',
      '10000000-0000-0000-0000-000000000301',
      2,
      date '2026-05-04',
      30.00,
      20.00,
      10.00,
      0.00,
      30.00,
      'pending'
    );

  perform public.record_payment(
    'phase2-multi-payment',
    'REC-003',
    v_collector_id,
    v_customer_id,
    '10000000-0000-0000-0000-000000000301',
    v_device_id,
    'cash',
    v_now,
    null,
    null,
    'multi installment gate',
    jsonb_build_array(
      jsonb_build_object(
        'installment_id', '10000000-0000-0000-0000-000000000311',
        'applied_amount', 20.00,
        'fee_component', 5.00,
        'interest_component', 5.00,
        'principal_component', 10.00
      ),
      jsonb_build_object(
        'installment_id', '10000000-0000-0000-0000-000000000312',
        'applied_amount', 30.00,
        'fee_component', 0.00,
        'interest_component', 10.00,
        'principal_component', 20.00
      )
    )
  );

  if (select count(*) from public.installments where loan_id = '10000000-0000-0000-0000-000000000301' and status = 'paid'::public.installment_status) <> 2 then
    raise exception 'phase2_gate_multi_installments_not_paid';
  end if;

  if (select public.loans.status from public.loans where id = '10000000-0000-0000-0000-000000000301') <> 'settled'::public.loan_status then
    raise exception 'phase2_gate_multi_loan_status_invalid';
  end if;

  -- Caso 4: idempotencia por device_local_id.
  insert into public.loans (
    id,
    customer_id,
    collector_id,
    created_by,
    principal_amount,
    installment_amount,
    interest_rate_daily,
    total_installments,
    disbursement_date,
    first_due_date,
    status
  )
  values (
    '10000000-0000-0000-0000-000000000401',
    v_customer_id,
    v_collector_id,
    v_collector_id,
    10.00,
    10.00,
    0.050000,
    1,
    date '2026-05-01',
    date '2026-05-04',
    'active'
  );

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
    status
  )
  values (
    '10000000-0000-0000-0000-000000000411',
    '10000000-0000-0000-0000-000000000401',
    1,
    date '2026-05-04',
    10.00,
    10.00,
    0.00,
    0.00,
    10.00,
    'pending'
  );

  v_paid_payment_id := public.record_payment(
    'phase2-idempotent-payment',
    'REC-004',
    v_collector_id,
    v_customer_id,
    '10000000-0000-0000-0000-000000000401',
    v_device_id,
    'cash',
    v_now,
    null,
    null,
    'idempotent gate',
    jsonb_build_array(
      jsonb_build_object(
        'installment_id', '10000000-0000-0000-0000-000000000411',
        'applied_amount', 10.00,
        'fee_component', 0.00,
        'interest_component', 0.00,
        'principal_component', 10.00
      )
    )
  );

  v_retry_payment_id := public.record_payment(
    'phase2-idempotent-payment',
    'REC-004',
    v_collector_id,
    v_customer_id,
    '10000000-0000-0000-0000-000000000401',
    v_device_id,
    'cash',
    v_now,
    null,
    null,
    'idempotent gate',
    jsonb_build_array(
      jsonb_build_object(
        'installment_id', '10000000-0000-0000-0000-000000000411',
        'applied_amount', 10.00,
        'fee_component', 0.00,
        'interest_component', 0.00,
        'principal_component', 10.00
      )
    )
  );

  if v_paid_payment_id <> v_retry_payment_id then
    raise exception 'phase2_gate_idempotent_return_invalid';
  end if;

  if (select count(*) from public.payments where device_local_id = 'phase2-idempotent-payment') <> 1 then
    raise exception 'phase2_gate_idempotent_payment_count_invalid';
  end if;

  if (select count(*) from public.payment_applications where payment_id = v_paid_payment_id) <> 1 then
    raise exception 'phase2_gate_idempotent_application_count_invalid';
  end if;

  -- Caso 5: conflicto por reutilizar device_local_id con payload mutado.
  begin
    perform public.record_payment(
      'phase2-idempotent-payment',
      'REC-004-MUTATED',
      v_collector_id,
      v_customer_id,
      '10000000-0000-0000-0000-000000000401',
      v_device_id,
      'cash',
      v_now + interval '1 minute',
      null,
      null,
      'mutated idempotent gate',
      jsonb_build_array(
        jsonb_build_object(
          'installment_id', '10000000-0000-0000-0000-000000000411',
          'applied_amount', 9.00,
          'fee_component', 0.00,
          'interest_component', 0.00,
          'principal_component', 9.00
        )
      )
    );

    raise exception 'phase2_gate_expected_device_local_id_conflict_mutated_payload';
  exception
    when others then
      if sqlerrm = 'phase2_gate_expected_device_local_id_conflict_mutated_payload' then
        raise;
      end if;

      if sqlerrm <> 'device_local_id_conflict' then
        raise exception 'phase2_gate_wrong_error_device_local_id_conflict_mutated_payload:%', sqlerrm;
      end if;
  end;

  -- Caso 6: conflicto por reutilizar device_local_id para otro prestamo.
  insert into public.loans (
    id,
    customer_id,
    collector_id,
    created_by,
    principal_amount,
    installment_amount,
    interest_rate_daily,
    total_installments,
    disbursement_date,
    first_due_date,
    status
  )
  values (
    '10000000-0000-0000-0000-000000000501',
    v_customer_id,
    v_collector_id,
    v_collector_id,
    10.00,
    10.00,
    0.050000,
    1,
    date '2026-05-01',
    date '2026-05-04',
    'active'
  );

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
    status
  )
  values (
    '10000000-0000-0000-0000-000000000511',
    '10000000-0000-0000-0000-000000000501',
    1,
    date '2026-05-04',
    10.00,
    10.00,
    0.00,
    0.00,
    10.00,
    'pending'
  );

  begin
    perform public.record_payment(
      'phase2-idempotent-payment',
      'REC-005',
      v_collector_id,
      v_customer_id,
      '10000000-0000-0000-0000-000000000501',
      v_device_id,
      'cash',
      v_now,
      null,
      null,
      'conflict gate',
      jsonb_build_array(
        jsonb_build_object(
          'installment_id', '10000000-0000-0000-0000-000000000511',
          'applied_amount', 10.00,
          'fee_component', 0.00,
          'interest_component', 0.00,
          'principal_component', 10.00
        )
      )
    );

    raise exception 'phase2_gate_expected_device_local_id_conflict';
  exception
    when others then
      if sqlerrm = 'phase2_gate_expected_device_local_id_conflict' then
        raise;
      end if;

      if sqlerrm <> 'device_local_id_conflict' then
        raise exception 'phase2_gate_wrong_error_device_local_id_conflict:%', sqlerrm;
      end if;
  end;

  -- Caso 7: rechazo por prestamo no pagable.
  insert into public.loans (
    id,
    customer_id,
    collector_id,
    created_by,
    principal_amount,
    installment_amount,
    interest_rate_daily,
    total_installments,
    disbursement_date,
    first_due_date,
    status
  )
  values (
    '10000000-0000-0000-0000-000000000601',
    v_customer_id,
    v_collector_id,
    v_collector_id,
    10.00,
    10.00,
    0.050000,
    1,
    date '2026-05-01',
    date '2026-05-04',
    'draft'
  );

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
    status
  )
  values (
    '10000000-0000-0000-0000-000000000611',
    '10000000-0000-0000-0000-000000000601',
    1,
    date '2026-05-04',
    10.00,
    10.00,
    0.00,
    0.00,
    10.00,
    'pending'
  );

  begin
    perform public.record_payment(
      'phase2-draft-loan',
      'REC-006',
      v_collector_id,
      v_customer_id,
      '10000000-0000-0000-0000-000000000601',
      v_device_id,
      'cash',
      v_now,
      null,
      null,
      'draft gate',
      jsonb_build_array(
        jsonb_build_object(
          'installment_id', '10000000-0000-0000-0000-000000000611',
          'applied_amount', 10.00,
          'fee_component', 0.00,
          'interest_component', 0.00,
          'principal_component', 10.00
        )
      )
    );

    raise exception 'phase2_gate_expected_loan_status_not_payable';
  exception
    when others then
      if sqlerrm = 'phase2_gate_expected_loan_status_not_payable' then
        raise;
      end if;

      if sqlerrm <> 'loan_status_not_payable' then
        raise exception 'phase2_gate_wrong_error_loan_status_not_payable:%', sqlerrm;
      end if;
  end;

  -- Caso 7: rechazo por cuota duplicada.
  insert into public.loans (
    id,
    customer_id,
    collector_id,
    created_by,
    principal_amount,
    installment_amount,
    interest_rate_daily,
    total_installments,
    disbursement_date,
    first_due_date,
    status
  )
  values (
    '10000000-0000-0000-0000-000000000701',
    v_customer_id,
    v_collector_id,
    v_collector_id,
    10.00,
    10.00,
    0.050000,
    1,
    date '2026-05-01',
    date '2026-05-04',
    'active'
  );

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
    status
  )
  values (
    '10000000-0000-0000-0000-000000000711',
    '10000000-0000-0000-0000-000000000701',
    1,
    date '2026-05-04',
    10.00,
    10.00,
    0.00,
    0.00,
    10.00,
    'pending'
  );

  begin
    perform public.record_payment(
      'phase2-duplicate-installment',
      'REC-007',
      v_collector_id,
      v_customer_id,
      '10000000-0000-0000-0000-000000000701',
      v_device_id,
      'cash',
      v_now,
      null,
      null,
      'duplicate installment gate',
      jsonb_build_array(
        jsonb_build_object(
          'installment_id', '10000000-0000-0000-0000-000000000711',
          'applied_amount', 5.00,
          'fee_component', 0.00,
          'interest_component', 0.00,
          'principal_component', 5.00
        ),
        jsonb_build_object(
          'installment_id', '10000000-0000-0000-0000-000000000711',
          'applied_amount', 5.00,
          'fee_component', 0.00,
          'interest_component', 0.00,
          'principal_component', 5.00
        )
      )
    );

    raise exception 'phase2_gate_expected_duplicate_installment_application';
  exception
    when others then
      if sqlerrm = 'phase2_gate_expected_duplicate_installment_application' then
        raise;
      end if;

      if sqlerrm <> 'duplicate_installment_application' then
        raise exception 'phase2_gate_wrong_error_duplicate_installment_application:%', sqlerrm;
      end if;
  end;

  -- Caso 8: rechazo por componentes inconsistentes.
  insert into public.loans (
    id,
    customer_id,
    collector_id,
    created_by,
    principal_amount,
    installment_amount,
    interest_rate_daily,
    total_installments,
    disbursement_date,
    first_due_date,
    status
  )
  values (
    '10000000-0000-0000-0000-000000000801',
    v_customer_id,
    v_collector_id,
    v_collector_id,
    10.00,
    10.00,
    0.050000,
    1,
    date '2026-05-01',
    date '2026-05-04',
    'active'
  );

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
    status
  )
  values (
    '10000000-0000-0000-0000-000000000811',
    '10000000-0000-0000-0000-000000000801',
    1,
    date '2026-05-04',
    10.00,
    10.00,
    0.00,
    0.00,
    10.00,
    'pending'
  );

  begin
    perform public.record_payment(
      'phase2-component-mismatch',
      'REC-008',
      v_collector_id,
      v_customer_id,
      '10000000-0000-0000-0000-000000000801',
      v_device_id,
      'cash',
      v_now,
      null,
      null,
      'component mismatch gate',
      jsonb_build_array(
        jsonb_build_object(
          'installment_id', '10000000-0000-0000-0000-000000000811',
          'applied_amount', 10.00,
          'fee_component', 0.00,
          'interest_component', 4.00,
          'principal_component', 5.00
        )
      )
    );

    raise exception 'phase2_gate_expected_application_components_mismatch';
  exception
    when others then
      if sqlerrm = 'phase2_gate_expected_application_components_mismatch' then
        raise;
      end if;

      if sqlerrm <> 'application_components_mismatch' then
        raise exception 'phase2_gate_wrong_error_application_components_mismatch:%', sqlerrm;
      end if;
  end;

  -- Caso 9: rechazo por saltar cuota mas antigua.
  insert into public.loans (
    id,
    customer_id,
    collector_id,
    created_by,
    principal_amount,
    installment_amount,
    interest_rate_daily,
    total_installments,
    disbursement_date,
    first_due_date,
    status
  )
  values (
    '10000000-0000-0000-0000-000000000901',
    v_customer_id,
    v_collector_id,
    v_collector_id,
    20.00,
    10.00,
    0.050000,
    2,
    date '2026-05-01',
    date '2026-05-03',
    'active'
  );

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
    status
  )
  values
    (
      '10000000-0000-0000-0000-000000000911',
      '10000000-0000-0000-0000-000000000901',
      1,
      date '2026-05-03',
      10.00,
      10.00,
      0.00,
      0.00,
      10.00,
      'pending'
    ),
    (
      '10000000-0000-0000-0000-000000000912',
      '10000000-0000-0000-0000-000000000901',
      2,
      date '2026-05-04',
      10.00,
      10.00,
      0.00,
      0.00,
      10.00,
      'pending'
    );

  begin
    perform public.record_payment(
      'phase2-installment-order',
      'REC-009',
      v_collector_id,
      v_customer_id,
      '10000000-0000-0000-0000-000000000901',
      v_device_id,
      'cash',
      v_now,
      null,
      null,
      'installment order gate',
      jsonb_build_array(
        jsonb_build_object(
          'installment_id', '10000000-0000-0000-0000-000000000912',
          'applied_amount', 10.00,
          'fee_component', 0.00,
          'interest_component', 0.00,
          'principal_component', 10.00
        )
      )
    );

    raise exception 'phase2_gate_expected_installment_order_violation';
  exception
    when others then
      if sqlerrm = 'phase2_gate_expected_installment_order_violation' then
        raise;
      end if;

      if sqlerrm <> 'installment_order_violation' then
        raise exception 'phase2_gate_wrong_error_installment_order_violation:%', sqlerrm;
      end if;
  end;

  -- Caso 10: rechazo por saltar fee o interest dentro de una cuota.
  insert into public.loans (
    id,
    customer_id,
    collector_id,
    created_by,
    principal_amount,
    installment_amount,
    interest_rate_daily,
    total_installments,
    disbursement_date,
    first_due_date,
    status
  )
  values (
    '10000000-0000-0000-0000-000000001001',
    v_customer_id,
    v_collector_id,
    v_collector_id,
    30.00,
    50.00,
    0.050000,
    1,
    date '2026-05-01',
    date '2026-05-04',
    'active'
  );

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
    status
  )
  values (
    '10000000-0000-0000-0000-000000001011',
    '10000000-0000-0000-0000-000000001001',
    1,
    date '2026-05-04',
    50.00,
    30.00,
    12.00,
    8.00,
    50.00,
    'pending'
  );

  begin
    perform public.record_payment(
      'phase2-component-order',
      'REC-010',
      v_collector_id,
      v_customer_id,
      '10000000-0000-0000-0000-000000001001',
      v_device_id,
      'cash',
      v_now,
      null,
      null,
      'component order gate',
      jsonb_build_array(
        jsonb_build_object(
          'installment_id', '10000000-0000-0000-0000-000000001011',
          'applied_amount', 20.00,
          'fee_component', 0.00,
          'interest_component', 12.00,
          'principal_component', 8.00
        )
      )
    );

    raise exception 'phase2_gate_expected_application_order_violation';
  exception
    when others then
      if sqlerrm = 'phase2_gate_expected_application_order_violation' then
        raise;
      end if;

      if sqlerrm <> 'application_order_violation' then
        raise exception 'phase2_gate_wrong_error_application_order_violation:%', sqlerrm;
      end if;
  end;

  -- Caso 11: rechazo si device_id no pertenece al collector del cobro.
  insert into public.loans (
    id,
    customer_id,
    collector_id,
    created_by,
    principal_amount,
    installment_amount,
    interest_rate_daily,
    total_installments,
    disbursement_date,
    first_due_date,
    status
  )
  values (
    '10000000-0000-0000-0000-000000001101',
    v_customer_id,
    v_collector_id,
    v_collector_id,
    25.00,
    25.00,
    0.050000,
    1,
    date '2026-05-01',
    date '2026-05-04',
    'active'
  );

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
    status
  )
  values (
    '10000000-0000-0000-0000-000000001111',
    '10000000-0000-0000-0000-000000001101',
    1,
    date '2026-05-04',
    25.00,
    20.00,
    5.00,
    0.00,
    25.00,
    'pending'
  );

  begin
    perform public.record_payment(
      'phase2-foreign-device',
      'REC-011',
      v_collector_id,
      v_customer_id,
      '10000000-0000-0000-0000-000000001101',
      v_foreign_device_id,
      'cash',
      v_now,
      null,
      null,
      'foreign device gate',
      jsonb_build_array(
        jsonb_build_object(
          'installment_id', '10000000-0000-0000-0000-000000001111',
          'applied_amount', 25.00,
          'fee_component', 0.00,
          'interest_component', 5.00,
          'principal_component', 20.00
        )
      )
    );

    raise exception 'phase2_gate_expected_device_not_owned_by_collector';
  exception
    when others then
      if sqlerrm = 'phase2_gate_expected_device_not_owned_by_collector' then
        raise;
      end if;

      if sqlerrm <> 'device_not_owned_by_collector' then
        raise exception 'phase2_gate_wrong_error_device_not_owned_by_collector:%', sqlerrm;
      end if;
  end;

  if (select count(*) from public.payments where device_local_id = 'phase2-foreign-device') <> 0 then
    raise exception 'phase2_gate_foreign_device_payment_should_not_exist';
  end if;
end;
$$;

rollback;
