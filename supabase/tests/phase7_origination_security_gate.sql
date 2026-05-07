-- Compuerta OR-1 para originacion segura.
-- Debe ejecutarse con ROLLBACK y mantenerse alineada con originate_loan(),
-- sus helpers privados, sus grants y sus policies de INSERT sobre customers/loans/installments.
begin;

do $$
declare
  v_admin_id uuid := '70000000-0000-0000-0000-000000000001';
  v_collector_actor_id uuid := '70000000-0000-0000-0000-000000000003';
  v_inactive_admin_id uuid := '70000000-0000-0000-0000-000000000004';
  v_target_collector_id uuid := '70000000-0000-0000-0000-000000000005';
  v_other_collector_id uuid := '70000000-0000-0000-0000-000000000006';
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
      'phase7-admin@example.com',
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
      'phase7-collector@example.com',
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
      'phase7-inactive-admin@example.com',
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
      v_target_collector_id,
      'authenticated',
      'authenticated',
      'phase7-target-collector@example.com',
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
      'phase7-other-collector@example.com',
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
    (v_admin_id, 'admin', 'Phase 7 Admin', true),
    (v_collector_actor_id, 'collector', 'Phase 7 Collector Actor', true),
    (v_inactive_admin_id, 'admin', 'Phase 7 Inactive Admin', false),
    (v_target_collector_id, 'collector', 'Phase 7 Target Collector', true),
    (v_other_collector_id, 'collector', 'Phase 7 Other Collector', true);

  insert into public.customers (
    id,
    assigned_collector_id,
    created_by,
    full_name,
    government_id,
    phone,
    address_line,
    neighborhood
  )
  values (
    '70000000-0000-0000-0000-000000000101',
    v_target_collector_id,
    v_admin_id,
    'Phase 7 Existing Customer',
    'PH7-EXIST-001',
    '3007000101',
    'Calle 7 # 10-11',
    'Centro'
  );
end;
$$;

set local role authenticated;

