-- Compuerta de BR-3 para el recibo autoritativo.
-- Verifica alcance RLS, bloqueo por perfil inactivo y coherencia del desglose remoto.
begin;

do $$
declare
  v_admin_id uuid := '35000000-0000-0000-0000-000000000001';
  v_collector_id uuid := '35000000-0000-0000-0000-000000000002';
  v_inactive_collector_id uuid := '35000000-0000-0000-0000-000000000003';
  v_other_collector_id uuid := '35000000-0000-0000-0000-000000000004';
  v_customer_id uuid := '35000000-0000-0000-0000-000000000011';
  v_other_customer_id uuid := '35000000-0000-0000-0000-000000000012';
  v_loan_id uuid := '35000000-0000-0000-0000-000000000021';
  v_other_loan_id uuid := '35000000-0000-0000-0000-000000000022';
  v_payment_id uuid := '35000000-0000-0000-0000-000000000031';
  v_other_payment_id uuid := '35000000-0000-0000-0000-000000000032';
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
      'phase5-admin@example.com',
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
      'phase5-collector@example.com',
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
      'phase5-inactive@example.com',
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
      'phase5-other@example.com',
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
    (v_admin_id, 'admin', 'Phase 5 Admin', true),
    (v_collector_id, 'collector', 'Phase 5 Collector', true),
    (v_inactive_collector_id, 'collector', 'Phase 5 Inactive Collector', false),
    (v_other_collector_id, 'collector', 'Phase 5 Other Collector', true);

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
      'Cliente Recibo Confirmado',
      '901200300',
      '3002003000',
      'Calle 10 # 11-12',
      'Centro',
      'Ruta Centro'
    ),
    (
      v_other_customer_id,
      v_other_collector_id,
      v_admin_id,
      'Cliente Fuera de Alcance',
      '901200301',
      '3002003001',
      'Calle 13 # 14-15',
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
      'CD-20260506-RC001',
      120.00,
      70.00,
      0.000000,
      2,
      'COP',
      '2026-05-05',
      '2026-05-06',
      'active',
      'daily',
      'simple_precomputed',
      timezone('utc', now())
    ),
    (
      v_other_loan_id,
      v_other_customer_id,
      v_other_collector_id,
      v_admin_id,
      'CD-20260506-RC002',
      90.00,
      50.00,
      0.000000,
      2,
      'COP',
      '2026-05-05',
      '2026-05-06',
      'active',
      'daily',
      'simple_precomputed',
      timezone('utc', now())
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
      '35000000-0000-0000-0000-000000000041',
      v_loan_id,
      1,
      '2026-05-06',
      70.00,
      50.00,
      15.00,
      5.00,
      0.00,
      'paid'
    ),
    (
      '35000000-0000-0000-0000-000000000042',
      v_loan_id,
      2,
      '2026-05-07',
      50.00,
      40.00,
      10.00,
      0.00,
      35.00,
      'partial'
    ),
    (
      '35000000-0000-0000-0000-000000000043',
      v_other_loan_id,
      1,
      '2026-05-06',
      50.00,
      40.00,
      10.00,
      0.00,
      50.00,
      'pending'
    );

  insert into public.payments (
    id,
    customer_id,
    loan_id,
    collector_id,
    device_local_id,
    payment_reference,
    payment_method,
    total_amount,
    status,
    paid_at,
    created_at,
    updated_at
  )
  values
    (
      v_payment_id,
      v_customer_id,
      v_loan_id,
      v_collector_id,
      'phase5-device-payment-1',
      'REC-3501',
      'cash',
      85.00,
      'posted',
      '2026-05-06T13:00:00.000Z',
      '2026-05-06T13:00:05.000Z',
      '2026-05-06T13:00:05.000Z'
    ),
    (
      v_other_payment_id,
      v_other_customer_id,
      v_other_loan_id,
      v_other_collector_id,
      'phase5-device-payment-2',
      'REC-3502',
      'cash',
      50.00,
      'posted',
      '2026-05-06T14:00:00.000Z',
      '2026-05-06T14:00:05.000Z',
      '2026-05-06T14:00:05.000Z'
    );

  insert into public.payment_applications (
    id,
    payment_id,
    installment_id,
    applied_amount,
    principal_component,
    interest_component,
    fee_component
  )
  values
    (
      '35000000-0000-0000-0000-000000000051',
      v_payment_id,
      '35000000-0000-0000-0000-000000000041',
      70.00,
      50.00,
      15.00,
      5.00
    ),
    (
      '35000000-0000-0000-0000-000000000052',
      v_payment_id,
      '35000000-0000-0000-0000-000000000042',
      15.00,
      5.00,
      10.00,
      0.00
    ),
    (
      '35000000-0000-0000-0000-000000000053',
      v_other_payment_id,
      '35000000-0000-0000-0000-000000000043',
      50.00,
      40.00,
      10.00,
      0.00
    );
