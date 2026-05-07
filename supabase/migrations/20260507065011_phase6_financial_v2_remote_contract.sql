-- BR-6 separa primero los enums para respetar la restriccion transaccional
-- de PostgreSQL: un nuevo valor de enum debe quedar comprometido antes de
-- ser usado por policies, funciones o casts posteriores del mismo rollout.

alter type public.loan_interest_mode add value if not exists 'compound_fixed_installment';

do $$
begin
  if not exists (
    select 1
    from pg_type
    where typnamespace = 'public'::regnamespace
      and typname = 'loan_payment_application_mode'
  ) then
    create type public.loan_payment_application_mode as enum (
      'oldest_first',
      'principal_only',
      'interest_only'
    );
  end if;
end;
$$;
