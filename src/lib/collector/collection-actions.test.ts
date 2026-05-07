import { describe, expect, it } from 'vitest'
import {
  describeCollectionActionOutcome,
  describeCollectionActionTone,
  requiresCollectionFollowUp,
} from '@/lib/collector/collection-actions.ts'

describe('collection action helpers', () => {
  it('describes every operational outcome with stable UI labels', () => {
    expect(describeCollectionActionOutcome('promise_to_pay')).toBe('Promesa de pago')
    expect(describeCollectionActionOutcome('not_found')).toBe('No encontrado')
    expect(describeCollectionActionOutcome('return_visit')).toBe('Volver luego')
    expect(describeCollectionActionOutcome('visited_no_payment')).toBe('Visita sin pago')
  })

  it('maps every operational outcome to a deterministic tone', () => {
    expect(describeCollectionActionTone('promise_to_pay')).toBe('warning')
    expect(describeCollectionActionTone('not_found')).toBe('danger')
    expect(describeCollectionActionTone('return_visit')).toBe('pending')
    expect(describeCollectionActionTone('visited_no_payment')).toBe('neutral')
  })

  it('requires follow-up only for promises and revisit actions', () => {
    expect(requiresCollectionFollowUp('promise_to_pay')).toBe(true)
    expect(requiresCollectionFollowUp('return_visit')).toBe(true)
    expect(requiresCollectionFollowUp('not_found')).toBe(false)
    expect(requiresCollectionFollowUp('visited_no_payment')).toBe(false)
  })
})