do $$
declare
  v_admin_id uuid := '70000000-0000-0000-0000-000000000001';
  v_target_collector_id uuid := '70000000-0000-0000-0000-000000000005';
  v_other_collector_id uuid := '70000000-0000-0000-0000-000000000006';
  v_result jsonb;
  v_customer_id uuid;
  v_loan_id uuid;
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

  begin
    insert into public.customers (
      id,
      assigned_collector_id,
      created_by,
      full_name,
      government_id,
      phone,
      address_line,
      neighborhood
    )
    values (
      '70000000-0000-0000-0000-000000000201',
      v_target_collector_id,
      v_admin_id,
      'Phase 7 Direct Customer',
      'PH7-DIRECT-001',
      '3007000201',
      'Carrera 1 # 2-03',
      'Directo'
    );

    raise exception 'phase7_gate_expected_direct_customer_insert_denied';
  exception
    when others then
      if sqlerrm = 'phase7_gate_expected_direct_customer_insert_denied' then
        raise;
      end if;
  end;

  v_result := public.originate_loan(
    null,
    jsonb_build_object(
      'assigned_collector_id', v_target_collector_id::text,
      'full_name', 'Phase 7 Admin Customer',
      'government_id', 'PH7-ADM-001',
      'phone', '3007000301',
      'address_line', 'Diagonal 9 # 12-13',
      'neighborhood', 'San Pedro',
      'notes', 'alta admin'
    ),
    jsonb_build_object(
      'principal_amount', 120.00,
      'installment_amount', 70.00,
      'interest_rate_daily', 0.050000,
      'total_installments', 2,
      'payment_frequency', 'weekly',
      'disbursement_date', '2026-05-06',
      'first_due_date', '2026-05-13',
      'currency_code', 'COP',
      'interest_mode', 'simple_precomputed',
      'notes', 'prestamo admin'
    ),
    jsonb_build_array(
      jsonb_build_object(
        'installment_number', 1,
        'due_date', '2026-05-13',
        'scheduled_amount', 70.00,
        'principal_amount', 60.00,
        'interest_amount', 10.00,
        'fee_amount', 0.00,
        'outstanding_principal_amount', 60.00,
        'outstanding_interest_amount', 10.00,
        'outstanding_fee_amount', 0.00,
        'outstanding_amount', 70.00,
        'status', 'pending'
      ),
      jsonb_build_object(
        'installment_number', 2,
        'due_date', '2026-05-20',
        'scheduled_amount', 70.00,
        'principal_amount', 60.00,
        'interest_amount', 10.00,
        'fee_amount', 0.00,
        'outstanding_principal_amount', 60.00,
        'outstanding_interest_amount', 10.00,
        'outstanding_fee_amount', 0.00,
        'outstanding_amount', 70.00,
        'status', 'pending'
      )
    )
  );

  v_customer_id := (v_result ->> 'customer_id')::uuid;
  v_loan_id := (v_result ->> 'loan_id')::uuid;

  if coalesce(v_result ->> 'created_customer', '') <> 'true' then
    raise exception 'phase7_gate_admin_should_create_customer';
  end if;

  if v_customer_id is null or v_loan_id is null then
    raise exception 'phase7_gate_admin_origination_missing_ids';
  end if;

  if (
    select count(*)
    from public.customers
    where public.customers.id = v_customer_id
      and public.customers.assigned_collector_id = v_target_collector_id
      and public.customers.created_by = v_admin_id
  ) <> 1 then
    raise exception 'phase7_gate_admin_customer_not_persisted';
  end if;

  if (
    select count(*)
    from public.loans
    where public.loans.id = v_loan_id
      and public.loans.customer_id = v_customer_id
      and public.loans.collector_id = v_target_collector_id
      and public.loans.created_by = v_admin_id
      and public.loans.status = 'active'::public.loan_status
      and public.loans.payment_frequency = 'weekly'::public.loan_payment_frequency
      and public.loans.interest_mode = 'simple_precomputed'::public.loan_interest_mode
      and public.loans.originated_at is not null
      and nullif(public.loans.external_loan_number, '') is not null
  ) <> 1 then
    raise exception 'phase7_gate_admin_loan_not_persisted';
  end if;

  if (
    select count(*)
    from public.installments
    where public.installments.loan_id = v_loan_id
  ) <> 2 then
    raise exception 'phase7_gate_admin_installments_not_materialized';
  end if;

  begin
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
    values (
      '70000000-0000-0000-0000-000000000202',
      v_customer_id,
      v_target_collector_id,
      v_admin_id,
      'PH7-DIRECT-LOAN',
      50.00,
      55.00,
      0.050000,
      1,
      'COP',
      date '2026-05-06',
      date '2026-05-07',
      'active',
      'daily',
      'simple_precomputed',
      timezone('utc', now())
    );

    raise exception 'phase7_gate_expected_direct_loan_insert_denied';
  exception
    when others then
      if sqlerrm = 'phase7_gate_expected_direct_loan_insert_denied' then
        raise;
      end if;
  end;

  begin
    perform public.originate_loan(
      null,
      jsonb_build_object(
        'assigned_collector_id', v_target_collector_id::text,
        'full_name', 'Phase 7 Failed Customer',
        'government_id', 'PH7-ADM-FAIL-001',
        'phone', '3007000302',
        'address_line', 'Diagonal 10 # 11-12',
        'neighborhood', 'San Benito'
      ),
      jsonb_build_object(
        'principal_amount', 120.00,
        'installment_amount', 70.00,
        'interest_rate_daily', 0.050000,
        'total_installments', 2,
        'payment_frequency', 'weekly',
        'disbursement_date', '2026-05-06',
        'first_due_date', '2026-05-13'
      ),
      jsonb_build_array(
        jsonb_build_object(
          'installment_number', 1,
          'due_date', '2026-05-13',
          'scheduled_amount', 70.00,
          'principal_amount', 50.00,
          'interest_amount', 20.00,
          'fee_amount', 0.00,
          'outstanding_principal_amount', 50.00,
          'outstanding_interest_amount', 20.00,
          'outstanding_fee_amount', 0.00,
          'outstanding_amount', 70.00,
          'status', 'pending'
        )
      )
    );

    raise exception 'phase7_gate_expected_installment_count_mismatch';
  exception
    when others then
      if sqlerrm = 'phase7_gate_expected_installment_count_mismatch' then
        raise;
      end if;

      if sqlerrm <> 'installments_count_mismatch' then
        raise exception 'phase7_gate_wrong_atomicity_error:%', sqlerrm;
      end if;
  end;

  if exists (
    select 1
    from public.customers
    where public.customers.government_id = 'PH7-ADM-FAIL-001'
  ) then
    raise exception 'phase7_gate_failed_origination_left_customer';
  end if;

  begin
    perform public.originate_loan(
      '70000000-0000-0000-0000-000000000101',
      null,
      jsonb_build_object(
        'collector_id', v_other_collector_id::text,
        'principal_amount', 55.00,
        'installment_amount', 60.00,
        'interest_rate_daily', 0.050000,
        'total_installments', 1,
        'payment_frequency', 'daily',
        'disbursement_date', '2026-05-06',
        'first_due_date', '2026-05-07'
      ),
      jsonb_build_array(
        jsonb_build_object(
          'installment_number', 1,
          'due_date', '2026-05-07',
          'scheduled_amount', 60.00,
          'principal_amount', 55.00,
          'interest_amount', 5.00,
          'fee_amount', 0.00,
          'outstanding_principal_amount', 55.00,
          'outstanding_interest_amount', 5.00,
          'outstanding_fee_amount', 0.00,
          'outstanding_amount', 60.00,
          'status', 'pending'
        )
      )
    );

    raise exception 'phase7_gate_expected_loan_collector_mismatch';
  exception
    when others then
      if sqlerrm = 'phase7_gate_expected_loan_collector_mismatch' then
        raise;
      end if;

      if sqlerrm <> 'loan_collector_mismatch' then
        raise exception 'phase7_gate_wrong_collector_mismatch_error:%', sqlerrm;
      end if;
  end;
