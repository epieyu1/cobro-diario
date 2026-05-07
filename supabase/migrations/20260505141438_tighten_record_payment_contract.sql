-- Endurece el contrato temporal de pagos para dejar trazabilidad e idempotencia explicitas.
-- Este cambio alinea la logica remota con los comentarios y helpers del frontend.
comment on table public.payments is
'Registro transaccional confirmado en servidor. device_local_id es la llave de idempotencia para reintentos offline del mismo cobro.';

comment on column public.payments.device_local_id is
'Identificador estable generado por cliente/dispositivo. Debe reutilizarse solo al reintentar exactamente el mismo pago.';

comment on table public.payment_applications is
'Aplicaciones materializadas por cuota. El backend valida coherencia e idempotencia, pero no inventa la distribucion financiera.';

comment on column public.payment_applications.fee_component is
'Bucket temporal para mora y otros cargos hasta que exista un modelo financiero dedicado.';

comment on table public.sync_events is
'Cola y bitacora operativa para sincronizacion. PostgreSQL sigue siendo la fuente final de verdad del negocio.';

comment on column public.sync_events.client_event_id is
'Identificador idempotente del evento producido por la capa local. No debe reciclarse para otra operacion.';

create or replace function public.record_payment(
  p_device_local_id text,
  p_payment_reference text,
  p_collector_id uuid,
  p_customer_id uuid,
  p_loan_id uuid,
  p_device_id uuid,
  p_payment_method text,
  p_paid_at timestamptz,
  p_latitude numeric,
  p_longitude numeric,
  p_notes text,
  p_applications jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_payment_id uuid;
  v_inserted_payment_id uuid;
  v_total_amount numeric(14, 2);
  v_application jsonb;
  v_loan public.loans%rowtype;
  v_installment public.installments%rowtype;
  v_existing_payment public.payments%rowtype;
  v_applied_amount numeric(14, 2);
  v_principal_component numeric(14, 2);
  v_interest_component numeric(14, 2);
  v_fee_component numeric(14, 2);
  v_component_total numeric(14, 2);
  v_remaining_amount numeric(14, 2);
begin
  if nullif(trim(p_device_local_id), '') is null then
    raise exception 'device_local_id_required';
  end if;

  if not private.can_access_collector(p_collector_id) then
    raise exception 'collector_not_allowed';
  end if;

  select *
  into v_existing_payment
  from public.payments
  where public.payments.device_local_id = p_device_local_id;

  if found then
    if v_existing_payment.loan_id = p_loan_id
      and v_existing_payment.customer_id = p_customer_id
      and v_existing_payment.collector_id = p_collector_id then
      return v_existing_payment.id;
    end if;

    raise exception 'device_local_id_conflict';
  end if;

  if jsonb_typeof(p_applications) <> 'array' or jsonb_array_length(p_applications) = 0 then
    raise exception 'payment_requires_applications';
  end if;

  if exists (
    select 1
    from (
      select application ->> 'installment_id' as installment_id
      from jsonb_array_elements(p_applications) as application
      group by application ->> 'installment_id'
      having count(*) > 1
    ) as duplicated_installments
  ) then
    raise exception 'duplicate_installment_application';
  end if;

  select *
  into v_loan
  from public.loans
  where public.loans.id = p_loan_id
  for update;

  if not found then
    raise exception 'loan_not_found';
  end if;

  if v_loan.customer_id <> p_customer_id then
    raise exception 'loan_customer_mismatch';
  end if;

  if v_loan.collector_id <> p_collector_id then
    raise exception 'loan_collector_mismatch';
  end if;

  if v_loan.status not in ('active'::public.loan_status, 'delinquent'::public.loan_status) then
    raise exception 'loan_status_not_payable';
  end if;

  select coalesce(sum((application ->> 'applied_amount')::numeric(14, 2)), 0)
  into v_total_amount
  from jsonb_array_elements(p_applications) as application;

  if v_total_amount <= 0 then
    raise exception 'payment_total_must_be_positive';
  end if;

  insert into public.payments (
    id,
    customer_id,
    loan_id,
    collector_id,
    device_id,
    device_local_id,
    payment_reference,
    payment_method,
    total_amount,
    latitude,
    longitude,
    notes,
    paid_at
  )
  values (
    extensions.gen_random_uuid(),
    p_customer_id,
    p_loan_id,
    p_collector_id,
    p_device_id,
    p_device_local_id,
    p_payment_reference,
    coalesce(nullif(trim(p_payment_method), ''), 'cash'),
    v_total_amount,
    p_latitude,
    p_longitude,
    p_notes,
    p_paid_at
  )
  on conflict (device_local_id) do nothing
  returning id into v_inserted_payment_id;

  if v_inserted_payment_id is null then
    select *
    into v_existing_payment
    from public.payments
    where public.payments.device_local_id = p_device_local_id;

    if found
      and v_existing_payment.loan_id = p_loan_id
      and v_existing_payment.customer_id = p_customer_id
      and v_existing_payment.collector_id = p_collector_id then
      return v_existing_payment.id;
    end if;

    raise exception 'device_local_id_conflict';
  end if;

  v_payment_id := v_inserted_payment_id;

  for v_application in
    select value from jsonb_array_elements(p_applications)
  loop
    if jsonb_typeof(v_application) <> 'object' then
      raise exception 'invalid_payment_application';
    end if;

    if nullif(v_application ->> 'installment_id', '') is null then
      raise exception 'installment_id_required';
    end if;

    select *
    into v_installment
    from public.installments
    where public.installments.id = (v_application ->> 'installment_id')::uuid
      and public.installments.loan_id = p_loan_id
    for update;

    if not found then
      raise exception 'installment_not_found_for_loan';
    end if;

    if v_installment.status in ('paid'::public.installment_status, 'canceled'::public.installment_status) then
      raise exception 'installment_not_payable';
    end if;

    v_applied_amount := coalesce((v_application ->> 'applied_amount')::numeric(14, 2), 0);
    v_principal_component := coalesce((v_application ->> 'principal_component')::numeric(14, 2), 0);
    v_interest_component := coalesce((v_application ->> 'interest_component')::numeric(14, 2), 0);
    v_fee_component := coalesce((v_application ->> 'fee_component')::numeric(14, 2), 0);

    if v_applied_amount <= 0 then
      raise exception 'invalid_applied_amount';
    end if;

    if v_principal_component < 0 or v_interest_component < 0 or v_fee_component < 0 then
      raise exception 'negative_component_not_allowed';
    end if;

    v_component_total := v_principal_component + v_interest_component + v_fee_component;

    if v_component_total <> v_applied_amount then
      raise exception 'application_components_mismatch';
    end if;

    if v_applied_amount > v_installment.outstanding_amount then
      raise exception 'applied_amount_exceeds_outstanding';
    end if;

    insert into public.payment_applications (
      payment_id,
      installment_id,
      applied_amount,
      principal_component,
      interest_component,
      fee_component
    )
    values (
      v_payment_id,
      v_installment.id,
      v_applied_amount,
      v_principal_component,
      v_interest_component,
      v_fee_component
    );

    v_remaining_amount := v_installment.outstanding_amount - v_applied_amount;

    update public.installments
    set
      outstanding_amount = v_remaining_amount,
      status = case
        when v_remaining_amount = 0 then 'paid'::public.installment_status
        when v_remaining_amount < v_installment.scheduled_amount then 'partial'::public.installment_status
        else status
      end
    where id = v_installment.id;
  end loop;

  update public.loans
  set status = case
    when status in ('written_off'::public.loan_status, 'canceled'::public.loan_status) then status
    when exists (
      select 1
      from public.installments
      where public.installments.loan_id = p_loan_id
        and public.installments.outstanding_amount > 0
    ) then case
      when status = 'delinquent'::public.loan_status then 'delinquent'::public.loan_status
      else 'active'::public.loan_status
    end
    else 'settled'::public.loan_status
  end
  where id = p_loan_id;

  insert into public.payment_events (
    payment_id,
    actor_id,
    event_name,
    payload
  )
  values (
    v_payment_id,
    p_collector_id,
    'payment_recorded',
    jsonb_build_object(
      'device_local_id', p_device_local_id,
      'application_count', jsonb_array_length(p_applications),
      'derived_total_amount', v_total_amount
    )
  );

  return v_payment_id;
end;
$$;

comment on function public.record_payment(
  text,
  text,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  timestamptz,
  numeric,
  numeric,
  text,
  jsonb
) is
'RPC atomico e idempotente por device_local_id. Deriva el total desde las aplicaciones y no permite duplicar cuotas dentro del mismo pago. El orden V1 de aplicacion por componente es fee, interest y luego principal.';
