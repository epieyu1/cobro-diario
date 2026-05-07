import { describe, expect, it, vi } from 'vitest'
import { createSupabaseOriginationTransport } from '@/lib/origination/origination-transport.ts'

type MockTransportClient = Parameters<typeof createSupabaseOriginationTransport>[0]

describe('createSupabaseOriginationTransport', () => {
  it('provisions collectors through the RPC instead of a second browser Auth client', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        full_name: 'Laura Diaz',
        id: 'collector-1',
      },
      error: null,
    })
    const transport = createSupabaseOriginationTransport({
      rpc,
    } as unknown as MockTransportClient)

    const result = await transport.createCollectorAccount({
      email: ' LAURA@COBRODIARIO.DEV ',
      fullName: ' Laura Diaz ',
      password: '123456',
      phone: '3001234567',
    })

    expect(rpc).toHaveBeenCalledWith('provision_collector_account', {
      p_email: 'laura@cobrodiario.dev',
      p_full_name: 'Laura Diaz',
      p_password: '123456',
      p_phone: '3001234567',
    })
    expect(result).toEqual({
      fullName: 'Laura Diaz',
      id: 'collector-1',
    })
  })

  it('fails fast when the RPC payload returns an unexpected shape', async () => {
    const transport = createSupabaseOriginationTransport({
      rpc: vi.fn().mockResolvedValue({
        data: {
          full_name: 'Laura Diaz',
        },
        error: null,
      }),
    } as unknown as MockTransportClient)

    await expect(
      transport.createCollectorAccount({
        email: 'laura@cobrodiario.dev',
        fullName: 'Laura Diaz',
        password: '123456',
      }),
    ).rejects.toThrow('invalid_collector_provision_response')
  })

  it('rejects malformed collector input before touching Supabase', async () => {
    const rpc = vi.fn()
    const transport = createSupabaseOriginationTransport({
      rpc,
    } as unknown as MockTransportClient)

    await expect(
      transport.createCollectorAccount({
        email: 'correo-invalido',
        fullName: 'Laura Diaz',
        password: '123456',
      }),
    ).rejects.toThrow('collector_email_invalid')
    expect(rpc).not.toHaveBeenCalled()
  })
})
