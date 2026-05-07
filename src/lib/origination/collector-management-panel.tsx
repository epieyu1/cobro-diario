import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { canAccessCollectorManagement } from '@/lib/auth/role-guards.ts'
import type { SessionProfile } from '@/lib/db/local-db.ts'
import { createSupabaseOriginationTransport } from '@/lib/origination/origination-transport.ts'
import {
  describeOriginationError,
  type OriginationCollectorOption,
} from '@/lib/origination/origination-validation.ts'
import type { SupabaseClient } from '@supabase/supabase-js'

type CollectorManagementPanelProps = {
  isOnline: boolean
  profile?: SessionProfile
  supabaseClient: SupabaseClient | null
}

type CollectorCreationDraft = {
  email: string
  fullName: string
  password: string
  phone: string
}

export function CollectorManagementPanel({
  isOnline,
  profile,
  supabaseClient,
}: CollectorManagementPanelProps) {
  const [collectors, setCollectors] = useState<OriginationCollectorOption[]>([])
  const [collectorsError, setCollectorsError] = useState<string | null>(null)
  const [collectorCreationDraft, setCollectorCreationDraft] = useState<CollectorCreationDraft>(createInitialCollectorCreationDraft)
  const [collectorCreationError, setCollectorCreationError] = useState<string | null>(null)
  const [collectorCreationSuccess, setCollectorCreationSuccess] = useState<string | null>(null)
  const [isCreatingCollector, setIsCreatingCollector] = useState(false)
  const [isLoadingCollectors, setIsLoadingCollectors] = useState(false)
  const [showCollectorCreation, setShowCollectorCreation] = useState(false)
  const transport = useMemo(
    () => (supabaseClient ? createSupabaseOriginationTransport(supabaseClient) : null),
    [supabaseClient],
  )
  const canManageCollectors = canAccessCollectorManagement(profile)

  useEffect(() => {
    if (!canManageCollectors || !transport || !isOnline) {
      return
    }

    const activeTransport = transport
    let active = true

    async function loadCollectors() {
      setIsLoadingCollectors(true)
      setCollectorsError(null)

      try {
        const nextCollectors = await activeTransport.listActiveCollectors()

        if (!active) {
          return
        }

        setCollectors(nextCollectors)
      } catch (error) {
        if (!active) {
          return
        }

        setCollectorsError(describeOriginationError(extractErrorCode(error)))
      } finally {
        if (active) {
          setIsLoadingCollectors(false)
        }
      }
    }

    void loadCollectors()

    return () => {
      active = false
    }
  }, [canManageCollectors, isOnline, transport])

  function updateCollectorCreationField(field: keyof CollectorCreationDraft, value: string) {
    setCollectorCreationError(null)
    setCollectorCreationSuccess(null)
    setCollectorCreationDraft((currentDraft) => ({
      ...currentDraft,
      [field]: value,
    }))
  }

  async function handleCreateCollector(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!transport || !isOnline) {
      setCollectorCreationError(describeOriginationError('requires_connection'))
      return
    }

    setIsCreatingCollector(true)
    setCollectorCreationError(null)
    setCollectorCreationSuccess(null)

    try {
      const createdCollector = await transport.createCollectorAccount(collectorCreationDraft)
      const nextCollectors = await transport.listActiveCollectors()

      setCollectors(nextCollectors)
      setCollectorCreationDraft(createInitialCollectorCreationDraft())
      setShowCollectorCreation(false)
      setCollectorCreationSuccess(`Cobrador ${createdCollector.fullName} creado y disponible para asignacion operativa.`)
    } catch (error) {
      setCollectorCreationError(describeOriginationError(extractErrorCode(error)))
    } finally {
      setIsCreatingCollector(false)
    }
  }

  if (!profile) {
    return (
      <div className="warn-box inline" role="alert">
        <strong>Gestión de cobradores bloqueada</strong>
        <p>La sesión necesita un perfil remoto válido antes de administrar cobradores.</p>
      </div>
    )
  }

  if (!canManageCollectors) {
    return (
      <div className="warn-box inline" role="alert">
        <strong>Solo administrador</strong>
        <p>La gestión de cobradores no está disponible para el rol actual.</p>
      </div>
    )
  }

  return (
    <section className="management-panel standalone">
      <div className="management-heading">
        <strong>Cobradores activos</strong>
        <span>Vista separada para crear y revisar cobradores sin depender del flujo de originación.</span>
      </div>

      {!isOnline || !transport ? (
        <div className="warn-box inline" role="alert">
          <strong>Requiere conexión</strong>
          <p>La gestión de cobradores usa una RPC de administrador sobre `LANDING`.</p>
        </div>
      ) : null}

      {collectorsError ? (
        <div className="warn-box inline" role="alert">
          <strong>No se pudo cargar la plantilla operativa</strong>
          <p>{collectorsError}</p>
        </div>
      ) : null}

      {collectorCreationSuccess ? (
        <div className="origination-success-card" role="status">
          <strong>Cobrador creado</strong>
          <p>{collectorCreationSuccess}</p>
        </div>
      ) : null}

      <div className="origination-inline-actions">
        <button
          className="button secondary"
          onClick={() => {
            setCollectorCreationError(null)
            setCollectorCreationSuccess(null)
            setShowCollectorCreation((currentValue) => !currentValue)
          }}
          type="button"
        >
          {showCollectorCreation ? 'Cancelar alta de cobrador' : 'Nuevo cobrador'}
        </button>
        <p className="origination-helper">
          El alta provisiona Auth y `public.profiles` sin reemplazar tu sesión de administrador.
        </p>
      </div>

      {showCollectorCreation ? (
        <form className="preview-box" onSubmit={handleCreateCollector}>
          <strong>Alta rápida de cobrador</strong>
          <p>Usa una clave inicial temporal y entrégala al cobrador solo por un canal controlado.</p>

          <label className="field">
            <span>Nombre completo</span>
            <input
              className="input"
              placeholder="Ej. Laura Diaz"
              required
              value={collectorCreationDraft.fullName}
              onChange={(event) => updateCollectorCreationField('fullName', event.target.value)}
            />
          </label>

          <label className="field">
            <span>Correo</span>
            <input
              className="input"
              autoComplete="email"
              inputMode="email"
              placeholder="Ej. laura@cobrodiario.dev"
              required
              type="email"
              value={collectorCreationDraft.email}
              onChange={(event) => updateCollectorCreationField('email', event.target.value)}
            />
          </label>

          <label className="field">
            <span>Clave inicial</span>
            <input
              className="input"
              autoComplete="new-password"
              minLength={6}
              placeholder="Mínimo 6 caracteres"
              required
              type="password"
              value={collectorCreationDraft.password}
              onChange={(event) => updateCollectorCreationField('password', event.target.value)}
            />
          </label>

          <label className="field">
            <span>Teléfono opcional</span>
            <input
              className="input"
              inputMode="tel"
              placeholder="Ej. 3001234567"
              value={collectorCreationDraft.phone}
              onChange={(event) => updateCollectorCreationField('phone', event.target.value)}
            />
          </label>

          {collectorCreationError ? (
            <div className="warn-box inline" role="alert">
              <strong>No se pudo crear el cobrador</strong>
              <p>{collectorCreationError}</p>
            </div>
          ) : null}

          <div className="origination-actions compact">
            <button className="button ghost" onClick={() => setShowCollectorCreation(false)} type="button">
              Cerrar
            </button>
            <button className="button primary" disabled={isCreatingCollector} type="submit">
              {isCreatingCollector ? 'Creando cobrador...' : 'Crear cobrador'}
            </button>
          </div>
        </form>
      ) : null}

      <div className="collector-admin-list" aria-label="Cobradores activos">
        {isLoadingCollectors ? (
          <div className="empty-state">
            <p>Cargando cobradores activos...</p>
          </div>
        ) : collectors.length ? (
          collectors.map((collector) => (
            <article key={collector.id} className="collector-admin-card">
              <div className="collector-admin-copy">
                <strong>{collector.fullName}</strong>
                <span>{collector.phone ?? 'Sin teléfono operativo'}</span>
                <small>{collector.id}</small>
              </div>
              <span className="chip success">activo</span>
            </article>
          ))
        ) : (
          <div className="empty-state">
            <p>No hay cobradores activos cargados en el dominio remoto.</p>
          </div>
        )}
      </div>
    </section>
  )
}

function createInitialCollectorCreationDraft(): CollectorCreationDraft {
  return {
    email: '',
    fullName: '',
    password: '',
    phone: '',
  }
}

function extractErrorCode(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return 'form_validation_failed'
}
