-- Las policies de RLS llaman helpers del esquema private.
-- Si authenticated no tiene USAGE sobre ese esquema, la sesion puede autenticarse
-- pero la primera lectura operativa falla con "permission denied for schema private".
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- Los helpers privados no deben quedar abiertos por herencia implicita.
-- Se revoca PUBLIC y se deja el contrato explicito para las policies operativas.
revoke execute on function private.current_app_role() from public;
revoke execute on function private.is_admin() from public;
revoke execute on function private.can_access_collector(uuid) from public;

grant execute on function private.current_app_role() to authenticated;
grant execute on function private.is_admin() to authenticated;
grant execute on function private.can_access_collector(uuid) to authenticated;
