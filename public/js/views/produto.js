import { api, fileUrl, allCategories } from '../api.js';
import {
  h, mount, field, fmtDate, fmtMoney, fmtQty, handleSubmit, photoInput, withShrunkPhotos,
  confirmDialog, toast, thumb, statusBadge, showPhoto, todayIso, addDaysIso, pager, skeleton, btn, emptyState,
} from '../dom.js';
import { icon } from '../icons.js';
import { historyDialog, deleteLot, lotButtons } from './lotActions.js';

export const UNITS = [
  ['un', 'Unidade'], ['kg', 'Quilo (kg)'], ['g', 'Grama (g)'], ['l', 'Litro (l)'], ['ml', 'Mililitro (ml)'],
  ['cx', 'Caixa'], ['pct', 'Pacote'], ['dz', 'Dúzia'], ['bandeja', 'Bandeja'], ['maço', 'Maço'],
];

// ---- Detalhe ---------------------------------------------------------------------

export async function renderDetail(main, ctx) {
  const [id] = ctx.params;
  const p = await api(`/products/${id}`);
  const refresh = () => {
    ctx.refreshBadge?.();
    return renderDetail(main, ctx);
  };
  const lotsEl = h('div', null, skeleton(3));
  let tab = 'open';

  const tabs = h('div', { class: 'chips' });
  function renderTabs() {
    mount(
      tabs,
      [['open', 'Em estoque'], ['closed', 'Encerrados']].map(([key, label]) =>
        h('button', { type: 'button', class: `chip-btn ${tab === key ? 'active' : ''}`, onclick: () => { tab = key; renderTabs(); loadLots(1); } }, label),
      ),
    );
  }

  async function loadLots(page = 1) {
    mount(lotsEl, skeleton(3));
    const res = await api(`/lots?productId=${p.id}&state=${tab}&page=${page}&pageSize=10`);
    if (!res.total) {
      mount(lotsEl, emptyState(tab === 'open' ? 'Sem lotes em estoque' : 'Nenhum lote encerrado', tab === 'open' ? 'Registre uma entrada com a data de validade.' : null, null, 'package'));
      return;
    }
    const lotView = (l) => ({ ...l, product_name: p.name, unit: p.unit });
    mount(
      lotsEl,
      h(
        'div',
        { class: 'table-wrap' },
        h(
          'table',
          { class: 'table' },
          h('thead', null, h('tr', null, ['Validade', 'Situação', 'Estoque', 'Custo', 'Venda', ''].map((t, i) => h('th', { class: i >= 2 && i <= 4 ? 'num' : null }, t)))),
          h(
            'tbody',
            null,
            res.items.map((l) =>
              h(
                'tr',
                { class: l.quantity > 0 ? null : 'row-muted' },
                h('td', { class: 'nowrap' }, h('strong', null, fmtDate(l.expiry_date))),
                h('td', null, l.quantity > 0 ? statusBadge(l.days_left) : h('span', { class: 'badge badge-muted' }, 'Encerrado'), l.in_promo ? [' ', h('span', { class: 'badge badge-promo' }, `Promo ${fmtMoney(l.promo_price)}`)] : null),
                h('td', { class: 'num nowrap' }, `${fmtQty(l.quantity)} / ${fmtQty(l.initial_quantity)} ${p.unit}`),
                h('td', { class: 'num' }, fmtMoney(l.cost_price)),
                h('td', { class: 'num' }, fmtMoney(l.sale_price)),
                h(
                  'td',
                  null,
                  h(
                    'div',
                    { class: 'row-actions' },
                    lotButtons(lotView(l), ctx, refresh, { compact: true }),
                    h('button', { class: 'btn btn-sm btn-ghost', type: 'button', title: 'Histórico', 'aria-label': 'Histórico', onclick: () => historyDialog(lotView(l)) }, icon('history', 15)),
                    ctx.can('lots:write') ? h('a', { class: 'btn btn-sm btn-ghost', href: `#/lotes/${l.id}/editar`, title: 'Editar lote', 'aria-label': 'Editar lote' }, icon('edit', 15)) : null,
                    ctx.can('lots:delete') ? h('button', { class: 'btn btn-sm btn-ghost', type: 'button', title: 'Excluir lote', 'aria-label': 'Excluir lote', onclick: () => deleteLot(l, refresh) }, icon('trash', 15)) : null,
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
      pager(res, loadLots),
    );
  }

  const photo = p.photo
    ? h('button', { type: 'button', class: 'photo-btn', onclick: () => showPhoto(fileUrl(p.photo), p.name), 'aria-label': 'Ampliar foto' }, thumb(fileUrl(p.photo), p.name, 'product-hero-photo'))
    : thumb(null, p.name, 'product-hero-photo');

  const fact = (label, value) => h('div', { class: 'fact' }, h('div', { class: 'fact-label' }, label), h('div', { class: 'fact-value' }, value));

  mount(
    main,
    h('a', { href: '#/produtos', class: 'back' }, icon('arrowLeft', 16), 'Produtos'),
    h(
      'section',
      { class: 'card' },
      h(
        'div',
        { class: 'product-hero' },
        photo,
        h(
          'div',
          { class: 'stack' },
          h(
            'div',
            { class: 'row' },
            h('h1', null, p.name),
            h('span', { class: 'badge badge-muted' }, p.category_name),
            h('span', { class: `badge ${p.perishable ? 'badge-blue' : 'badge-muted'}` }, p.perishable ? 'Perecível' : 'Não perecível'),
          ),
          h('p', { class: 'muted' }, [`Vendido por ${p.unit}`, p.barcode ? `Código ${p.barcode}` : null].filter(Boolean).join(' · ')),
          p.notes ? h('p', { class: 'small' }, p.notes) : null,
          h(
            'div',
            { class: 'facts' },
            fact('Estoque', `${fmtQty(p.stock ?? 0)} ${p.unit}`),
            fact('Lotes abertos', p.open_lots ?? 0),
            fact('Próxima validade', p.next_expiry ? fmtDate(p.next_expiry) : '—'),
            fact('Situação', p.next_expiry ? statusBadge(p.days_left) : h('span', { class: 'badge badge-muted' }, 'Sem estoque')),
          ),
          h(
            'div',
            { class: 'actions actions-start' },
            ctx.can('lots:write') ? btn('Nova entrada', { iconName: 'plus', cls: 'btn btn-primary', href: `#/lotes/novo?produto=${p.id}` }) : null,
            ctx.can('products:write') ? btn('Editar', { iconName: 'edit', href: `#/produtos/${p.id}/editar` }) : null,
            ctx.can('products:delete') ? btn('Excluir', { iconName: 'trash', cls: 'btn btn-soft-red', onclick: () => deleteProduct(p, ctx) }) : null,
          ),
        ),
      ),
    ),
    h('section', { class: 'card section-gap' }, h('div', { class: 'card-head' }, h('h2', null, 'Lotes'), tabs), lotsEl),
  );
  renderTabs();
  await loadLots(1);
}

async function deleteProduct(p, ctx) {
  const ok = await confirmDialog(`Excluir "${p.name}"? O histórico de perdas continua no relatório.`, { confirmText: 'Excluir', danger: true });
  if (!ok) return;
  await api(`/products/${p.id}`, { method: 'DELETE' });
  toast('Produto excluído');
  ctx.go('/produtos');
}

// ---- Cadastro / edição -----------------------------------------------------------

export async function renderForm(main, ctx) {
  const [id] = ctx.params;
  const editing = Boolean(id);
  const [categories, product] = await Promise.all([allCategories(), editing ? api(`/products/${id}`) : null]);
  const p = product ?? {};

  const section = (title, iconName, ...children) =>
    h('div', { class: 'form-section' }, h('div', { class: 'form-section-title' }, icon(iconName, 18), title), children);

  const form = h(
    'form',
    { class: 'card form-narrow' },
    section(
      'Dados do produto',
      'package',
      field('Nome', h('input', { name: 'name', required: true, maxlength: 120, value: p.name ?? '', placeholder: 'Ex.: Leite integral 1L' })),
      h(
        'div',
        { class: 'grid-2' },
        field(
          'Categoria / tipo',
          h('select', { name: 'categoryId', required: true }, h('option', { value: '' }, 'Escolha…'), categories.map((c) => h('option', { value: c.id, selected: c.id === p.category_id }, `${c.name}${c.perishable ? ' (perecível)' : ''}`))),
        ),
        field('Unidade', h('select', { name: 'unit' }, UNITS.map(([v, l]) => h('option', { value: v, selected: v === (p.unit ?? 'un') }, l)))),
      ),
      field('Código de barras', h('input', { name: 'barcode', inputmode: 'numeric', pattern: '[0-9]{6,14}', value: p.barcode ?? '', placeholder: 'Opcional' }), 'Só números, de 6 a 14 dígitos.'),
      field('Observações', h('textarea', { name: 'notes', rows: 2, maxlength: 500 }, p.notes ?? '')),
    ),
    section(
      'Foto do produto',
      'camera',
      photoInput('photo', 'Foto do produto', null, fileUrl(p.photo)),
      editing && p.photo ? h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'removePhoto', value: 'true' }), 'Remover foto atual') : null,
    ),
    editing
      ? null
      : section(
          'Primeira entrada (opcional)',
          'calendar',
          h('p', { class: 'muted small' }, 'Já tem esse produto na prateleira? Informe a quantidade e a validade.'),
          h('div', { class: 'grid-2' }, field('Quantidade', h('input', { name: 'quantity', type: 'number', step: 'any', min: '0', inputmode: 'decimal' })), expiryField()),
          h(
            'div',
            { class: 'grid-2' },
            field('Preço de custo (R$)', h('input', { name: 'costPrice', type: 'number', step: '0.01', min: '0', inputmode: 'decimal' }), 'Usado para calcular as perdas.'),
            field('Preço de venda (R$)', h('input', { name: 'salePrice', type: 'number', step: '0.01', min: '0', inputmode: 'decimal' })),
          ),
          photoInput('expiryPhoto', 'Foto da validade', 'Foto da etiqueta com a data, para conferência.'),
        ),
    h('div', { class: 'form-section' }, h('p', { class: 'form-error', role: 'alert' })),
    h(
      'div',
      { class: 'form-footer' },
      h('a', { class: 'btn', href: editing ? `#/produtos/${id}` : '#/produtos' }, 'Cancelar'),
      h('button', { class: 'btn btn-primary', type: 'submit' }, icon('check', 16), 'Salvar'),
    ),
  );

  handleSubmit(form, async (fd) => {
    const lotData = editing ? null : extractLot(fd);
    await withShrunkPhotos(fd, 'photo');
    const saved = await api(editing ? `/products/${id}` : '/products', { method: editing ? 'PATCH' : 'POST', form: fd });

    if (lotData) {
      lotData.set('productId', saved.id);
      await withShrunkPhotos(lotData, 'expiryPhoto');
      try {
        await api('/lots', { method: 'POST', form: lotData });
      } catch (err) {
        toast(`Produto salvo, mas a entrada não: ${err.message}`, 'error');
        return ctx.go(`/lotes/novo?produto=${saved.id}`);
      }
    }
    toast('Produto salvo');
    ctx.go(`/produtos/${saved.id}`);
  });

  mount(main, h('a', { href: editing ? `#/produtos/${id}` : '#/produtos', class: 'back' }, icon('arrowLeft', 16), 'Voltar'), h('div', { class: 'page-head' }, h('h1', null, editing ? 'Editar produto' : 'Novo produto')), form);
}

/** Separa os campos da primeira entrada do form de produto. */
export function extractLot(fd) {
  const keys = ['quantity', 'expiryDate', 'costPrice', 'salePrice', 'expiryPhoto'];
  const lot = new FormData();
  for (const k of keys) {
    const v = fd.get(k);
    if (v !== null) lot.set(k, v);
    fd.delete(k);
  }
  const qty = lot.get('quantity');
  const date = lot.get('expiryDate');
  if (!qty && !date) return null;
  if (!qty || !date) throw new Error('Para a primeira entrada, informe quantidade e validade (ou deixe as duas em branco)');
  return lot;
}

/** Campo de validade com atalhos: hortifrúti costuma ser "daqui a X dias". */
export function expiryField(value = '') {
  const input = h('input', { name: 'expiryDate', type: 'date', value });
  const shortcut = (days, label) => h('button', { type: 'button', class: 'btn btn-sm', onclick: () => (input.value = addDaysIso(todayIso(), days)) }, label);
  return h(
    'div',
    { class: 'stack' },
    field('Validade', input),
    h('div', { class: 'shortcuts' }, h('span', { class: 'xs muted' }, 'Atalhos:'), shortcut(3, '+3 dias'), shortcut(7, '+7'), shortcut(15, '+15'), shortcut(30, '+30')),
  );
}
