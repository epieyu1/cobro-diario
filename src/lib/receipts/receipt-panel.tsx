import { useEffect, useMemo, useState } from 'react'
import type { CollectorLoanCard } from '@/lib/collector/collector-workspace.ts'
import type { LocalPayment } from '@/lib/db/local-db.ts'
import { env } from '@/lib/env.ts'
import { FINANCIAL_BASELINE } from '@/lib/finance/financial-config.ts'
import { resolvePaymentReversalAvailability } from '@/lib/finance/payment-reversal.ts'
import { formatCurrency } from '@/lib/finance/money.ts'
import { deriveReceiptMetrics } from '@/lib/receipts/receipt-analytics.ts'
import {
  buildConfirmedReceiptPdfFilename,
  createConfirmedReceiptPdfBytes,
} from '@/lib/receipts/receipt-pdf.ts'
import { resolvePaymentReceiptAvailability } from '@/lib/receipts/receipt-status.ts'
import type {
  BluetoothReceiptStrategy,
  ConfirmedPaymentReceipt,
  ConfirmedReceiptLookupState,
} from '@/lib/receipts/receipt-types.ts'

type ReceiptPanelProps = {
  bluetoothStrategy: BluetoothReceiptStrategy | null
  canReversePayments: boolean
  confirmedReceipt?: ConfirmedPaymentReceipt | null
  isOnline: boolean
  isReversingConfirmedReceipt: boolean
  loanCards?: CollectorLoanCard[]
  lookupState: ConfirmedReceiptLookupState
  onReverseConfirmedReceipt: (reason: string) => void
  onRetryConfirmedReceipt: () => void
  payment: LocalPayment
  reverseError?: string | null
}

type PreparedReceiptPdf = {
  actionLabel: string
  filename: string
  file: File | null
  objectUrl: string
  snapshotKey: string
}

type PreparedReceiptPdfError = {
  message: string
  snapshotKey: string
}

