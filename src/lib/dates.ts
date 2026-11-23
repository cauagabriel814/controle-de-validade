import { config } from '../config.js';

// 'sv-SE' formata como AAAA-MM-DD, o mesmo formato salvo no banco.
const dayFmt = new Intl.DateTimeFormat('sv-SE', { timeZone: config.timeZone });

export function today(): string {
  return dayFmt.format(new Date());
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Últimos `count` meses terminando no mês atual, ex.: ['2026-06', ..., '2026-11']. */
export function lastMonths(count: number): string[] {
  const [y, m] = today().split('-').map(Number) as [number, number];
  const months: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    months.push(d.toISOString().slice(0, 7));
  }
  return months;
}
