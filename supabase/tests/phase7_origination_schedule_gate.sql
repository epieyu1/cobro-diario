-- Compuerta OR-2 para cronograma y validacion financiera de originacion.
-- Debe ejecutarse con ROLLBACK y mantenerse alineada con build_origination_schedule(),
-- el helper TypeScript de preview y el RPC originate_loan().
begin;

do $$
declare
  v_admin_id uuid := '71000000-0000-0000-0000-000000000001';
  v_target_collector_id uuid := '71000000-0000-0000-0000-000000000002';
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
      'phase7-schedule-admin@example.com',
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
      'phase7-schedule-collector@example.com',
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
    (v_admin_id, 'admin', 'Phase 7 Schedule Admin', true),
    (v_target_collector_id, 'collector', 'Phase 7 Schedule Collector', true);
end;
$$;

do $$
declare
  v_due_dates date[];
  v_interest_amounts numeric[];
  v_principal_total numeric(14, 2);
begin
  select
    array_agg(due_date order by installment_number),
    array_agg(interest_amount order by installment_number),
    sum(principal_amount)
  into
    v_due_dates,
    v_interest_amounts,
    v_principal_total
  from private.build_origination_schedule(
    270.00,
    100.00,
    3,
    'daily'::public.loan_payment_frequency,
    date '2026-05-06',
    date '2026-05-07'
  );

  if v_due_dates <> array[date '2026-05-07', date '2026-05-08', date '2026-05-09'] then
    raise exception 'phase7_schedule_gate_daily_due_dates_invalid';
  end if;

  if v_interest_amounts <> array[10.00, 10.00, 10.00]::numeric[] then
    raise exception 'phase7_schedule_gate_daily_interest_split_invalid';
  end if;

  if v_principal_total <> 270.00 then
    raise exception 'phase7_schedule_gate_daily_principal_total_invalid';
  end if;
end;
$$;

do $$
declare
  v_due_dates date[];
begin
  select array_agg(due_date order by installment_number)
  into v_due_dates
  from private.build_origination_schedule(
    120.00,
    70.00,
    2,
    'weekly'::public.loan_payment_frequency,
    date '2026-05-06',
    date '2026-05-13'
  );

  if v_due_dates <> array[date '2026-05-13', date '2026-05-20'] then
    raise exception 'phase7_schedule_gate_weekly_due_dates_invalid';
  end if;
end;
$$;

do $$
declare
  v_due_dates date[];
begin
  select array_agg(due_date order by installment_number)
  into v_due_dates
  from private.build_origination_schedule(
    150.00,
    60.00,
    3,
    'biweekly'::public.loan_payment_frequency,
    date '2026-05-01',
    date '2026-05-16'
  );

  if v_due_dates <> array[date '2026-05-16', date '2026-05-31', date '2026-06-15'] then
    raise exception 'phase7_schedule_gate_biweekly_due_dates_invalid';
  end if;
end;
$$;

do $$
declare
  v_due_dates date[];
  v_interest_amounts numeric[];
  v_principal_amounts numeric[];
begin
  select
    array_agg(due_date order by installment_number),
    array_agg(interest_amount order by installment_number),
    array_agg(principal_amount order by installment_number)
  into
    v_due_dates,
    v_interest_amounts,
    v_principal_amounts
  from private.build_origination_schedule(
    100.00,
    33.34,
    3,
    'monthly'::public.loan_payment_frequency,
    date '2026-01-10',
    date '2026-01-31'
  );

  if v_due_dates <> array[date '2026-01-31', date '2026-02-28', date '2026-03-31'] then
    raise exception 'phase7_schedule_gate_monthly_due_dates_invalid';
  end if;

  if v_interest_amounts <> array[0.01, 0.01, 0.00]::numeric[] then
    raise exception 'phase7_schedule_gate_monthly_interest_residual_invalid';
  end if;

  if v_principal_amounts <> array[33.33, 33.33, 33.34]::numeric[] then
    raise exception 'phase7_schedule_gate_monthly_principal_residual_invalid';
  end if;
end;
$$;

