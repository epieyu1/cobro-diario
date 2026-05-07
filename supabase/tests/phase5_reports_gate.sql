-- Compuerta de BR-4 para reportes operativos administrativos.
-- Verifica acceso solo admin, bloqueo a collector/inactivos y coherencia mínima
-- de métricas/filtros bajo el RPC `public.get_operational_report()`.
begin;

do $$
declare
  v_admin_id uuid := '46000000-0000-0000-0000-000000000001';
  v_inactive_admin_id uuid := '46000000-0000-0000-0000-000000000002';
  v_collector_id uuid := '46000000-0000-0000-0000-000000000003';
  v_other_collector_id uuid := '46000000-0000-0000-0000-000000000004';
  v_customer_id uuid := '46000000-0000-0000-0000-000000000011';
  v_other_customer_id uuid := '46000000-0000-0000-0000-000000000012';
  v_loan_id uuid := '46000000-0000-0000-0000-000000000021';
  v_other_loan_id uuid := '46000000-0000-0000-0000-000000000022';
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
      'phase5-report-admin@example.com',
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
      'phase5-report-inactive-admin@example.com',
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
      'phase5-report-collector@example.com',
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
      'phase5-report-other@example.com',
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
    (v_admin_id, 'admin', 'Phase 5 Report Admin', true),
    (v_inactive_admin_id, 'admin', 'Phase 5 Report Inactive Admin', false),
    (v_collector_id, 'collector', 'Phase 5 Report Collector', true),
    (v_other_collector_id, 'collector', 'Phase 5 Report Other Collector', true);

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
      'Cliente Reporte Centro',
      '906000100',
      '3005006001',
      'Calle 12 # 13-14',
      'Centro',
      'BR4 Gate Ruta Centro'
    ),
    (
      v_other_customer_id,
      v_other_collector_id,
      v_admin_id,
      'Cliente Reporte Norte',
      '906000101',
      '3005006002',
      'Carrera 20 # 21-22',
      'Norte',
      'BR4 Gate Ruta Norte'
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
      'CD-REP-001',
      140.00,
      70.00,
      0.000000,
      2,
      'COP',
      v_today,
      v_today,
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
      'CD-REP-002',
      160.00,
      80.00,
      0.000000,
      2,
      'COP',
      v_today,
      v_today,
      'delinquent',
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
      '46000000-0000-0000-0000-000000000041',
      v_loan_id,
      1,
      v_today,
      70.00,
      55.00,
      10.00,
      5.00,
      30.00,
      'partial'
    ),
    (
      '46000000-0000-0000-0000-000000000042',
      v_other_loan_id,
      1,
      v_today,
      80.00,
      60.00,
      15.00,
      5.00,
      80.00,
      'overdue'
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
      '46000000-0000-0000-0000-000000000051',
      v_customer_id,
      v_loan_id,
      v_collector_id,
      'phase5-report-payment-1',
      'REP-001',
      'cash',
      30.00,
      'posted',
      timezone('utc', now()),
      timezone('utc', now()),
      timezone('utc', now())
    ),
    (
      '46000000-0000-0000-0000-000000000052',
      v_other_customer_id,
      v_other_loan_id,
      v_other_collector_id,
      'phase5-report-payment-2',
      'REP-002',
      'cash',
      20.00,
      'posted',
      timezone('utc', now()) - interval '2 days',
      timezone('utc', now()) - interval '2 days',
      timezone('utc', now()) - interval '2 days'
    );
end;
$$;

set local role authenticated;

do $$
declare
  v_admin_id uuid := '46000000-0000-0000-0000-000000000001';
  v_inactive_admin_id uuid := '46000000-0000-0000-0000-000000000002';
  v_collector_id uuid := '46000000-0000-0000-0000-000000000003';
  v_report jsonb;
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

  v_report := public.get_operational_report(null, 'BR4 Gate Ruta Centro', null);

  if coalesce((v_report -> 'metrics' ->> 'customerCount')::integer, -1) <> 1 then
    raise exception 'phase5_reports_gate_customer_count_invalid';
  end if;

  if coalesce((v_report -> 'metrics' ->> 'openLoanCount')::integer, -1) <> 1 then
    raise exception 'phase5_reports_gate_open_loan_count_invalid';
  end if;

  if coalesce((v_report -> 'metrics' ->> 'overdueLoanCount')::integer, -1) <> 0 then
    raise exception 'phase5_reports_gate_overdue_loan_count_invalid';
  end if;

  if coalesce((v_report -> 'metrics' ->> 'collectedTodayCount')::integer, -1) <> 1 then
    raise exception 'phase5_reports_gate_collected_today_count_invalid';
  end if;

  if coalesce(v_report -> 'metrics' ->> 'collectedTodayAmount', '') <> '30.00' then
    raise exception 'phase5_reports_gate_collected_today_amount_invalid';
  end if;

  if jsonb_array_length(coalesce(v_report -> 'collectors', '[]'::jsonb)) <> 1 then
    raise exception 'phase5_reports_gate_collectors_breakdown_invalid';
  end if;

  if jsonb_array_length(coalesce(v_report -> 'routes', '[]'::jsonb)) <> 1 then
    raise exception 'phase5_reports_gate_routes_breakdown_invalid';
  end if;

  v_report := public.get_operational_report(v_collector_id, null, null);

  if coalesce(v_report -> 'filters' ->> 'collectorId', '') <> v_collector_id::text then
    raise exception 'phase5_reports_gate_collector_filter_not_echoed';
  end if;

  if coalesce((v_report -> 'metrics' ->> 'customerCount')::integer, -1) <> 1 then
    raise exception 'phase5_reports_gate_collector_filter_scope_invalid';
  end if;

  v_report := public.get_operational_report(null, 'BR4 Gate Ruta Norte', null);

  if coalesce((v_report -> 'metrics' ->> 'overdueLoanCount')::integer, -1) <> 1 then
    raise exception 'phase5_reports_gate_route_filter_overdue_scope_invalid';
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
    perform public.get_operational_report(null, null, null);
    raise exception 'phase5_reports_gate_collector_should_not_read_reports';
  exception
    when others then
      if sqlerrm <> 'report_role_not_allowed' then
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
    perform public.get_operational_report(null, null, null);
    raise exception 'phase5_reports_gate_inactive_admin_should_not_read_reports';
  exception
    when others then
      if sqlerrm <> 'operator_inactive' then
        raise;
      end if;
  end;
end;
$$;

rollback;
