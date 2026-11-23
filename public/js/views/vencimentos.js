import { api, allCategories } from '../api.js';
import { h, mount, pageHead, pager, skeleton, emptyState, debounce, qs } from '../dom.js';
import { icon } from '../icons.js';
import { lotRow } from './lotActions.js';

// Atalhos de período. `days` vai direto para GET /api/lots?days=N
export const PERIODS = [
  { key: 'vencidos', label: 'Vencidos', expired: true },
  { key: '0', label: 'Hoje', days: 0 },
  { key: '5', label: '5 dias', days: 5 },
  { key: '7', label: '7 dias', days: 7 },
  { key: '10', label: '10 dias', days: 10 },
  { key: '15', label: '15 dias', days: 15 },
  { key: '30', label: '30 dias', days: 30 },
  { key: 'todos', label: 'Todo o estoque' },
];

/** Converte o filtro da tela nos parâmetros da API. */
export function periodParams(key, customDays, includeExpired) {
  if (key === 'custom') return { days: customDays, expired: includeExpired ? 'true' : undefined };
  const p = PERIODS.find((x) => x.key === key) ?? PERIODS[3];
  if (p.expired) return { expired: 'true' };
  if (p.days === undefined) return {};
  return { days: p.days, expired: includeExpired ? 'true' : undefined };
}

const state = { period: '7', customDays: 20, includeExpired: false, q: '', categoryId: '', perishable: '', promo: false, sort: 'expiry', page: 1 };

export async function render(main, ctx) {
  // Links do painel: #/vencimentos?f=7&vencidos=1
  const f = ctx.query.get('f');
  if (f && (PERIODS.some((p) => p.key === f) || f === 'custom')) {
    state.period = f;
    state.includeExpired = ctx.query.get('vencidos') === '1';
    state.page = 1;
  }

  const categories = await allCategories();
  const results = h('div', null, skeleton(5));
  const chipsEl = h('div', { class: 'chips', role: 'group', 'aria-label': 'Período' });

  async function load() {
    mount(results, skeleton(5));
    const params = {
      ...periodParams(state.period, state.customDays, state.includeExpired),
      q: state.q,
      categoryId: state.categoryId,
      perishable: state.perishable,
      promo: state.promo ? 'true' : undefined,
      sort: state.sort,
      page: state.page,
      pageSize: 20,
    };
    const res = await api(`/lots?${qs(params)}`);
    mount(
      results,
      res.items.length
        ? h('div', { class: 'lot-list' }, res.items.map((lot) => lotRow(lot, ctx, reload)))
        : emptyState('Nada encontrado', 'Nenhum lote em estoque com esses filtros.', null, 'calendar'),
      pager(res, (p) => {
        state.page = p;
        load();
        main.scrollIntoView({ block: 'start' });
      }),
    );
  }

  function reload() {
    ctx.refreshBadge?.();
    return load();
  }

  function setPeriod(key) {
    state.period = key;
    state.page = 1;
    renderChips();
    load();
  }

  function renderChips() {
    const customInput = h('input', {
      type: 'number', min: 0, max: 365, value: state.customDays, 'aria-label': 'Número de dias', inputmode: 'numeric',
      oninput: debounce((e) => {
        const n = Number(e.target.value);
        if (Number.isInteger(n) && n >= 0 && n <= 365) {
          state.customDays = n;
          setPeriod('custom');
        }
      }, 400),
    });
    mount(
      chipsEl,
      PERIODS.map((p) =>
        h('button', { type: 'button', class: `chip-btn ${p.expired ? 'chip-red' : ''} ${state.period === p.key ? 'active' : ''}`, 'aria-pressed': String(state.period === p.key), onclick: () => setPeriod(p.key) }, p.label),
      ),
      h('span', { class: `chip-custom ${state.period === 'custom' ? 'active' : ''}` }, 'Próximos', customInput, 'dias'),
    );
  }

  const update = (key) => (e) => {
    state[key] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    state.page = 1;
    load();
  };

  renderChips();
  mount(
    main,
    pageHead('Vencimentos', 'Busque o que vence nos próximos dias e aja antes de perder a mercadoria.'),
    h(
      'section',
      { class: 'card' },
      h(
        'div',
        { class: 'toolbar' },
        chipsEl,
        h(
          'div',
          { class: 'filters' },
          h('div', { class: 'input-icon' }, icon('search', 16), h('input', { type: 'search', placeholder: 'Produto ou código de barras', value: state.q, 'aria-label': 'Buscar', oninput: debounce(update('q')) })),
          h('select', { 'aria-label': 'Categoria', onchange: update('categoryId') }, h('option', { value: '' }, 'Todas as categorias'), categories.map((c) => h('option', { value: c.id, selected: String(c.id) === String(state.categoryId) }, c.name))),
          h(
            'select',
            { 'aria-label': 'Tipo', onchange: update('perishable') },
            h('option', { value: '' }, 'Perecíveis e não perecíveis'),
            h('option', { value: 'true', selected: state.perishable === 'true' }, 'Só perecíveis'),
            h('option', { value: 'false', selected: state.perishable === 'false' }, 'Só não perecíveis'),
          ),
          h(
            'select',
            { 'aria-label': 'Ordenar', onchange: update('sort') },
            h('option', { value: 'expiry', selected: state.sort === 'expiry' }, 'Vence primeiro'),
            h('option', { value: '-expiry', selected: state.sort === '-expiry' }, 'Vence por último'),
            h('option', { value: 'name', selected: state.sort === 'name' }, 'Nome do produto'),
            h('option', { value: 'quantity', selected: state.sort === 'quantity' }, 'Maior quantidade'),
          ),
        ),
        h(
          'div',
          { class: 'row' },
          h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: state.promo, onchange: update('promo') }), 'Só em promoção'),
          h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: state.includeExpired, onchange: update('includeExpired') }), 'Incluir vencidos no período'),
        ),
      ),
      results,
    ),
  );
  await load();
}
