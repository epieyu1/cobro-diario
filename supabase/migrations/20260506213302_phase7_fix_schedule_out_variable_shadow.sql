-- Corrige la sombra entre la variable OUT installment_number y el loop interno del helper.

create or replace function private.build_origination_schedule(
  p_principal_amount numeric,
  p_installment_amount numeric,
  p_total_installments integer,
  p_payment_frequency public.loan_payment_frequency,
  p_disbursement_date date,
  p_first_due_date date
)
returns table (
  installment_number integer,
  due_date date,
  scheduled_amount numeric(14, 2),
  principal_amount numeric(14, 2),
  interest_amount numeric(14, 2),
  fee_amount numeric(14, 2),
  outstanding_amount numeric(14, 2),
  status public.installment_status
)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_total_scheduled_amount numeric(14, 2);
  v_total_interest_amount numeric(14, 2);
  v_regular_interest_amount numeric(14, 2);
  v_principal_component numeric(14, 2);
begin
  if p_principal_amount is null or p_principal_amount <= 0 then
    raise exception 'loan_principal_amount_invalid';
  end if;

  if p_installment_amount is null or p_installment_amount <= 0 then
    raise exception 'loan_installment_amount_invalid';
  end if;

  if p_total_installments is null or p_total_installments <= 0 then
    raise exception 'loan_total_installments_invalid';
  end if;

  if p_disbursement_date is null then
    raise exception 'loan_disbursement_date_required';
  end if;

  if p_first_due_date is null then
    raise exception 'loan_first_due_date_required';
  end if;

  if p_first_due_date < p_disbursement_date then
    raise exception 'loan_first_due_date_before_disbursement';
  end if;

  v_total_scheduled_amount := round(p_installment_amount * p_total_installments, 2);

  if v_total_scheduled_amount < p_principal_amount then
    raise exception 'loan_total_scheduled_below_principal';
  end if;

  v_total_interest_amount := round(v_total_scheduled_amount - p_principal_amount, 2);
  v_regular_interest_amount := round(v_total_interest_amount / p_total_installments, 2);

  for v_installment_step in 1..p_total_installments loop
    installment_number := v_installment_step;
    scheduled_amount := round(p_installment_amount, 2);
    due_date := private.next_origination_due_date(
      p_first_due_date,
      p_payment_frequency,
      v_installment_step - 1
    );
    interest_amount := case
      when v_installment_step = p_total_installments then
        round(v_total_interest_amount - (v_regular_interest_amount * (p_total_installments - 1)), 2)
      else v_regular_interest_amount
    end;
    fee_amount := 0.00;
    v_principal_component := round(scheduled_amount - interest_amount, 2);

    if interest_amount < 0 or v_principal_component < 0 then
      raise exception 'loan_installment_component_invalid';
    end if;

    principal_amount := v_principal_component;
    outstanding_amount := scheduled_amount;
    status := 'pending'::public.installment_status;

    return next;
  end loop;
end;
$$;
