import { api, fileUrl } from '../api.js';
import {
  h, mount, field, fmtDate, fmtMoney, fmtQty, fmtDateTime, handleSubmit, openModal, confirmDialog,
  showPhoto, statusBadge, thumb, toast, pager, skeleton,
} from '../dom.js';
import { icon } from '../icons.js';

const LOSS_REASONS = ['Vencido', 'Estragado / passou do ponto', 'Embalagem danificada', 'Consumo interno', 'Outro'];

export function promoDialog(lot, onDone) {
  const suggestion = lot.sale_price ? (lot.sale_price * 0.7).toFixed(2) : '';
  const form = h(
    'form',
    { class: 'stack' },
    h('p', { class: 'muted' }, `${lot.product_name} · validade ${fmtDate(lot.expiry_date)} · preço normal ${fmtMoney(lot.sale_price)}`),
    field(
      'Preço promocional (R$)',
      h('input', { name: 'promoPrice', type: 'number', step: '0.01', min: '0', required: true, value: lot.promo_price ?? suggestion, inputmode: 'decimal' }),
      lot.sale_price ? 'Sugestão: 30% de desconto.' : null,
    ),
    h('p', { class: 'form-error', role: 'alert' }),
    h(
      'div',
      { class: 'actions' },
      lot.in_promo ? h('button', { type: 'button', class: 'btn', onclick: () => endPromo(lot, modal, onDone) }, 'Encerrar promoção') : null,
      h('button', { type: 'submit', class: 'btn btn-primary' }, lot.in_promo ? 'Atualizar preço' : 'Colocar em promoção'),
    ),
  );
  const modal = openModal('Promoção', form);
  handleSubmit(form, async (fd) => {
    await api(`/lots/${lot.id}/promo`, { method: 'POST', body: { promoPrice: fd.get('promoPrice') } });
    modal.close();
    toast('Lote em promoção');
    onDone();
  });
}

async function endPromo(lot, modal, onDone) {
  await api(`/lots/${lot.id}/promo`, { method: 'DELETE' });
  modal.close();
  toast('Promoção encerrada');
  onDone();
}

export function movementDialog(lot, type, onDone) {
  const isLoss = type === 'perda';
  const form = h(
    'form',
    { class: 'stack' },
    h('p', { class: 'muted' }, `${lot.product_name}: ${fmtQty(lot.quantity)} ${lot.unit} em estoque neste lote.`),
    field(
      isLoss ? 'Quantidade perdida' : 'Quantidade vendida',
      h('input', { name: 'quantity', type: 'number', step: 'any', min: '0.001', max: lot.quantity, required: true, value: lot.quantity, inputmode: 'decimal' }),
    ),
    isLoss ? field('Motivo', h('select', { name: 'reason' }, LOSS_REASONS.map((r) => h('option', { value: r }, r)))) : null,
    h(
      'p',
      { class: 'small muted' },
      isLoss
        ? `Entra no relatório como perda de ${fmtMoney(lot.cost_price ?? lot.sale_price ?? 0)} por ${lot.unit} (preço de custo).`
        : lot.in_promo
          ? `Venda em promoção a ${fmtMoney(lot.promo_price)}: conta como valor recuperado.`
          : `Venda a ${fmtMoney(lot.sale_price)} por ${lot.unit}.`,
    ),
    h('p', { class: 'form-error', role: 'alert' }),
    h('div', { class: 'actions' }, h('button', { type: 'submit', class: `btn ${isLoss ? 'btn-danger' : 'btn-primary'}` }, isLoss ? 'Registrar perda' : 'Registrar venda')),
  );
  const modal = openModal(isLoss ? 'Registrar perda' : 'Registrar venda', form);
  handleSubmit(form, async (fd) => {
    await api(`/lots/${lot.id}/movements`, {
      method: 'POST',
      body: { type, quantity: fd.get('quantity'), reason: fd.get('reason') ?? undefined },
    });
    modal.close();
    toast(isLoss ? 'Perda registrada' : 'Venda registrada');
    onDone();
  });
}

