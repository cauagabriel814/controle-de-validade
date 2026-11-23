import { icon } from './icons.js';

/**
 * Cria elementos sem innerHTML: todo texto vira textContent,
 * então nome de produto com "<script>" aparece como texto e nunca executa (XSS).
 */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value == null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'class') el.className = value;
    else if (key === 'value') el.value = value;
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, String(value));
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const child of [children].flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export function mount(el, ...children) {
  el.replaceChildren();
  return append(el, children);
}

export function debounce(fn, ms = 300) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// ---- Formatação -------------------------------------------------------------------

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const fmtMoney = (v) => (v == null ? '—' : money.format(v));
export const fmtQty = (v) => Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 3 });

export function fmtDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export function fmtMonth(ym) {
  const [y, m] = ym.split('-');
  return `${MONTHS[Number(m) - 1]}/${y}`;
}

export function fmtDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export function todayIso() {
  return new Date().toLocaleDateString('sv-SE');
}

export function addDaysIso(iso, days) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('sv-SE');
}

export function initials(name = '') {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts.at(-1)[0] : '')).toUpperCase() || '?';
}

/** Situação do lote a partir dos dias que faltam. */
export function expiryStatus(daysLeft) {
  if (daysLeft < 0) {
    const n = -daysLeft;
    return { level: 'expired', label: n === 1 ? 'Venceu ontem' : `Venceu há ${n} dias` };
  }
  if (daysLeft === 0) return { level: 'danger', label: 'Vence hoje' };
  if (daysLeft === 1) return { level: 'danger', label: 'Vence amanhã' };
  if (daysLeft <= 7) return { level: 'danger', label: `Vence em ${daysLeft} dias` };
  if (daysLeft <= 15) return { level: 'warn', label: `Vence em ${daysLeft} dias` };
  return { level: 'ok', label: `Vence em ${daysLeft} dias` };
}

export function statusBadge(daysLeft) {
  if (daysLeft == null) return h('span', { class: 'badge badge-muted' }, 'Sem estoque');
  const s = expiryStatus(daysLeft);
  return h('span', { class: `badge badge-${s.level}` }, h('span', { class: 'dot' }), s.label);
}

// ---- UI: toast, modal, confirmação ---------------------------------------------

export function toast(message, type = 'ok') {
  const el = h(
    'div',
    { class: `toast toast-${type}`, role: type === 'error' ? 'alert' : 'status' },
    icon(type === 'error' ? 'alert' : 'check', 18),
    message,
  );
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), 4200);
}

export function openModal(title, content, { wide = false } = {}) {
  const dialog = document.getElementById('modal');
  dialog.classList.toggle('modal-wide', wide);
  const close = () => dialog.close();
  mount(
    dialog,
    h(
      'div',
      { class: 'modal-head' },
      h('h2', null, title),
      h('button', { class: 'icon-btn icon-btn-sm', type: 'button', 'aria-label': 'Fechar', onclick: close }, icon('x', 16)),
    ),
    h('div', { class: 'modal-body' }, content),
  );
  dialog.showModal();
  return { close, dialog };
}

export function confirmDialog(message, { confirmText = 'Confirmar', danger = false } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    const done = (v) => {
      answered = true;
      modal.close();
      resolve(v);
    };
    const modal = openModal(
      'Confirmar',
      h(
        'div',
        { class: 'stack' },
        h('p', null, message),
        h(
          'div',
          { class: 'actions' },
          h('button', { class: 'btn', type: 'button', onclick: () => done(false) }, 'Cancelar'),
          h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, type: 'button', onclick: () => done(true) }, confirmText),
        ),
      ),
    );
    modal.dialog.addEventListener('close', () => answered || resolve(false), { once: true });
  });
}

/** Envolve um submit: desabilita o botão e mostra o erro da API no form. */
export function handleSubmit(form, fn) {
  const errorEl = form.querySelector('.form-error') ?? form.appendChild(h('p', { class: 'form-error', role: 'alert' }));
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const button = form.querySelector('button[type=submit]');
    errorEl.textContent = '';
    if (button) button.disabled = true;
    try {
      await fn(new FormData(form));
    } catch (err) {
      errorEl.textContent = err.message || 'Erro ao salvar';
    } finally {
      if (button) button.disabled = false;
    }
  });
}

export function field(label, input, hint) {
  return h('label', null, label, input, hint ? h('small', null, hint) : null);
}

export function skeleton(rows = 4) {
  return h('div', { class: 'skeleton', 'aria-label': 'Carregando' }, Array.from({ length: rows }, () => h('div')));
}

export function emptyState(title, text, action, iconName = 'package') {
  return h('div', { class: 'empty' }, h('div', { class: 'empty-icon' }, icon(iconName, 24)), h('h3', null, title), text ? h('p', null, text) : null, action ?? null);
}

