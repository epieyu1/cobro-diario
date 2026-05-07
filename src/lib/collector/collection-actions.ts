import type { CollectionActionOutcome } from '@/types/domain.ts'

// Estas etiquetas deben mantenerse alineadas con la UI operativa.
// No cambian contabilidad: solo describen el resultado de la visita de campo.
export function describeCollectionActionOutcome(outcome: CollectionActionOutcome) {
  switch (outcome) {
    case 'promise_to_pay':
      return 'Promesa de pago'
    case 'not_found':
      return 'No encontrado'
    case 'return_visit':
      return 'Volver luego'
    case 'visited_no_payment':
      return 'Visita sin pago'
    default:
      return outcome
  }
}

export function describeCollectionActionTone(outcome: CollectionActionOutcome) {
  switch (outcome) {
    case 'promise_to_pay':
      return 'warning'
    case 'not_found':
      return 'danger'
    case 'return_visit':
      return 'pending'
    case 'visited_no_payment':
      return 'neutral'
    default:
      return 'neutral'
  }
}

export function requiresCollectionFollowUp(outcome: CollectionActionOutcome) {
  return outcome === 'promise_to_pay' || outcome === 'return_visit'
}
