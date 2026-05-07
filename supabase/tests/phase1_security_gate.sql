-- Compuerta negativa de Fase 1 para RLS, grants y bloqueo de perfiles inactivos.
-- Se ejecuta con ROLLBACK para no dejar basura y debe mantenerse alineada con las policies
-- y grants del dominio operativo cuando cambie el hardening de public.
begin;

do $$
declare
  v_active_collector_id uuid := '20000000-0000-0000-0000-000000000001';
  v_other_collector_id uuid := '20000000-0000-0000-0000-000000000002';
  v_inactive_collector_id uuid := '20000000-0000-0000-0000-000000000003';
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
      v_active_collector_id,
      'authenticated',
      'authenticated',
      'phase1-active-collector@example.com',
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
      'phase1-other-collector@example.com',
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
      'phase1-inactive-collector@example.com',
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
    (v_active_collector_id, 'collector', 'Phase 1 Active Collector', true),
    (v_other_collector_id, 'collector', 'Phase 1 Other Collector', true),
    (v_inactive_collector_id, 'collector', 'Phase 1 Inactive Collector', false);

  insert into public.devices (id, collector_id, device_uid, device_name)
  values
    ('20000000-0000-0000-0000-000000000011', v_active_collector_id, 'phase1-active-device', 'Phase 1 Active Device'),
    ('20000000-0000-0000-0000-000000000012', v_other_collector_id, 'phase1-other-device', 'Phase 1 Other Device'),
    ('20000000-0000-0000-0000-000000000013', v_inactive_collector_id, 'phase1-inactive-device', 'Phase 1 Inactive Device');

  insert into public.customers (
    id,
    assigned_collector_id,
    created_by,
    full_name
  )
  values
    ('20000000-0000-0000-0000-000000000021', v_active_collector_id, v_active_collector_id, 'Phase 1 Active Customer'),
    ('20000000-0000-0000-0000-000000000022', v_other_collector_id, v_other_collector_id, 'Phase 1 Other Customer'),
    ('20000000-0000-0000-0000-000000000023', v_inactive_collector_id, v_inactive_collector_id, 'Phase 1 Inactive Customer');

  insert into public.loans (
    id,
    customer_id,
    collector_id,
    principal_amount,
    installment_amount,
    interest_rate_daily,
    total_installments,
    disbursement_date,
    first_due_date,
    status
  )
  values
    (
      '20000000-0000-0000-0000-000000000031',
      '20000000-0000-0000-0000-000000000021',
      v_active_collector_id,
      20.00,
      25.00,
      0.050000,
      1,
      date '2026-05-01',
      date '2026-05-04',
      'active'
    ),
    (
      '20000000-0000-0000-0000-000000000032',
      '20000000-0000-0000-0000-000000000022',
      v_other_collector_id,
      20.00,
      25.00,
      0.050000,
      1,
      date '2026-05-01',
      date '2026-05-04',
      'active'
    ),
    (
      '20000000-0000-0000-0000-000000000033',
      '20000000-0000-0000-0000-000000000023',
      v_inactive_collector_id,
      20.00,
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
  values
    (
      '20000000-0000-0000-0000-000000000041',
      '20000000-0000-0000-0000-000000000031',
      1,
      date '2026-05-04',
      25.00,
      20.00,
      5.00,
      0.00,
      25.00,
      'pending'
    ),
    (
      '20000000-0000-0000-0000-000000000042',
      '20000000-0000-0000-0000-000000000032',
      1,
      date '2026-05-04',
      25.00,
      20.00,
      5.00,
      0.00,
      25.00,
      'pending'
    ),
    (
      '20000000-0000-0000-0000-000000000043',
      '20000000-0000-0000-0000-000000000033',
      1,
      date '2026-05-04',
      25.00,
      20.00,
      5.00,
      0.00,
      25.00,
      'pending'
    );
end;
$$;

set local role authenticated;

do $$
declare
  v_active_collector_id uuid := '20000000-0000-0000-0000-000000000001';
  v_active_customer_id uuid := '20000000-0000-0000-0000-000000000021';
  v_other_customer_id uuid := '20000000-0000-0000-0000-000000000022';
  v_active_loan_id uuid := '20000000-0000-0000-0000-000000000031';
  v_other_loan_id uuid := '20000000-0000-0000-0000-000000000032';
  v_active_installment_id uuid := '20000000-0000-0000-0000-000000000041';
  v_other_installment_id uuid := '20000000-0000-0000-0000-000000000042';
  v_active_device_id uuid := '20000000-0000-0000-0000-000000000011';
  v_payment_id uuid;
  v_row_count bigint;
begin
  perform set_config('request.jwt.claim.sub', v_active_collector_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', v_active_collector_id::text,
      'app_metadata', jsonb_build_object('role', 'collector')
    )::text,
    true
  );

  if (select count(*) from public.customers where id = v_active_customer_id) <> 1 then
    raise exception 'phase1_gate_active_collector_cannot_read_own_customer';
  end if;

  if (select count(*) from public.customers where id = v_other_customer_id) <> 0 then
    raise exception 'phase1_gate_active_collector_can_read_foreign_customer';
  end if;

  if (select count(*) from public.loans where id = v_active_loan_id) <> 1 then
    raise exception 'phase1_gate_active_collector_cannot_read_own_loan';
  end if;

  if (select count(*) from public.loans where id = v_other_loan_id) <> 0 then
    raise exception 'phase1_gate_active_collector_can_read_foreign_loan';
  end if;

  if (select count(*) from public.installments where id = v_active_installment_id) <> 1 then
    raise exception 'phase1_gate_active_collector_cannot_read_own_installment';
  end if;

  if (select count(*) from public.installments where id = v_other_installment_id) <> 0 then
    raise exception 'phase1_gate_active_collector_can_read_foreign_installment';
  end if;

  update public.loans
  set status = 'settled'::public.loan_status
  where id = v_active_loan_id;
  get diagnostics v_row_count = row_count;

  if v_row_count <> 0 then
    raise exception 'phase1_gate_direct_loan_update_should_not_affect_rows';
  end if;

  update public.installments
  set outstanding_amount = 0
  where id = v_active_installment_id;
  get diagnostics v_row_count = row_count;

  if v_row_count <> 0 then
    raise exception 'phase1_gate_direct_installment_update_should_not_affect_rows';
  end if;

  if (select public.loans.status from public.loans where id = v_active_loan_id) <> 'active'::public.loan_status then
    raise exception 'phase1_gate_direct_loan_update_mutated_state';
  end if;

  if (select public.installments.outstanding_amount from public.installments where id = v_active_installment_id) <> 25.00 then
    raise exception 'phase1_gate_direct_installment_update_mutated_state';
  end if;

  begin
    insert into public.payments (
      id,
      customer_id,
      loan_id,
      collector_id,
      device_id,
      device_local_id,
      payment_method,
      total_amount,
      paid_at
    )
    values (
      '20000000-0000-0000-0000-000000000051',
      v_active_customer_id,
      v_active_loan_id,
      v_active_collector_id,
      v_active_device_id,
      'phase1-direct-payment-insert',
      'cash',
      25.00,
      '2026-05-05 10:00:00-05'::timestamptz
    );

    raise exception 'phase1_gate_expected_direct_payment_insert_denied';
  exception
    when others then
      if sqlerrm = 'phase1_gate_expected_direct_payment_insert_denied' then
        raise;
      end if;

      if sqlstate <> '42501' then
        raise exception 'phase1_gate_wrong_sqlstate_direct_payment_insert:%:%', sqlstate, sqlerrm;
      end if;
  end;

  v_payment_id := public.record_payment(
    'phase1-rpc-payment',
    'REC-PHASE1-001',
    v_active_collector_id,
    v_active_customer_id,
    v_active_loan_id,
    v_active_device_id,
    'cash',
    '2026-05-05 10:00:00-05'::timestamptz,
    null,
    null,
    'phase1 legit payment',
    jsonb_build_array(
      jsonb_build_object(
        'installment_id', v_active_installment_id,
        'applied_amount', 25.00,
        'fee_component', 0.00,
        'interest_component', 5.00,
        'principal_component', 20.00
      )
    )
  );

  if not exists (
    select 1
    from public.payments
    where public.payments.id = v_payment_id
      and public.payments.device_local_id = 'phase1-rpc-payment'
  ) then
    raise exception 'phase1_gate_rpc_payment_missing';
  end if;

  begin
    update public.payments
    set notes = 'tampered'
    where id = v_payment_id;

    raise exception 'phase1_gate_expected_direct_payment_update_denied';
  exception
    when others then
      if sqlerrm = 'phase1_gate_expected_direct_payment_update_denied' then
        raise;
      end if;

      if sqlstate <> '42501' then
        raise exception 'phase1_gate_wrong_sqlstate_direct_payment_update:%:%', sqlstate, sqlerrm;
      end if;
  end;

  if (select public.payments.notes from public.payments where id = v_payment_id) <> 'phase1 legit payment' then
    raise exception 'phase1_gate_direct_payment_update_mutated_state';
  end if;
