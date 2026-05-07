import {
  lazy,
  Suspense,
  startTransition,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useMemo,
  useState,
} from 'react'
import {
  type CollectorWorkspaceSnapshot,
} from '@/lib/collector/collector-workspace.ts'
import {
  type CollectorRouteBoard,
  type OperationalLoanCard,
} from '@/lib/collector/collector-route-board.ts'
import { shouldBlockAuthenticatedWorkspaceForProfileAlignment } from '@/lib/auth/profile-alignment.ts'
import { resolveOperationalRoleCapabilities } from '@/lib/auth/role-guards.ts'
import type { LocalInstallment, LocalPayment } from '@/lib/db/local-db.ts'
import { env, hasSupabaseEnv } from '@/lib/env.ts'
import { FINANCIAL_BASELINE, PAYMENT_OPERATIONAL_REQUIREMENTS } from '@/lib/finance/financial-config.ts'
import { CurrencyAmountInput } from '@/lib/finance/currency-amount-input.tsx'
import { formatCurrency, sumMoney, toMoney } from '@/lib/finance/money.ts'
import type { OriginationCompletedPayload } from '@/lib/origination/origination-wizard-panel.tsx'
import type { ConfirmedPaymentReceipt, ConfirmedReceiptLookupState } from '@/lib/receipts/receipt-types.ts'
import type { SyncQueueSnapshot } from '@/lib/sync/payment-sync.ts'
import type {
  CollectionActionOutcome,
  LoanPaymentApplicationMode,
  PaymentApplicationDraft,
  SyncQueueEntityName,
} from '@/types/domain.ts'

type OperationalRuntime = typeof import('@/lib/runtime/operational-runtime.ts')

type PaymentPreviewState = {
  applications: PaymentApplicationDraft[]
  paymentApplicationMode: LoanPaymentApplicationMode
  error?: string
}

type MobileShellMode = 'environment' | 'bootstrap' | 'public' | 'authenticated'
type MobileWorkspacePane = 'portfolio' | 'detail'
type MobileNavigationTarget = MobileWorkspacePane | 'operation'
type OperationsPane = 'payment' | 'origination' | 'management' | 'receipt' | 'reports' | 'queue' | 'rules'
const DESKTOP_OPERATIONS_MEDIA_QUERY = '(min-width: 60rem)'

const COLLECTION_ACTION_OUTCOMES: CollectionActionOutcome[] = [
  'promise_to_pay',
  'not_found',
  'return_visit',
  'visited_no_payment',
]
const OriginationWizardPanel = lazy(() =>
  import('@/lib/origination/origination-wizard-panel.tsx').then((module) => ({
    default: module.OriginationWizardPanel,
  })),
)
const CollectorManagementPanel = lazy(() =>
  import('@/lib/origination/collector-management-panel.tsx').then((module) => ({
    default: module.CollectorManagementPanel,
  })),
)
const ReceiptPanel = lazy(() =>
  import('@/lib/receipts/receipt-panel.tsx').then((module) => ({
    default: module.ReceiptPanel,
  })),
)
const ReportPanel = lazy(() =>
  import('@/lib/reports/report-panel.tsx').then((module) => ({
    default: module.ReportPanel,
  })),
)
const J = lazy(() => import('@/lib/ui/j.tsx'))
const Z = lazy(() => import('@/lib/ui/z.tsx'))

const emptyQueueSnapshot: SyncQueueSnapshot = {
  failed: 0,
  pending: 0,
  processing: 0,
  synced: 0,
  total: 0,
}
const emptyConfirmedReceiptLookupState: ConfirmedReceiptLookupState = {
  paymentId: null,
  status: 'idle',
}

const emptyRouteBoard: CollectorRouteBoard = {
  businessDate: '',
  cards: [],
  metrics: {
    dueTodayLoanCount: 0,
    failedSyncLoanCount: 0,
    openLoanCount: 0,
    overdueLoanCount: 0,
  },
  routes: [],
}