do $$
begin
  begin
    perform *
    from private.build_origination_schedule(
      100.00,
      30.00,
      3,
      'daily'::public.loan_payment_frequency,
      date '2026-05-06',
      date '2026-05-07'
    );

    raise exception 'phase7_schedule_gate_expected_total_below_principal';
  exception
    when others then
      if sqlerrm = 'phase7_schedule_gate_expected_total_below_principal' then
        raise;
      end if;

      if sqlerrm <> 'loan_total_scheduled_below_principal' then
        raise exception 'phase7_schedule_gate_wrong_total_below_principal_error:%', sqlerrm;
      end if;
  end;
end;
$$;

set local role authenticated;

do $$
declare
  v_admin_id uuid := '71000000-0000-0000-0000-000000000001';
  v_target_collector_id uuid := '71000000-0000-0000-0000-000000000002';
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
    perform public.originate_loan(
      null,
      jsonb_build_object(
        'assigned_collector_id', v_target_collector_id::text,
        'full_name', 'Phase 7 Schedule Mismatch',
        'government_id', 'PH7-SCH-MISMATCH-001',
        'phone', '3007100001',
        'address_line', 'Calle 1 # 2-03',
        'neighborhood', 'Mismatch'
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
          'outstanding_amount', 70.00,
          'status', 'pending'
        ),
        jsonb_build_object(
          'installment_number', 2,
          'due_date', '2026-05-20',
          'scheduled_amount', 70.00,
          'principal_amount', 70.00,
          'interest_amount', 0.00,
          'fee_amount', 0.00,
          'outstanding_amount', 70.00,
          'status', 'pending'
        )
      )
    );

    raise exception 'phase7_schedule_gate_expected_installment_schedule_mismatch';
  exception
    when others then
      if sqlerrm = 'phase7_schedule_gate_expected_installment_schedule_mismatch' then
        raise;
      end if;

      if sqlerrm <> 'installment_schedule_mismatch' then
        raise exception 'phase7_schedule_gate_wrong_schedule_mismatch_error:%', sqlerrm;
      end if;
  end;
end;
$$;

do $$
declare
  v_admin_id uuid := '71000000-0000-0000-0000-000000000001';
  v_target_collector_id uuid := '71000000-0000-0000-0000-000000000002';
  v_result jsonb;
  v_loan_id uuid;
  v_due_dates date[];
  v_interest_amounts numeric[];
  v_status public.loan_status;
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
    null,
    jsonb_build_object(
      'assigned_collector_id', v_target_collector_id::text,
      'full_name', 'Phase 7 Schedule Valid',
      'government_id', 'PH7-SCH-VALID-001',
      'phone', '3007100002',
      'address_line', 'Calle 4 # 5-06',
      'neighborhood', 'Valido'
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
      'interest_mode', 'simple_precomputed'
    ),
    jsonb_build_array(
      jsonb_build_object(
        'installment_number', 1,
        'due_date', '2026-05-13',
        'scheduled_amount', 70.00,
        'principal_amount', 60.00,
        'interest_amount', 10.00,
        'fee_amount', 0.00,
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
        'outstanding_amount', 70.00,
        'status', 'pending'
      )
    )
  );

  v_loan_id := (v_result ->> 'loan_id')::uuid;

  if v_loan_id is null then
    raise exception 'phase7_schedule_gate_missing_loan_id';
  end if;

  select public.loans.status
  into v_status
  from public.loans
  where public.loans.id = v_loan_id;

  if v_status <> 'active'::public.loan_status then
    raise exception 'phase7_schedule_gate_expected_active_loan';
  end if;

  select
    array_agg(due_date order by installment_number),
    array_agg(interest_amount order by installment_number)
  into
    v_due_dates,
    v_interest_amounts
  from public.installments
  where public.installments.loan_id = v_loan_id;

  if v_due_dates <> array[date '2026-05-13', date '2026-05-20'] then
    raise exception 'phase7_schedule_gate_persisted_due_dates_invalid';
  end if;

  if v_interest_amounts <> array[10.00, 10.00]::numeric[] then
    raise exception 'phase7_schedule_gate_persisted_interest_invalid';
  end if;
end;
$$;

reset role;
rollback;
