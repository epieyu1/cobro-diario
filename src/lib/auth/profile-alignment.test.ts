import { describe, expect, it } from 'vitest'
import { shouldBlockAuthenticatedWorkspaceForProfileAlignment } from '@/lib/auth/profile-alignment.ts'

describe('authenticated profile alignment guard', () => {
  it('stays open while auth or IndexedDB are still bootstrapping', () => {
    expect(
      shouldBlockAuthenticatedWorkspaceForProfileAlignment({
        authReady: false,
        dbReady: true,
        sessionUserId: 'user-1',
        workspace: {
          profile: undefined,
        },
      }),
    ).toBe(false)

    expect(
      shouldBlockAuthenticatedWorkspaceForProfileAlignment({
        authReady: true,
        dbReady: false,
        sessionUserId: 'user-1',
        workspace: {
          profile: undefined,
        },
      }),
    ).toBe(false)
  })

  it('stays open before the authenticated workspace snapshot resolves', () => {
    expect(
      shouldBlockAuthenticatedWorkspaceForProfileAlignment({
        authReady: true,
        dbReady: true,
        sessionUserId: 'user-1',
        workspace: null,
      }),
    ).toBe(false)
  })

  it('blocks the shell when Auth exists but the remote profile is missing', () => {
    expect(
      shouldBlockAuthenticatedWorkspaceForProfileAlignment({
        authReady: true,
        dbReady: true,
        sessionUserId: 'user-1',
        workspace: {
          profile: undefined,
        },
      }),
    ).toBe(true)
  })

  it('allows the shell once the remote profile is aligned', () => {
    expect(
      shouldBlockAuthenticatedWorkspaceForProfileAlignment({
        authReady: true,
        dbReady: true,
        sessionUserId: 'user-1',
        workspace: {
          profile: {
            fullName: 'Fase 7 Admin',
            id: 'user-1',
            role: 'admin',
          },
        },
      }),
    ).toBe(false)
  })
})