end;
$$;

do $$
declare
  v_admin_id uuid := '70000000-0000-0000-0000-000000000001';
  v_existing_customer_id uuid := '70000000-0000-0000-0000-000000000101';
  v_target_collector_id uuid := '70000000-0000-0000-0000-000000000005';
  v_result jsonb;
  v_loan_id uuid;
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

  v_result := public.originate_loan(
    v_existing_customer_id,
    null,
    jsonb_build_object(
      'principal_amount', 50.00,
      'installment_amount', 55.00,
      'interest_rate_daily', 0.050000,
      'total_installments', 1,
      'payment_frequency', 'daily',
      'disbursement_date', '2026-05-06',
      'first_due_date', '2026-05-07',
      'currency_code', 'COP',
      'interest_mode', 'simple_precomputed'
    ),
    jsonb_build_array(
      jsonb_build_object(
        'installment_number', 1,
        'due_date', '2026-05-07',
        'scheduled_amount', 55.00,
        'principal_amount', 50.00,
        'interest_amount', 5.00,
        'fee_amount', 0.00,
        'outstanding_principal_amount', 50.00,
        'outstanding_interest_amount', 5.00,
        'outstanding_fee_amount', 0.00,
        'outstanding_amount', 55.00,
        'status', 'pending'
      )
    )
  );

  v_loan_id := (v_result ->> 'loan_id')::uuid;

  if coalesce(v_result ->> 'created_customer', '') <> 'false' then
    raise exception 'phase7_gate_existing_customer_should_not_be_recreated';
  end if;

  if v_loan_id is null then
    raise exception 'phase7_gate_admin_existing_customer_missing_loan_id';
  end if;

  if (
    select count(*)
    from public.loans
    where public.loans.id = v_loan_id
      and public.loans.customer_id = v_existing_customer_id
      and public.loans.collector_id = v_target_collector_id
      and public.loans.created_by = v_admin_id
      and public.loans.status = 'active'::public.loan_status
  ) <> 1 then
    raise exception 'phase7_gate_admin_existing_customer_loan_not_persisted';
  end if;