end;
$$;

do $$
declare
  v_inactive_collector_id uuid := '20000000-0000-0000-0000-000000000003';
  v_inactive_customer_id uuid := '20000000-0000-0000-0000-000000000023';
  v_inactive_loan_id uuid := '20000000-0000-0000-0000-000000000033';
  v_inactive_installment_id uuid := '20000000-0000-0000-0000-000000000043';
  v_inactive_device_id uuid := '20000000-0000-0000-0000-000000000013';
begin
  perform set_config('request.jwt.claim.sub', v_inactive_collector_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', v_inactive_collector_id::text,
      'app_metadata', jsonb_build_object('role', 'collector')
    )::text,
    true
  );

  if (select count(*) from public.profiles where id = v_inactive_collector_id) <> 0 then
    raise exception 'phase1_gate_inactive_profile_still_visible';
  end if;

  if (select count(*) from public.customers where id = v_inactive_customer_id) <> 0 then
    raise exception 'phase1_gate_inactive_collector_can_read_customer';
  end if;

  begin
    perform public.record_payment(
      'phase1-inactive-rpc',
      'REC-PHASE1-002',
      v_inactive_collector_id,
      v_inactive_customer_id,
      v_inactive_loan_id,
      v_inactive_device_id,
      'cash',
      '2026-05-05 10:00:00-05'::timestamptz,
      null,
      null,
      'inactive collector should fail',
      jsonb_build_array(
        jsonb_build_object(
          'installment_id', v_inactive_installment_id,
          'applied_amount', 25.00,
          'fee_component', 0.00,
          'interest_component', 5.00,
          'principal_component', 20.00
        )
      )
    );

    raise exception 'phase1_gate_expected_inactive_collector_not_allowed';
  exception
    when others then
      if sqlerrm = 'phase1_gate_expected_inactive_collector_not_allowed' then
        raise;
      end if;

      if sqlerrm <> 'collector_not_allowed' then
        raise exception 'phase1_gate_wrong_error_inactive_collector:%', sqlerrm;
      end if;
  end;
end;
$$;

reset role;
rollback;
