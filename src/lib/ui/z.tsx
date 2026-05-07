import type { RouteSummary } from '@/lib/collector/collector-route-board.ts'
import { SearchableSelect, type SearchableSelectOption } from '@/lib/ui/searchable-select.tsx'
import '@/lib/ui/searchable-select.css'

interface ZProps {
  onPickRoute: (routeLabel: string) => void
  routes: RouteSummary[]
  totalOpenLoanCount: number
  value: string
}

export default function Z({ onPickRoute, routes, totalOpenLoanCount, value }: ZProps) {
  // Intencion: mantener el filtro por zona en la misma fuente de verdad que ya arma el routeBoard,
  // pero con una busqueda desplegable equivalente al selector de clientes.
  // Flujo: routeBoard.routes -> opciones visibles con conteo -> selectedRouteLabel en App.
  // Riesgo: si el conteo o el label salen de otra capa, la zona mostrada deja de coincidir con la cartera filtrada.
  const options: SearchableSelectOption[] = [
    {
      label: 'Toda la cartera',
      sublabel: `${totalOpenLoanCount} préstamos`,
      value: 'all',
    },
    ...routes.map((route) => ({
      label: route.routeLabel,
      sublabel: `${route.loanCount} préstamos`,
      value: route.routeLabel,
    })),
  ]

  return (
    <SearchableSelect
      className="route-search-select"
      emptyLabel="No hay zonas visibles"
      onChange={onPickRoute}
      options={options}
      placeholder="Buscar zona"
      searchPlaceholder="Buscar zona..."
      value={value}
    />
  )
}