export function historyDialog(lot) {
  const body = h('div', null, skeleton(3));
  const labels = { venda: 'Venda', perda: 'Perda', ajuste: 'Ajuste' };
  openModal(`Histórico do lote · validade ${fmtDate(lot.expiry_date)}`, body, { wide: true });

  async function load(page = 1) {
    const res = await api(`/lots/${lot.id}/movements?page=${page}&pageSize=10`);
    mount(
      body,
      res.total
        ? h(
            'div',
            null,
            h(
              'div',
              { class: 'table-wrap' },
              h(
                'table',
                { class: 'table' },
                h('thead', null, h('tr', null, ['Quando', 'Tipo', 'Qtd', 'Valor un.', 'Motivo', 'Por'].map((t) => h('th', null, t)))),
                h(
                  'tbody',
                  null,
                  res.items.map((m) =>
                    h(
                      'tr',
                      null,
                      h('td', { class: 'nowrap' }, fmtDateTime(m.created_at)),
                      h('td', null, h('span', { class: `badge ${m.type === 'perda' ? 'badge-danger' : m.type === 'venda' ? 'badge-ok' : 'badge-muted'}` }, labels[m.type]), m.in_promo ? h('span', { class: 'badge badge-promo' }, 'promo') : null),
                      h('td', { class: 'num' }, fmtQty(m.quantity)),
                      h('td', { class: 'num' }, fmtMoney(m.unit_value)),
                      h('td', null, m.reason ?? '—'),
                      h('td', null, m.user_name ?? '—'),
                    ),
                  ),
                ),
              ),
            ),
            pager(res, load),
          )
        : h('p', { class: 'muted' }, 'Nenhuma venda ou perda registrada.'),
    );
  }
  load();
}

export async function deleteLot(lot, onDone) {
  const ok = await confirmDialog('Excluir este lote? Só é possível se ele não tiver vendas ou perdas registradas.', { confirmText: 'Excluir', danger: true });
  if (!ok) return;
  try {
    await api(`/lots/${lot.id}`, { method: 'DELETE' });
    toast('Lote excluído');
    onDone();
  } catch (err) {
    toast(err.message, 'error');
  }
}

/** Botões de ação de um lote (usados no painel, na busca e no produto). */
export function lotButtons(lot, ctx, refresh, { compact = false } = {}) {
  const open = lot.quantity > 0;
  const b = (label, iconName, cls, onclick) =>
    h('button', { class: `btn btn-sm ${cls}`, type: 'button', onclick, title: label, 'aria-label': label }, icon(iconName, 15), compact ? null : label);
  return [
    lot.expiry_photo ? b('Etiqueta', 'image', 'btn-ghost', () => showPhoto(fileUrl(lot.expiry_photo), 'Foto da validade')) : null,
    open && ctx.can('lots:write') && lot.days_left >= 0 ? b(lot.in_promo ? 'Promoção' : 'Promover', 'percent', 'btn-soft-violet', () => promoDialog(lot, refresh)) : null,
    open && ctx.can('movements:write') ? b('Vendeu', 'cart', 'btn-soft-green', () => movementDialog(lot, 'venda', refresh)) : null,
    open && ctx.can('movements:write') ? b('Perda', 'ban', 'btn-soft-red', () => movementDialog(lot, 'perda', refresh)) : null,
  ];
}

/** Linha de lote em lista (painel e busca). */
export function lotRow(lot, ctx, refresh) {
  return h(
    'article',
    { class: 'lot-row' },
    h('a', { href: `#/produtos/${lot.product_id}`, class: 'lot-thumb', tabindex: '-1' }, thumb(fileUrl(lot.product_photo), lot.product_name)),
    h(
      'div',
      { class: 'lot-main' },
      h(
        'div',
        { class: 'lot-title' },
        h('a', { href: `#/produtos/${lot.product_id}`, class: 'lot-name' }, lot.product_name),
        statusBadge(lot.days_left),
        lot.in_promo ? h('span', { class: 'badge badge-promo' }, icon('percent', 12), fmtMoney(lot.promo_price)) : null,
      ),
      h(
        'div',
        { class: 'lot-meta' },
        h('span', null, icon('calendar', 14), fmtDate(lot.expiry_date)),
        h('span', null, icon('package', 14), `${fmtQty(lot.quantity)} ${lot.unit}`),
        h('span', null, icon('tag', 14), lot.category_name),
      ),
    ),
    h('div', { class: 'lot-actions' }, lotButtons(lot, ctx, refresh)),
  );
}