export function ReceiptPanel({
  bluetoothStrategy,
  canReversePayments,
  confirmedReceipt,
  isOnline,
  isReversingConfirmedReceipt,
  loanCards = [],
  lookupState,
  onReverseConfirmedReceipt,
  onRetryConfirmedReceipt,
  payment,
  reverseError,
}: ReceiptPanelProps) {
  const [reversalReason, setReversalReason] = useState('')
  const [pdfErrorState, setPdfErrorState] = useState<PreparedReceiptPdfError | null>(null)
  const [preparedPdf, setPreparedPdf] = useState<PreparedReceiptPdf | null>(null)
  const receiptAvailability = resolvePaymentReceiptAvailability(payment)
  const loanCard = confirmedReceipt
    ? loanCards.find((candidate) => candidate.loan.id === confirmedReceipt.loan.id) ?? null
    : null
  const canSubmitReversal = reversalReason.trim().length > 0
  const reversalAvailability = resolvePaymentReversalAvailability({
    isAdmin: canReversePayments,
    isOnline,
    paymentStatus: confirmedReceipt?.status,
  })
  const receiptMetrics = confirmedReceipt ? deriveReceiptMetrics(confirmedReceipt, loanCard) : null
  const confirmedReceiptSnapshot = useMemo(
    () => confirmedReceipt && receiptMetrics
      ? {
          receipt: confirmedReceipt,
          summary: receiptMetrics,
        }
      : null,
    [confirmedReceipt, receiptMetrics],
  )
  const preparedPdfSnapshotKey = confirmedReceiptSnapshot
    ? [
        confirmedReceiptSnapshot.receipt.paymentId,
        confirmedReceiptSnapshot.receipt.status,
        confirmedReceiptSnapshot.summary.loanSnapshot?.currentOutstandingAmount ?? 'no-loan-snapshot',
        confirmedReceiptSnapshot.summary.loanSnapshot?.nextDueDate ?? 'no-next-due',
      ].join(':')
    : null
  const activePreparedPdf = preparedPdfSnapshotKey && preparedPdf?.snapshotKey === preparedPdfSnapshotKey
    ? preparedPdf
    : null
  const activePdfError = preparedPdfSnapshotKey && pdfErrorState?.snapshotKey === preparedPdfSnapshotKey
    ? pdfErrorState.message
    : null
  const isPreparingPdf = Boolean(
    confirmedReceiptSnapshot
      && preparedPdfSnapshotKey
      && !activePreparedPdf
      && !activePdfError,
  )

  useEffect(() => {
    if (!confirmedReceiptSnapshot || !preparedPdfSnapshotKey) {
      return
    }

    if (preparedPdf?.snapshotKey === preparedPdfSnapshotKey) {
      return
    }

    let isActive = true

    // Intencion: dejar el PDF listo apenas llega el comprobante confirmado.
    // Flujo: recibo confirmado -> bytes PDF -> Blob/File -> URL reutilizable para compartir o guardar.
    // Riesgo: si revocamos la URL antes de tiempo, el guardado en movil falla aunque el PDF ya exista.
    void createConfirmedReceiptPdfBytes({
      appName: env.appName,
      locale: env.defaultLocale,
      receipt: confirmedReceiptSnapshot.receipt,
      summary: confirmedReceiptSnapshot.summary,
    })
      .then((bytes) => {
        if (!isActive) {
          return
        }

        const filename = buildConfirmedReceiptPdfFilename(confirmedReceiptSnapshot.receipt)
        const buffer = new ArrayBuffer(bytes.byteLength)
        new Uint8Array(buffer).set(bytes)
        const blob = new Blob([buffer], {
          type: 'application/pdf',
        })
        const file = typeof File === 'function'
          ? new File([blob], filename, {
              type: 'application/pdf',
            })
          : null
        const actionLabel = canShareReceiptPdf(file) ? 'Compartir PDF' : 'Guardar PDF'
        const objectUrl = URL.createObjectURL(blob)

        setPreparedPdf((currentPreparedPdf) => {
          if (currentPreparedPdf?.objectUrl) {
            URL.revokeObjectURL(currentPreparedPdf.objectUrl)
          }

          return {
            actionLabel,
            filename,
            file,
            objectUrl,
            snapshotKey: preparedPdfSnapshotKey,
          }
        })
        setPdfErrorState(null)
      })
      .catch((error) => {
        if (!isActive) {
          return
        }

        setPdfErrorState({
          message: error instanceof Error ? error.message : 'receipt_pdf_generation_failed',
          snapshotKey: preparedPdfSnapshotKey,
        })
      })

    return () => {
      isActive = false
    }
  }, [
    confirmedReceiptSnapshot,
    preparedPdf?.snapshotKey,
    preparedPdfSnapshotKey,
  ])

  useEffect(() => {
    if (!preparedPdf?.objectUrl) {
      return
    }

    return () => {
      URL.revokeObjectURL(preparedPdf.objectUrl)
    }
  }, [preparedPdf?.objectUrl])

  async function handleExportConfirmedReceiptPdf() {
    if (!activePreparedPdf) {
      return
    }

    try {
      if (activePreparedPdf.file && canShareReceiptPdf(activePreparedPdf.file)) {
        await navigator.share({
          files: [activePreparedPdf.file],
          text: `Recibo ${activePreparedPdf.filename}`,
          title: activePreparedPdf.filename,
        })
        return
      }

      const anchor = document.createElement('a')
      anchor.href = activePreparedPdf.objectUrl
      anchor.download = activePreparedPdf.filename
      anchor.click()
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return
      }

      setPdfErrorState({
        message: error instanceof Error ? error.message : 'receipt_pdf_generation_failed',
        snapshotKey: preparedPdfSnapshotKey ?? 'receipt-pdf',
      })
    }
  }

  return (
    <article className="receipt-card" aria-label="Detalle del recibo">
      <div className="receipt-status-card">
        <div className="receipt-status-copy">
          <p className="section-kicker">Estado</p>
          <strong>{receiptAvailability.label}</strong>
          <p className="muted-copy compact">{receiptAvailability.summary}</p>
        </div>
        <span className={`chip ${receiptAvailability.tone}`}>{receiptAvailability.label}</span>
      </div>

      {confirmedReceiptSnapshot ? (
        <div className="receipt-brand-card">
          <div className="receipt-brand-copy">
            <p className="section-kicker">{env.appName}</p>
            <strong>Recibo confirmado</strong>
            <p className="muted-copy compact">
              Recibo {resolveReceiptReference(confirmedReceiptSnapshot.receipt)}
              {' · '}
              {confirmedReceiptSnapshot.receipt.loan.externalLoanNumber || 'sin consecutivo'}
            </p>
          </div>
          <div className="receipt-brand-amount">
            <span>Total pagado</span>
            <strong>
              {formatCurrency(
                confirmedReceiptSnapshot.receipt.totalAmount,
                confirmedReceiptSnapshot.receipt.loan.currencyCode,
                env.defaultLocale,
              )}
            </strong>
          </div>
        </div>
      ) : null}

      <div className="receipt-section">
        <div className="receipt-line">
          <span>Registro local</span>
          <strong>{formatCurrency(payment.totalAmount, env.defaultCurrency, env.defaultLocale)}</strong>
        </div>
        <div className="receipt-line">
          <span>Fecha del cobro</span>
          <strong>{formatDateTime(payment.paidAt)}</strong>
        </div>
        <div className="receipt-line">
          <span>Id local</span>
          <strong>{payment.deviceLocalId}</strong>
        </div>
        <div className="receipt-line">
          <span>Referencia</span>
          <strong>{payment.paymentReference || 'Sin referencia'}</strong>
        </div>
      </div>

      {confirmedReceiptSnapshot ? (
        <div className="report-inline-actions">
          <button
            className="button full"
            disabled={isPreparingPdf || !activePreparedPdf}
            onClick={() => void handleExportConfirmedReceiptPdf()}
            type="button"
          >
            {isPreparingPdf ? 'Preparando PDF...' : activePreparedPdf?.actionLabel || 'Preparando PDF...'}
          </button>
        </div>
      ) : null}

      {activePdfError ? (
        <div className="warn-box inline" role="alert">
          <strong>No fue posible generar el PDF.</strong>
          <p>{activePdfError}</p>
        </div>
      ) : null}

      {receiptAvailability.canRequestConfirmedReceipt ? (
        <>
          {lookupState.status === 'loading' && !confirmedReceipt ? (
            <div className="empty-state">
              <p>Cargando comprobante confirmado desde PostgreSQL...</p>
            </div>
          ) : null}

          {lookupState.status === 'error' ? (
            <div className="warn-box inline" role="alert">
              <strong>No fue posible cargar el recibo.</strong>
              <p>{lookupState.error}</p>
              <button className="button ghost" onClick={onRetryConfirmedReceipt} type="button">
                Reintentar recibo
              </button>
            </div>
          ) : null}

                  {confirmedReceiptSnapshot ? (
            <div className="receipt-section">
              <div
                className={`receipt-status-card ${
                  confirmedReceiptSnapshot.receipt.status === 'reversed'
                    ? 'receipt-status-card-reversed'
                    : 'receipt-status-card-confirmed'
                }`}
              >
                <div className="receipt-status-copy">
                  <p className="section-kicker">Recibo confirmado</p>
                  <strong>{confirmedReceiptSnapshot.receipt.customer.fullName}</strong>
                  <p className="muted-copy compact">
                    Cobro confirmado {confirmedReceiptSnapshot.receipt.paymentId} · {confirmedReceiptSnapshot.receipt.loan.externalLoanNumber || 'sin consecutivo'}
                  </p>
                </div>
                <span className={`chip ${confirmedReceiptSnapshot.receipt.status === 'reversed' ? 'warning' : 'success'}`}>
                  {confirmedReceiptSnapshot.receipt.status === 'reversed' ? 'Reversado' : 'Confirmado'}
                </span>
              </div>

              <div className="receipt-grid">
                <div className="receipt-line">
                  <span>Valor confirmado</span>
                  <strong>
                    {formatCurrency(
                      confirmedReceiptSnapshot.receipt.totalAmount,
                      confirmedReceiptSnapshot.receipt.loan.currencyCode,
                      env.defaultLocale,
                    )}
                  </strong>
                </div>
                <div className="receipt-line">
                  <span>Pagado</span>
                  <strong>{formatDateTime(confirmedReceiptSnapshot.receipt.paidAt)}</strong>
                </div>
                <div className="receipt-line">
                  <span>Cobrador</span>
                  <strong>{confirmedReceiptSnapshot.receipt.collector.fullName || confirmedReceiptSnapshot.receipt.collector.id}</strong>
                </div>
                <div className="receipt-line">
                  <span>Método</span>
                  <strong>{formatPaymentMethod(confirmedReceiptSnapshot.receipt.paymentMethod)}</strong>
                </div>
                <div className="receipt-line">
                  <span>Estado del recibo</span>
                  <strong>{confirmedReceiptSnapshot.receipt.status === 'reversed' ? 'Reversado' : 'Confirmado'}</strong>
                </div>
                <div className="receipt-line">
                  <span>Documento</span>
                  <strong>{confirmedReceiptSnapshot.receipt.customer.governmentId || 'No informado'}</strong>
                </div>
                <div className="receipt-line">
                  <span>Contacto</span>
                  <strong>{confirmedReceiptSnapshot.receipt.customer.phone || 'No informado'}</strong>
                </div>
              </div>

              <div className="receipt-breakdown">
                <div className="receipt-breakdown-header">
                  <strong>Aplicación del pago</strong>
                  <small>Distribución confirmada por servidor</small>
                </div>

                <div className="receipt-grid receipt-grid-compact">
                  <div className="receipt-line">
                    <span>Abono crédito</span>
                    <strong>
                      {formatCurrency(
                        confirmedReceiptSnapshot.summary.principalAppliedAmount,
                        confirmedReceiptSnapshot.receipt.loan.currencyCode,
                        env.defaultLocale,
                      )}
                    </strong>
                  </div>
                  <div className="receipt-line">
                    <span>Abono atrasos</span>
                    <strong>
                      {formatCurrency(
                        confirmedReceiptSnapshot.summary.overdueAppliedAmount,
                        confirmedReceiptSnapshot.receipt.loan.currencyCode,
                        env.defaultLocale,
                      )}
                    </strong>
                  </div>
                  <div className="receipt-line">
                    <span>Abono mora</span>
                    <strong>
                      {formatCurrency(
                        confirmedReceiptSnapshot.summary.feeAppliedAmount,
                        confirmedReceiptSnapshot.receipt.loan.currencyCode,
                        env.defaultLocale,
                      )}
                    </strong>
                  </div>
                  <div className="receipt-line">
                    <span>Abono interés</span>
                    <strong>
                      {formatCurrency(
                        confirmedReceiptSnapshot.summary.interestAppliedAmount,
                        confirmedReceiptSnapshot.receipt.loan.currencyCode,
                        env.defaultLocale,
                      )}
                    </strong>
                  </div>
                </div>
              </div>

              {confirmedReceiptSnapshot.summary.loanSnapshot ? (
                <div className="receipt-breakdown">
                  <div className="receipt-breakdown-header">
                    <strong>Estado actual del crédito</strong>
                    <small>Snapshot operativo del préstamo</small>
                  </div>

                  <div className="receipt-summary-grid">
                    <article className="receipt-summary-card">
                      <span>Saldo actual</span>
                      <strong>
                        {formatCurrency(
                          confirmedReceiptSnapshot.summary.loanSnapshot.currentOutstandingAmount,
                          confirmedReceiptSnapshot.receipt.loan.currencyCode,
                          env.defaultLocale,
                        )}
                      </strong>
                    </article>
                    <article className="receipt-summary-card">
                      <span>Saldo vencido</span>
                      <strong>
                        {formatCurrency(
                          confirmedReceiptSnapshot.summary.loanSnapshot.overdueBreakdown.totalAmount,
                          confirmedReceiptSnapshot.receipt.loan.currencyCode,
                          env.defaultLocale,
                        )}
                      </strong>
                    </article>
                    <article className="receipt-summary-card">
                      <span>Total abonado</span>
                      <strong>
                        {formatCurrency(
                          confirmedReceiptSnapshot.summary.loanSnapshot.totalHistoricalPaidAmount,
                          confirmedReceiptSnapshot.receipt.loan.currencyCode,
                          env.defaultLocale,
                        )}
                      </strong>
                    </article>
                    <article className="receipt-summary-card">
                      <span>Próximo vencimiento</span>
                      <strong>
                        {confirmedReceiptSnapshot.summary.loanSnapshot.nextDueDate
                          ? formatDate(confirmedReceiptSnapshot.summary.loanSnapshot.nextDueDate)
                          : 'Sin saldo pendiente'}
                      </strong>
                    </article>
                  </div>

                  <div className="receipt-summary-grid">
                    <article className="receipt-summary-card">
                      <span>Cuotas pendientes</span>
                      <strong>{confirmedReceiptSnapshot.summary.loanSnapshot.pendingInstallmentCount}</strong>
                    </article>
                    <article className="receipt-summary-card">
                      <span>Cuotas atrasadas</span>
                      <strong>{confirmedReceiptSnapshot.summary.loanSnapshot.overdueInstallmentCount}</strong>
                    </article>
                    <article className="receipt-summary-card">
                      <span>Cuotas pagadas</span>
                      <strong>{confirmedReceiptSnapshot.summary.loanSnapshot.paidInstallmentCount}</strong>
                    </article>
                    <article className="receipt-summary-card">
                      <span>Cuotas pactadas</span>
                      <strong>{confirmedReceiptSnapshot.summary.loanSnapshot.agreedInstallmentCount}</strong>
                    </article>
                  </div>

                  <div className="receipt-grid receipt-grid-compact">
                    <div className="receipt-line">
                      <span>Días de atraso</span>
                      <strong>{confirmedReceiptSnapshot.summary.loanSnapshot.overdueDays}</strong>
                    </div>
                    <div className="receipt-line">
                      <span>Saldo en atraso</span>
                      <strong>
                        {formatCurrency(
                          confirmedReceiptSnapshot.summary.loanSnapshot.overdueBreakdown.totalAmount,
                          confirmedReceiptSnapshot.receipt.loan.currencyCode,
                          env.defaultLocale,
                        )}
                      </strong>
                    </div>
                    <div className="receipt-line">
                      <span>Capital vencido</span>
                      <strong>
                        {formatCurrency(
                          confirmedReceiptSnapshot.summary.loanSnapshot.overdueBreakdown.principalAmount,
                          confirmedReceiptSnapshot.receipt.loan.currencyCode,
                          env.defaultLocale,
                        )}
                      </strong>
                    </div>
                    <div className="receipt-line">
                      <span>Interés vencido</span>
                      <strong>
                        {formatCurrency(
                          confirmedReceiptSnapshot.summary.loanSnapshot.overdueBreakdown.interestAmount,
                          confirmedReceiptSnapshot.receipt.loan.currencyCode,
                          env.defaultLocale,
                        )}
                      </strong>
                    </div>
                    <div className="receipt-line">
                      <span>Mora vencida</span>
                      <strong>
                        {formatCurrency(
                          confirmedReceiptSnapshot.summary.loanSnapshot.overdueBreakdown.feeAmount,
                          confirmedReceiptSnapshot.receipt.loan.currencyCode,
                          env.defaultLocale,
                        )}
                      </strong>
                    </div>
                  </div>
                </div>
              ) : null}

              {confirmedReceiptSnapshot.receipt.reversal ? (
                <div className="warn-box inline" role="status">
                  <strong>Reverso confirmado por servidor</strong>
                  <p>
                    {confirmedReceiptSnapshot.receipt.reversal.reason}
                    {' · '}
                    {formatDateTime(confirmedReceiptSnapshot.receipt.reversal.reversedAt)}
                    {' · '}
                    {confirmedReceiptSnapshot.receipt.reversal.reversedBy.fullName || confirmedReceiptSnapshot.receipt.reversal.reversedBy.id}
                  </p>
                </div>
              ) : null}

              <div className="receipt-breakdown">
                <div className="receipt-breakdown-header">
                  <strong>Aplicaciones por cuota</strong>
                  <small>{confirmedReceiptSnapshot.receipt.applications.length} movimiento(s)</small>
                </div>

                <div className="receipt-application-list">
                  {confirmedReceiptSnapshot.receipt.applications.map((application) => (
                    <article key={application.installmentId} className="receipt-application-row">
                      <div className="receipt-application-copy">
                        <strong>Cuota {application.installmentNumber}</strong>
                        <p className="muted-copy compact">Vence {formatDate(application.dueDate)}</p>
                      </div>
                      <div className="receipt-application-metrics">
                        <span>
                          Total{' '}
                          <strong>
                            {formatCurrency(
                              application.appliedAmount,
                              confirmedReceiptSnapshot.receipt.loan.currencyCode,
                              env.defaultLocale,
                            )}
                          </strong>
                        </span>
                        <span>
                          Capital{' '}
                          <strong>
                            {formatCurrency(
                              application.principalComponent,
                              confirmedReceiptSnapshot.receipt.loan.currencyCode,
                              env.defaultLocale,
                            )}
                          </strong>
                        </span>
                        <span>
                          Interés{' '}
                          <strong>
                            {formatCurrency(
                              application.interestComponent,
                              confirmedReceiptSnapshot.receipt.loan.currencyCode,
                              env.defaultLocale,
                            )}
                          </strong>
                        </span>
                        <span>
                          Mora{' '}
                          <strong>
                            {formatCurrency(
                              application.feeComponent,
                              confirmedReceiptSnapshot.receipt.loan.currencyCode,
                              env.defaultLocale,
                            )}
                          </strong>
                        </span>
                      </div>
                    </article>
                  ))}
                </div>
              </div>

              <div className="receipt-reversal-card">
                <div className="management-heading">
                  <strong>Reverso operativo</strong>
                  <span>{reversalAvailability.summary}</span>
                </div>

                {reversalAvailability.canReverse ? (
                  <>
                    <label className="field">
                      <span>Motivo del reverso</span>
                      <textarea
                        className="input textarea"
                        disabled={isReversingConfirmedReceipt}
                        placeholder="Explica por qué este cobro debe compensarse..."
                        rows={3}
                        value={reversalReason}
                        onChange={(event) => setReversalReason(event.target.value)}
                      />
                    </label>

                    <div className="report-inline-actions">
                      <button
                        className="button secondary receipt-reversal-button"
                        disabled={isReversingConfirmedReceipt || !canSubmitReversal}
                        onClick={() => onReverseConfirmedReceipt(reversalReason)}
                        type="button"
                      >
                        {isReversingConfirmedReceipt ? 'Reversando...' : 'Reversar pago confirmado'}
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="receipt-status-card">
                    <div className="receipt-status-copy">
                      <strong>{reversalAvailability.label}</strong>
                      <p className="muted-copy compact">{reversalAvailability.summary}</p>
                    </div>
                  </div>
                )}

                {reverseError ? (
                  <div className="warn-box inline" role="alert">
                    <strong>No fue posible reversar el pago.</strong>
                    <p>{reverseError}</p>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      {payment.syncErrorMessage ? (
        <div className="warn-box inline" role="alert">
          <strong>Error de sincronización</strong>
          <p>{payment.syncErrorMessage}</p>
        </div>
      ) : null}

      {bluetoothStrategy ? (
        <div className="receipt-strategy-card">
          <p className="section-kicker">Impresión Bluetooth</p>
          <strong>Preparación documentada</strong>
          <p className="muted-copy compact">{bluetoothStrategy.summary}</p>
          <div className="receipt-strategy-metadata">
            <span>Objetivo: {formatBluetoothDeliveryTarget(bluetoothStrategy.deliveryTarget)}</span>
            <span>Estado: {formatBluetoothStrategyStatus(bluetoothStrategy.status)}</span>
            <span>Próximo paso: {formatBluetoothNextGate(bluetoothStrategy.nextGate)}</span>
          </div>
        </div>
      ) : null}
    </article>
  )
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

function formatPaymentMethod(paymentMethod: string) {
  switch (paymentMethod) {
    case 'cash':
      return 'Efectivo'
    default:
      return paymentMethod
  }
}

function formatBluetoothDeliveryTarget(deliveryTarget: BluetoothReceiptStrategy['deliveryTarget']) {
  switch (deliveryTarget) {
    case 'web_bluetooth':
      return 'Web Bluetooth'
  }
}

function formatBluetoothStrategyStatus(status: BluetoothReceiptStrategy['status']) {
  switch (status) {
    case 'deferred':
      return 'Diferido'
  }
}

function formatBluetoothNextGate(nextGate: BluetoothReceiptStrategy['nextGate']) {
  switch (nextGate) {
    case 'manual_smoke_with_supported_printer':
      return 'Prueba manual con impresora compatible'
  }
}

function resolveReceiptReference(receipt: ConfirmedPaymentReceipt) {
  return receipt.paymentReference || `CDR-${receipt.paymentId.slice(0, 8).toUpperCase()}`
}

function canShareReceiptPdf(file: File | null) {
  if (!file || typeof navigator === 'undefined' || typeof navigator.share !== 'function') {
    return false
  }

  if (typeof navigator.canShare === 'function') {
    try {
      return navigator.canShare({
        files: [file],
      })
    } catch {
      return false
    }
  }

  return false
}
