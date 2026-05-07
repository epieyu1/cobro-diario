import { describe, expect, it } from 'vitest'
import {
  formatCurrency,
  formatCurrencyInputDisplay,
  normalizeCurrencyInput,
  sumMoney,
  toMoney,
} from '@/lib/finance/money.ts'

describe('money helpers', () => {
  it('rounds using HALF_UP at two decimals', () => {
    expect(toMoney('1.005').toFixed(2)).toBe('1.01')
    expect(toMoney('1.004').toFixed(2)).toBe('1.00')
  })

  it('sums with decimal precision and normalizes the result', () => {
    expect(sumMoney(['0.1', '0.2', '0.3']).toFixed(2)).toBe('0.60')
    expect(sumMoney(['1000.335', '0.335']).toFixed(2)).toBe('1000.67')
  })

  it('shows COP with explicit code while preserving the trailing-zero policy', () => {
    const expectedWholeAmount = new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      currencyDisplay: 'code',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(10000)
    const expected = new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      currencyDisplay: 'code',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(1234.5)

    expect(formatCurrency('10000')).toBe(expectedWholeAmount)
    expect(formatCurrency('1234.5')).toBe(expected)
  })

  it('normalizes lowercase cop before resolving the visible display policy', () => {
    const expectedWholeAmount = new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      currencyDisplay: 'code',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(10000)

    expect(formatCurrency('10000', 'cop')).toBe(expectedWholeAmount)
  })

  it('keeps symbol display for non-COP currencies unless explicitly overridden', () => {
    const expected = new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(1234.5)

    expect(formatCurrency('1234.5', 'USD')).toBe(expected)
  })

  it('normalizes COP inputs without losing the canonical decimal value', () => {
    expect(normalizeCurrencyInput('10000')).toEqual({
      canonical: '10000',
      display: '10.000',
    })
    expect(normalizeCurrencyInput('10000,5')).toEqual({
      canonical: '10000.5',
      display: '10.000,5',
    })
    expect(normalizeCurrencyInput('10000,')).toEqual({
      canonical: '10000',
      display: '10.000,',
    })
    expect(normalizeCurrencyInput('$ 10.000,50')).toEqual({
      canonical: '10000.50',
      display: '10.000,50',
    })
  })

  it('formats canonical amount inputs back to the grouped product display', () => {
    expect(formatCurrencyInputDisplay('10000.00')).toBe('10.000')
    expect(formatCurrencyInputDisplay('10000.50')).toBe('10.000,50')
  })
})
