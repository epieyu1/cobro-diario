-- Endurece la resolucion de nombres dentro de funciones y cubre foreign keys
-- que el advisor de Supabase marco sin indice. Esto evita ambiguedad por
-- search_path mutable y reduce costo de joins/borrados conforme crezca el dominio.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create or replace function private.current_app_role()
returns public.app_role
language sql
stable
set search_path = ''
as $$
  select case coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '')
    when 'admin' then 'admin'::public.app_role
    else 'collector'::public.app_role
  end;
$$;

create or replace function private.is_admin()
returns boolean
language sql
stable
set search_path = ''
as $$
  select private.current_app_role() = 'admin'::public.app_role;
$$;

create or replace function private.can_access_collector(target_collector_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select private.is_admin() or (select auth.uid()) = target_collector_id;
$$;

create index if not exists customers_created_by_idx on public.customers (created_by);
create index if not exists devices_collector_idx on public.devices (collector_id);
create index if not exists payments_customer_idx on public.payments (customer_id);
create index if not exists payments_loan_idx on public.payments (loan_id);
create index if not exists payments_device_idx on public.payments (device_id);
create index if not exists payment_events_payment_idx on public.payment_events (payment_id);
create index if not exists payment_events_actor_idx on public.payment_events (actor_id);
