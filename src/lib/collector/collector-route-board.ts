import type { CollectorLoanCard } from '@/lib/collector/collector-workspace.ts'
import { FINANCIAL_BASELINE } from '@/lib/finance/financial-config.ts'
import { toMoney } from '@/lib/finance/money.ts'

export type OperationalPriority = 'sync-failed' | 'overdue' | 'due-today' | 'scheduled' | 'settled'

export type OperationalLoanCard = CollectorLoanCard & {
  isOpen: boolean
  priority: OperationalPriority
  priorityLabel: string
  priorityNote: string
  routeLabel: string
}

export type RouteSummary = {
  dueTodayCount: number
  failedSyncCount: number
  highestPriority: OperationalPriority
  highestPriorityLabel: string
  loanCount: number
  openCount: number
  overdueCount: number
  routeLabel: string
}

export type CollectorRouteBoard = {
  businessDate: string
  cards: OperationalLoanCard[]
  metrics: {
    dueTodayLoanCount: number
    failedSyncLoanCount: number
    openLoanCount: number
    overdueLoanCount: number
  }
  routes: RouteSummary[]
}

export function buildCollectorRouteBoard(
  loanCards: CollectorLoanCard[],
  options: {
    businessDate?: string
  } = {},
): CollectorRouteBoard {
  // Intencion: producir una vista operativa de ruta/prioridad sin inventar una segunda
  // fuente de verdad distinta a PostgreSQL. Mientras no exista una tabla dedicada de rutas,
  // routeLabel llega del bootstrap remoto y neighborhood solo queda como fallback operativo.
  // Flujo: CollectorLoanCard remoto/cacheado -> lectura de routeLabel actual + fallback compatible -> UI filtra y prioriza cartera.
  // Riesgo: este orden y este agrupamiento siguen siendo provisionales; cuando exista un modelo remoto
  // de rutas mas formal, este derivado debe alinearse o retirarse para no contradecir la fuente transaccional.
  const businessDate = options.businessDate ?? getBusinessDate(FINANCIAL_BASELINE.businessTimezone)
  const cards = loanCards
    .map((loanCard) => mapOperationalLoanCard(loanCard, businessDate))
    .sort(compareOperationalLoanCards)
  const routesByLabel = new Map<string, RouteSummary>()

  for (const loanCard of cards) {
    const currentRouteSummary = routesByLabel.get(loanCard.routeLabel) ?? {
      dueTodayCount: 0,
      failedSyncCount: 0,
      highestPriority: loanCard.priority,
      highestPriorityLabel: loanCard.priorityLabel,
      loanCount: 0,
      openCount: 0,
      overdueCount: 0,
      routeLabel: loanCard.routeLabel,
    }

    currentRouteSummary.loanCount += 1
    currentRouteSummary.openCount += loanCard.isOpen ? 1 : 0
    currentRouteSummary.failedSyncCount += loanCard.failedSyncCount > 0 ? 1 : 0
    currentRouteSummary.overdueCount += loanCard.overdueInstallmentCount > 0 ? 1 : 0
    currentRouteSummary.dueTodayCount += loanCard.nextDueDate === businessDate && loanCard.isOpen ? 1 : 0

    if (getPriorityRank(loanCard.priority) < getPriorityRank(currentRouteSummary.highestPriority)) {
      currentRouteSummary.highestPriority = loanCard.priority
      currentRouteSummary.highestPriorityLabel = loanCard.priorityLabel
    }

    routesByLabel.set(loanCard.routeLabel, currentRouteSummary)
  }

  const routes = [...routesByLabel.values()].sort((leftRoute, rightRoute) => {
    const priorityDifference = getPriorityRank(leftRoute.highestPriority) - getPriorityRank(rightRoute.highestPriority)

    if (priorityDifference !== 0) {
      return priorityDifference
    }

    if (leftRoute.openCount !== rightRoute.openCount) {
      return rightRoute.openCount - leftRoute.openCount
    }

    return leftRoute.routeLabel.localeCompare(rightRoute.routeLabel)
  })

  return {
    businessDate,
    cards,
    metrics: {
      dueTodayLoanCount: cards.filter((loanCard) => loanCard.priority === 'due-today').length,
      failedSyncLoanCount: cards.filter((loanCard) => loanCard.priority === 'sync-failed').length,
      openLoanCount: cards.filter((loanCard) => loanCard.isOpen).length,
      overdueLoanCount: cards.filter((loanCard) => loanCard.priority === 'overdue').length,
    },
    routes,
  }
}

