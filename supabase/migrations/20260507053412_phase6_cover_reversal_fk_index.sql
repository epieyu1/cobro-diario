-- BR-5 agrega `payments.reversed_by` para trazabilidad del reverso.
-- Este indice evita que el FK nuevo quede como alerta de performance en advisors
-- y mantiene las lecturas por actor de reverso sin degradar joins administrativos.
create index if not exists payments_reversed_by_idx on public.payments (reversed_by);
