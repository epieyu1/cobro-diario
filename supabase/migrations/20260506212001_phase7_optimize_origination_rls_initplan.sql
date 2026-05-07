-- Ajusta las policies de originacion para que Postgres pueda materializar mejor
-- el init plan de auth/current_setting dentro de RLS. No cambia permisos ni flujo:
-- solo evita evaluaciones por fila que el advisor remoto marco como WARN.

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
  and interest_mode = 'simple_precomputed'::public.loan_interest_mode
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
