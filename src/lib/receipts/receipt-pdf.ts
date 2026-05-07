import Decimal from 'decimal.js'
import { jsPDF } from 'jspdf'
import type { ReceiptDerivedMetrics } from './receipt-analytics.ts'
import type { ConfirmedPaymentReceipt } from './receipt-types.ts'

type ConfirmedReceiptPdfOptions = {
  appName?: string
  locale?: string
  receipt: ConfirmedPaymentReceipt
  summary: ReceiptDerivedMetrics
}

// Intencion: generar un PDF descargable desde el mismo chunk diferido del recibo, sin subir
// el peso del shell inicial ni abrir una segunda implementacion para el smoke real.
// Flujo: ReceiptPanel o smoke tecnico -> `jspdf` -> bytes PDF -> descarga en navegador o
// escritura en disco temporal. Riesgo: si este helper usa APIs del DOM o acopla JSX, el smoke
// real no podra verificar el mismo contrato que usa la app para exportar el recibo.
export async function createConfirmedReceiptPdfBytes(
  options: ConfirmedReceiptPdfOptions,
): Promise<Uint8Array> {
  const locale = options.locale ?? 'es-CO'
  const appName = options.appName ?? 'Cobro Diario'
  const receiptReference = buildReceiptReference(options.receipt)
  const document = new jsPDF({
    compress: true,
    format: 'a4',
    unit: 'pt',
  })
  const pageHeight = document.internal.pageSize.getHeight()
  const pageWidth = document.internal.pageSize.getWidth()
  const contentWidth = pageWidth - 80
  let cursorY = 48

  const ensureSpace = (requiredHeight: number) => {
    if (cursorY + requiredHeight <= pageHeight - 48) {
      return
    }

    document.addPage()
    cursorY = 48
  }

  const drawDivider = () => {
    document.setDrawColor(200, 202, 198)
    document.line(40, cursorY, pageWidth - 40, cursorY)
    cursorY += 14
  }

  const writeSectionTitle = (title: string) => {
    ensureSpace(24)
    document.setFont('helvetica', 'bold')
    document.setFontSize(11)
    document.setTextColor(28, 62, 54)
    document.text(title.toUpperCase(), 40, cursorY)
    cursorY += 18
  }

  const writeParagraph = (label: string, value: string) => {
    ensureSpace(20)
    document.setFont('helvetica', 'normal')
    document.setFontSize(10)
    document.setTextColor(104, 116, 112)
    document.text(label, 40, cursorY)
    document.setFont('helvetica', 'bold')
    document.setTextColor(32, 42, 39)
    document.text(value, pageWidth - 40, cursorY, { align: 'right' })
    cursorY += 16
  }

  const writeLongRow = (label: string, value: string) => {
    ensureSpace(34)
    document.setFont('helvetica', 'normal')
    document.setFontSize(10)
    document.setTextColor(104, 116, 112)
    document.text(label, 40, cursorY)
    const lines = document.splitTextToSize(value, contentWidth)
    document.setFont('helvetica', 'bold')
    document.setTextColor(32, 42, 39)
    document.text(lines, 40, cursorY + 13)
    cursorY += 18 + lines.length * 11
  }

  document.setFillColor(246, 240, 228)
  document.roundedRect(32, 28, pageWidth - 64, 92, 18, 18, 'F')
  document.setFont('helvetica', 'bold')
  document.setFontSize(20)
  document.setTextColor(24, 52, 45)
  document.text(appName, 48, 58)
  document.setFont('helvetica', 'normal')
  document.setFontSize(11)
  document.setTextColor(104, 116, 112)
  document.text('Recibo digital confirmado por servidor', 48, 76)
  document.setFont('helvetica', 'bold')
  document.setFontSize(12)
  document.setTextColor(24, 52, 45)
  document.text(`Recibo ${receiptReference}`, pageWidth - 48, 58, { align: 'right' })
  document.setFont('helvetica', 'normal')
  document.setFontSize(10)
  document.setTextColor(104, 116, 112)
  document.text(formatDateTime(options.receipt.createdAt, locale), pageWidth - 48, 76, { align: 'right' })
  document.setFont('helvetica', 'bold')
  document.setFontSize(24)
  document.setTextColor(24, 52, 45)
  document.text(
    formatMoney(options.receipt.totalAmount, options.receipt.loan.currencyCode, locale),
    48,
    106,
  )

  cursorY = 146
  writeSectionTitle('Pago confirmado')
  writeParagraph('Cliente', options.receipt.customer.fullName)
  writeParagraph('Cobrador', options.receipt.collector.fullName || options.receipt.collector.id)
  writeParagraph('Fecha de pago', formatDateTime(options.receipt.paidAt, locale))
  writeParagraph('Crédito', options.receipt.loan.externalLoanNumber || options.receipt.loan.id)
  writeParagraph('Método', formatPaymentMethod(options.receipt.paymentMethod))
  writeParagraph('Estado', options.receipt.status === 'reversed' ? 'Reversado' : 'Confirmado')
  writeParagraph(
    'Documento',
    options.receipt.customer.governmentId || 'No informado',
  )
  drawDivider()

  writeSectionTitle('Aplicación del pago')
  writeParagraph(
    'Abono capital',
    formatMoney(options.summary.principalAppliedAmount, options.receipt.loan.currencyCode, locale),
  )
  writeParagraph(
    'Abono atrasos',
    formatMoney(options.summary.overdueAppliedAmount, options.receipt.loan.currencyCode, locale),
  )
  writeParagraph(
    'Abono mora',
    formatMoney(options.summary.feeAppliedAmount, options.receipt.loan.currencyCode, locale),
  )
  writeParagraph(
    'Abono interés',
    formatMoney(options.summary.interestAppliedAmount, options.receipt.loan.currencyCode, locale),
  )
  drawDivider()

  if (options.summary.loanSnapshot) {
    writeSectionTitle('Estado actual del crédito')
    writeParagraph(
      'Saldo actual',
      formatMoney(
        options.summary.loanSnapshot.currentOutstandingAmount,
        options.receipt.loan.currencyCode,
        locale,
      ),
    )
    writeParagraph(
      'Saldo vencido',
      formatMoney(
        options.summary.loanSnapshot.overdueBreakdown.totalAmount,
        options.receipt.loan.currencyCode,
        locale,
      ),
    )
    writeParagraph(
      'Total abonado histórico',
      formatMoney(
        options.summary.loanSnapshot.totalHistoricalPaidAmount,
        options.receipt.loan.currencyCode,
        locale,
      ),
    )
    writeParagraph(
      'Próximo vencimiento',
      options.summary.loanSnapshot.nextDueDate
        ? formatDate(options.summary.loanSnapshot.nextDueDate, locale)
        : 'Sin saldo pendiente',
    )
    writeParagraph('Cuotas pendientes', String(options.summary.loanSnapshot.pendingInstallmentCount))
    writeParagraph('Cuotas atrasadas', String(options.summary.loanSnapshot.overdueInstallmentCount))
    writeParagraph('Cuotas pagadas', String(options.summary.loanSnapshot.paidInstallmentCount))
    writeParagraph('Cuotas pactadas', String(options.summary.loanSnapshot.agreedInstallmentCount))
    writeParagraph('Días de atraso', String(options.summary.loanSnapshot.overdueDays))
    writeParagraph(
      'Saldo en atraso',
      [
        `Capital ${formatMoney(options.summary.loanSnapshot.overdueBreakdown.principalAmount, options.receipt.loan.currencyCode, locale)}`,
        `Interés ${formatMoney(options.summary.loanSnapshot.overdueBreakdown.interestAmount, options.receipt.loan.currencyCode, locale)}`,
        `Mora ${formatMoney(options.summary.loanSnapshot.overdueBreakdown.feeAmount, options.receipt.loan.currencyCode, locale)}`,
      ].join(' · '),
    )
    drawDivider()
  }

  writeSectionTitle('Desglose por cuota')
  for (const application of options.receipt.applications) {
    writeLongRow(
      `Cuota ${application.installmentNumber}`,
      [
        `Vence ${formatDate(application.dueDate, locale)}`,
        `Total ${formatMoney(application.appliedAmount, options.receipt.loan.currencyCode, locale)}`,
        `Capital ${formatMoney(application.principalComponent, options.receipt.loan.currencyCode, locale)}`,
        `Interés ${formatMoney(application.interestComponent, options.receipt.loan.currencyCode, locale)}`,
        `Mora ${formatMoney(application.feeComponent, options.receipt.loan.currencyCode, locale)}`,
      ].join(' · '),
    )
  }

  if (options.receipt.reversal) {
    drawDivider()
    writeSectionTitle('Reverso')
    writeParagraph('Motivo', options.receipt.reversal.reason)
    writeParagraph('Reversado en', formatDateTime(options.receipt.reversal.reversedAt, locale))
    writeParagraph(
      'Reversado por',
      options.receipt.reversal.reversedBy.fullName || options.receipt.reversal.reversedBy.id,
    )
  }

  drawDivider()
  ensureSpace(40)
  document.setFont('helvetica', 'normal')
  document.setFontSize(9)
  document.setTextColor(104, 116, 112)
  document.text(
    'Este PDF conserva el comprobante confirmado del pago y un snapshot operativo del crédito al momento de la descarga.',
    40,
    cursorY,
    {
      maxWidth: contentWidth,
    },
  )

  return new Uint8Array(document.output('arraybuffer'))
}

