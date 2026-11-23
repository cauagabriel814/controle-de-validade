import { api, fileUrl } from '../api.js';
import { h, mount, field, handleSubmit, photoInput, withShrunkPhotos, toast, fmtQty, thumb, debounce, qs, btn } from '../dom.js';
import { icon } from '../icons.js';
import { expiryField } from './produto.js';

export async function renderForm(main, ctx) {
  const [lotId] = ctx.params;
  return lotId ? renderEdit(main, ctx, lotId) : renderNew(main, ctx);
}

const section = (title, iconName, ...children) =>
  h('div', { class: 'form-section' }, h('div', { class: 'form-section-title' }, icon(iconName, 18), title), children);

/** Escolha de produto com busca no servidor (paginada: só 10 resultados por vez). */
function productPicker(initial, onChange) {
  let selected = initial;
  const hidden = h('input', { type: 'hidden', name: 'productId', value: initial?.id ?? '' });
  const box = h('div', { class: 'stack' });
  const results = h('div', { class: 'quick-links' });

  async function search(term) {
    const res = await api(`/products?${qs({ q: term, pageSize: 10, sort: 'name' })}`);
    mount(
      results,
      res.items.length
        ? res.items.map((p) =>
            h(
              'button',
              { type: 'button', class: 'quick-link', onclick: () => choose(p) },
              thumb(fileUrl(p.photo), p.name),
              h('span', { class: 'stack', style: null }, h('span', null, p.name), h('span', { class: 'xs muted' }, `${p.category_name} · ${fmtQty(p.stock)} ${p.unit} em estoque`)),
            ),
          )
        : h('p', { class: 'muted small' }, 'Nenhum produto encontrado. ', h('a', { href: '#/produtos/novo' }, 'Cadastrar produto')),
      res.total > res.items.length ? h('p', { class: 'xs muted' }, `Mostrando ${res.items.length} de ${res.total}. Digite mais para refinar.`) : null,
    );
  }

  function choose(p) {
    selected = p;
    hidden.value = p.id;
    render();
    onChange(p);
  }

  function render() {
    if (selected) {
      mount(
        box,
        h(
          'div',
          { class: 'quick-link' },
          thumb(fileUrl(selected.photo), selected.name),
          h('span', { class: 'stack' }, h('strong', null, selected.name), h('span', { class: 'xs muted' }, `${selected.category_name} · vendido por ${selected.unit}`)),
          h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { selected = null; hidden.value = ''; render(); onChange(null); } }, 'Trocar'),
        ),
        hidden,
      );
      return;
    }
    const input = h('input', { type: 'search', placeholder: 'Digite o nome ou o código de barras', 'aria-label': 'Buscar produto', oninput: debounce((e) => search(e.target.value.trim())) });
    mount(box, h('div', { class: 'input-icon' }, icon('search', 16), input), results, hidden);
    search('');
    input.focus();
  }

  render();
  return box;
}

