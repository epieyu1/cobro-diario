-- BR-6 no debe reabrir el WARN de initplan ya cerrado en OR-1.
-- Esta correccion restaura el patron `(select ...)` sobre helpers estables de
-- RLS para que Postgres los materialice una sola vez por sentencia.

drop policy if exists "customers_insert_via_origination_context" on public.customers;
drop policy if exists "loans_insert_via_origination_context" on public.loans;
drop policy if exists "installments_insert_via_origination_context" on public.installments;

create policy "customers_insert_via_origination_context"
on public.customers
for insert
to authenticated
with check (
  (select private.origination_write_context_enabled())
  and (select private.can_originate_for_collector(assigned_collector_id))
  and created_by = (select auth.uid())
);

create policy "loans_insert_via_origination_context"
on public.loans
for insert
to authenticated
with check (
  (select private.origination_write_context_enabled())
  and (select private.can_originate_for_collector(collector_id))
  and created_by = (select auth.uid())
  and originated_at is not null
  and interest_mode in (
    'simple_precomputed'::public.loan_interest_mode,
    'compound_fixed_installment'::public.loan_interest_mode
  )
  and payment_application_mode in (
    'oldest_first'::public.loan_payment_application_mode,
    'principal_only'::public.loan_payment_application_mode,
    'interest_only'::public.loan_payment_application_mode
  )
);

create policy "installments_insert_via_origination_context"
on public.installments
for insert
to authenticated
with check (
  (select private.origination_write_context_enabled())
  and exists (
    select 1
    from public.loans
    where public.loans.id = installments.loan_id
      and (select private.can_originate_for_collector(public.loans.collector_id))
  )
);
