-- Compuerta BR-6 para coexistencia V1/V2, originacion compound y abonos dirigidos.
-- Debe ejecutarse con ROLLBACK y mantenerse alineada con:
-- private.build_financial_schedule, public.originate_loan, public.record_payment y public.reverse_payment.
begin;

do $$
declare
  v_admin_id uuid := '58000000-0000-0000-0000-000000000001';
  v_collector_id uuid := '58000000-0000-0000-0000-000000000002';
  v_today date := timezone('America/Bogota', now())::date;
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
      'phase6-v2-admin@example.com',
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
      'phase6-v2-collector@example.com',
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
    (v_admin_id, 'admin', 'Phase 6 V2 Admin', true),
    (v_collector_id, 'collector', 'Phase 6 V2 Collector', true);
end;
$$;

set local role authenticated;

do $$
declare
  v_admin_id uuid := '58000000-0000-0000-0000-000000000001';
  v_collector_id uuid := '58000000-0000-0000-0000-000000000002';
  v_today date := timezone('America/Bogota', now())::date;
  v_principal_result jsonb;
  v_interest_result jsonb;
  v_principal_loan_id uuid;
  v_interest_loan_id uuid;
  v_principal_installment_one_id uuid;
  v_principal_installment_two_id uuid;
  v_interest_installment_one_id uuid;
  v_recorded_principal_payment_id uuid;
  v_recorded_interest_payment_id uuid;
  v_reversed_receipt jsonb;
  v_principal_loan public.loans%rowtype;
  v_interest_loan public.loans%rowtype;
  v_installment public.installments%rowtype;
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

  v_principal_result := public.originate_loan(
    null,
    jsonb_build_object(
      'assigned_collector_id', v_collector_id::text,
      'full_name', 'Cliente BR6 Capital',
      'government_id', 'BR6-CAP-001',
      'phone', '3005800001',
      'address_line', 'Calle BR6 # 10-01',
      'neighborhood', 'Centro',
      'route_label', 'BR6 Ruta Capital'
    ),
    jsonb_build_object(
      'principal_amount', 100.00,
      'installment_amount', 57.62,
      'interest_rate_daily', 0.10,
      'total_installments', 2,
      'payment_frequency', 'daily',
      'disbursement_date', v_today,
      'first_due_date', v_today + 1,
      'currency_code', 'COP',
      'interest_mode', 'compound_fixed_installment',
      'payment_application_mode', 'principal_only',
      'notes', 'prestamo compound capital'
    ),
    jsonb_build_array(
      jsonb_build_object(
        'installment_number', 1,
        'due_date', v_today + 1,
        'scheduled_amount', 57.62,
        'principal_amount', 47.62,
        'interest_amount', 10.00,
        'fee_amount', 0.00,
        'outstanding_principal_amount', 47.62,
        'outstanding_interest_amount', 10.00,
        'outstanding_fee_amount', 0.00,
        'outstanding_amount', 57.62,
        'status', 'pending'
      ),
      jsonb_build_object(
        'installment_number', 2,
        'due_date', v_today + 2,
        'scheduled_amount', 57.62,
        'principal_amount', 52.38,
        'interest_amount', 5.24,
        'fee_amount', 0.00,
        'outstanding_principal_amount', 52.38,
        'outstanding_interest_amount', 5.24,
        'outstanding_fee_amount', 0.00,
        'outstanding_amount', 57.62,
        'status', 'pending'
      )
    )
  );

  v_interest_result := public.originate_loan(
    null,
    jsonb_build_object(
      'assigned_collector_id', v_collector_id::text,
      'full_name', 'Cliente BR6 Interes',
      'government_id', 'BR6-INT-001',
      'phone', '3005800002',
      'address_line', 'Carrera BR6 # 10-02',
      'neighborhood', 'Norte',
      'route_label', 'BR6 Ruta Interes'
    ),
    jsonb_build_object(
      'principal_amount', 100.00,
      'installment_amount', 57.62,
      'interest_rate_daily', 0.10,
      'total_installments', 2,
      'payment_frequency', 'daily',
      'disbursement_date', v_today,
      'first_due_date', v_today + 1,
      'currency_code', 'COP',
      'interest_mode', 'compound_fixed_installment',
      'payment_application_mode', 'interest_only',
      'notes', 'prestamo compound interes'
    ),
    jsonb_build_array(
      jsonb_build_object(
        'installment_number', 1,
        'due_date', v_today + 1,
        'scheduled_amount', 57.62,
        'principal_amount', 47.62,
        'interest_amount', 10.00,
        'fee_amount', 0.00,
        'outstanding_principal_amount', 47.62,
        'outstanding_interest_amount', 10.00,
        'outstanding_fee_amount', 0.00,
        'outstanding_amount', 57.62,
        'status', 'pending'
      ),
      jsonb_build_object(
        'installment_number', 2,
        'due_date', v_today + 2,
        'scheduled_amount', 57.62,
        'principal_amount', 52.38,
        'interest_amount', 5.24,
        'fee_amount', 0.00,
        'outstanding_principal_amount', 52.38,
        'outstanding_interest_amount', 5.24,
        'outstanding_fee_amount', 0.00,
        'outstanding_amount', 57.62,
        'status', 'pending'
      )
    )
  );

  begin
    perform public.originate_loan(
      null,
      jsonb_build_object(
        'assigned_collector_id', v_collector_id::text,
        'full_name', 'Cliente BR6 Invalido',
        'government_id', 'BR6-INVALID-001',
        'phone', '3005800003',
        'address_line', 'Diagonal BR6 # 10-03',
        'neighborhood', 'Sur',
        'route_label', 'BR6 Ruta Invalida'
      ),
      jsonb_build_object(
        'principal_amount', 100.00,
        'installment_amount', 55.00,
        'interest_rate_daily', 0.00,
        'total_installments', 2,
        'payment_frequency', 'daily',
        'disbursement_date', v_today,
        'first_due_date', v_today + 1,
        'currency_code', 'COP',
        'interest_mode', 'simple_precomputed',
        'payment_application_mode', 'principal_only'
      ),
      jsonb_build_array(
        jsonb_build_object(
          'installment_number', 1,
          'due_date', v_today + 1,
          'scheduled_amount', 55.00,
          'principal_amount', 50.00,
          'interest_amount', 5.00,
          'fee_amount', 0.00,
          'outstanding_principal_amount', 50.00,
          'outstanding_interest_amount', 5.00,
          'outstanding_fee_amount', 0.00,
          'outstanding_amount', 55.00,
          'status', 'pending'
        ),
        jsonb_build_object(
          'installment_number', 2,
          'due_date', v_today + 2,
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

    raise exception 'phase6_v2_gate_expected_simple_directed_mode_rejection';
  exception
    when others then
      if sqlerrm = 'phase6_v2_gate_expected_simple_directed_mode_rejection' then
        raise;
      end if;

      if sqlerrm <> 'loan_payment_application_mode_not_supported' then
        raise exception 'phase6_v2_gate_expected_simple_directed_mode_rejection_got_%', sqlerrm;
      end if;
  end;

  v_principal_loan_id := (v_principal_result ->> 'loan_id')::uuid;
  v_interest_loan_id := (v_interest_result ->> 'loan_id')::uuid;

  select *
  into v_principal_loan
  from public.loans
  where public.loans.id = v_principal_loan_id;

  select *
  into v_interest_loan
  from public.loans
  where public.loans.id = v_interest_loan_id;

  if v_principal_loan.interest_mode <> 'compound_fixed_installment'::public.loan_interest_mode
    or v_principal_loan.payment_application_mode <> 'principal_only'::public.loan_payment_application_mode then
    raise exception 'phase6_v2_gate_compound_principal_contract_mismatch';
  end if;

  if v_interest_loan.interest_mode <> 'compound_fixed_installment'::public.loan_interest_mode
    or v_interest_loan.payment_application_mode <> 'interest_only'::public.loan_payment_application_mode then
    raise exception 'phase6_v2_gate_compound_interest_contract_mismatch';
  end if;

  select public.installments.id
  into v_principal_installment_one_id
  from public.installments
  where public.installments.loan_id = v_principal_loan_id
    and public.installments.installment_number = 1;

  select public.installments.id
  into v_principal_installment_two_id
  from public.installments
  where public.installments.loan_id = v_principal_loan_id
    and public.installments.installment_number = 2;

  select public.installments.id
  into v_interest_installment_one_id
  from public.installments
  where public.installments.loan_id = v_interest_loan_id
    and public.installments.installment_number = 1;

  perform set_config('request.jwt.claim.sub', v_collector_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', v_collector_id::text,
      'app_metadata', jsonb_build_object('role', 'collector')
    )::text,
    true
  );

  begin
    perform public.record_payment(
      'phase6-v2-invalid-principal',
      'BR6-CAP-ERR',
      v_collector_id,
      (v_principal_result ->> 'customer_id')::uuid,
      v_principal_loan_id,
      null,
      'cash',
      timezone('utc', now()),
      null,
      null,
      'invalid principal_only mix',
      jsonb_build_array(
        jsonb_build_object(
          'installment_id', v_principal_installment_one_id,
          'applied_amount', 47.62,
          'principal_component', 40.00,
          'interest_component', 7.62,
          'fee_component', 0.00
        )
      )
    );

    raise exception 'phase6_v2_gate_expected_principal_only_component_rejection';
  exception
    when others then
      if sqlerrm = 'phase6_v2_gate_expected_principal_only_component_rejection' then
        raise;
      end if;

      if sqlerrm <> 'payment_mode_component_violation' then
        raise exception 'phase6_v2_gate_expected_principal_only_component_rejection_got_%', sqlerrm;
      end if;
  end;

  v_recorded_principal_payment_id := public.record_payment(
    'phase6-v2-principal-payment',
    'BR6-CAP-001',
    v_collector_id,
    (v_principal_result ->> 'customer_id')::uuid,
    v_principal_loan_id,
    null,
    'cash',
    timezone('utc', now()),
    null,
    null,
    'valid principal_only payment',
    jsonb_build_array(
      jsonb_build_object(
        'installment_id', v_principal_installment_one_id,
        'applied_amount', 47.62,
        'principal_component', 47.62,
        'interest_component', 0.00,
        'fee_component', 0.00
      )
    )
  );

  select *
  into v_installment
  from public.installments
  where public.installments.id = v_principal_installment_one_id;

  if v_installment.outstanding_principal_amount <> 0.00
    or v_installment.outstanding_interest_amount <> 10.00
    or v_installment.outstanding_amount <> 10.00
    or v_installment.status <> 'partial'::public.installment_status then
    raise exception 'phase6_v2_gate_principal_only_allocation_mismatch';
  end if;

  if exists (
    select 1
    from public.installments
    where public.installments.id = v_principal_installment_two_id
      and (
        public.installments.outstanding_principal_amount <> 52.38
        or public.installments.outstanding_interest_amount <> 5.24
      )
  ) then
    raise exception 'phase6_v2_gate_principal_only_touched_wrong_installment';
  end if;

  v_recorded_interest_payment_id := public.record_payment(
    'phase6-v2-interest-payment',
    'BR6-INT-001',
    v_collector_id,
    (v_interest_result ->> 'customer_id')::uuid,
    v_interest_loan_id,
    null,
    'cash',
    timezone('utc', now()),
    null,
    null,
    'valid interest_only payment',
    jsonb_build_array(
      jsonb_build_object(
        'installment_id', v_interest_installment_one_id,
        'applied_amount', 10.00,
        'principal_component', 0.00,
        'interest_component', 10.00,
        'fee_component', 0.00
      )
    )
  );

  if v_recorded_principal_payment_id is null or v_recorded_interest_payment_id is null then
    raise exception 'phase6_v2_gate_payment_rpc_missing_id';
  end if;

  select *
  into v_installment
  from public.installments
  where public.installments.id = v_interest_installment_one_id;

  if v_installment.outstanding_principal_amount <> 47.62
    or v_installment.outstanding_interest_amount <> 0.00
    or v_installment.outstanding_amount <> 47.62
    or v_installment.status <> 'partial'::public.installment_status then
    raise exception 'phase6_v2_gate_interest_only_allocation_mismatch';
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

  v_reversed_receipt := public.reverse_payment(v_recorded_principal_payment_id, 'rollback BR-6 gate');

  if (v_reversed_receipt ->> 'paymentStatus') <> 'reversed' then
    raise exception 'phase6_v2_gate_reverse_receipt_status_mismatch';
  end if;

  select *
  into v_installment
  from public.installments
  where public.installments.id = v_principal_installment_one_id;

  if v_installment.outstanding_principal_amount <> 47.62
    or v_installment.outstanding_interest_amount <> 10.00
    or v_installment.outstanding_amount <> 57.62
    or v_installment.status <> 'pending'::public.installment_status then
    raise exception 'phase6_v2_gate_reverse_restore_mismatch';
  end if;
end;
$$;

rollback;