async function renderNew(main, ctx) {
  const preId = ctx.query.get('produto');
  const preselected = preId ? await api(`/products/${encodeURIComponent(preId)}`).catch(() => null) : null;

  const unitHint = h('small');
  const setUnit = (p) => (unitHint.textContent = p ? `Em ${p.unit}.` : '');
  setUnit(preselected);

  const form = h(
    'form',
    { class: 'card form-narrow' },
    section('Produto', 'package', productPicker(preselected, setUnit)),
    section(
      'Quantidade e validade',
      'calendar',
      h('p', { class: 'muted small' }, 'Cada entrada com a mesma validade forma um lote. Validades diferentes, entradas separadas.'),
      h('div', { class: 'grid-2' }, h('label', null, 'Quantidade', h('input', { name: 'quantity', type: 'number', step: 'any', min: '0.001', required: true, inputmode: 'decimal' }), unitHint), expiryField()),
      h(
        'div',
        { class: 'grid-2' },
        field('Preço de custo (R$)', h('input', { name: 'costPrice', type: 'number', step: '0.01', min: '0', inputmode: 'decimal' }), 'Usado para calcular as perdas.'),
        field('Preço de venda (R$)', h('input', { name: 'salePrice', type: 'number', step: '0.01', min: '0', inputmode: 'decimal' })),
      ),
      field('Observações', h('input', { name: 'notes', maxlength: 300, placeholder: 'Ex.: fornecedor, prateleira' })),
    ),
    section('Foto da validade', 'camera', photoInput('expiryPhoto', 'Foto da etiqueta', 'Tire uma foto da data impressa na embalagem, para conferência.')),
    h('div', { class: 'form-section' }, h('p', { class: 'form-error', role: 'alert' })),
    h('div', { class: 'form-footer' }, h('a', { class: 'btn', href: '#/painel' }, 'Cancelar'), h('button', { class: 'btn btn-primary', type: 'submit' }, icon('check', 16), 'Salvar entrada')),
  );

  handleSubmit(form, async (fd) => {
    if (!fd.get('productId')) throw new Error('Escolha o produto');
    if (!fd.get('expiryDate')) throw new Error('Informe a validade');
    await withShrunkPhotos(fd, 'expiryPhoto');
    const lot = await api('/lots', { method: 'POST', form: fd });
    toast('Entrada registrada');
    ctx.refreshBadge?.();
    ctx.go(`/produtos/${lot.product_id}`);
  });

  mount(
    main,
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Nova entrada'), h('p', { class: 'subtitle' }, 'Registre a mercadoria que chegou com a data de validade.')), btn('Produto novo', { iconName: 'plus', href: '#/produtos/novo' })),
    form,
  );
}

async function renderEdit(main, ctx, lotId) {
  const lot = await api(`/lots/${lotId}`);
  const form = h(
    'form',
    { class: 'card form-narrow' },
    section(
      'Validade e preços',
      'calendar',
      h('p', { class: 'muted small' }, `Estoque: ${fmtQty(lot.quantity)} de ${fmtQty(lot.initial_quantity)} ${lot.unit}. Para baixar estoque, use Vendeu ou Perda.`),
      expiryField(lot.expiry_date),
      h(
        'div',
        { class: 'grid-2' },
        field('Preço de custo (R$)', h('input', { name: 'costPrice', type: 'number', step: '0.01', min: '0', value: lot.cost_price ?? '' })),
        field('Preço de venda (R$)', h('input', { name: 'salePrice', type: 'number', step: '0.01', min: '0', value: lot.sale_price ?? '' })),
      ),
      field('Observações', h('input', { name: 'notes', maxlength: 300, value: lot.notes ?? '' })),
    ),
    section(
      'Foto da validade',
      'camera',
      photoInput('expiryPhoto', 'Foto da etiqueta', null, fileUrl(lot.expiry_photo)),
      lot.expiry_photo ? h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'removePhoto', value: 'true' }), 'Remover foto atual') : null,
    ),
    h('div', { class: 'form-section' }, h('p', { class: 'form-error', role: 'alert' })),
    h('div', { class: 'form-footer' }, h('a', { class: 'btn', href: `#/produtos/${lot.product_id}` }, 'Cancelar'), h('button', { class: 'btn btn-primary', type: 'submit' }, icon('check', 16), 'Salvar')),
  );

  handleSubmit(form, async (fd) => {
    await withShrunkPhotos(fd, 'expiryPhoto');
    await api(`/lots/${lot.id}`, { method: 'PATCH', form: fd });
    toast('Lote atualizado');
    ctx.go(`/produtos/${lot.product_id}`);
  });

  mount(main, h('a', { href: `#/produtos/${lot.product_id}`, class: 'back' }, icon('arrowLeft', 16), lot.product_name), h('div', { class: 'page-head' }, h('h1', null, 'Editar lote')), form);
}
