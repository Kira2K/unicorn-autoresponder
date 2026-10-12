export type Compensation = { min: number; max?: number; currency: string; period: 'hour' | 'day' | 'week' | 'month' | 'year'; hoursPerWeek?: number; daysPerWeek?: number; net?: boolean }
export type ExchangeRates = { asOf: string; source: string; usdPerUnit: Record<string, number> }
/** Arithmetic only. The salary threshold and range acceptance policy stay in the selection skill. */
export function monthlyUsd(pay: Compensation, rates?: ExchangeRates) {
  const unknown = (reason: string) => ({ status: 'unknown' as const, min: undefined, max: undefined, reason })
  if (pay.net) return unknown('Net-to-gross tax basis is not supplied')
  if (!Number.isFinite(pay.min) || pay.min < 0 || !Number.isFinite(pay.max ?? pay.min) || (pay.max ?? pay.min) < pay.min) return unknown('Invalid salary range')
  const rate = pay.currency.toUpperCase() === 'USD' ? 1 : rates?.usdPerUnit[pay.currency.toUpperCase()]
  if (!rate || !Number.isFinite(rate) || rate <= 0) return unknown('Recorded currency conversion unavailable')
  if (pay.currency.toUpperCase() !== 'USD' && (!rates?.source?.trim() || !Number.isFinite(Date.parse(rates.asOf)))) return unknown('Dated exchange-rate provenance is required')
  const factor = pay.period === 'year' ? 1 / 12 : pay.period === 'month' ? 1 : pay.period === 'week' ? 52 / 12 : pay.period === 'hour' ? (pay.hoursPerWeek ?? 0) * 52 / 12 : (pay.daysPerWeek ?? 0) * 52 / 12
  if (!Number.isFinite(factor) || factor <= 0) return unknown('Working hours/days are not specified')
  return { status: 'normalized' as const, min: pay.min * rate * factor, max: (pay.max ?? pay.min) * rate * factor,
    evidence: { original: pay, factor, rate, rateDate: pay.currency.toUpperCase() === 'USD' ? null : rates!.asOf, rateSource: pay.currency.toUpperCase() === 'USD' ? null : rates!.source } }
}
