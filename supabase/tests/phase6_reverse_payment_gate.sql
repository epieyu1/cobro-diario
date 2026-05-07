-- Compuerta de BR-5 para reverso transaccional e idempotencia.
-- Verifica restauracion de saldos, trazabilidad del evento compensatorio y
-- bloqueo estricto por rol/estado sin debilitar RLS.
begin;

do $$
declare
  v_admin_id uuid := '56000000-0000-0000-0000-000000000001';
  v_inactive_admin_id uuid := '56000000-0000-0000-0000-000000000002';
  v_collector_id uuid := '56000000-0000-0000-0000-000000000003';
  v_device_id uuid := '56000000-0000-0000-0000-000000000004';
  v_customer_id uuid := '56000000-0000-0000-0000-000000000011';
  v_loan_id uuid := '56000000-0000-0000-0000-000000000021';
  v_installment_id uuid := '56000000-0000-0000-0000-000000000031';
  v_paid_payment_id uuid;
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
      'phase6-admin@example.com',
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
      v_inactive_admin_id,
      'authenticated',
      'authenticated',
      'phase6-inactive-admin@example.com',
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
      'phase6-collector@example.com',
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
    (v_admin_id, 'admin', 'Phase 6 Admin', true),
    (v_inactive_admin_id, 'admin', 'Phase 6 Inactive Admin', false),
    (v_collector_id, 'collector', 'Phase 6 Collector', true);

  insert into public.devices (id, collector_id, device_uid, device_name)
  values (v_device_id, v_collector_id, 'phase6-device', 'Phase 6 Device');

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
  values (
    v_customer_id,
    v_collector_id,
    v_admin_id,
    'Cliente Reverso BR-5',
    '907000100',
    '3006007001',
    'Calle 16 # 17-18',
    'Centro',
    'BR5 Gate Ruta Centro'
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
  values (
    v_loan_id,
    v_customer_id,
    v_collector_id,
    v_admin_id,
    'CD-REV-001',
    50.00,
    60.00,
    0.000000,
    1,
    'COP',
    v_today - 2,
    v_today - 1,
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
  values (
    v_installment_id,
    v_loan_id,
    1,
    v_today - 1,
    60.00,
    50.00,
    10.00,
    0.00,
    60.00,
    'overdue'
  );
end;
$$;

set local role authenticated;

do $$
declare
  v_admin_id uuid := '56000000-0000-0000-0000-000000000001';
  v_inactive_admin_id uuid := '56000000-0000-0000-0000-000000000002';
  v_collector_id uuid := '56000000-0000-0000-0000-000000000003';
  v_device_id uuid := '56000000-0000-0000-0000-000000000004';
  v_customer_id uuid := '56000000-0000-0000-0000-000000000011';
  v_loan_id uuid := '56000000-0000-0000-0000-000000000021';
  v_installment_id uuid := '56000000-0000-0000-0000-000000000031';
  v_missing_payment_id uuid := '56000000-0000-0000-0000-000000000099';
  v_paid_payment_id uuid;
  v_reversed_receipt jsonb;
  v_repeat_reversed_receipt jsonb;
  v_event_count integer;
  v_today date := timezone('America/Bogota', now())::date;
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

  v_paid_payment_id := public.record_payment(
    'phase6-reversal-payment',
    'REV-001',
    v_collector_id,
    v_customer_id,
    v_loan_id,
    v_device_id,
    'cash',
    timezone('utc', now()),
    null,
    null,
    'seed payment for BR-5 gate',
    jsonb_build_array(
      jsonb_build_object(
        'installment_id', v_installment_id,
        'applied_amount', 60.00,
        'fee_component', 0.00,
        'interest_component', 10.00,
        'principal_component', 50.00
      )
    )
  );

  if (select public.installments.outstanding_amount from public.installments where id = v_installment_id) <> 0 then
    raise exception 'phase6_reverse_gate_payment_not_materialized';
  end if;

  if (select public.installments.status from public.installments where id = v_installment_id) <> 'paid'::public.installment_status then
    raise exception 'phase6_reverse_gate_paid_installment_status_invalid';
  end if;

  if (select public.loans.status from public.loans where id = v_loan_id) <> 'settled'::public.loan_status then
    raise exception 'phase6_reverse_gate_paid_loan_status_invalid';
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

  v_reversed_receipt := public.reverse_payment(v_paid_payment_id, 'Cobro duplicado gate');

  if v_reversed_receipt ->> 'status' <> 'reversed' then
    raise exception 'phase6_reverse_gate_status_invalid';
  end if;

  if coalesce(v_reversed_receipt #>> '{reversal,reason}', '') <> 'Cobro duplicado gate' then
    raise exception 'phase6_reverse_gate_reason_missing';
  end if;

  if (select public.payments.status from public.payments where id = v_paid_payment_id) <> 'reversed'::public.payment_status then
    raise exception 'phase6_reverse_gate_payment_status_invalid';
  end if;

  if (select public.payments.reversal_reason from public.payments where id = v_paid_payment_id) <> 'Cobro duplicado gate' then
    raise exception 'phase6_reverse_gate_payment_reason_not_persisted';
  end if;

  if (select public.payments.reversed_by from public.payments where id = v_paid_payment_id) <> v_admin_id then
    raise exception 'phase6_reverse_gate_payment_reversed_by_invalid';
  end if;

  if (select public.installments.outstanding_amount from public.installments where id = v_installment_id) <> 60.00 then
    raise exception 'phase6_reverse_gate_installment_outstanding_not_restored';
  end if;

  if (select public.installments.status from public.installments where id = v_installment_id) <> 'overdue'::public.installment_status then
    raise exception 'phase6_reverse_gate_installment_status_not_restored';
  end if;

  if (select public.loans.status from public.loans where id = v_loan_id) <> 'delinquent'::public.loan_status then
    raise exception 'phase6_reverse_gate_loan_status_not_restored';
  end if;

  select count(*)
  into v_event_count
  from public.payment_events
  where public.payment_events.payment_id = v_paid_payment_id
    and public.payment_events.event_name = 'payment_reversed';

  if v_event_count <> 1 then
    raise exception 'phase6_reverse_gate_compensating_event_missing';
  end if;

  v_repeat_reversed_receipt := public.reverse_payment(v_paid_payment_id, 'Segundo intento no debe mutar');

  if v_repeat_reversed_receipt ->> 'status' <> 'reversed' then
    raise exception 'phase6_reverse_gate_idempotent_status_invalid';
  end if;

  if coalesce(v_repeat_reversed_receipt #>> '{reversal,reason}', '') <> 'Cobro duplicado gate' then
    raise exception 'phase6_reverse_gate_idempotent_reason_overwritten';
  end if;

  select count(*)
  into v_event_count
  from public.payment_events
  where public.payment_events.payment_id = v_paid_payment_id
    and public.payment_events.event_name = 'payment_reversed';

  if v_event_count <> 1 then
    raise exception 'phase6_reverse_gate_idempotent_event_duplicated';
  end if;

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
    perform public.reverse_payment(v_paid_payment_id, 'Collector no autorizado');
    raise exception 'phase6_reverse_gate_collector_not_blocked';
  exception
    when others then
      if sqlerrm <> 'reverse_role_not_allowed' then
        raise;
      end if;
  end;

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
    perform public.reverse_payment(v_paid_payment_id, 'Admin inactivo');
    raise exception 'phase6_reverse_gate_inactive_admin_not_blocked';
  exception
    when others then
      if sqlerrm <> 'operator_inactive' then
        raise;
      end if;
  end;

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
    perform public.reverse_payment(v_missing_payment_id, 'Pago inexistente');
    raise exception 'phase6_reverse_gate_missing_payment_not_blocked';
  exception
    when others then
      if sqlerrm <> 'payment_not_found' then
        raise;
      end if;
  end;

  if (select public.loans.status from public.loans where id = v_loan_id) <> 'delinquent'::public.loan_status then
    raise exception 'phase6_reverse_gate_restored_loan_status_drifted';
  end if;

  if (select public.installments.due_date from public.installments where id = v_installment_id) <> v_today - 1 then
    raise exception 'phase6_reverse_gate_due_date_mutated';
  end if;
end;
$$;

rollback;
