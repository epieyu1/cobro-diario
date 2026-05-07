-- Corrige la documentación remota de `get_payment_receipt()` para que `LANDING`
-- quede alineado con la migración versionada y no deje deriva semántica en comments.
comment on function public.get_payment_receipt(uuid) is
'Recibo autoritativo de BR-3 y BR-5. Lee el pago confirmado o reversado bajo RLS del actor autenticado y devuelve el desglose materializado por cuota mas la trazabilidad del reverso cuando existe.';