export function buildConfirmedReceiptPdfFilename(receipt: ConfirmedPaymentReceipt) {
  const receiptReference = buildReceiptReference(receipt)
  const normalizedReference = receiptReference
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return `recibo-${normalizedReference || receipt.paymentId}.pdf`
}

function buildReceiptReference(receipt: ConfirmedPaymentReceipt) {
  return receipt.paymentReference?.trim() || `CDR-${receipt.paymentId.slice(0, 8).toUpperCase()}`
}

function formatDate(date: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: 'short',
    timeZone: 'America/Bogota',
  }).format(new Date(`${date}T00:00:00`))
}

function formatDateTime(timestamp: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    timeZone: 'America/Bogota',
  }).format(new Date(timestamp))
}

function formatMoney(value: Decimal.Value, currency: string, locale: string) {
  const normalizedValue = toMoney(value)
  const normalizedCurrency = currency.toUpperCase()
  const hasMinorUnits = !normalizedValue.mod(1).eq(0)
  const visibleFractionDigits = normalizedCurrency === 'COP' && !hasMinorUnits ? 0 : 2

  return new Intl.NumberFormat(locale, {
    currency: normalizedCurrency,
    currencyDisplay: normalizedCurrency === 'COP' ? 'code' : 'symbol',
    maximumFractionDigits: visibleFractionDigits,
    minimumFractionDigits: visibleFractionDigits,
    style: 'currency',
  }).format(normalizedValue.toNumber())
}

function formatPaymentMethod(paymentMethod: string) {
  switch (paymentMethod) {
    case 'cash':
      return 'Efectivo'
    default:
      return paymentMethod
  }
}

function toMoney(value: Decimal.Value) {
  return new Decimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
}