function App() {
  const [runtime, setRuntime] = useState<OperationalRuntime | null>(null)
  const supabaseClient = useMemo(() => runtime?.getSupabaseBrowserClient() ?? null, [runtime])
  const remoteSource = useMemo(
    () => (runtime && supabaseClient ? runtime.createSupabaseCollectorWorkspaceSource(supabaseClient) : null),
    [runtime, supabaseClient],
  )
  const syncTransport = useMemo(
    () => (runtime && supabaseClient ? runtime.createSupabasePaymentSyncTransport(supabaseClient) : null),
    [runtime, supabaseClient],
  )
  const receiptTransport = useMemo(
    () => (runtime && supabaseClient ? runtime.createSupabaseReceiptTransport(supabaseClient) : null),
    [runtime, supabaseClient],
  )
  const paymentReversalTransport = useMemo(
    () => (runtime && supabaseClient ? runtime.createSupabasePaymentReversalTransport(supabaseClient) : null),
    [runtime, supabaseClient],
  )
  const reportTransport = useMemo(
    () => (runtime && supabaseClient ? runtime.createSupabaseOperationalReportTransport(supabaseClient) : null),
    [runtime, supabaseClient],
  )
  const collectionActionSyncTransport = useMemo(
    () => (runtime && supabaseClient ? runtime.createSupabaseCollectionActionSyncTransport(supabaseClient) : null),
    [runtime, supabaseClient],
  )
  const bluetoothReceiptStrategy = useMemo(
    () => runtime?.evaluateBluetoothReceiptStrategy() ?? null,
    [runtime],
  )
  const [isOnline, setIsOnline] = useState(() => navigator.onLine)
  const [dbReady, setDbReady] = useState(false)
  const [authReady, setAuthReady] = useState(!hasSupabaseEnv)
  const [sessionUserId, setSessionUserId] = useState<string | null>(null)
  const [workspace, setWorkspace] = useState<CollectorWorkspaceSnapshot | null>(null)
  const [queueSnapshot, setQueueSnapshot] = useState(emptyQueueSnapshot)
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedRouteLabel, setSelectedRouteLabel] = useState('all')
  const [selectedLoanId, setSelectedLoanId] = useState<string | null>(null)
  const [activeMobilePane, setActiveMobilePane] = useState<MobileWorkspacePane>('portfolio')
  const [activeOperationsPane, setActiveOperationsPane] = useState<OperationsPane>('payment')
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [isOperationsSheetOpen, setIsOperationsSheetOpen] = useState(false)
  const [isDesktopOperationsLayout, setIsDesktopOperationsLayout] = useState(() =>
    window.matchMedia(DESKTOP_OPERATIONS_MEDIA_QUERY).matches,
  )
  const [amountInput, setAmountInput] = useState('')
  const [paymentReference, setPaymentReference] = useState('')
  const [paymentNotes, setPaymentNotes] = useState('')
  const [collectionActionNotes, setCollectionActionNotes] = useState('')
  const [collectionFollowUpDate, setCollectionFollowUpDate] = useState('')
  const [receiptPaymentId, setReceiptPaymentId] = useState<string | null>(null)
  const [confirmedReceiptsByPaymentId, setConfirmedReceiptsByPaymentId] = useState<
    Record<string, ConfirmedPaymentReceipt>
  >({})
  const [confirmedReceiptLookupState, setConfirmedReceiptLookupState] = useState(
    emptyConfirmedReceiptLookupState,
  )
  const [receiptReloadToken, setReceiptReloadToken] = useState(0)
  const [paymentReversalError, setPaymentReversalError] = useState<string | null>(null)
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [, setSyncMessage] = useState('Esperando inicio de sesión.')
  const [runtimeError, setRuntimeError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [isSigningIn, setIsSigningIn] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isReversingConfirmedReceipt, setIsReversingConfirmedReceipt] = useState(false)
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false)
  const [isSigningOut, setIsSigningOut] = useState(false)
  const deferredSearchTerm = useDeferredValue(searchTerm)

  useEffect(() => {
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  useEffect(() => {
    // La hoja operativa es overlay en móvil y panel persistente desde 60rem por CSS.
    // Duplicamos ese breakpoint en JS solo para mantener `aria-hidden` e `inert`
    // sincronizados con lo que realmente queda visible en pantalla.
    const mediaQueryList = window.matchMedia(DESKTOP_OPERATIONS_MEDIA_QUERY)
    const handleChange = (event: MediaQueryListEvent) => setIsDesktopOperationsLayout(event.matches)

    mediaQueryList.addEventListener('change', handleChange)

    return () => {
      mediaQueryList.removeEventListener('change', handleChange)
    }
  }, [])

  useEffect(() => {
    // Este corte asincrono separa el shell inicial del runtime operativo pesado.
    // La app sigue cargando el flujo completo automaticamente, pero evita meter Dexie,
    // Supabase y sync en el JS critico del primer paint.
    let active = true

    void import('@/lib/runtime/operational-runtime.ts')
      .then((nextRuntime) => {
        if (!active) {
          return
        }

        setRuntime(nextRuntime)
      })
      .catch((error) => {
        if (!active) {
          return
        }

        setRuntimeError(extractOperationalError(error))
      })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!runtime) {
      return
    }

    // Abrimos IndexedDB al montar para garantizar que la shell operativa pueda leer cache local
    // antes de tocar Supabase. Esto soporta reingreso offline con sesion previamente persistida.
    // Riesgo: localDb es un singleton del runtime. Cerrarlo en el cleanup del efecto rompe el
    // remount de React StrictMode en desarrollo y deja la app congelada con "Database has been closed".
    // Fuente de verdad: al cerrar sesion se limpia el contenido operativo, pero la conexion local
    // debe seguir viva mientras la app este montada en este navegador.
    let active = true

    void runtime.localDb
      .open()
      .then(() => {
        if (!active) {
          return
        }

        setDbReady(true)
      })
      .catch((error) => {
        if (!active) {
          return
        }

        setRuntimeError(extractOperationalError(error))
        setDbReady(false)
      })

    return () => {
      active = false
    }
  }, [runtime])

  useEffect(() => {
    if (!runtime || !supabaseClient) {
      return
    }

    let active = true
    const unsubscribe = runtime.subscribeToBrowserAuthSession(supabaseClient, (nextSession) => {
      // Supabase puede emitir SIGNED_IN varias veces por refocus o refresh de token.
      // Solo derivamos el user id y dejamos que el bootstrap pesado dependa de ese identificador estable.
      startTransition(() => {
        setSessionUserId(nextSession?.user.id ?? null)
      })
    })

    void runtime.readPersistedBrowserSession(supabaseClient)
      .then((session) => {
        if (!active) {
          return
        }

        setSessionUserId(session?.user.id ?? null)
      })
      .catch((error) => {
        if (!active) {
          return
        }

        setRuntimeError(extractOperationalError(error))
      })
      .finally(() => {
        if (active) {
          setAuthReady(true)
        }
      })

    return () => {
      active = false
      unsubscribe()
    }
  }, [runtime, supabaseClient])

  async function loadLocalWorkspace(collectorId: string | null) {
    if (!runtime) {
      startTransition(() => {
        setQueueSnapshot(emptyQueueSnapshot)
        setWorkspace(null)
      })
      return
    }

    const nextQueueSnapshot = await runtime.getSyncQueueSnapshot(runtime.localDb)
    startTransition(() => {
      setQueueSnapshot(nextQueueSnapshot)
    })

    if (!collectorId) {
      startTransition(() => {
        setWorkspace(null)
      })
      return
    }

    const nextWorkspace = await runtime.loadCollectorWorkspaceSnapshot(collectorId, {
      db: runtime.localDb,
    })

    startTransition(() => {
      setWorkspace(nextWorkspace)
    })
  }

  async function runRefreshOperationalWorkspace(
    reason: 'session' | 'manual' | 'online' | 'payment' | 'retry',
  ) {
    if (!runtime || !dbReady) {
      return
    }

    setRuntimeError(null)
    setIsRefreshing(true)

    try {
      await loadLocalWorkspace(sessionUserId)

      if (!sessionUserId) {
        setSyncMessage(hasSupabaseEnv ? 'Inicia sesión para descargar tu cartera.' : 'Falta configuración pública de Supabase.')
        return
      }

      if (!supabaseClient || !remoteSource) {
        setSyncMessage('Supabase no está disponible en este navegador.')
        return
      }

      if (!isOnline) {
        setSyncMessage('Modo offline. Se usa la cartera guardada.')
        return
      }

      let nextQueueSnapshot = await runtime.getSyncQueueSnapshot(runtime.localDb)

      if (nextQueueSnapshot.pending > 0 && syncTransport && collectionActionSyncTransport) {
        setSyncMessage('Sincronizando pendientes antes de refrescar cartera...')

        await runtime.flushPaymentSyncQueue(syncTransport, {
          db: runtime.localDb,
        })
        await runtime.flushCollectionActionSyncQueue(collectionActionSyncTransport, {
          db: runtime.localDb,
        })

        nextQueueSnapshot = await runtime.getSyncQueueSnapshot(runtime.localDb)
        await loadLocalWorkspace(sessionUserId)
      }

      if (nextQueueSnapshot.failed > 0 || nextQueueSnapshot.pending > 0 || nextQueueSnapshot.processing > 0) {
        setSyncMessage(
          'La cola sigue divergente. Se conserva la vista local hasta resolver pendientes o fallidos.',
        )
        return
      }

      await runtime.bootstrapCollectorWorkspace(remoteSource, sessionUserId, {
        db: runtime.localDb,
      })
      await loadLocalWorkspace(sessionUserId)

      setSyncMessage(
        reason === 'manual' ? 'Cartera actualizada desde LANDING.' : 'Caché local alineada con LANDING.',
      )
    } catch (error) {
      setRuntimeError(extractOperationalError(error))
      setSyncMessage('No se pudo alinear la cartera remota. Se mantiene el estado local disponible.')
    } finally {
      setIsRefreshing(false)
    }
  }

  const refreshOperationalWorkspaceEffect = useEffectEvent(
    (reason: 'session' | 'manual' | 'online' | 'payment' | 'retry') => {
      void runRefreshOperationalWorkspace(reason)
    },
  )

  useEffect(() => {
    if (!dbReady || !authReady) {
      return
    }

    const timerId = window.setTimeout(() => {
      refreshOperationalWorkspaceEffect('session')
    }, 0)

    return () => {
      window.clearTimeout(timerId)
    }
  }, [authReady, dbReady, sessionUserId])

  useEffect(() => {
    if (!dbReady || !authReady || !isOnline || !sessionUserId) {
      return
    }

    const timerId = window.setTimeout(() => {
      refreshOperationalWorkspaceEffect('online')
    }, 0)

    return () => {
      window.clearTimeout(timerId)
    }
  }, [authReady, dbReady, isOnline, sessionUserId])

  const routeBoard = useMemo(() => {
    // Intencion: dar una vista de ruta/prioridad para trabajo de campo aunque el dominio remoto
    // aun no tenga una entidad formal de ruta. Hoy se deriva desde neighborhood/address local.
    // Flujo: CollectorWorkspaceSnapshot -> agrupacion provisional -> filtros y chips operativos.
    // Riesgo: cuando exista una ruta persistida en backend, este derivado temporal debe retirarse
    // o alinearse para no presentar una organizacion distinta a la fuente remota de verdad.
    return runtime ? runtime.buildCollectorRouteBoard(workspace?.loanCards ?? []) : emptyRouteBoard
  }, [runtime, workspace?.loanCards])

  const resolvedSelectedRouteLabel = useMemo(() => {
    if (selectedRouteLabel === 'all') {
      return 'all'
    }

    return routeBoard.routes.some((route) => route.routeLabel === selectedRouteLabel) ? selectedRouteLabel : 'all'
  }, [routeBoard.routes, selectedRouteLabel])

  const filteredLoanCards = useMemo<OperationalLoanCard[]>(() => {
    const normalizedSearch = deferredSearchTerm.trim().toLowerCase()
    const routeScopedLoanCards =
      resolvedSelectedRouteLabel === 'all'
        ? routeBoard.cards
        : routeBoard.cards.filter((loanCard) => loanCard.routeLabel === resolvedSelectedRouteLabel)

    if (!normalizedSearch) {
      return routeScopedLoanCards
    }

    return routeScopedLoanCards.filter((loanCard) => {
      const searchParts = [
        loanCard.customer.fullName,
        loanCard.customer.governmentId,
        loanCard.customer.phone,
        loanCard.customer.address,
        loanCard.customer.neighborhood,
        loanCard.latestCollectionAction
          ? describeCollectionActionOutcome(runtime, loanCard.latestCollectionAction.outcome)
          : undefined,
        loanCard.loan.externalLoanNumber,
        loanCard.loan.id,
        loanCard.priorityLabel,
        loanCard.priorityNote,
        loanCard.routeLabel,
      ]
        .filter((value): value is string => Boolean(value))
        .join(' ')
        .toLowerCase()

      return searchParts.includes(normalizedSearch)
    })
  }, [deferredSearchTerm, resolvedSelectedRouteLabel, routeBoard.cards, runtime])

  const resolvedSelectedLoanId = useMemo(() => {
    if (filteredLoanCards.length === 0) {
      return null
    }

    return filteredLoanCards.some((loanCard) => loanCard.loan.id === selectedLoanId)
      ? selectedLoanId
      : filteredLoanCards[0].loan.id
  }, [filteredLoanCards, selectedLoanId])

  const selectedLoan = useMemo(
    () => filteredLoanCards.find((loanCard) => loanCard.loan.id === resolvedSelectedLoanId) ?? null,
    [filteredLoanCards, resolvedSelectedLoanId],
  )
  const paymentPreview = useMemo<PaymentPreviewState | null>(() => {
    if (!runtime || !selectedLoan || !amountInput.trim()) {
      return null
    }

    const paymentApplicationMode = selectedLoan.loan.paymentApplicationMode ?? 'oldest_first'

    try {
      return {
        applications:
          paymentApplicationMode === 'oldest_first'
            ? runtime.buildOldestFirstPaymentApplications(amountInput, selectedLoan.installments)
            : runtime.buildDirectedPaymentApplications(
                paymentApplicationMode,
                amountInput,
                selectedLoan.installments,
              ),
        paymentApplicationMode,
      }
    } catch (error) {
      return {
        applications: [],
        paymentApplicationMode,
        error: extractOperationalError(error),
      }
    }
  }, [amountInput, runtime, selectedLoan])
  const selectedLoanPaymentApplicationMode = selectedLoan?.loan.paymentApplicationMode ?? 'oldest_first'
  const selectedLoanModeOutstandingAmount = useMemo(() => {
    if (!selectedLoan) {
      return '0.00'
    }

    return resolvePaymentModeOutstandingAmount(
      selectedLoan.installments,
      selectedLoanPaymentApplicationMode,
      selectedLoan.outstandingAmount,
    )
  }, [selectedLoan, selectedLoanPaymentApplicationMode])
  const selectedLoanModeCurrentAmount = useMemo(() => {
    if (!selectedLoan) {
      return '0.00'
    }

    return resolveCurrentModeInstallmentAmount(
      selectedLoan.installments,
      selectedLoanPaymentApplicationMode,
      selectedLoan.outstandingAmount,
    )
  }, [selectedLoan, selectedLoanPaymentApplicationMode])

  const receiptPayment = workspace
    ? receiptPaymentId
      ? workspace.recentPayments.find((recentPayment) => recentPayment.id === receiptPaymentId) ?? null
      : workspace.recentPayments[0] ?? null
    : null
  const receiptRemotePaymentId = receiptPayment?.remotePaymentId ?? null
  const confirmedReceipt = receiptRemotePaymentId
    ? confirmedReceiptsByPaymentId[receiptRemotePaymentId] ?? null
    : null
  const loadConfirmedReceipt = useEffectEvent(
    async (
      remotePaymentId: string,
      transport: NonNullable<typeof receiptTransport>,
      isActive: () => boolean,
    ) => {
      setConfirmedReceiptLookupState({
        paymentId: remotePaymentId,
        status: 'loading',
      })

      try {
        const nextReceipt = await transport.getPaymentReceipt(remotePaymentId)

        if (!isActive()) {
          return
        }

        startTransition(() => {
          setConfirmedReceiptsByPaymentId((currentReceipts) => ({
            ...currentReceipts,
            [remotePaymentId]: nextReceipt,
          }))
          setConfirmedReceiptLookupState({
            paymentId: remotePaymentId,
            status: 'idle',
          })
        })
      } catch (error) {
        if (!isActive()) {
          return
        }

        startTransition(() => {
          setConfirmedReceiptLookupState({
            error: extractOperationalError(error),
            paymentId: remotePaymentId,
            status: 'error',
          })
        })
      }
    },
  )

  useEffect(() => {
    if (
      activeOperationsPane !== 'receipt'
      || !receiptRemotePaymentId
      || !receiptTransport
      || confirmedReceipt
    ) {
      return
    }

    let active = true

    void loadConfirmedReceipt(receiptRemotePaymentId, receiptTransport, () => active)

    return () => {
      active = false
    }
  }, [
    activeOperationsPane,
    confirmedReceipt,
    receiptRemotePaymentId,
    receiptReloadToken,
    receiptTransport,
  ])
  const effectiveConfirmedReceiptLookupState: ConfirmedReceiptLookupState = !receiptRemotePaymentId
    ? emptyConfirmedReceiptLookupState
    : confirmedReceipt
      ? {
          paymentId: receiptRemotePaymentId,
          status: 'idle',
        }
      : confirmedReceiptLookupState.paymentId === receiptRemotePaymentId
        ? confirmedReceiptLookupState
        : {
            paymentId: receiptRemotePaymentId,
            status: 'idle',
          }

  useEffect(() => {
    setPaymentReversalError(null)
  }, [receiptPayment?.id])

  const totalOutstanding = useMemo(() => {
    if (!workspace) return toMoney(0)
    return sumMoney(workspace.loanCards.map((card) => card.outstandingAmount))
  }, [workspace])

  const dashboardMetrics = useMemo(() => {
    if (!workspace) return []
    return [
      {
        label: 'Total Cartera',
        value: formatCurrency(totalOutstanding, FINANCIAL_BASELINE.currencyCode, env.defaultLocale),
        tone: 'accent',
      },
      {
        label: 'Actividad',
        value: `${workspace.openLoanCount} préstamos`,
        tone: 'neutral',
      },
      {
        label: 'Sincronización',
        value:
          queueSnapshot.pending + queueSnapshot.failed > 0
            ? `${queueSnapshot.pending + queueSnapshot.failed} pendientes`
            : 'Sincronizado',
        tone: queueSnapshot.failed > 0 ? 'danger' : 'success',
      },
    ]
  }, [workspace, queueSnapshot, totalOutstanding])
  const roleCapabilities = useMemo(
    () => resolveOperationalRoleCapabilities(workspace?.profile),
    [workspace?.profile],
  )
  const canAccessOrigination = roleCapabilities.canAccessOrigination
  // Fuente de verdad: Auth y public.profiles deben converger antes de abrir la shell operativa.
  // Si la cuenta existe solo en Auth (por ejemplo, un admin creado manualmente sin alinear perfil),
  // la UI no debe caer silenciosamente a una experiencia "collector" sin permisos reales.
  const isProfileAlignmentBlocked = shouldBlockAuthenticatedWorkspaceForProfileAlignment({
    authReady,
    dbReady,
    sessionUserId,
    workspace,
  })

  const runtimeCards = useMemo(
    () => [
      {
        label: 'Sesión',
        tone: sessionUserId ? 'ready' : 'warn',
        value: sessionUserId ? 'Activa' : 'Sin iniciar',
      },
      {
        label: 'Red',
        tone: isOnline ? 'ready' : 'warn',
        value: isOnline ? 'Con conexión' : 'Sin conexión',
      },
      {
        label: 'Caché local',
        tone: dbReady ? 'ready' : 'warn',
        value: dbReady ? `${workspace?.customerCount ?? 0} clientes` : 'Pendiente',
      },
      {
        label: 'Sincronización',
        tone: queueSnapshot.failed === 0 ? 'ready' : 'warn',
        value: `${queueSnapshot.pending} pendientes / ${queueSnapshot.failed} fallidos`,
      },
    ],
    [dbReady, isOnline, queueSnapshot.failed, queueSnapshot.pending, sessionUserId, workspace?.customerCount],
  )

  const mobilePaneItems = useMemo(
    // Intencion: exponer la navegacion primaria del cobrador desde un menu hamburguesa movil
    // una vez la shell ya tiene sesion autenticada, sin obligar al usuario a depender
    // de una barra fija inferior.
    // Flujo: menu hamburguesa -> cambia panel visible o abre el sheet de operaciones con el mismo estado.
    // Riesgo: si el menu deja de ser persistente o duplica logica de vista, se rompe la continuidad
    // entre cartera, detalle y acciones operativas que hoy comparten una sola fuente de verdad.
    () => [
      {
        description: `${filteredLoanCards.length} casos visibles`,
        key: 'portfolio' as const,
        label: 'Cartera',
      },
      {
        description: selectedLoan ? selectedLoan.customer.fullName : 'Sin préstamo elegido',
        key: 'detail' as const,
        label: 'Detalle',
      },
      {
        description: `${queueSnapshot.pending + queueSnapshot.failed} movimiento(s) activos`,
        key: 'operation' as const,
        label: 'Operación',
      },
    ],
    [filteredLoanCards.length, queueSnapshot.failed, queueSnapshot.pending, selectedLoan],
  )

  const operationsPaneItems = useMemo(
    // Intencion: separar cobro, gestion, recibo y cola en un menu claro para no mezclar
    // demasiadas responsabilidades visibles al mismo tiempo.
    // Flujo: el usuario entra al panel operativo -> elige una seccion -> la UI muestra solo
    // el bloque relevante, manteniendo el mismo estado local de prestamo, pago y gestion.
    // Riesgo: si se duplican componentes por cada opcion del menu, se rompe consistencia entre
    // preview, recibo y estado de cola; este menu solo debe cambiar visibilidad, no fuente de verdad.
    () => {
      const nextPaneItems: Array<{
        description: string
        key: OperationsPane
        label: string
      }> = [
        {
          description: selectedLoan ? 'Cobro contractual' : 'Selecciona un préstamo',
          key: 'payment',
          label: 'Recaudo',
        },
        {
          description: roleCapabilities.canAccessCollectorManagement
            ? 'Altas y visitas'
            : selectedLoan?.latestCollectionAction
              ? describeCollectionActionOutcome(runtime, selectedLoan.latestCollectionAction.outcome)
              : 'Registrar visita',
          key: 'management',
          label: roleCapabilities.canAccessCollectorManagement ? 'Cobradores' : 'Visita de Campo',
        },
        {
          description: receiptPayment ? describeReceiptPaneStatus(receiptPayment) : 'Recibo local',
          key: 'receipt',
          label: 'Comprobante',
        },
      ]

      if (roleCapabilities.canAccessOperationalReports) {
        nextPaneItems.push({
          description: 'Cartera, mora y sincronización',
          key: 'reports',
          label: 'Indicadores',
        })
      }

      nextPaneItems.push({
        description: `${queueSnapshot.pending + queueSnapshot.failed} movimiento(s) en cola`,
        key: 'queue',
        label: 'Cola',
      })

      if (canAccessOrigination) {
        nextPaneItems.push({
          description: 'Nuevo préstamo',
          key: 'origination',
          label: 'Nuevo Crédito',
        })
      }

      nextPaneItems.push({
        description: 'Políticas',
        key: 'rules',
        label: 'Políticas',
      })

      return nextPaneItems
    },
    [
      canAccessOrigination,
      queueSnapshot.failed,
      queueSnapshot.pending,
      receiptPayment,
      roleCapabilities.canAccessCollectorManagement,
      roleCapabilities.canAccessOperationalReports,
      runtime,
      selectedLoan,
    ],
  )

  useEffect(() => {
    if (operationsPaneItems.some((paneItem) => paneItem.key === activeOperationsPane)) {
      return
    }

    setActiveOperationsPane('payment')
  }, [activeOperationsPane, operationsPaneItems])

  // Intencion: el menu hamburguesa y la hoja operativa deben reflejar la ruta movil activa
  // con el mismo estado que usa desktop, sin bifurcar la logica por viewport.
  const activeMobileNavigationTarget: MobileNavigationTarget = isOperationsSheetOpen
    ? 'operation'
    : activeMobilePane
  const isOperationsSheetVisible = isDesktopOperationsLayout || isOperationsSheetOpen
  const currentMobileNavigationItem =
    mobilePaneItems.find((paneItem) => paneItem.key === activeMobileNavigationTarget) ?? mobilePaneItems[0]
  // Intencion: el patron de menu hamburguesa debe existir desde el primer render movil,
  // incluso mientras el runtime sigue abriendo IndexedDB o detectando la sesion persistida.
  // Flujo: cabecera sticky global -> drawer contextual por estado (`environment`, `bootstrap`,
  // `public`, `authenticated`) sin duplicar la fuente de verdad operativa.
  // Riesgo: si el header vuelve a depender de `dbReady`, `authReady` o `sessionUserId`,
  // el telefono regresa a un arranque sin navegacion visible y se rompe la prioridad mobile-first.
  const mobileShellMode: MobileShellMode = !hasSupabaseEnv
    ? 'environment'
    : !dbReady || !authReady
      ? 'bootstrap'
      : sessionUserId
        ? 'authenticated'
        : 'public'
  const mobileShellKicker =
    mobileShellMode === 'authenticated'
      ? 'Menú móvil'
      : mobileShellMode === 'environment'
        ? 'Configuración móvil'
        : mobileShellMode === 'bootstrap'
          ? 'Arranque móvil'
          : 'Inicio móvil'
  const mobileShellTitle =
    mobileShellMode === 'authenticated'
      ? currentMobileNavigationItem.label
      : mobileShellMode === 'environment'
        ? 'Entorno'
        : mobileShellMode === 'bootstrap'
          ? 'Preparando'
          : 'Acceso'
  const mobileShellDescription =
    mobileShellMode === 'authenticated'
      ? currentMobileNavigationItem.description
      : mobileShellMode === 'environment'
        ? 'Configuración, reglas y arquitectura desde el primer toque.'
        : mobileShellMode === 'bootstrap'
          ? 'El menú ya está listo mientras termina el arranque local.'
          : 'Acceso, reglas y arquitectura en el mismo patrón móvil.'

  function handleToggleMobileMenu() {
    setIsMobileMenuOpen((previousOpen) => !previousOpen)
  }

  function handleSelectMobileTarget(target: MobileNavigationTarget) {
    setIsMobileMenuOpen(false)

    if (target === 'operation') {
      setIsOperationsSheetOpen(true)
      return
    }

    setIsOperationsSheetOpen(false)
    setActiveMobilePane(target)
  }

  function handleOpenOperationsPaneFromMenu(target: OperationsPane) {
    setIsMobileMenuOpen(false)
    setIsOperationsSheetOpen(true)
    setActiveOperationsPane(target)
  }

  function renderMobileNavigationDrawerContent() {
    if (mobileShellMode === 'authenticated' && isProfileAlignmentBlocked) {
      return (
        <>
          <div className="mobile-navigation-drawer-header">
            <div>
              <p className="section-kicker">Centro móvil</p>
              <h2>Perfil operativo pendiente</h2>
              <p className="muted-copy">
                La sesión ya existe, pero falta alinear el perfil remoto antes de operar.
              </p>
            </div>

            <button
              className="button ghost mobile-navigation-close"
              onClick={() => setIsMobileMenuOpen(false)}
              type="button"
            >
              Cerrar
            </button>
          </div>

          <div className="mobile-navigation-group">
            <p className="section-kicker">Siguiente paso</p>
            <div className="mobile-navigation-list">
              <article className="mobile-navigation-button">
                <strong>Cuenta sin perfil remoto</strong>
                <span>
                  Administrador manual: alinear Auth y `public.profiles` antes de reingresar.
                </span>
              </article>
              <article className="mobile-navigation-button">
                <strong>Alta de cobrador</strong>
                <span>
                  Los cobradores deben provisionarse desde la web.
                </span>
              </article>
            </div>
          </div>

          <div className="mobile-navigation-group">
            <p className="section-kicker">Acciones de sesión</p>
            <div className="mobile-navigation-actions">
              <button
                className="button primary"
                disabled={!dbReady || !authReady || isRefreshing}
                onClick={() => {
                  setIsMobileMenuOpen(false)
                  void handleRefreshWorkspace()
                }}
                type="button"
              >
                {isRefreshing ? 'Revisando...' : 'Revisar'}
              </button>
              <button
                className="button secondary"
                disabled={isSigningOut}
                onClick={() => {
                  setIsMobileMenuOpen(false)
                  void handleSignOut()
                }}
                type="button"
              >
                {isSigningOut ? 'Cerrando...' : 'Cerrar sesión'}
              </button>
            </div>
          </div>
        </>
      )
    }

    if (mobileShellMode === 'authenticated') {
      return (
        <>
          <div className="mobile-navigation-drawer-header">
            <div>
              <p className="section-kicker">Centro móvil</p>
              <h2>{workspace?.profile?.fullName ?? 'Cobrador sin perfil remoto'}</h2>
              <p className="muted-copy">
                Cartera, detalle y acciones de cobro quedan accesibles desde un solo menú principal.
              </p>
            </div>

            <button
              className="button ghost mobile-navigation-close"
              onClick={() => setIsMobileMenuOpen(false)}
              type="button"
            >
              Cerrar
            </button>
          </div>

          <div className="mobile-navigation-group">
            <p className="section-kicker">Destino principal</p>
            <div className="mobile-navigation-list">
              {mobilePaneItems.map((paneItem) => (
                <button
                  key={paneItem.key}
                  aria-current={activeMobileNavigationTarget === paneItem.key ? 'page' : undefined}
                  aria-expanded={paneItem.key === 'operation' ? isOperationsSheetOpen : undefined}
                  className={`mobile-navigation-button ${activeMobileNavigationTarget === paneItem.key ? 'selected' : ''}`}
                  onClick={() => handleSelectMobileTarget(paneItem.key)}
                  type="button"
                >
                  <strong>{paneItem.label}</strong>
                  <span>{paneItem.description}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="mobile-navigation-group">
            <p className="section-kicker">Operación inmediata</p>
            <div className="mobile-navigation-list">
              {operationsPaneItems.map((paneItem) => (
                <button
                  key={paneItem.key}
                  aria-current={activeOperationsPane === paneItem.key ? 'page' : undefined}
                  className={`mobile-navigation-button ${activeOperationsPane === paneItem.key && isOperationsSheetOpen ? 'selected' : ''}`}
                  onClick={() => handleOpenOperationsPaneFromMenu(paneItem.key)}
                  type="button"
                >
                  <strong>{paneItem.label}</strong>
                  <span>{paneItem.description}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="mobile-navigation-group">
            <p className="section-kicker">Acciones de sesión</p>
            <div className="mobile-navigation-actions">
              <button
                className="button primary"
                disabled={!dbReady || !authReady || isRefreshing}
                onClick={() => {
                  setIsMobileMenuOpen(false)
                  void handleRefreshWorkspace()
                }}
                type="button"
              >
                {isRefreshing ? 'Actualizando...' : 'Actualizar cartera'}
              </button>
              <button
                className="button secondary"
                disabled={isSigningOut}
                onClick={() => {
                  setIsMobileMenuOpen(false)
                  void handleSignOut()
                }}
                type="button"
              >
                {isSigningOut ? 'Cerrando...' : 'Cerrar sesión'}
              </button>
            </div>
          </div>
        </>
      )
    }

    if (mobileShellMode === 'environment') {
      return (
        <>
          <div className="mobile-navigation-drawer-header">
            <div>
              <p className="section-kicker">Centro móvil</p>
              <h2>Entorno bloqueado</h2>
              <p className="muted-copy">
                El menú ya existe desde el arranque, pero solo expone configuración y contexto
                mientras faltan variables públicas seguras para levantar la aplicación.
              </p>
            </div>

            <button
              className="button ghost mobile-navigation-close"
              onClick={() => setIsMobileMenuOpen(false)}
              type="button"
            >
              Cerrar
            </button>
          </div>

          <div className="mobile-navigation-group">
            <p className="section-kicker">Configuración</p>
            <div className="mobile-navigation-list">
              <a
                className="mobile-navigation-button"
                href="#collector-setup-panel"
                onClick={() => setIsMobileMenuOpen(false)}
              >
                <strong>Configurar entorno</strong>
                <span>Revisar por qué faltan `VITE_SUPABASE_URL` y la clave publicable del cliente.</span>
              </a>
              <a
                className="mobile-navigation-button"
                href="/docs/mcp-setup.md"
                onClick={() => setIsMobileMenuOpen(false)}
              >
                <strong>Guía de configuración</strong>
                <span>Abrir la referencia local sin exponer secretos ni relajar la seguridad del navegador.</span>
              </a>
            </div>
          </div>

        </>
      )
    }

    if (mobileShellMode === 'bootstrap') {
      return (
        <>
          <div className="mobile-navigation-drawer-header">
            <div>
              <p className="section-kicker">Centro móvil</p>
              <h2>Preparando sistema</h2>
              <p className="muted-copy">
                El encabezado ya se muestra desde el primer render; la operación espera a que
                IndexedDB y la sesión persistida terminen de cargar en este navegador.
              </p>
            </div>

            <button
              className="button ghost mobile-navigation-close"
              onClick={() => setIsMobileMenuOpen(false)}
              type="button"
            >
              Cerrar
            </button>
          </div>

          <div className="mobile-navigation-group">
            <p className="section-kicker">Estado</p>
            <div className="mobile-navigation-list">
              <a
                className="mobile-navigation-button"
                href="#runtime-status-panel"
                onClick={() => setIsMobileMenuOpen(false)}
              >
                <strong>Resumen operativo</strong>
                <span>
                  {dbReady ? 'Caché local lista.' : 'Caché local abriéndose.'}{' '}
                  {authReady ? 'Sesión ya revisada.' : 'Sesión persistida en revisión.'}
                </span>
              </a>
              <a
                className="mobile-navigation-button"
                href="#collector-bootstrap-panel"
                onClick={() => setIsMobileMenuOpen(false)}
              >
                <strong>Arranque seguro</strong>
                <span>Esperar la carga inicial antes de mostrar acceso o acciones operativas reales.</span>
              </a>
            </div>
          </div>

          <div className="mobile-navigation-group">
            <p className="section-kicker">Estado</p>
            <div className="mobile-navigation-actions">
              <a
                className="button primary"
                href="#collector-bootstrap-panel"
                onClick={() => setIsMobileMenuOpen(false)}
              >
                Ver estado
              </a>
            </div>
          </div>
        </>
      )
    }

    return (
      <>
        <div className="mobile-navigation-drawer-header">
          <div>
            <p className="section-kicker">Centro móvil</p>
            <h2>Acceso y contexto</h2>
            <p className="muted-copy">
              El mismo menú móvil sigue visible antes del login para que acceso, reglas
              y arquitectura no queden escondidos.
            </p>
          </div>

          <button
            className="button ghost mobile-navigation-close"
            onClick={() => setIsMobileMenuOpen(false)}
            type="button"
          >
            Cerrar
          </button>
        </div>

        <div className="mobile-navigation-group">
          <p className="section-kicker">Inicio</p>
          <div className="mobile-navigation-list">
            <a
              className="mobile-navigation-button"
              href="#login-panel"
              onClick={() => setIsMobileMenuOpen(false)}
            >
              <strong>Acceso</strong>
              <span>Ir al formulario de inicio de sesión.</span>
            </a>
            <a
              className="mobile-navigation-button"
              href="#collector-rules-panel"
              onClick={() => setIsMobileMenuOpen(false)}
            >
              <strong>Reglas</strong>
              <span>Revisar restricciones antes de operar en este dispositivo.</span>
            </a>
          </div>
        </div>

        <div className="mobile-navigation-group">
          <p className="section-kicker">Acciones</p>
          <div className="mobile-navigation-actions">
            <a
              className="button primary"
              href="#login-panel"
              onClick={() => setIsMobileMenuOpen(false)}
            >
              Entrar
            </a>
          </div>
        </div>
      </>
    )
  }

  async function handleSignIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!runtime || !supabaseClient) {
      setRuntimeError('Supabase no está configurado en este entorno.')
      return
    }

    setIsSigningIn(true)
    setRuntimeError(null)
    setNotice(null)

    try {
      await runtime.signInWithPassword(supabaseClient, {
        email: loginEmail,
        password: loginPassword,
      })
      setLoginPassword('')
      setSyncMessage('Sesión abierta. Cargando cartera...')
    } catch (error) {
      setRuntimeError(extractOperationalError(error))
    } finally {
      setIsSigningIn(false)
    }
  }

  function handleSelectLoanFromQuickSearch(loanId: string) {
    // Esta seleccion reutiliza la cartera ya visible por ruta.
    // El selector hace su propia busqueda interna, asi que limpiamos el texto libre
    // para no dejar el expediente elegido oculto por un filtro viejo.
    setSearchTerm('')
    setSelectedLoanId(loanId)
    setActiveMobilePane('detail')
  }

  async function handleRefreshWorkspace() {
    setNotice(null)
    await runRefreshOperationalWorkspace('manual')
  }

  function handleRetryConfirmedReceipt() {
    setPaymentReversalError(null)
    setConfirmedReceiptLookupState((currentState) => ({
      paymentId: currentState.paymentId,
      status: 'idle',
    }))
    setReceiptReloadToken((currentToken) => currentToken + 1)
  }

  async function handleReverseConfirmedReceipt(reversalReason: string) {
    if (!runtime || !paymentReversalTransport || !receiptPayment || !receiptRemotePaymentId) {
      setRuntimeError('No hay un comprobante confirmado listo para reversar.')
      return
    }

    setIsReversingConfirmedReceipt(true)
    setPaymentReversalError(null)
    setRuntimeError(null)
    setNotice(null)

    try {
      const reversedReceipt = await paymentReversalTransport.reversePayment({
        paymentId: receiptRemotePaymentId,
        reversalReason,
      })

      await runtime.reconcileLocalPaymentReceipt(
        receiptPayment.id,
        reversedReceipt,
        {
          db: runtime.localDb,
        },
      )

      startTransition(() => {
        setConfirmedReceiptsByPaymentId((currentReceipts) => ({
          ...currentReceipts,
          [reversedReceipt.paymentId]: reversedReceipt,
        }))
        setConfirmedReceiptLookupState({
          paymentId: reversedReceipt.paymentId,
          status: 'idle',
        })
      })

      await runRefreshOperationalWorkspace('manual')
      setNotice('Pago reversado y cartera remota restaurada.')
    } catch (error) {
      setPaymentReversalError(extractOperationalError(error))
    } finally {
      setIsReversingConfirmedReceipt(false)
    }
  }

  async function handleSubmitPayment() {
    if (!workspace?.profile || !selectedLoan || !paymentPreview || paymentPreview.error) {
      setRuntimeError(paymentPreview?.error ?? 'No hay un préstamo listo para cobrar.')
      return
    }

    setIsSubmittingPayment(true)
    setRuntimeError(null)
    setNotice(null)

    try {
      if (!runtime) {
        throw new Error('operational_runtime_not_ready')
      }

      const coordinates = await runtime.readBestEffortCoordinates()
      const payment = await runtime.enqueueOfflinePayment(
        {
          applications: paymentPreview.applications,
          // El pago siempre debe viajar con el collectorId real del préstamo visible.
          // Si admin opera una cartera agregada, usar su propio profile.id reabre
          // `loan_collector_mismatch` y rompe la trazabilidad del caso.
          collectorId: selectedLoan.loan.collectorId,
          customerId: selectedLoan.customer.id,
          deviceLocalId: crypto.randomUUID(),
          latitude: coordinates?.latitude,
          loanId: selectedLoan.loan.id,
          longitude: coordinates?.longitude,
          notes: normalizeOptionalText(paymentNotes),
          paymentApplicationMode: paymentPreview.paymentApplicationMode,
          paidAt: new Date().toISOString(),
          paymentReference: normalizeOptionalText(paymentReference),
        },
        {
          db: runtime.localDb,
        },
      )

      setReceiptPaymentId(payment.localPaymentId)
      setConfirmedReceiptLookupState(emptyConfirmedReceiptLookupState)
      setAmountInput('')
      setPaymentReference('')
      setPaymentNotes('')
      setIsOperationsSheetOpen(true)
      setActiveOperationsPane('receipt')
      setNotice('Cobro registrado en la cola local. Se sincronizará al recuperar conectividad.')

      await runRefreshOperationalWorkspace('payment')
    } catch (error) {
      setRuntimeError(extractOperationalError(error))
    } finally {
      setIsSubmittingPayment(false)
    }
  }

  async function handleRetryQueueItem(queueId: number, entityName: SyncQueueEntityName) {
    setRuntimeError(null)
    setNotice(null)

    try {
      if (!runtime) {
        throw new Error('operational_runtime_not_ready')
      }

      if (entityName === 'collection_action') {
        await runtime.retryFailedCollectionActionSyncQueueItem(queueId, {
          db: runtime.localDb,
        })
        setNotice('La gestión fallida quedó marcada para reintento.')
      } else {
        await runtime.retryFailedSyncQueueItem(queueId, {
          db: runtime.localDb,
        })
        setNotice('El cobro fallido quedó marcado para reintento.')
      }

      await runRefreshOperationalWorkspace('retry')
    } catch (error) {
      setRuntimeError(extractOperationalError(error))
    }
  }

  async function handleSignOut() {
    if (!runtime || !supabaseClient) {
      return
    }

    if (queueSnapshot.pending > 0 || queueSnapshot.failed > 0 || queueSnapshot.processing > 0) {
      setRuntimeError(
        'No cierres sesión con eventos sin resolver. Corrige la cola para no perder trazabilidad.',
      )
      return
    }

    setIsSigningOut(true)
    setRuntimeError(null)
    setNotice(null)

    try {
      await runtime.signOutBrowserSession(supabaseClient)
      await runtime.clearCollectorOperationalCache(runtime.localDb)
      await loadLocalWorkspace(null)
      setReceiptPaymentId(null)
      setConfirmedReceiptsByPaymentId({})
      setConfirmedReceiptLookupState(emptyConfirmedReceiptLookupState)
      setReceiptReloadToken(0)
      setSearchTerm('')
      setSelectedRouteLabel('all')
      setSelectedLoanId(null)
      setActiveMobilePane('portfolio')
      setIsOperationsSheetOpen(false)
      setActiveOperationsPane('payment')
      setAmountInput('')
      setCollectionActionNotes('')
      setCollectionFollowUpDate('')
      setPaymentReference('')
      setPaymentNotes('')
      setNotice('Sesión cerrada y caché operativa limpiada en este dispositivo.')
    } catch (error) {
      setRuntimeError(extractOperationalError(error))
    } finally {
      setIsSigningOut(false)
    }
  }

  async function handleRecordCollectionAction(outcome: CollectionActionOutcome) {
    if (!runtime || !workspace?.profile || !selectedLoan || !sessionUserId) {
      setRuntimeError('Selecciona un préstamo antes de registrar una gestión de visita.')
      return
    }

    if (requiresCollectionFollowUp(runtime, outcome) && !collectionFollowUpDate) {
      setRuntimeError('Define una fecha de seguimiento para esta gestión.')
      return
    }

    setRuntimeError(null)
    setNotice(null)

    try {
      const coordinates = await runtime.readBestEffortCoordinates()

      await runtime.enqueueOfflineCollectionAction(
        {
          // La gestión local queda asociada al collector dueño del préstamo,
          // no necesariamente al usuario autenticado que está supervisando la shell.
          collectorId: selectedLoan.loan.collectorId,
          customerId: selectedLoan.customer.id,
          deviceLocalId: crypto.randomUUID(),
          followUpAt: collectionFollowUpDate || undefined,
          latitude: coordinates?.latitude,
          loanId: selectedLoan.loan.id,
          longitude: coordinates?.longitude,
          notes: normalizeOptionalText(collectionActionNotes),
          outcome,
          recordedAt: new Date().toISOString(),
        },
        {
          db: runtime.localDb,
        },
      )

      await loadLocalWorkspace(sessionUserId)
      setCollectionActionNotes('')
      setCollectionFollowUpDate('')
      setIsOperationsSheetOpen(true)
      setActiveOperationsPane('management')
      setNotice(`Gestión "${describeCollectionActionOutcome(runtime, outcome)}" registrada en la cola local.`)
      await runRefreshOperationalWorkspace('retry')
    } catch (error) {
      setRuntimeError(extractOperationalError(error))
    }
  }

  function handleOriginationCompleted(payload: OriginationCompletedPayload) {
    setRuntimeError(null)
    const canManagementWorkspaceSeeLoan = roleCapabilities.canReadAggregateWorkspace
    const canFocusOriginatedLoan =
      payload.assignedCollectorId === sessionUserId || canManagementWorkspaceSeeLoan

    const visibilityMessage =
      payload.assignedCollectorId === sessionUserId
        ? 'La cartera local se alineará ahora para enfocar el préstamo nuevo.'
        : canManagementWorkspaceSeeLoan
          ? `El caso quedó asignado a ${payload.assignedCollectorName}; la vista de administración lo mostrará al refrescar la cartera.`
          : `El caso quedó asignado a ${payload.assignedCollectorName}; el cobrador lo verá al refrescar su cartera.`

    setNotice(`${payload.message} ${visibilityMessage}`)
    // Tras una originación exitosa, la UI debe salir del wizard aunque el préstamo
    // pertenezca a otra cartera. En móvil se cierra el overlay; en desktop el panel
    // persistente vuelve a la operación base y desmonta el estado de éxito del wizard.
    setActiveOperationsPane('payment')
    setIsOperationsSheetOpen(false)

    if (!canFocusOriginatedLoan) {
      return
    }

    void (async () => {
      try {
        await runRefreshOperationalWorkspace('manual')
        setSelectedRouteLabel('all')
        setSearchTerm(payload.externalLoanNumber)
        setSelectedLoanId(payload.loanId)
        setActiveMobilePane('detail')
      } catch (error) {
        setRuntimeError(extractOperationalError(error))
      }
    })()
  }

  return (
    <main className="ops-shell has-mobile-menu" role="main">
      <button
        aria-hidden="true"
        className={`mobile-menu-backdrop ${isMobileMenuOpen ? 'open' : ''}`}
        onClick={() => setIsMobileMenuOpen(false)}
        tabIndex={-1}
        type="button"
      />

      <header className="mobile-shell-header">
        <div className="mobile-shell-copy">
          <p className="section-kicker" aria-hidden="true">{mobileShellKicker}</p>
          <h1 className="mobile-shell-title">{mobileShellTitle}</h1>
          <span className="mobile-shell-description">{mobileShellDescription}</span>
        </div>

        <button
          aria-controls="mobile-navigation-drawer"
          aria-expanded={isMobileMenuOpen}
          aria-label={isMobileMenuOpen ? 'Cerrar menú' : 'Abrir menú'}
          className={`mobile-menu-toggle ${isMobileMenuOpen ? 'open' : ''}`}
          onClick={handleToggleMobileMenu}
          type="button"
        >
          <span />
          <span />
          <span />
        </button>
      </header>

      <aside
        id="mobile-navigation-drawer"
        aria-label="Menú de navegación principal"
        aria-hidden={!isMobileMenuOpen}
        className={`mobile-navigation-drawer ${isMobileMenuOpen ? 'open' : ''}`}
      >
        {renderMobileNavigationDrawerContent()}
      </aside>

      <section className={sessionUserId ? 'dashboard-header' : 'hero-panel'} aria-labelledby="hero-heading">
        <div className="hero-copy">
          {sessionUserId ? (
            <>
              <p className="eyebrow" aria-hidden="true">
                {isProfileAlignmentBlocked ? 'Acceso bloqueado' : 'Resumen operativo'}
              </p>
              <h2 id="hero-heading">
                {isProfileAlignmentBlocked ? 'Perfil operativo pendiente' : 'Panel de Control'}
              </h2>
              {isProfileAlignmentBlocked && (
                <p className="lead">
                  La cuenta aún no tiene el perfil remoto mínimo para operar.
                </p>
              )}
            </>
          ) : (
            <>
              <p className="eyebrow" aria-hidden="true">{env.appName}</p>
              <h2 id="hero-heading">Gestión Inteligente de Cartera</h2>
              <p className="lead">
                Operación profesional sin conexión, con trazabilidad financiera y sincronización controlada.
              </p>
            </>
          )}

          {/* El hero solo expone acciones operativas cuando existe sesion autenticada.
              Riesgo: reintroducir CTAs o estado de runtime en la vista publica vuelve a prometer operacion
              antes de que Auth y el bootstrap remoto confirmen el contexto real del cobrador/admin. */}
          {sessionUserId && (
            <div className="hero-actions">
              <button
                className="button primary"
                onClick={handleRefreshWorkspace}
                disabled={!dbReady || !authReady || isRefreshing}
              >
                {isRefreshing ? 'Revisando...' : isProfileAlignmentBlocked ? 'Revisar' : 'Actualizar'}
              </button>
              {isProfileAlignmentBlocked ? (
                <button
                  className="button secondary"
                  disabled={isSigningOut}
                  onClick={() => void handleSignOut()}
                  type="button"
                >
                  {isSigningOut ? 'Cerrando...' : 'Cerrar sesión'}
                </button>
              ) : canAccessOrigination && (
                <button
                  className="button secondary"
                  onClick={() => {
                    setIsOperationsSheetOpen(true)
                    setActiveOperationsPane('origination')
                  }}
                  type="button"
                >
                  Nuevo Crédito
                </button>
              )}
            </div>
          )}
        </div>

          {sessionUserId && !isProfileAlignmentBlocked && dashboardMetrics.length > 0 && (
            <div className="hero-metrics" role="region" aria-label="Indicadores clave">
              {dashboardMetrics.map((metric) => (
                <article key={metric.label} className={`metric-card ${metric.tone}`}>
                  <span className="metric-label">{metric.label}</span>
                  <strong>{metric.value}</strong>
                </article>
              ))}
            </div>
          )}
      </section>

      {/* La tira de estado sigue leyendo runtime real, pero solo se renderiza con sesion activa
          para no duplicar en la portada publica indicadores que dependen de cartera/sync autenticados. */}
      {sessionUserId && !isProfileAlignmentBlocked && (
        <section className="status-strip" aria-label="Estado del sistema">
          {runtimeCards.map((card) => (
            <article key={card.label} className={`status-pill ${card.tone}`}>
              <span className="status-indicator" />
              <div className="status-pill-content">
                <span className="metric-label">{card.label}</span>
                <strong>{card.value}</strong>
              </div>
            </article>
          ))}
        </section>
      )}

      {runtimeError && (
        <section className="banner danger" role="alert">
          <strong>Atención</strong>
          <span>{runtimeError}</span>
        </section>
      )}

      {notice && (
        <section className="banner success" role="status">
          <strong>Operación</strong>
          <span>{notice}</span>
        </section>
      )}

      {!hasSupabaseEnv ? (
        <section className="content-grid">
          <article id="collector-setup-panel" className="panel">
            <header className="panel-heading">
              <p className="section-kicker">Entorno</p>
              <h2>Configuración requerida</h2>
            </header>
            <p className="muted-copy">
              Faltan `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` en el entorno.
            </p>
            <a className="button secondary" href="/docs/mcp-setup.md">
              Guía de configuración
            </a>
          </article>
        </section>
      ) : !dbReady || !authReady ? (
        <section className="content-grid">
          <article id="collector-bootstrap-panel" className="panel">
            <header className="panel-heading">
              <p className="section-kicker">Arranque</p>
              <h2>Sincronizando sistema</h2>
            </header>
            <p className="muted-copy">
              Abriendo base de datos local y restaurando sesión segura...
            </p>
          </article>
        </section>
      ) : !sessionUserId ? (
        <section className="content-grid auth-layout">
          <article id="login-panel" className="panel">
            <header className="panel-heading">
              <p className="section-kicker">Acceso</p>
              <h2>Iniciar sesión</h2>
            </header>
            <form className="login-form" onSubmit={handleSignIn}>
              <label className="field">
                <span>Correo electrónico</span>
                <input
                  className="input"
                  autoComplete="email"
                  inputMode="email"
                  type="email"
                  value={loginEmail}
                  onChange={(event) => setLoginEmail(event.target.value)}
                  placeholder="ejemplo@empresa.com"
                  required
                />
              </label>
              <label className="field">
                <span>Contraseña</span>
                <input
                  className="input"
                  autoComplete="current-password"
                  type="password"
                  value={loginPassword}
                  onChange={(event) => setLoginPassword(event.target.value)}
                  placeholder="••••••••"
                  required
                />
              </label>
              <button className="button primary" disabled={isSigningIn} type="submit">
                {isSigningIn ? 'Validando...' : 'Entrar'}
              </button>
            </form>
          </article>

          <article className="panel">
            <header className="panel-heading">
              <p className="section-kicker">Información</p>
              <h2>Seguridad Operativa</h2>
            </header>
            <ul className="list">
              <li>Cifrado SSL de punta a punta.</li>
              <li>Validación de celdas por RLS.</li>
              <li>Identidad de dispositivo única por cobro.</li>
            </ul>
          </article>
        </section>
      ) : isProfileAlignmentBlocked ? (
        <section className="content-grid">
          <article id="profile-alignment-panel" className="panel">
            <header className="panel-heading">
              <p className="section-kicker">Acceso bloqueado</p>
              <h2>Perfil operativo pendiente</h2>
            </header>
            <p className="muted-copy">
              La sesión existe, pero no hay un perfil remoto alineado.
            </p>
            <ul className="list compact">
              <li>Administrador manual: alinear `app_metadata.role` y `public.profiles` en Supabase.</li>
              <li>Cobrador: crear la cuenta desde la web con el flujo seguro.</li>
              <li>Después, reingresar para refrescar el JWT.</li>
            </ul>
            <div className="hero-actions">
              <button
                className="button primary"
                disabled={!dbReady || !authReady || isRefreshing}
                onClick={handleRefreshWorkspace}
                type="button"
              >
                {isRefreshing ? 'Revisando...' : 'Revisar'}
              </button>
              <button
                className="button secondary"
                disabled={isSigningOut}
                onClick={() => void handleSignOut()}
                type="button"
              >
                {isSigningOut ? 'Cerrando...' : 'Cerrar sesión'}
              </button>
            </div>
          </article>
        </section>
      ) : (
        <div className="ops-grid">
          <article
            className={`panel portfolio-panel workspace-pane ${activeMobilePane === 'portfolio' ? 'is-active' : ''}`}
            aria-hidden={activeMobilePane !== 'portfolio'}
          >
            <header className="panel-heading compact">
              <div>
                <p className="section-kicker">Cartera diaria</p>
                <h2>{workspace?.profile?.fullName ?? 'Usuario'}</h2>
              </div>
            </header>

            <div className="search-row">
              <input
                className="input"
                type="search"
                placeholder="Buscar cliente, documento o dirección..."
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                aria-label="Buscar en cartera"
              />
              <span className="pill" aria-live="polite">{filteredLoanCards.length} préstamos</span>
            </div>

            {filteredLoanCards.length > 0 && (
              <Suspense fallback={null}>
                <J
                  cards={filteredLoanCards}
                  onPick={handleSelectLoanFromQuickSearch}
                  value={resolvedSelectedLoanId}
                />
              </Suspense>
            )}

            {routeBoard.routes.length > 0 && (
              <>
                <div className="route-board-header">
                  <strong>Ruta operativa: {formatDate(routeBoard.businessDate)}</strong>
                </div>

                <div className="route-focus-grid" role="region" aria-label="Resumen del día">
                  <article className="focus-card danger">
                    <span>Vencidos</span>
                    <strong>{routeBoard.metrics.overdueLoanCount}</strong>
                  </article>
                  <article className="focus-card warning">
                    <span>Hoy</span>
                    <strong>{routeBoard.metrics.dueTodayLoanCount}</strong>
                  </article>
                  <article className="focus-card pending">
                    <span>Pendientes de envío</span>
                    <strong>{routeBoard.metrics.failedSyncLoanCount}</strong>
                  </article>
                </div>

                <div className="field route-filter-select">
                  <span>Zona</span>
                  <Suspense fallback={null}>
                    <Z
                      onPickRoute={setSelectedRouteLabel}
                      routes={routeBoard.routes}
                      totalOpenLoanCount={routeBoard.metrics.openLoanCount}
                      value={resolvedSelectedRouteLabel}
                    />
                  </Suspense>
                </div>
              </>
            )}

            {filteredLoanCards.length === 0 && (
              <div className="empty-state" role="status">
                <strong>Sin resultados</strong>
                <p>No se encontraron préstamos que coincidan con los filtros actuales.</p>
              </div>
            )}
          </article>

          <article
            className={`panel loan-detail-panel workspace-pane ${activeMobilePane === 'detail' ? 'is-active' : ''}`}
            aria-hidden={activeMobilePane !== 'detail'}
          >
            {selectedLoan ? (
              <>
                <header className="panel-heading compact">
                  <div>
                    <p className="section-kicker">Detalle del Cliente</p>
                    <h2>{selectedLoan.customer.fullName}</h2>
                  </div>
                  <div className="header-actions">
                    <button
                      className="button primary"
                      onClick={() => {
                        setIsOperationsSheetOpen(true)
                        setActiveOperationsPane('payment')
                      }}
                      type="button"
                    >
                      Cobrar
                    </button>
                  </div>
                </header>

                <div className="detail-grid">
                  <article className="detail-card">
                    <span>Saldo Pendiente</span>
                    <strong>{formatCurrency(selectedLoan.outstandingAmount, selectedLoan.loan.currencyCode, env.defaultLocale)}</strong>
                  </article>
                  <article className="detail-card">
                    <span>Estado</span>
                    <strong>{describeLoanStatus(selectedLoan.loan.status)}</strong>
                  </article>
                  <article className="detail-card">
                    <span>Préstamo</span>
                    <strong>{selectedLoan.loan.externalLoanNumber ?? selectedLoan.loan.id}</strong>
                  </article>
                  <article className="detail-card">
                    <span>Vencimiento</span>
                    <strong>{selectedLoan.nextDueDate ? formatDate(selectedLoan.nextDueDate) : 'Sin saldo'}</strong>
                  </article>
                </div>

                <div className="borrower-strip">
                  <span aria-label="Préstamo">{selectedLoan.loan.externalLoanNumber ?? 'Sin consecutivo'}</span>
                  <span aria-label="Ruta">{selectedLoan.routeLabel}</span>
                  <span aria-label="Identificación">{selectedLoan.customer.governmentId}</span>
                  <span aria-label="Teléfono">{selectedLoan.customer.phone}</span>
                </div>

                <div className="preview-box">
                  <strong>Condiciones del Crédito</strong>
                  <p>
                    {formatLoanFrequencyLabel(selectedLoan.loan.paymentFrequency)} ·{' '}
                    {selectedLoan.loan.totalInstallments ?? selectedLoan.installments.length} cuota(s) · desembolso{' '}
                    {selectedLoan.loan.disbursementDate ? formatDate(selectedLoan.loan.disbursementDate) : 'sin fecha'}
                  </p>
                  <small>
                    Primera cuota {selectedLoan.loan.firstDueDate ? formatDate(selectedLoan.loan.firstDueDate) : 'sin fecha'} ·
                    originado {selectedLoan.loan.originatedAt ? formatDateTime(selectedLoan.loan.originatedAt) : 'sin marca'}
                  </small>
                </div>

                <div className="installment-list" aria-label="Plan de pagos">
                  {selectedLoan.installments.map((installment) => (
                    <article key={installment.id} className={`installment-row ${installment.status}`}>
                      <div>
                        <strong>Cuota {installment.installmentNumber}</strong>
                        <span>{formatDate(installment.dueDate)}</span>
                      </div>
                      <div className="installment-amounts">
                        <strong>{formatCurrency(installment.outstandingAmount, selectedLoan.loan.currencyCode, env.defaultLocale)}</strong>
                      </div>
                      <span className={`chip ${installment.status === 'overdue' ? 'danger' : 'neutral'}`}>
                        {describeInstallmentStatus(installment.status)}
                      </span>
                    </article>
                  ))}
                </div>
              </>
            ) : (
              <div className="empty-state">
                <strong>Sin selección</strong>
                <p>Elige un cliente de la cartera para ver su historial y opciones de cobro.</p>
              </div>
            )}
          </article>

          <button
            aria-hidden="true"
            className={`operations-backdrop ${isOperationsSheetOpen ? 'open' : ''}`}
            onClick={() => setIsOperationsSheetOpen(false)}
            tabIndex={-1}
            type="button"
          />

          <aside
            className={`side-stack operations-sheet ${isOperationsSheetOpen ? 'open' : ''}`}
            aria-label="Panel de operaciones"
            aria-hidden={!isOperationsSheetVisible}
            inert={!isOperationsSheetVisible}
          >
            {/* §WHY: Marcador visual de arrastre para reforzar UX de App Nativa en móviles */}
            <div className="sheet-handle" aria-hidden="true" />
            <header className="operations-sheet-header">
              <div>
                <p className="section-kicker">
                  {activeOperationsPane === 'origination' ? 'Nuevo Crédito' : 'Operación'}
                </p>
                <h2>
                  {activeOperationsPane === 'origination'
                    ? 'Alta de Cliente y Crédito'
                    : selectedLoan
                      ? selectedLoan.customer.fullName
                      : 'Centro operativo'}
                </h2>
              </div>
              <button
                className="button ghost operations-sheet-close"
                onClick={() => setIsOperationsSheetOpen(false)}
                type="button"
                aria-label="Cerrar operaciones"
              >
                Cerrar
              </button>
            </header>

            {/* §NO-ROMPER: Ocultamos el menú principal en Originación para ganar espacio vertical y evitar triple cabecera en móvil */}
            {activeOperationsPane !== 'origination' && (
              <nav className="operations-menu" aria-label="Opciones operativas">
                {operationsPaneItems.map((paneItem) => (
                  <button
                    key={paneItem.key}
                    aria-current={activeOperationsPane === paneItem.key ? 'page' : undefined}
                    className={`operations-menu-button ${activeOperationsPane === paneItem.key ? 'selected' : ''}`}
                    onClick={() => setActiveOperationsPane(paneItem.key)}
                    type="button"
                  >
                    <strong>{paneItem.label}</strong>
                    <span>{paneItem.description}</span>
                  </button>
                ))}
              </nav>
            )}

            <div className="operations-content">
              {activeOperationsPane === 'payment' && (
                <article className="panel">
                  <header className="panel-heading">
                    <p className="section-kicker">Cobro</p>
                    <h2>Aplicar Pago</h2>
                  </header>

                  {selectedLoan ? (
                    <div className="login-form">
                      <div className="preview-box">
                        <strong>Modalidad de Pago</strong>
                        <p>
                          {selectedLoan.loan.interestMode === 'compound_fixed_installment'
                            ? 'Interés compuesto V2'
                            : 'V1 simple'}{' '}
                          · {describePaymentApplicationMode(selectedLoanPaymentApplicationMode)}
                        </p>
                      </div>

                      <div className="quick-actions">
                        <button
                          className="button ghost"
                          onClick={() => setAmountInput(selectedLoanModeCurrentAmount)}
                          type="button"
                        >
                          Cuota de hoy
                        </button>
                        <button
                          className="button ghost"
                          onClick={() => setAmountInput(selectedLoanModeOutstandingAmount)}
                          type="button"
                        >
                          Saldo total
                        </button>
                      </div>

                      <label className="field">
                        <span>Monto a recibir</span>
                        <CurrencyAmountInput
                          inputMode="decimal"
                          locale={env.defaultLocale}
                          placeholder="0"
                          value={amountInput}
                          onValueChange={setAmountInput}
                        />
                      </label>

                      {paymentPreview?.applications.length ? (
                        <div className="preview-box">
                          <strong>Desglose del abono</strong>
                          <ul className="list compact">
                            {paymentPreview.applications.map((app) => (
                              <li key={app.installmentId}>
                                <span>{resolvePaymentPreviewInstallmentLabel(selectedLoan.installments, app.installmentId)}</span>
                                <small>
                                  {describePaymentApplicationPreview(app, paymentPreview.paymentApplicationMode, selectedLoan.loan.currencyCode)}
                                </small>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}

                      <button
                        className="button primary full"
                        disabled={!amountInput || isSubmittingPayment}
                        onClick={handleSubmitPayment}
                        type="button"
                      >
                        {isSubmittingPayment ? 'Registrando...' : 'Confirmar Cobro'}
                      </button>
                    </div>
                  ) : (
                    <div className="empty-state">
                      <p>Selecciona un préstamo para habilitar el cobro.</p>
                    </div>
                  )}
                </article>
              )}

              {activeOperationsPane === 'origination' && (
                <Suspense fallback={<DeferredOperationsPanel message="Cargando nuevo crédito..." />}>
                  <OriginationWizardPanel
                    isOnline={isOnline}
                    profile={workspace?.profile}
                    supabaseClient={supabaseClient}
                    onOriginated={handleOriginationCompleted}
                  />
                </Suspense>
              )}

              {activeOperationsPane === 'management' && (
                <>
                  {roleCapabilities.canAccessCollectorManagement ? (
                    <article className="panel">
                      <header className="panel-heading">
                        <p className="section-kicker">Administración</p>
                        <h2>Cobradores</h2>
                      </header>

                      <Suspense fallback={<DeferredOperationsPanel message="Cargando gestión de cobradores..." />}>
                        <CollectorManagementPanel
                          isOnline={isOnline}
                          profile={workspace?.profile}
                          supabaseClient={supabaseClient}
                        />
                      </Suspense>
                    </article>
                  ) : null}

                  <article className="panel">
                    <header className="panel-heading">
                      <p className="section-kicker">Gestión</p>
                      <h2>Bitácora de visita</h2>
                    </header>

                    {selectedLoan ? (
                      <div className="login-form">
                        <div className="management-actions">
                          {COLLECTION_ACTION_OUTCOMES.map((outcome) => (
                            <button
                              key={outcome}
                              className={`button ghost management-button ${describeCollectionActionTone(runtime, outcome)}`}
                              onClick={() => void handleRecordCollectionAction(outcome)}
                              type="button"
                            >
                              {describeCollectionActionOutcome(runtime, outcome)}
                            </button>
                          ))}
                        </div>

                        <label className="field">
                          <span>Observaciones</span>
                          <textarea
                            className="input textarea"
                            placeholder="Observaciones de la visita..."
                            value={collectionActionNotes}
                            onChange={(event) => setCollectionActionNotes(event.target.value)}
                          />
                        </label>
                      </div>
                    ) : (
                      <div className="empty-state">
                        <p>Selecciona un préstamo para registrar gestión.</p>
                      </div>
                    )}
                  </article>
                </>
              )}

              {activeOperationsPane === 'reports' && (
                <article className="panel">
                  <header className="panel-heading">
                    <p className="section-kicker">Supervisión</p>
                    <h2>Reportes Operativos</h2>
                  </header>

                  <Suspense fallback={<DeferredOperationsPanel message="Cargando reportes operativos..." />}>
                    <ReportPanel
                      isOnline={isOnline}
                      profile={workspace?.profile}
                      queueSnapshot={queueSnapshot}
                      transport={reportTransport}
                    />
                  </Suspense>
                </article>
              )}

              {activeOperationsPane === 'receipt' && (
                <article className="panel">
                  <header className="panel-heading">
                    <p className="section-kicker">Recibo</p>
                    <h2>Último Recibo</h2>
                  </header>

                  {receiptPayment ? (
                    <Suspense fallback={<div className="empty-state"><p>Cargando comprobante...</p></div>}>
                      <ReceiptPanel
                        bluetoothStrategy={bluetoothReceiptStrategy}
                        canReversePayments={roleCapabilities.canReversePayments}
                        confirmedReceipt={confirmedReceipt}
                        isOnline={isOnline}
                        isReversingConfirmedReceipt={isReversingConfirmedReceipt}
                        loanCards={workspace?.loanCards ?? []}
                        lookupState={effectiveConfirmedReceiptLookupState}
                        onReverseConfirmedReceipt={handleReverseConfirmedReceipt}
                        onRetryConfirmedReceipt={handleRetryConfirmedReceipt}
                        payment={receiptPayment}
                        reverseError={paymentReversalError}
                      />
                    </Suspense>
                  ) : (
                    <div className="empty-state">
                      <p>No hay pagos registrados recientemente.</p>
                    </div>
                  )}
                </article>
              )}

              {activeOperationsPane === 'queue' && (
                <article className="panel">
                  <header className="panel-heading">
                    <p className="section-kicker">Sincronización</p>
                    <h2>Cola de Envío</h2>
                  </header>

                  {workspace?.queueEntries.length ? (
                    <div className="queue-list">
                      {workspace.queueEntries.map((entry) => (
                        <article key={entry.queueItem.clientEventId} className="queue-row">
                          <div className="queue-row-copy">
                            <strong>
                              {entry.customer?.fullName
                                || (entry.collectionAction ? 'Gestión de visita' : 'Cobro')}
                            </strong>
                            <p className="muted-copy compact">{describeQueueRow(runtime, entry)}</p>
                          </div>
                          <div className="queue-actions">
                            <span className={`chip ${entry.queueItem.status === 'failed' ? 'danger' : 'pending'}`}>
                              {describePaymentSyncStatus(entry.queueItem.status as LocalPayment['syncStatus'])}
                            </span>
                            {entry.queueItem.status === 'failed' && entry.queueItem.id && (
                              <button
                                className="button ghost"
                                onClick={() => handleRetryQueueItem(entry.queueItem.id!, entry.queueItem.entityName)}
                                type="button"
                              >
                                Reintentar
                              </button>
                            )}
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <div className="empty-state">
                      <p>Todo está sincronizado.</p>
                    </div>
                  )}
                </article>
              )}

              {activeOperationsPane === 'rules' && (
                <article className="panel">
                  <header className="panel-heading">
                    <p className="section-kicker">Contrato</p>
                    <h2>Reglas de Operación</h2>
                  </header>
                  <ul className="list compact">
                    <li>`paidAt`: {PAYMENT_OPERATIONAL_REQUIREMENTS.paidAt}</li>
                    <li>`applications`: {PAYMENT_OPERATIONAL_REQUIREMENTS.applications}</li>
                    <li>`deviceLocalId`: {PAYMENT_OPERATIONAL_REQUIREMENTS.deviceLocalId}</li>
                    <li>`gps`: {PAYMENT_OPERATIONAL_REQUIREMENTS.gps}</li>
                    <li>`receipt`: {PAYMENT_OPERATIONAL_REQUIREMENTS.receipt}</li>
                  </ul>
                </article>
              )}
            </div>
          </aside>
        </div>
      )}
    </main>
  )
}

function describeCollectionActionOutcome(
  runtime: OperationalRuntime | null,
  outcome: CollectionActionOutcome,
) {
  return runtime?.describeCollectionActionOutcome(outcome) ?? outcome
}

function DeferredOperationsPanel({ message }: { message: string }) {
  return (
    <article className="panel">
      <div className="empty-state">
        <p>{message}</p>
      </div>
    </article>
  )
}

function describeCollectionActionTone(
  runtime: OperationalRuntime | null,
  outcome: CollectionActionOutcome,
) {
  return runtime?.describeCollectionActionTone(outcome) ?? 'neutral'
}

function requiresCollectionFollowUp(
  runtime: OperationalRuntime | null,
  outcome: CollectionActionOutcome,
) {
  return runtime?.requiresCollectionFollowUp(outcome) ?? (outcome === 'promise_to_pay' || outcome === 'return_visit')
}

function describeQueueRow(
  runtime: OperationalRuntime | null,
  entry: CollectorWorkspaceSnapshot['queueEntries'][number],
) {
  if (entry.payment) {
    return `${formatCurrency(entry.payment.totalAmount, env.defaultCurrency, env.defaultLocale)} · ${formatDateTime(entry.payment.paidAt)}`
  }

  if (entry.collectionAction) {
    return `${describeCollectionActionOutcome(runtime, entry.collectionAction.outcome)} · ${formatDateTime(entry.collectionAction.createdAt)}`
  }

  return 'Pendiente de procesar'
}

function describePaymentApplicationMode(paymentApplicationMode: LoanPaymentApplicationMode) {
  const paymentApplicationModeMap: Record<LoanPaymentApplicationMode, string> = {
    oldest_first: 'Abono por antigüedad',
    principal_only: 'Abono solo a capital',
    interest_only: 'Abono solo a interés',
  }

  return paymentApplicationModeMap[paymentApplicationMode]
}

function resolvePaymentModeOutstandingAmount(
  installments: LocalInstallment[],
  paymentApplicationMode: LoanPaymentApplicationMode,
  fallbackOutstandingAmount: string,
) {
  if (paymentApplicationMode === 'oldest_first') {
    return fallbackOutstandingAmount
  }

  return sumMoney(
    installments.map((installment) => getInstallmentTargetOutstandingAmount(installment, paymentApplicationMode)),
  ).toFixed(2)
}

function resolveCurrentModeInstallmentAmount(
  installments: LocalInstallment[],
  paymentApplicationMode: LoanPaymentApplicationMode,
  fallbackOutstandingAmount: string,
) {
  if (paymentApplicationMode === 'oldest_first') {
    return installments[0]?.outstandingAmount ?? fallbackOutstandingAmount
  }

  const firstTargetInstallment = [...installments]
    .filter((installment) => {
      return (
        installment.status !== 'paid'
        && installment.status !== 'canceled'
        && toMoney(getInstallmentTargetOutstandingAmount(installment, paymentApplicationMode)).gt(0)
      )
    })
    .sort((leftInstallment, rightInstallment) => {
      if (leftInstallment.dueDate !== rightInstallment.dueDate) {
        return leftInstallment.dueDate.localeCompare(rightInstallment.dueDate)
      }

      if (leftInstallment.installmentNumber !== rightInstallment.installmentNumber) {
        return leftInstallment.installmentNumber - rightInstallment.installmentNumber
      }

      return leftInstallment.id.localeCompare(rightInstallment.id)
    })
    .at(0)

  return firstTargetInstallment
    ? getInstallmentTargetOutstandingAmount(firstTargetInstallment, paymentApplicationMode)
    : '0.00'
}

function getInstallmentTargetOutstandingAmount(
  installment: Pick<
    LocalInstallment,
    'outstandingAmount' | 'outstandingInterestAmount' | 'outstandingPrincipalAmount'
  >,
  paymentApplicationMode: LoanPaymentApplicationMode,
) {
  switch (paymentApplicationMode) {
    case 'principal_only':
      return installment.outstandingPrincipalAmount
    case 'interest_only':
      return installment.outstandingInterestAmount
    case 'oldest_first':
      return installment.outstandingAmount
  }
}

function describePaymentApplicationPreview(
  application: PaymentApplicationDraft,
  paymentApplicationMode: LoanPaymentApplicationMode,
  currencyCode: string,
) {
  switch (paymentApplicationMode) {
    case 'principal_only':
      return `Capital ${formatCurrency(application.principalComponent ?? '0.00', currencyCode, env.defaultLocale)}`
    case 'interest_only':
      return `Interés ${formatCurrency(application.interestComponent ?? '0.00', currencyCode, env.defaultLocale)}`
    case 'oldest_first':
      return [
        `Total ${formatCurrency(application.appliedAmount, currencyCode, env.defaultLocale)}`,
        `Capital ${formatCurrency(application.principalComponent ?? '0.00', currencyCode, env.defaultLocale)}`,
        `Interés ${formatCurrency(application.interestComponent ?? '0.00', currencyCode, env.defaultLocale)}`,
      ].join(' · ')
  }
}

function resolvePaymentPreviewInstallmentLabel(
  installments: Pick<LocalInstallment, 'id' | 'installmentNumber'>[],
  installmentId: string,
) {
  const installmentNumber = installments.find((installment) => installment.id === installmentId)?.installmentNumber
  return installmentNumber ? `Cuota ${installmentNumber}` : 'Cuota no identificada'
}

function describeLoanStatus(status: string) {
  const statusMap: Record<string, string> = {
    draft: 'Borrador',
    active: 'Activo',
    delinquent: 'Mora',
    settled: 'Pagado',
    written_off: 'Incobrable',
    canceled: 'Cancelado',
  }
  return statusMap[status] || status
}

function describeInstallmentStatus(status: string) {
  const statusMap: Record<string, string> = {
    pending: 'Pendiente',
    partial: 'Parcial',
    paid: 'Pagado',
    overdue: 'Vencido',
    canceled: 'Cancelado',
  }
  return statusMap[status] || status
}

function describePaymentSyncStatus(syncStatus: LocalPayment['syncStatus']) {
  const statusMap: Record<string, string> = {
    failed: 'Fallido',
    pending: 'Pendiente',
    processing: 'Enviando',
    synced: 'Sincronizado',
  }
  return statusMap[syncStatus] || syncStatus
}

function describeReceiptPaneStatus(payment: LocalPayment) {
  if (payment.syncStatus === 'synced' && payment.remotePaymentId && payment.remotePaymentStatus === 'reversed') {
    return 'Recibo reversado'
  }

  if (payment.syncStatus === 'synced' && payment.remotePaymentId) {
    return 'Recibo confirmado'
  }

  if (payment.syncStatus === 'synced') {
    return 'Sin id remoto'
  }

  return describePaymentSyncStatus(payment.syncStatus)
}

function extractOperationalError(error: unknown) {
  if (error instanceof Error) return translateOperationalError(error.message)
  return 'Error de sistema no identificado.'
}

function translateOperationalError(message: string) {
  const knownMessages: Record<string, string> = {
    'Auth session missing!': 'Sesión expirada. Inicia de nuevo.',
    'Invalid login credentials': 'Credenciales inválidas.',
    authentication_required: 'La sesión ya no está autenticada para cargar el recibo.',
    collector_not_allowed: 'Sin permisos de cobro.',
    collection_action_follow_up_invalid: 'La fecha de seguimiento debe usar YYYY-MM-DD.',
    collection_action_follow_up_required: 'La gestión seleccionada exige fecha de seguimiento.',
    collection_action_outcome_invalid: 'La novedad de visita no es valida.',
    customer_archived: 'El deudor ya fue archivado y no admite gestión remota.',
    customer_collector_mismatch: 'El deudor no coincide con el cobrador asignado a la gestión.',
    customer_not_found: 'El deudor no está disponible localmente.',
    device_local_id_conflict: 'El identificador local ya está siendo usado por otro evento.',
    device_local_id_required: 'Falta el identificador local del evento.',
    installment_not_found_for_payment: 'El reverso no encontró una de las cuotas históricas del pago.',
    installment_not_reversible: 'La cuota afectada ya no puede restaurarse con este reverso.',
    invalid_applied_amount: 'Monto inválido.',
    invalid_payment_receipt: 'El servidor devolvió un recibo inválido.',
    loan_collector_mismatch: 'El préstamo no coincide con el cobrador esperado.',
    loan_customer_mismatch: 'El préstamo no coincide con el deudor seleccionado.',
    loan_not_found: 'Préstamo no disponible localmente.',
    loan_status_not_payable: 'Estado no cobrable.',
    loan_status_not_reversible: 'El préstamo ya no admite reverso en su estado actual.',
    loan_without_payable_installments: 'Sin cuotas pendientes.',
    operator_inactive: 'Tu perfil está inactivo y no puede registrar eventos.',
    payment_id_required: 'Falta el identificador remoto del recibo.',
    payment_not_found: 'El recibo confirmado no está disponible para esta sesión.',
    payment_amount_exceeds_loan_outstanding: 'El monto excede el saldo.',
    payment_without_applications: 'El pago no tiene aplicaciones materializadas para restaurar saldo.',
    recorded_at_required: 'Falta la fecha real en que ocurrió la visita.',
    reversal_actor_inactive: 'Tu perfil está inactivo y no puede registrar eventos.',
    reversal_actor_role_not_allowed: 'Solo un administrador activo puede reversar pagos.',
    reversal_exceeds_scheduled_amount: 'El reverso intentó restaurar un saldo mayor al valor programado de la cuota.',
    reversal_reason_required: 'Debes registrar un motivo antes de reversar el pago.',
    reverse_role_not_allowed: 'Solo un administrador activo puede reversar pagos.',
    sign_in_credentials_required: 'Correo y contraseña requeridos.',
  }
  return knownMessages[message] ?? message
}

function normalizeOptionalText(value: string) {
  const trimmed = value.trim()
  return trimmed || undefined
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat(env.defaultLocale, {
    day: '2-digit',
    month: 'short',
    timeZone: FINANCIAL_BASELINE.businessTimezone,
  }).format(new Date(`${date}T00:00:00`))
}

function formatDateTime(timestamp: string) {
  return new Intl.DateTimeFormat(env.defaultLocale, {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    timeZone: FINANCIAL_BASELINE.businessTimezone,
  }).format(new Date(timestamp))
}

function formatLoanFrequencyLabel(paymentFrequency?: string) {
  switch (paymentFrequency) {
    case 'daily':
      return 'Frecuencia diaria'
    case 'weekly':
      return 'Frecuencia semanal'
    case 'biweekly':
      return 'Frecuencia quincenal'
    case 'monthly':
      return 'Frecuencia mensual'
    default:
      return 'Frecuencia no informada'
  }
}

export default App
