import { describe, expect, it } from 'vitest'
import {
  canAccessCollectorManagement,
  canAccessOperationalReports,
  canAccessOrigination,
  canReversePayments,
  canReadAggregateWorkspace,
  resolveOperationalRoleCapabilities,
} from '@/lib/auth/role-guards.ts'

describe('role guards', () => {
  it('blocks privileged capabilities when there is no remote profile yet', () => {
    expect(resolveOperationalRoleCapabilities()).toEqual({
      canAccessCollectorManagement: false,
      canAccessOperationalReports: false,
      canAccessOrigination: false,
      canReversePayments: false,
      canReadAggregateWorkspace: false,
      isAdmin: false,
    })
  })

  it('grants admin-only capabilities consistently across the shell', () => {
    const profile = {
      id: 'admin-1',
      fullName: 'Admin Uno',
      role: 'admin' as const,
    }

    expect(canAccessOrigination(profile)).toBe(true)
    expect(canAccessCollectorManagement(profile)).toBe(true)
    expect(canAccessOperationalReports(profile)).toBe(true)
    expect(canReversePayments(profile)).toBe(true)
    expect(canReadAggregateWorkspace(profile)).toBe(true)
  })

  it('keeps collector scoped to field operation only', () => {
    const profile = {
      id: 'collector-1',
      fullName: 'Cobrador Uno',
      role: 'collector' as const,
    }

    expect(canAccessOrigination(profile)).toBe(false)
    expect(canAccessCollectorManagement(profile)).toBe(false)
    expect(canAccessOperationalReports(profile)).toBe(false)
    expect(canReversePayments(profile)).toBe(false)
    expect(canReadAggregateWorkspace(profile)).toBe(false)
  })
})
