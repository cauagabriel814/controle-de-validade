import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { lastMonths } from '../lib/dates.js';
import { money } from '../lib/validation.js';
import { authorize } from '../middleware/auth.js';

export const router = Router();

const BASELINE_KEY = 'baseline_monthly_loss';

async function getBaseline(): Promise<number | null> {
  const row = await db.one<{ value: string | null }>('SELECT value FROM settings WHERE key = $1', [BASELINE_KEY]);
  return row?.value ? Number(row.value) : null;
}

/** Variação percentual de `from` para `to` (negativo = perdas caíram). */
function pctChange(from: number | null, to: number): number | null {
  if (from === null || from === 0) return null;
  return Math.round(((to - from) / from) * 1000) / 10;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

const query = z.object({ months: z.coerce.number().int().min(1).max(24).default(6) });

async function buildReport(monthsBack: number) {
  const months = lastMonths(monthsBack);
  const from = `${months[0]}-01`;

  const LOSS_JOIN = `FROM movements m
     JOIN lots l ON l.id = m.lot_id
     JOIN products p ON p.id = l.product_id
     JOIN categories c ON c.id = p.category_id
     WHERE m.type = 'perda' AND m.occurred_on >= $1`;

  const [rows, topLosses, lossByCategory, baseline] = await Promise.all([
    db.query<{ month: string; loss_value: number; loss_count: number; recovered_value: number; sales_value: number }>(
      `SELECT to_char(occurred_on, 'YYYY-MM') AS month,
              coalesce(sum(quantity * unit_value) FILTER (WHERE type = 'perda'), 0)              AS loss_value,
              count(*) FILTER (WHERE type = 'perda')::int                                         AS loss_count,
              coalesce(sum(quantity * unit_value) FILTER (WHERE type = 'venda' AND in_promo), 0) AS recovered_value,
              coalesce(sum(quantity * unit_value) FILTER (WHERE type = 'venda'), 0)              AS sales_value
       FROM movements WHERE occurred_on >= $1
       GROUP BY 1`,
      [from],
    ),
    // Rankings: sempre limitados (top 10)
    db.query(
      `SELECT p.name AS product, c.name AS category, sum(m.quantity) AS quantity, p.unit,
              round(sum(m.quantity * m.unit_value), 2) AS value
       ${LOSS_JOIN}
       GROUP BY p.id, c.name ORDER BY value DESC, quantity DESC LIMIT 10`,
      [from],
    ),
    db.query(
      `SELECT c.name AS category, round(sum(m.quantity * m.unit_value), 2) AS value
       ${LOSS_JOIN}
       GROUP BY c.id ORDER BY value DESC LIMIT 10`,
      [from],
    ),
    getBaseline(),
  ]);

  const byMonth = new Map(rows.map((r) => [r.month, r]));
  // Meses antes do primeiro registro = sistema ainda não era usado: sem comparação
  // (senão apareceria "100% menor" só por não haver dados).
  const firstActive = months.findIndex((m) => byMonth.has(m));
  let prev: number | null = null;
  const monthly = months.map((month, i) => {
    const r = byMonth.get(month);
    const loss = round2(r?.loss_value ?? 0);
    const inUse = firstActive !== -1 && i >= firstActive;
    const item = {
      month,
      inUse,
      lossValue: loss,
      lossCount: r?.loss_count ?? 0,
      recoveredValue: round2(r?.recovered_value ?? 0),
      salesValue: round2(r?.sales_value ?? 0),
      changeVsPrevMonth: inUse && i > firstActive ? pctChange(prev, loss) : null,
      changeVsBaseline: inUse ? pctChange(baseline, loss) : null,
    };
    prev = loss;
    return item;
  });

  return { baselineMonthlyLoss: baseline, monthly, topLosses, lossByCategory, impact: economicImpact(monthly, baseline) };
}

/**
 * Impacto econômico (ODS 8: Trabalho decente e crescimento econômico).
 * Só conta os meses em que o sistema já estava em uso. "Perdas evitadas" compara
 * com a linha de base informada pelo dono; sem ela, fica null (não inventamos número).
 * Perdas evitadas e receita recuperada são mostradas separadas para não somar duas vezes
 * a mesma mercadoria.
 */
export function economicImpact(monthly: { inUse: boolean; lossValue: number; recoveredValue: number }[], baseline: number | null) {
  const used = monthly.filter((m) => m.inUse);
  const monthsInUse = used.length;
  const lossInUse = round2(used.reduce((s, m) => s + m.lossValue, 0));
  const recovered = round2(used.reduce((s, m) => s + m.recoveredValue, 0));
  const avoidedLoss = baseline !== null && monthsInUse > 0 ? round2(baseline * monthsInUse - lossInUse) : null;
  const annualProjection = avoidedLoss !== null ? round2((avoidedLoss / monthsInUse) * 12) : null;
  return { monthsInUse, lossInUse, recovered, avoidedLoss, annualProjection };
}

router.get('/monthly', authorize('reports:read'), async (req, res) => {
  const { months } = query.parse(req.query);
  res.json(await buildReport(months));
});

router.get('/monthly.csv', authorize('reports:read'), async (req, res) => {
  const { months } = query.parse(req.query);
  const { monthly } = await buildReport(months);
  const num = (n: number | null) => (n === null ? '' : String(n).replace('.', ','));
  const lines = [
    'Mês;Perdas (R$);Nº de perdas;Recuperado em promoção (R$);Vendas registradas (R$);Variação vs mês anterior (%);Variação vs antes do sistema (%)',
    ...monthly.map((m) =>
      [m.month, num(m.lossValue), m.lossCount, num(m.recoveredValue), num(m.salesValue), num(m.changeVsPrevMonth), num(m.changeVsBaseline)].join(';'),
    ),
  ];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="relatorio-perdas.csv"');
  // BOM para o Excel abrir os acentos corretamente.
  res.send('﻿' + lines.join('\r\n'));
});

router.get('/settings', authorize('reports:read'), async (_req, res) => {
  res.json({ baselineMonthlyLoss: await getBaseline() });
});

const settingsSchema = z.object({ baselineMonthlyLoss: money.nullable() });

router.put('/settings', authorize('settings:write'), async (req, res) => {
  const { baselineMonthlyLoss } = settingsSchema.parse(req.body);
  await db.run(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    [BASELINE_KEY, baselineMonthlyLoss == null ? null : String(baselineMonthlyLoss)],
  );
  res.json({ baselineMonthlyLoss: await getBaseline() });
});
