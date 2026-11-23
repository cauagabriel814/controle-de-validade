import { api } from '../api.js';
import { h, mount, fmtDate, fmtMoney, emptyState, skeleton, btn } from '../dom.js';
import { icon } from '../icons.js';
import { lotRow } from './lotActions.js';

function greeting(name) {
  const hour = new Date().getHours();
  const hi = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
  return `${hi}, ${name.split(' ')[0]}`;
}

function kpi({ label, value, foot, tone, iconName, href }) {
  return h(
    href ? 'a' : 'div',
    { class: `kpi kpi-${tone}`, href },
    h('div', { class: 'kpi-top' }, h('span', { class: 'kpi-label' }, label), h('span', { class: 'kpi-icon' }, icon(iconName, 18))),
    h('span', { class: 'kpi-value' }, value),
    foot ? h('span', { class: 'kpi-foot' }, foot) : null,
  );
}

export function lossTrend(current, previous) {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 100);
}

export async function render(main, ctx) {
  const dash = await api('/dashboard');
  const urgentEl = h('div', { class: 'lot-list' }, skeleton(4));
  const refresh = () => {
    ctx.refreshBadge?.();
    return render(main, ctx);
  };

  const trend = lossTrend(dash.lossThisMonth, dash.lossPrevMonth);

  mount(
    main,
    h(
      'div',
      { class: 'page-head' },
      h('div', null, h('h1', null, greeting(ctx.user.name)), h('p', { class: 'subtitle' }, `Resumo de hoje, ${fmtDate(dash.today)}`)),
      ctx.can('lots:write') ? h('div', { class: 'actions' }, btn('Nova entrada', { iconName: 'plus', cls: 'btn btn-primary', href: '#/lotes/novo' })) : null,
    ),
    h(
      'section',
      { class: 'kpis', 'aria-label': 'Resumo' },
      kpi({ label: 'Vencidos', value: dash.expired, foot: 'lotes ainda em estoque', tone: 'red', iconName: 'alert', href: '#/vencimentos?f=vencidos' }),
      kpi({ label: 'Vencem em até 7 dias', value: dash.within7, foot: 'hora de fazer promoção', tone: 'orange', iconName: 'hourglass', href: '#/vencimentos?f=7' }),
      kpi({ label: 'Vencem em 8 a 15 dias', value: dash.within15, foot: 'fique de olho', tone: 'amber', iconName: 'clock', href: '#/vencimentos?f=15' }),
      kpi({ label: 'Valor em risco', value: fmtMoney(dash.valueAtRisk), foot: 'vencidos + 7 dias, a preço de custo', tone: 'slate', iconName: 'coins' }),
    ),
    h(
      'div',
      { class: 'dash-grid' },
      h(
        'section',
        { class: 'card' },
        h('div', { class: 'card-head' }, h('h2', null, 'Precisam de atenção'), h('a', { href: '#/vencimentos?f=7&vencidos=1' }, 'Ver todos →')),
        urgentEl,
      ),
      h(
        'div',
        { class: 'side-stack' },
        h(
          'section',
          { class: 'card card-pad stack' },
          h('h2', null, 'Perdas deste mês'),
          h('div', null, h('div', { class: 'metric-big' }, fmtMoney(dash.lossThisMonth)),
            trend === null
              ? h('span', { class: 'muted small' }, 'Sem perdas no mês passado para comparar')
              : h('span', { class: `trend ${trend <= 0 ? 'good' : 'bad'}` }, icon(trend <= 0 ? 'trendDown' : 'trendUp', 16), `${Math.abs(trend)}% ${trend <= 0 ? 'menos' : 'a mais'} que o mês passado`)),
          h(
            'div',
            null,
            h('div', { class: 'metric-row' }, h('span', { class: 'muted' }, 'Mês passado'), h('strong', null, fmtMoney(dash.lossPrevMonth))),
            h('div', { class: 'metric-row' }, h('span', { class: 'muted' }, 'Recuperado com promoções'), h('strong', { class: 'good' }, fmtMoney(dash.recoveredThisMonth))),
            h('div', { class: 'metric-row' }, h('span', { class: 'muted' }, 'Lotes em promoção'), h('strong', null, dash.inPromo)),
            h('div', { class: 'metric-row' }, h('span', { class: 'muted' }, 'Produtos / lotes em estoque'), h('strong', null, `${dash.products} / ${dash.openLots}`)),
          ),
          ctx.can('reports:read') ? btn('Ver relatório completo', { iconName: 'chart', href: '#/relatorio', cls: 'btn btn-block' }) : null,
        ),
        h(
          'section',
          { class: 'card card-pad stack' },
          h('h2', null, 'Atalhos'),
          h(
            'div',
            { class: 'quick-links' },
            ctx.can('lots:write') ? quick('Registrar entrada de mercadoria', 'plusCircle', '#/lotes/novo') : null,
            ctx.can('products:write') ? quick('Cadastrar produto', 'package', '#/produtos/novo') : null,
            quick('Buscar por dias até vencer', 'search', '#/vencimentos'),
          ),
        ),
      ),
    ),
  );

  // Vencidos + até 7 dias, os mais urgentes primeiro (limitado a 8)
  const urgent = await api('/lots?expired=true&days=7&pageSize=8&sort=expiry');
  mount(
    urgentEl,
    urgent.items.length
      ? urgent.items.map((lot) => lotRow(lot, ctx, refresh))
      : emptyState('Tudo em dia', 'Nenhum produto vencido ou vencendo nos próximos 7 dias.', null, 'check'),
  );
}

function quick(label, iconName, href) {
  return h('a', { class: 'quick-link', href }, h('span', { class: 'kpi-icon' }, icon(iconName, 16)), label);
}
