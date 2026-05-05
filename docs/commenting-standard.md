# Commenting Standard

## Propósito

Los comentarios de este repositorio deben ayudar a otro asistente o ingeniero a entender qué no puede romper.

## Qué debe comentarse

- Lógica financiera.
- Lógica de sincronización.
- Integraciones externas.
- Restricciones de seguridad.
- Decisiones que no son obvias al leer el código.

## Qué debe incluir un comentario útil

- intención,
- restricción,
- riesgo si se cambia,
- fuente de verdad o dependencia externa cuando aplique.

## Patrones recomendados

### TypeScript

```ts
// Esta capa solo mantiene estado local operativo.
// La verdad final del pago vive en Supabase y no debe asumirse confirmada
// hasta que exista persistencia remota o una marca explícita de sincronización.
```

### SQL / RPC

```sql
-- Este RPC centraliza el registro del pago para mantener atomicidad.
-- No fragmentar este flujo en múltiples escrituras desde frontend.
```

### Integraciones

```ts
// Solo usar claves publicables en cliente.
// Nunca mover service_role al navegador ni a variables expuestas por Vite.
```

## Regla de mantenimiento

Cuando se cambie una lógica comentada:

1. actualizar el comentario en el mismo commit o cambio,
2. actualizar `docs/` si la decisión afecta arquitectura o proceso,
3. dejar claro si el comportamiento cambia o solo se refactoriza.