end;
$$;

set local role authenticated;

do $$
declare
  v_admin_id uuid := '35000000-0000-0000-0000-000000000001';
  v_collector_id uuid := '35000000-0000-0000-0000-000000000002';
  v_inactive_collector_id uuid := '35000000-0000-0000-0000-000000000003';
  v_payment_id uuid := '35000000-0000-0000-0000-000000000031';
  v_other_payment_id uuid := '35000000-0000-0000-0000-000000000032';
  v_receipt jsonb;
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

  v_receipt := public.get_payment_receipt(v_payment_id);

  if v_receipt ->> 'paymentId' <> v_payment_id::text then
    raise exception 'phase5_receipt_gate_payment_id_mismatch';
  end if;

  if v_receipt #>> '{customer,fullName}' <> 'Cliente Recibo Confirmado' then
    raise exception 'phase5_receipt_gate_customer_name_mismatch';
  end if;

  if v_receipt #>> '{collector,fullName}' <> 'Phase 5 Collector' then
    raise exception 'phase5_receipt_gate_collector_name_mismatch';
  end if;

  if v_receipt #>> '{loan,externalLoanNumber}' <> 'CD-20260506-RC001' then
    raise exception 'phase5_receipt_gate_loan_number_mismatch';
  end if;

  if jsonb_array_length(v_receipt -> 'applications') <> 2 then
    raise exception 'phase5_receipt_gate_application_count_mismatch';
  end if;

  if v_receipt #>> '{applications,0,installmentNumber}' <> '1' then
    raise exception 'phase5_receipt_gate_first_application_order_invalid';
  end if;

  if v_receipt #>> '{applications,1,appliedAmount}' <> '15.00' then
    raise exception 'phase5_receipt_gate_second_application_amount_invalid';
  end if;

  begin
    perform public.get_payment_receipt(v_other_payment_id);
    raise exception 'phase5_receipt_gate_collector_can_read_foreign_payment';
  exception
    when others then
      if sqlerrm <> 'payment_not_found' then
        raise;
      end if;
  end;

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', v_admin_id::text,
      'app_metadata', jsonb_build_object('role', 'admin')
    )::text,
    true
  );
  perform set_config('request.jwt.claim.sub', v_admin_id::text, true);

  if public.get_payment_receipt(v_other_payment_id) ->> 'paymentId' <> v_other_payment_id::text then
    raise exception 'phase5_receipt_gate_admin_cannot_read_foreign_payment';
  end if;

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', v_inactive_collector_id::text,
      'app_metadata', jsonb_build_object('role', 'collector')
    )::text,
    true
  );
  perform set_config('request.jwt.claim.sub', v_inactive_collector_id::text, true);

  begin
    perform public.get_payment_receipt(v_payment_id);
    raise exception 'phase5_receipt_gate_inactive_operator_not_blocked';
  exception
    when others then
      if sqlerrm <> 'operator_inactive' then
        raise;
      end if;
  end;
end;
$$;

rollback;