end;
$$;

do $$
declare
  v_collector_actor_id uuid := '70000000-0000-0000-0000-000000000003';
  v_target_collector_id uuid := '70000000-0000-0000-0000-000000000005';
begin
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
    perform public.originate_loan(
      null,
      jsonb_build_object(
        'assigned_collector_id', v_target_collector_id::text,
        'full_name', 'Phase 7 Collector Customer',
        'government_id', 'PH7-COL-001',
        'phone', '3007000401',
        'address_line', 'Cra 4 # 5-06',
        'neighborhood', 'Obrero'
      ),
      jsonb_build_object(
        'principal_amount', 50.00,
        'installment_amount', 55.00,
        'interest_rate_daily', 0.050000,
        'total_installments', 1,
        'payment_frequency', 'daily',
        'disbursement_date', '2026-05-06',
        'first_due_date', '2026-05-07'
      ),
      jsonb_build_array(
        jsonb_build_object(
          'installment_number', 1,
          'due_date', '2026-05-07',
          'scheduled_amount', 55.00,
          'principal_amount', 50.00,
          'interest_amount', 5.00,
          'fee_amount', 0.00,
          'outstanding_principal_amount', 50.00,
          'outstanding_interest_amount', 5.00,
          'outstanding_fee_amount', 0.00,
          'outstanding_amount', 55.00,
          'status', 'pending'
        )
      )
    );

    raise exception 'phase7_gate_expected_collector_denied';
  exception
    when others then
      if sqlerrm = 'phase7_gate_expected_collector_denied' then
        raise;
      end if;

      if sqlerrm <> 'originator_role_not_allowed' then
        raise exception 'phase7_gate_wrong_collector_error:%', sqlerrm;
      end if;
  end;
end;
$$;

do $$
declare
  v_inactive_admin_id uuid := '70000000-0000-0000-0000-000000000004';
  v_target_collector_id uuid := '70000000-0000-0000-0000-000000000005';
begin
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
    perform public.originate_loan(
      null,
      jsonb_build_object(
        'assigned_collector_id', v_target_collector_id::text,
        'full_name', 'Phase 7 Inactive Admin Customer',
        'government_id', 'PH7-INACT-001',
        'phone', '3007000501',
        'address_line', 'Cra 6 # 7-08',
        'neighborhood', 'Inactivo'
      ),
      jsonb_build_object(
        'principal_amount', 50.00,
        'installment_amount', 55.00,
        'interest_rate_daily', 0.050000,
        'total_installments', 1,
        'payment_frequency', 'daily',
        'disbursement_date', '2026-05-06',
        'first_due_date', '2026-05-07'
      ),
      jsonb_build_array(
        jsonb_build_object(
          'installment_number', 1,
          'due_date', '2026-05-07',
          'scheduled_amount', 55.00,
          'principal_amount', 50.00,
          'interest_amount', 5.00,
          'fee_amount', 0.00,
          'outstanding_principal_amount', 50.00,
          'outstanding_interest_amount', 5.00,
          'outstanding_fee_amount', 0.00,
          'outstanding_amount', 55.00,
          'status', 'pending'
        )
      )
    );

    raise exception 'phase7_gate_expected_inactive_admin_denied';
  exception
    when others then
      if sqlerrm = 'phase7_gate_expected_inactive_admin_denied' then
        raise;
      end if;

      if sqlerrm <> 'originator_inactive' then
        raise exception 'phase7_gate_wrong_inactive_admin_error:%', sqlerrm;
      end if;
  end;
end;
$$;

reset role;
rollback;
