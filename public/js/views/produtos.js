import { api, fileUrl, allCategories } from '../api.js';
import { h, mount, fmtDate, fmtQty, emptyState, thumb, statusBadge, pageHead, pager, skeleton, debounce, qs, btn } from '../dom.js';
import { icon } from '../icons.js';

const state = { q: '', categoryId: '', perishable: '', inStock: '', sort: 'name', page: 1 };

export function productCard(p) {
  return h(
    'a',
    { class: 'product-card', href: `#/produtos/${p.id}` },
    thumb(fileUrl(p.photo), p.name, 'product-cover'),
    h(
      'div',
      { class: 'product-info' },
      h('span', { class: 'product-name' }, p.name),
      h(
        'div',
        { class: 'product-tags' },
        h('span', { class: 'badge badge-muted' }, p.category_name),
        h('span', { class: `badge ${p.perishable ? 'badge-blue' : 'badge-muted'}` }, p.perishable ? 'Perecível' : 'Não perecível'),
      ),
      h(
        'div',
        { class: 'product-foot' },
        p.open_lots ? h('span', null, `${fmtQty(p.stock)} ${p.unit} · ${p.open_lots} ${p.open_lots === 1 ? 'lote' : 'lotes'}`) : h('span', null, 'Sem estoque'),
        p.next_expiry ? statusBadge(p.days_left) : null,
      ),
      p.next_expiry ? h('span', { class: 'xs muted' }, `Próxima validade: ${fmtDate(p.next_expiry)}`) : null,
    ),
  );
}

export async function render(main, ctx) {
  const categories = await allCategories();
  const results = h('div', null, skeleton(4));

  async function load() {
    mount(results, skeleton(4));
    const res = await api(`/products?${qs({ ...state, pageSize: 24 })}`);
    const filtering = state.q || state.categoryId || state.perishable || state.inStock;
    mount(
      results,
      res.items.length
        ? h('div', { class: 'product-grid' }, res.items.map(productCard))
        : emptyState(
            filtering ? 'Nenhum produto encontrado' : 'Nenhum produto cadastrado',
            filtering ? 'Tente outros filtros.' : 'Cadastre o primeiro produto para começar a controlar a validade.',
            !filtering && ctx.can('products:write') ? btn('Cadastrar produto', { iconName: 'plus', cls: 'btn btn-primary', href: '#/produtos/novo' }) : null,
          ),
      pager(res, (p) => {
        state.page = p;
        load();
        main.scrollIntoView({ block: 'start' });
      }),
    );
  }

  const update = (key) => (e) => {
    state[key] = e.target.value;
    state.page = 1;
    load();
  };

  mount(
    main,
    pageHead(
      'Produtos',
      'Tudo o que o mercadinho vende: frutas, verduras, perecíveis e não perecíveis.',
      ctx.can('products:write') ? btn('Novo produto', { iconName: 'plus', cls: 'btn btn-primary', href: '#/produtos/novo' }) : null,
    ),
    h(
      'section',
      { class: 'card' },
      h(
        'div',
        { class: 'toolbar' },
        h(
          'div',
          { class: 'filters' },
          h('div', { class: 'input-icon' }, icon('search', 16), h('input', { type: 'search', placeholder: 'Nome ou código de barras', value: state.q, 'aria-label': 'Buscar produto', oninput: debounce(update('q')) })),
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
            { 'aria-label': 'Estoque e ordem', onchange: (e) => { const [inStock, sort] = e.target.value.split('|'); state.inStock = inStock; state.sort = sort; state.page = 1; load(); } },
            h('option', { value: '|name' }, 'Todos, por nome'),
            h('option', { value: 'true|expiry', selected: state.sort === 'expiry' }, 'Com estoque, vence primeiro'),
            h('option', { value: 'false|name', selected: state.inStock === 'false' }, 'Sem estoque'),
            h('option', { value: '|recent', selected: state.sort === 'recent' }, 'Cadastrados recentemente'),
          ),
        ),
      ),
      results,
    ),
  );
  await load();
}
