-- Compuerta OR-5 para dejar congelado el corte final de roles de originacion.
-- Debe ejecutarse con ROLLBACK y mantenerse alineada con private.current_app_role(),
-- private.is_admin(), private.can_originate_for_collector() y public.originate_loan().
begin;

do $$
declare
  v_admin_id uuid := '71000000-0000-0000-0000-000000000001';
  v_collector_actor_id uuid := '71000000-0000-0000-0000-000000000002';
  v_inactive_admin_id uuid := '71000000-0000-0000-0000-000000000003';
  v_target_collector_id uuid := '71000000-0000-0000-0000-000000000004';
  v_inactive_target_collector_id uuid := '71000000-0000-0000-0000-000000000005';
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
      'phase7-roles-admin@example.com',
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
      'phase7-roles-collector@example.com',
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
      'phase7-roles-inactive-admin@example.com',
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
      'phase7-roles-target-collector@example.com',
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
      v_inactive_target_collector_id,
      'authenticated',
      'authenticated',
      'phase7-roles-inactive-collector@example.com',
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
    (v_admin_id, 'admin', 'Phase 7 Roles Admin', true),
    (v_collector_actor_id, 'collector', 'Phase 7 Roles Collector', true),
    (v_inactive_admin_id, 'admin', 'Phase 7 Roles Inactive Admin', false),
    (v_target_collector_id, 'collector', 'Phase 7 Roles Target Collector', true),
    (v_inactive_target_collector_id, 'collector', 'Phase 7 Roles Inactive Collector', false);
end;
$$;

set local role authenticated;

