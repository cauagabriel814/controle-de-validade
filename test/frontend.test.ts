// Funções puras do front-end (rodam no Node, sem navegador).
import { test } from 'node:test';
import assert from 'node:assert/strict';

// @ts-expect-error módulo JS do navegador, sem tipos
const dom = await import('../public/js/dom.js');
// @ts-expect-error módulo JS do navegador, sem tipos
const relatorio = await import('../public/js/views/relatorio.js');
// @ts-expect-error módulo JS do navegador, sem tipos
const vencimentos = await import('../public/js/views/vencimentos.js');
// @ts-expect-error módulo JS do navegador, sem tipos
const painel = await import('../public/js/views/painel.js');

test('expiryStatus classifica e escreve a situação do lote', () => {
  assert.deepEqual(dom.expiryStatus(-1), { level: 'expired', label: 'Venceu ontem' });
  assert.deepEqual(dom.expiryStatus(-4), { level: 'expired', label: 'Venceu há 4 dias' });
  assert.deepEqual(dom.expiryStatus(0), { level: 'danger', label: 'Vence hoje' });
  assert.deepEqual(dom.expiryStatus(1), { level: 'danger', label: 'Vence amanhã' });
  assert.equal(dom.expiryStatus(7).level, 'danger');
  assert.equal(dom.expiryStatus(8).level, 'warn');
  assert.equal(dom.expiryStatus(15).level, 'warn');
  assert.equal(dom.expiryStatus(16).level, 'ok');
});

test('formatação de datas, meses, quantidades e dinheiro em pt-BR', () => {
  assert.equal(dom.fmtDate('2026-11-05'), '05/11/2026');
  assert.equal(dom.fmtDate(null), '—');
  assert.equal(dom.fmtMonth('2026-02'), 'fev/2026');
  assert.equal(dom.fmtQty(1.5), '1,5');
  assert.equal(dom.addDaysIso('2026-12-30', 3), '2027-01-02');
  assert.match(dom.fmtMoney(12.5), /R\$\s?12,50/);
  assert.equal(dom.fmtMoney(null), '—');
});

test('initials pega primeira e última inicial', () => {
  assert.equal(dom.initials('Maria da Silva'), 'MS');
  assert.equal(dom.initials('joão'), 'J');
  assert.equal(dom.initials(''), '?');
});

test('pageNumbers mostra páginas compactas com reticências', () => {
  assert.deepEqual(dom.pageNumbers(1, 5), [1, 2, 3, 4, 5]);
  assert.deepEqual(dom.pageNumbers(1, 12), [1, 2, '…', 12]);
  assert.deepEqual(dom.pageNumbers(6, 12), [1, '…', 5, 6, 7, '…', 12]);
  assert.deepEqual(dom.pageNumbers(12, 12), [1, '…', 11, 12]);
});

test('qs ignora filtros vazios', () => {
  assert.equal(dom.qs({ q: '', days: 5, promo: undefined, expired: false, page: 1 }), 'days=5&page=1');
});

test('períodos da busca viram os parâmetros certos da API', () => {
  assert.deepEqual(vencimentos.periodParams('vencidos'), { expired: 'true' });
  assert.deepEqual(vencimentos.periodParams('5', 0, false), { days: 5, expired: undefined });
  assert.deepEqual(vencimentos.periodParams('10', 0, true), { days: 10, expired: 'true' });
  assert.deepEqual(vencimentos.periodParams('0', 0, false), { days: 0, expired: undefined });
  assert.deepEqual(vencimentos.periodParams('todos'), {});
  assert.deepEqual(vencimentos.periodParams('custom', 45, false), { days: 45, expired: undefined });
});

test('tendência de perdas do painel', () => {
  assert.equal(painel.lossTrend(50, 100), -50);
  assert.equal(painel.lossTrend(150, 100), 50);
  assert.equal(painel.lossTrend(10, 0), null);
});

test('averageLoss ignora os meses antes do sistema começar a ser usado', () => {
  const monthly = [
    { lossValue: 0, lossCount: 0, salesValue: 0, recoveredValue: 0 },
    { lossValue: 0, lossCount: 0, salesValue: 0, recoveredValue: 0 },
    { lossValue: 90, lossCount: 3, salesValue: 0, recoveredValue: 0 },
    { lossValue: 30, lossCount: 1, salesValue: 50, recoveredValue: 20 },
  ];
  assert.equal(relatorio.averageLoss(monthly), 60);
  assert.equal(relatorio.averageLoss(monthly.slice(0, 2)), null);
});

test('pctText descreve aumento e redução', () => {
  assert.equal(relatorio.pctText(-80), '80,0% menor');
  assert.equal(relatorio.pctText(12.5), '12,5% maior');
  assert.equal(relatorio.pctText(0), 'igual');
  assert.equal(relatorio.pctText(null), '—');
});