export function pageHead(title, subtitle, ...actions) {
  return h(
    'div',
    { class: 'page-head' },
    h('div', null, h('h1', null, title), subtitle ? h('p', { class: 'subtitle' }, subtitle) : null),
    actions.length ? h('div', { class: 'actions' }, actions) : null,
  );
}

/** Botão/link com ícone. */
export function btn(label, { iconName, cls = 'btn', href, onclick, type = 'button', title } = {}) {
  const content = [iconName ? icon(iconName, 16) : null, label];
  return href ? h('a', { class: cls, href, title }, content) : h('button', { class: cls, type, onclick, title }, content);
}

// ---- Paginação -------------------------------------------------------------------

/** Números de página compactos: 1 … 4 5 6 … 12 */
export function pageNumbers(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const set = new Set([1, total, current - 1, current, current + 1].filter((n) => n >= 1 && n <= total));
  const sorted = [...set].sort((a, b) => a - b);
  const out = [];
  sorted.forEach((n, i) => {
    if (i > 0 && n - sorted[i - 1] > 1) out.push('…');
    out.push(n);
  });
  return out;
}

/** Rodapé "Mostrando 1–20 de 57" + botões de página. */
export function pager(result, onPage) {
  const { page, pageSize, total, totalPages } = result;
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return h(
    'div',
    { class: 'pager' },
    h('span', { class: 'result-info' }, total === 0 ? 'Nenhum resultado' : `Mostrando ${from}–${to} de ${total}`),
    totalPages > 1
      ? h(
          'div',
          { class: 'pager-pages' },
          h('button', { class: 'page-btn', type: 'button', 'aria-label': 'Página anterior', disabled: page <= 1, onclick: () => onPage(page - 1) }, icon('chevronLeft', 16)),
          pageNumbers(page, totalPages).map((n) =>
            n === '…'
              ? h('span', { class: 'page-gap' }, '…')
              : h('button', { class: `page-btn ${n === page ? 'active' : ''}`, type: 'button', 'aria-current': n === page ? 'page' : null, onclick: () => onPage(n) }, n),
          ),
          h('button', { class: 'page-btn', type: 'button', 'aria-label': 'Próxima página', disabled: page >= totalPages, onclick: () => onPage(page + 1) }, icon('chevronRight', 16)),
        )
      : null,
  );
}

export function qs(params) {
  return new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null && v !== false)).toString();
}

// ---- Fotos -----------------------------------------------------------------------

/**
 * Reduz a foto no próprio celular antes de enviar (upload mais rápido)
 * e, por redesenhar a imagem, remove os metadados EXIF (inclusive GPS).
 */
export async function shrinkImage(file, maxSide = 1280) {
  if (!file || !file.size) return null;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
    return blob ?? file;
  } catch {
    return file;
  }
}

/** Campo de foto: no celular abre a câmera traseira; mostra a prévia. */
export function photoInput(name, label, hint, currentUrl) {
  const preview = h('img', { alt: '', hidden: !currentUrl, src: currentUrl ?? undefined });
  const placeholder = h('span', { hidden: Boolean(currentUrl) }, icon('camera', 28));
  const input = h('input', { type: 'file', name, accept: 'image/jpeg,image/png,image/webp', capture: 'environment', 'aria-label': label });
  let objectUrl;
  input.addEventListener('change', () => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    const file = input.files?.[0];
    if (file) {
      objectUrl = URL.createObjectURL(file);
      preview.src = objectUrl;
      preview.hidden = false;
      placeholder.hidden = true;
    }
  });
  return h(
    'div',
    { class: 'photo-field' },
    h('div', { class: 'photo-drop' }, preview, placeholder, input),
    h('div', { class: 'photo-text' }, h('strong', null, label), h('span', { class: 'muted' }, hint ?? 'Toque para tirar uma foto ou escolher da galeria. JPG, PNG ou WEBP.')),
  );
}

/** Troca o arquivo original do FormData pela versão reduzida. */
export async function withShrunkPhotos(formData, ...fields) {
  for (const name of fields) {
    const file = formData.get(name);
    if (file instanceof File && file.size) {
      formData.set(name, await shrinkImage(file), 'foto.jpg');
    } else {
      formData.delete(name);
    }
  }
  return formData;
}

export function thumb(url, alt, cls = 'thumb') {
  return url
    ? h('img', { class: cls, src: url, alt, loading: 'lazy' })
    : h('div', { class: `${cls} thumb-empty`, 'aria-hidden': 'true' }, alt?.[0]?.toUpperCase() ?? '?');
}

export function showPhoto(url, title) {
  openModal(title, h('img', { class: 'photo-full', src: url, alt: title }), { wide: true });
}