do $$
declare
  v_admin_id uuid := '71000000-0000-0000-0000-000000000001';
  v_collector_actor_id uuid := '71000000-0000-0000-0000-000000000002';
  v_inactive_admin_id uuid := '71000000-0000-0000-0000-000000000003';
  v_target_collector_id uuid := '71000000-0000-0000-0000-000000000004';
  v_inactive_target_collector_id uuid := '71000000-0000-0000-0000-000000000005';
  v_before_count integer;
  v_after_count integer;
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

  if private.current_app_role() <> 'admin'::public.app_role then
    raise exception 'phase7_roles_gate_admin_claim_not_resolved';
  end if;

  v_result := public.originate_loan(
    null,
    jsonb_build_object(
      'assigned_collector_id', v_target_collector_id::text,
      'full_name', 'Phase 7 Roles Admin Customer',
      'government_id', 'PH7R-ADM-001',
      'phone', '3107000101',
      'address_line', 'Calle 7 # 10-11',
      'neighborhood', 'Centro',
      'notes', 'alta admin roles'
    ),
    jsonb_build_object(
      'principal_amount', 120.00,
      'installment_amount', 70.00,
      'interest_rate_daily', 0.050000,
      'total_installments', 2,
      'payment_frequency', 'daily',
      'disbursement_date', '2026-05-06',
      'first_due_date', '2026-05-07',
      'currency_code', 'COP',
      'interest_mode', 'simple_precomputed',
      'notes', 'prestamo admin roles'
    ),
    jsonb_build_array(
      jsonb_build_object(
        'installment_number', 1,
        'due_date', '2026-05-07',
        'scheduled_amount', 70.00,
        'principal_amount', 60.00,
        'interest_amount', 10.00,
        'fee_amount', 0.00,
        'outstanding_amount', 70.00,
        'status', 'pending'
      ),
      jsonb_build_object(
        'installment_number', 2,
        'due_date', '2026-05-08',
        'scheduled_amount', 70.00,
        'principal_amount', 60.00,
        'interest_amount', 10.00,
        'fee_amount', 0.00,
        'outstanding_amount', 70.00,
        'status', 'pending'
      )
    )
  );

  v_customer_id := (v_result ->> 'customer_id')::uuid;
  v_loan_id := (v_result ->> 'loan_id')::uuid;

  if coalesce(v_result ->> 'created_customer', '') <> 'true' then
    raise exception 'phase7_roles_gate_admin_should_create_customer';
  end if;

  if v_customer_id is null or v_loan_id is null then
    raise exception 'phase7_roles_gate_admin_missing_ids';
  end if;

  if not exists (
    select 1
    from public.customers
    where public.customers.id = v_customer_id
      and public.customers.assigned_collector_id = v_target_collector_id
  ) then
    raise exception 'phase7_roles_gate_admin_customer_not_visible';
  end if;

  if not exists (
    select 1
    from public.loans
    where public.loans.id = v_loan_id
      and public.loans.collector_id = v_target_collector_id
      and public.loans.created_by = v_admin_id
  ) then
    raise exception 'phase7_roles_gate_admin_loan_not_created';
  end if;

  perform set_config('request.jwt.claim.sub', v_admin_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', v_admin_id::text,
      'app_metadata', jsonb_build_object('role', 'legacy_management')
    )::text,
    true
  );

  if private.current_app_role() <> 'collector'::public.app_role then
    raise exception 'phase7_roles_gate_legacy_claim_not_degraded';
  end if;

  select count(*)
  into v_before_count
  from public.customers
  where public.customers.government_id = 'PH7R-LEG-001';

  begin
    perform public.originate_loan(
      null,
      jsonb_build_object(
        'assigned_collector_id', v_target_collector_id::text,
        'full_name', 'Phase 7 Roles Legacy Claim',
        'government_id', 'PH7R-LEG-001',
        'phone', '3107000102',
        'address_line', 'Carrera 7 # 10-12',
        'neighborhood', 'Centro'
      ),
      jsonb_build_object(
        'principal_amount', 120.00,
        'installment_amount', 70.00,
        'interest_rate_daily', 0.050000,
        'total_installments', 2,
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
          'scheduled_amount', 70.00,
          'principal_amount', 60.00,
          'interest_amount', 10.00,
          'fee_amount', 0.00,
          'outstanding_amount', 70.00,
          'status', 'pending'
        ),
        jsonb_build_object(
          'installment_number', 2,
          'due_date', '2026-05-08',
          'scheduled_amount', 70.00,
          'principal_amount', 60.00,
          'interest_amount', 10.00,
          'fee_amount', 0.00,
          'outstanding_amount', 70.00,
          'status', 'pending'
        )
      )
    );

    raise exception 'phase7_roles_gate_expected_legacy_claim_denied';
  exception
    when others then
      if sqlerrm = 'phase7_roles_gate_expected_legacy_claim_denied' then
        raise;
      end if;

      if sqlerrm <> 'originator_role_not_allowed' then
        raise exception 'phase7_roles_gate_unexpected_legacy_claim_error:%', sqlerrm;
      end if;
  end;

  select count(*)
  into v_after_count
  from public.customers
  where public.customers.government_id = 'PH7R-LEG-001';

  if v_after_count <> v_before_count then
    raise exception 'phase7_roles_gate_legacy_claim_left_rows';
  end if;

  perform set_config('request.jwt.claim.sub', v_collector_actor_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', v_collector_actor_id::text,
      'app_metadata', jsonb_build_object('role', 'collector')
    )::text,
    true
  );

  select count(*)
  into v_before_count
  from public.customers
  where public.customers.government_id = 'PH7R-COL-001';

  begin
    perform public.originate_loan(
      null,
      jsonb_build_object(
        'assigned_collector_id', v_target_collector_id::text,
        'full_name', 'Phase 7 Roles Collector Rejected',
        'government_id', 'PH7R-COL-001',
        'phone', '3107000103',
        'address_line', 'Carrera 8 # 10-13',
        'neighborhood', 'Centro'
      ),
      jsonb_build_object(
        'principal_amount', 120.00,
        'installment_amount', 70.00,
        'interest_rate_daily', 0.050000,
        'total_installments', 2,
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
          'scheduled_amount', 70.00,
          'principal_amount', 60.00,
          'interest_amount', 10.00,
          'fee_amount', 0.00,
          'outstanding_amount', 70.00,
          'status', 'pending'
        ),
        jsonb_build_object(
          'installment_number', 2,
          'due_date', '2026-05-08',
          'scheduled_amount', 70.00,
          'principal_amount', 60.00,
          'interest_amount', 10.00,
          'fee_amount', 0.00,
          'outstanding_amount', 70.00,
          'status', 'pending'
        )
      )
    );

    raise exception 'phase7_roles_gate_expected_collector_denied';
  exception
    when others then
      if sqlerrm = 'phase7_roles_gate_expected_collector_denied' then
        raise;
      end if;

      if sqlerrm <> 'originator_role_not_allowed' then
        raise exception 'phase7_roles_gate_unexpected_collector_error:%', sqlerrm;
      end if;
  end;

  select count(*)
  into v_after_count
  from public.customers
  where public.customers.government_id = 'PH7R-COL-001';

  if v_after_count <> v_before_count then
    raise exception 'phase7_roles_gate_collector_left_rows';
  end if;

  perform set_config('request.jwt.claim.sub', v_inactive_admin_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', v_inactive_admin_id::text,
      'app_metadata', jsonb_build_object('role', 'admin')
    )::text,
    true
  );

  select count(*)
  into v_before_count
  from public.customers
  where public.customers.government_id = 'PH7R-INACTIVE-001';

  begin
    perform public.originate_loan(
      null,
      jsonb_build_object(
        'assigned_collector_id', v_target_collector_id::text,
        'full_name', 'Phase 7 Roles Inactive Admin',
        'government_id', 'PH7R-INACTIVE-001',
        'phone', '3107000104',
        'address_line', 'Carrera 9 # 10-14',
        'neighborhood', 'Centro'
      ),
      jsonb_build_object(
        'principal_amount', 120.00,
        'installment_amount', 70.00,
        'interest_rate_daily', 0.050000,
        'total_installments', 2,
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
          'scheduled_amount', 70.00,
          'principal_amount', 60.00,
          'interest_amount', 10.00,
          'fee_amount', 0.00,
          'outstanding_amount', 70.00,
          'status', 'pending'
        ),
        jsonb_build_object(
          'installment_number', 2,
          'due_date', '2026-05-08',
          'scheduled_amount', 70.00,
          'principal_amount', 60.00,
          'interest_amount', 10.00,
          'fee_amount', 0.00,
          'outstanding_amount', 70.00,
          'status', 'pending'
        )
      )
    );

    raise exception 'phase7_roles_gate_expected_inactive_admin_denied';
  exception
    when others then
      if sqlerrm = 'phase7_roles_gate_expected_inactive_admin_denied' then
        raise;
      end if;

      if sqlerrm <> 'originator_inactive' then
        raise exception 'phase7_roles_gate_unexpected_inactive_admin_error:%', sqlerrm;
      end if;
  end;

  select count(*)
  into v_after_count
  from public.customers
  where public.customers.government_id = 'PH7R-INACTIVE-001';

  if v_after_count <> v_before_count then
    raise exception 'phase7_roles_gate_inactive_admin_left_rows';
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
  into v_before_count
  from public.customers
  where public.customers.government_id = 'PH7R-INACTIVE-COL-001';

  begin
    perform public.originate_loan(
      null,
      jsonb_build_object(
        'assigned_collector_id', v_inactive_target_collector_id::text,
        'full_name', 'Phase 7 Roles Inactive Collector',
        'government_id', 'PH7R-INACTIVE-COL-001',
        'phone', '3107000105',
        'address_line', 'Carrera 10 # 10-15',
        'neighborhood', 'Centro'
      ),
      jsonb_build_object(
        'principal_amount', 120.00,
        'installment_amount', 70.00,
        'interest_rate_daily', 0.050000,
        'total_installments', 2,
        'payment_frequency', 'daily',
        'disbursement_date', '2026-05-06',
        'first_due_date', '2026-05-07',
        'currency_code', 'COP',
        'interest_mode', 'simple_precomputed',
        'collector_id', v_inactive_target_collector_id::text
      ),
      jsonb_build_array(
        jsonb_build_object(
          'installment_number', 1,
          'due_date', '2026-05-07',
          'scheduled_amount', 70.00,
          'principal_amount', 60.00,
          'interest_amount', 10.00,
          'fee_amount', 0.00,
          'outstanding_amount', 70.00,
          'status', 'pending'
        ),
        jsonb_build_object(
          'installment_number', 2,
          'due_date', '2026-05-08',
          'scheduled_amount', 70.00,
          'principal_amount', 60.00,
          'interest_amount', 10.00,
          'fee_amount', 0.00,
          'outstanding_amount', 70.00,
          'status', 'pending'
        )
      )
    );

    raise exception 'phase7_roles_gate_expected_inactive_collector_denied';
  exception
    when others then
      if sqlerrm = 'phase7_roles_gate_expected_inactive_collector_denied' then
        raise;
      end if;

      if sqlerrm <> 'assigned_collector_must_be_active_collector' then
        raise exception 'phase7_roles_gate_unexpected_inactive_collector_error:%', sqlerrm;
      end if;
  end;

  select count(*)
  into v_after_count
  from public.customers
  where public.customers.government_id = 'PH7R-INACTIVE-COL-001';

  if v_after_count <> v_before_count then
    raise exception 'phase7_roles_gate_inactive_collector_left_rows';
  end if;
end;
$$;

rollback;
