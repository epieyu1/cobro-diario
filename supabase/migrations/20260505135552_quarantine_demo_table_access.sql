-- La tabla demo no pertenece al dominio operativo de Cobro Diario.
-- Se conserva para no destruir datos ajenos, pero se bloquea su acceso por Data API
-- mientras se decide su destino final fuera del flujo transaccional principal.
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
    execute 'drop policy if exists "Permitir inserción pública" on public."TABLA DE USUARIOS DEMO"';
    execute 'revoke all on table public."TABLA DE USUARIOS DEMO" from anon, authenticated';
  end if;
end;
$$;
