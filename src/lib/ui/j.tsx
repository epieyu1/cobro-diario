import type { OperationalLoanCard } from '@/lib/collector/collector-route-board.ts'
import { SearchableSelect, type SearchableSelectOption } from '@/lib/ui/searchable-select.tsx'
import '@/lib/ui/searchable-select.css'

interface JProps {
  cards: OperationalLoanCard[]
  onPick: (loanId: string) => void
  value: string | null
}

export default function J({ cards, onPick, value }: JProps) {
  // Intencion: ofrecer un salto puntual dentro de la cartera ya visible sin abrir
  // otra fuente de datos ni duplicar la logica principal de filtros del panel.
  // Flujo: routeBoard filtrado en App -> opciones resumidas para mobile -> seleccion abre detalle.
  // Riesgo: este selector no debe sustituir la busqueda libre ni ampliar permisos;
  // solo resume la misma cartera que ya paso por RLS y por el filtro de ruta activo.
  const options: SearchableSelectOption[] = cards.map((loanCard) => ({
    label: loanCard.customer.fullName,
    sublabel: [
      loanCard.customer.governmentId,
      loanCard.loan.externalLoanNumber,
      loanCard.routeLabel,
    ]
      .filter((part): part is string => Boolean(part))
      .join(' · '),
    value: loanCard.loan.id,
  }))

  return (
    <SearchableSelect
      className="portfolio-jump-select"
      emptyLabel="No hay préstamos visibles en esta ruta"
      onChange={onPick}
      options={options}
      placeholder="Saltar a cliente o préstamo"
      searchPlaceholder="Buscar cliente, documento, ruta o consecutivo..."
      value={value ?? ''}
    />
  )
}
