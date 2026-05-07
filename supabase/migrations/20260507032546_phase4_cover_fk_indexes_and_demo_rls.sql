-- Este ajuste cierra avisos de advisors sin cambiar el contrato operativo principal.
-- Agrega indices cobridores para foreign keys consultables y deja la tabla demo
-- en cuarentena explicita con policy negativa para que RLS no dependa de ausencia de policies.

create index if not exists loans_created_by_idx
on public.loans (created_by);

create index if not exists collection_actions_created_by_recorded_at_idx
on public.collection_actions (created_by, recorded_at desc);

create index if not exists collection_actions_customer_id_recorded_at_idx
on public.collection_actions (customer_id, recorded_at desc);

do $$
begin
  if exists (
    select 1
    from pg_class
    join pg_namespace on pg_namespace.oid = pg_class.relnamespace
    where pg_namespace.nspname = 'public'
      and pg_class.relname = 'TABLA DE USUARIOS DEMO'
      and pg_class.relkind = 'r'
  ) then
    execute 'alter table public."TABLA DE USUARIOS DEMO" enable row level security';
    execute 'drop policy if exists "demo_table_quarantined_no_access" on public."TABLA DE USUARIOS DEMO"';
    execute 'create policy "demo_table_quarantined_no_access" on public."TABLA DE USUARIOS DEMO" as restrictive for all to anon, authenticated using (false) with check (false)';
    execute 'revoke all on table public."TABLA DE USUARIOS DEMO" from anon, authenticated';
  end if;
end;
$$;