function mapOperationalLoanCard(loanCard: CollectorLoanCard, businessDate: string): OperationalLoanCard {
  const isOpen = toMoney(loanCard.outstandingAmount).gt(0)
  const routeLabel = deriveOperationalRouteLabel(loanCard.customer)
  const priority = deriveOperationalPriority(loanCard, businessDate)

  return {
    ...loanCard,
    isOpen,
    priority,
    priorityLabel: describeOperationalPriority(priority),
    priorityNote: describeOperationalPriorityNote(loanCard, priority, businessDate),
    routeLabel,
  }
}

function deriveOperationalPriority(
  loanCard: CollectorLoanCard,
  businessDate: string,
): OperationalPriority {
  if (loanCard.failedSyncCount > 0) {
    return 'sync-failed'
  }

  if (loanCard.overdueInstallmentCount > 0) {
    return 'overdue'
  }

  if (loanCard.nextDueDate === businessDate && toMoney(loanCard.outstandingAmount).gt(0)) {
    return 'due-today'
  }

  if (loanCard.payableInstallmentCount > 0 && toMoney(loanCard.outstandingAmount).gt(0)) {
    return 'scheduled'
  }

  return 'settled'
}

function deriveOperationalRouteLabel(
  customer: Pick<CollectorLoanCard['customer'], 'address' | 'neighborhood' | 'routeLabel'>,
) {
  const explicitRouteLabel = customer.routeLabel?.trim()

  if (explicitRouteLabel) {
    return explicitRouteLabel
  }

  const explicitNeighborhood = customer.neighborhood?.trim()

  if (explicitNeighborhood) {
    return explicitNeighborhood
  }

  const addressParts = customer.address
    ?.split('·')
    .map((addressPart) => addressPart.trim())
    .filter(Boolean)

  if (addressParts && addressParts.length > 1) {
    return addressParts[addressParts.length - 1]
  }

  return 'Ruta sin zona'
}

function describeOperationalPriority(priority: OperationalPriority) {
  switch (priority) {
    case 'sync-failed':
      return 'Sync fallido'
    case 'overdue':
      return 'Vencido'
    case 'due-today':
      return 'Vence hoy'
    case 'scheduled':
      return 'En curso'
    case 'settled':
      return 'Sin saldo'
    default:
      return priority
  }
}

function describeOperationalPriorityNote(
  loanCard: CollectorLoanCard,
  priority: OperationalPriority,
  businessDate: string,
) {
  switch (priority) {
    case 'sync-failed':
      return `${loanCard.failedSyncCount} cobro(s) con error de sincronizacion`
    case 'overdue':
      return `${loanCard.overdueInstallmentCount} cuota(s) vencida(s)`
    case 'due-today':
      return `La proxima cuota vence ${businessDate}`
    case 'scheduled':
      return `${loanCard.payableInstallmentCount} cuota(s) cobrable(s)`
    case 'settled':
      return 'Prestamo sin saldo operativo pendiente'
    default:
      return priority
  }
}

function getPriorityRank(priority: OperationalPriority) {
  switch (priority) {
    case 'sync-failed':
      return 0
    case 'overdue':
      return 1
    case 'due-today':
      return 2
    case 'scheduled':
      return 3
    case 'settled':
      return 4
    default:
      return 99
  }
}

function compareOperationalLoanCards(
  leftLoanCard: OperationalLoanCard,
  rightLoanCard: OperationalLoanCard,
) {
  const priorityDifference =
    getPriorityRank(leftLoanCard.priority) - getPriorityRank(rightLoanCard.priority)

  if (priorityDifference !== 0) {
    return priorityDifference
  }

  if (leftLoanCard.routeLabel !== rightLoanCard.routeLabel) {
    return leftLoanCard.routeLabel.localeCompare(rightLoanCard.routeLabel)
  }

  if (leftLoanCard.nextDueDate && rightLoanCard.nextDueDate) {
    const dueDateDifference = leftLoanCard.nextDueDate.localeCompare(rightLoanCard.nextDueDate)

    if (dueDateDifference !== 0) {
      return dueDateDifference
    }
  }

  if (leftLoanCard.overdueInstallmentCount !== rightLoanCard.overdueInstallmentCount) {
    return rightLoanCard.overdueInstallmentCount - leftLoanCard.overdueInstallmentCount
  }

  return leftLoanCard.customer.fullName.localeCompare(rightLoanCard.customer.fullName)
}

function getBusinessDate(timeZone: string) {
  const dateParts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone,
    year: 'numeric',
  }).formatToParts(new Date())

  const day = dateParts.find((datePart) => datePart.type === 'day')?.value
  const month = dateParts.find((datePart) => datePart.type === 'month')?.value
  const year = dateParts.find((datePart) => datePart.type === 'year')?.value

  return `${year}-${month}-${day}`
}
