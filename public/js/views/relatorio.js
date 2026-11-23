import { api } from '../api.js';
import { h, mount, field, fmtMoney, fmtMonth, fmtQty, handleSubmit, toast, pageHead, btn } from '../dom.js';
import { icon } from '../icons.js';

let months = 6;

/** Média mensal de perdas, contando a partir do primeiro mês com algum registro. */
export function averageLoss(monthly) {
  const start = monthly.findIndex((m) => m.lossCount > 0 || m.salesValue > 0 || m.recoveredValue > 0);
  if (start === -1) return null;
  const used = monthly.slice(start);
  return used.reduce((s, m) => s + m.lossValue, 0) / used.length;
}

export function pctText(pct) {
  if (pct == null) return '—';
  if (pct === 0) return 'igual';
  return pct < 0 ? `${Math.abs(pct).toFixed(1).replace('.', ',')}% menor` : `${pct.toFixed(1).replace('.', ',')}% maior`;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

const tone = (pct) => (pct == null ? null : pct < 0 ? 'good' : pct > 0 ? 'bad' : null);

function kpi(label, value, foot, cls = 'slate', iconName = 'coins') {
  return h(
    'div',
    { class: `kpi kpi-sm kpi-${cls}` },
    h('div', { class: 'kpi-top' }, h('span', { class: 'kpi-label' }, label), h('span', { class: 'kpi-icon' }, icon(iconName, 18))),
    h('span', { class: 'kpi-value' }, value),
    foot ? h('span', { class: 'kpi-foot' }, foot) : null,
  );
}

export async function render(main, ctx) {
  const report = await api(`/reports/monthly?months=${months}`);
  const { monthly, baselineMonthlyLoss: baseline } = report;
  const current = monthly.at(-1);
  const avg = averageLoss(monthly);
  const avgVsBaseline = avg != null && baseline ? ((avg - baseline) / baseline) * 100 : null;
  const totalRecovered = monthly.reduce((s, m) => s + m.recoveredValue, 0);
  const totalLoss = monthly.reduce((s, m) => s + m.lossValue, 0);

  const periodSelect = h(
    'select',
    { 'aria-label': 'Período', onchange: (e) => ((months = Number(e.target.value)), render(main, ctx)) },
    [3, 6, 12].map((n) => h('option', { value: n, selected: n === months }, `Últimos ${n} meses`)),
  );

  mount(
    main,
    pageHead(
      'Relatório de perdas',
      'Quanto o mercadinho perdeu com mercadoria vencida e quanto recuperou com promoções.',
      h('span', { class: 'no-print' }, periodSelect),
      btn('Planilha', { iconName: 'download', href: `/api/reports/monthly.csv?months=${months}`, cls: 'btn no-print' }),
      btn('Imprimir', { iconName: 'printer', onclick: () => window.print(), cls: 'btn no-print' }),
    ),
    avgVsBaseline != null && avgVsBaseline < 0
      ? h('div', { class: 'callout', style: null }, icon('trendDown', 22), h('div', null, h('strong', null, `As perdas caíram ${Math.abs(avgVsBaseline).toFixed(0)}% desde que o sistema começou a ser usado.`), h('p', { class: 'small muted' }, `Média de ${fmtMoney(avg)}/mês contra ${fmtMoney(baseline)}/mês antes.`)))
      : null,
    h(
      'section',
      { class: 'kpis section-gap' },
      kpi(`Perdas em ${fmtMonth(current.month)}`, fmtMoney(current.lossValue), current.changeVsPrevMonth != null ? `${pctText(current.changeVsPrevMonth)} que o mês anterior` : 'sem mês anterior para comparar', current.changeVsPrevMonth < 0 ? 'green' : 'red', 'ban'),
      kpi('Média mensal de perdas', avg == null ? '—' : fmtMoney(avg), avgVsBaseline != null ? `${pctText(avgVsBaseline)} que antes do sistema` : 'informe a perda de antes abaixo', avgVsBaseline != null && avgVsBaseline < 0 ? 'green' : 'slate', 'chart'),
      kpi('Total perdido no período', fmtMoney(totalLoss), plural(monthly.reduce((s, m) => s + m.lossCount, 0), 'registro de perda', 'registros de perda'), 'slate', 'coins'),
      kpi('Recuperado com promoções', fmtMoney(totalRecovered), 'vendas de lotes em promoção', 'green', 'percent'),
    ),
    impactCard(report.impact),
    baselineBox(baseline, ctx, () => render(main, ctx)),
    h(
      'section',
      { class: 'card section-gap' },
      h('div', { class: 'card-head' }, h('h2', null, 'Mês a mês')),
      h(
        'div',
        { class: 'table-wrap' },
        h(
          'table',
          { class: 'table' },
          h('thead', null, h('tr', null, ['Mês', 'Perdas', 'Nº perdas', 'Recuperado', 'Vs mês anterior', 'Vs antes do sistema'].map((t, i) => h('th', { class: i > 0 ? 'num' : null }, t)))),
          h(
            'tbody',
            null,
            monthly.map((m) =>
              h(
                'tr',
                { class: m.inUse ? null : 'row-muted', title: m.inUse ? null : 'Antes de o sistema começar a ser usado' },
                h('td', null, h('strong', null, fmtMonth(m.month)), m.inUse ? null : h('span', { class: 'xs muted' }, ' · antes do sistema')),
                h('td', { class: 'num' }, fmtMoney(m.lossValue)),
                h('td', { class: 'num' }, m.lossCount),
                h('td', { class: 'num good' }, fmtMoney(m.recoveredValue)),
                h('td', { class: `num ${tone(m.changeVsPrevMonth) ?? ''}` }, pctText(m.changeVsPrevMonth)),
                h('td', { class: `num ${tone(m.changeVsBaseline) ?? ''}` }, pctText(m.changeVsBaseline)),
              ),
            ),
          ),
        ),
      ),
    ),
    h(
      'div',
      { class: 'grid-2 section-gap' },
      rankCard('Produtos que mais deram perda', report.topLosses, (t) => [h('span', null, t.product, h('span', { class: 'xs muted' }, ` · ${fmtQty(t.quantity)} ${t.unit}`)), h('strong', null, fmtMoney(t.value))]),
      rankCard('Perdas por categoria', report.lossByCategory, (c) => [h('span', null, c.category), h('strong', null, fmtMoney(c.value))]),
    ),
  );
}

/** Impacto econômico do negócio: ligação com a ODS 8 (Trabalho decente e crescimento econômico). */
function impactCard(impact) {
  const metric = (label, value, hint) =>
    h('div', { class: 'fact' }, h('div', { class: 'fact-label' }, label), h('div', { class: 'fact-value' }, value), hint ? h('div', { class: 'xs muted' }, hint) : null);
  const noBase = impact.avoidedLoss == null;
  return h(
    'section',
    { class: 'card card-pad stack section-gap' },
    h('div', { class: 'row' }, h('span', { class: 'ods-badge' }, 'ODS 8'), h('h2', null, 'Impacto econômico do negócio')),
    h(
      'p',
      { class: 'small muted' },
      'Menos mercadoria jogada fora significa mais dinheiro no caixa do pequeno comércio, o que sustenta o negócio e os empregos que ele gera (ODS 8: Trabalho decente e crescimento econômico).',
    ),
    h(
      'div',
      { class: 'facts' },
      metric('Meses com o sistema', impact.monthsInUse || '—'),
      metric('Perdas evitadas', noBase ? '—' : fmtMoney(impact.avoidedLoss), noBase ? 'informe a perda de antes do sistema' : 'em relação a antes do sistema'),
      metric('Receita recuperada', fmtMoney(impact.recovered), 'vendas de lotes em promoção'),
      metric('Projeção em 12 meses', noBase ? '—' : fmtMoney(impact.annualProjection), noBase ? null : 'se o ritmo atual se mantiver'),
    ),
    h('p', { class: 'xs muted' }, 'Valores calculados a partir dos registros do sistema. Perdas evitadas e receita recuperada são mostradas separadas para não contar a mesma mercadoria duas vezes.'),
  );
}

function rankCard(title, rows, render) {
  return h(
    'section',
    { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', null, title)),
    rows.length
      ? h('ol', { class: 'rank' }, rows.map((r, i) => h('li', null, h('span', { class: 'rank-pos' }, i + 1), render(r))))
      : h('p', { class: 'card-body muted' }, 'Nenhuma perda no período.'),
  );
}

function baselineBox(baseline, ctx, onSaved) {
  const text = baseline
    ? `Antes do sistema, o mercadinho perdia em média ${fmtMoney(baseline)} por mês. O relatório mede a redução contra esse valor.`
    : 'Para medir quanto o sistema reduziu as perdas, informe quanto o mercadinho perdia por mês antes de usá-lo (estimativa do dono).';

  if (!ctx.can('settings:write')) return h('p', { class: 'muted small' }, text);

  const form = h(
    'form',
    { class: 'card card-pad stack no-print' },
    h('div', { class: 'form-section-title' }, icon('chart', 18), 'Linha de base: perdas antes do sistema'),
    h('p', { class: 'small muted' }, text),
    h(
      'div',
      { class: 'inline-form' },
      field('Perda média mensal antes (R$)', h('input', { name: 'baseline', type: 'number', step: '0.01', min: '0', value: baseline ?? '', inputmode: 'decimal' })),
      h('button', { class: 'btn', type: 'submit' }, 'Salvar'),
    ),
    h('p', { class: 'form-error', role: 'alert' }),
  );
  handleSubmit(form, async (fd) => {
    const v = fd.get('baseline');
    await api('/reports/settings', { method: 'PUT', body: { baselineMonthlyLoss: v === '' ? null : v } });
    toast('Linha de base salva');
    onSaved();
  });
  return form;
}
