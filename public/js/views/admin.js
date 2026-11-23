import { api, invalidateCategories } from '../api.js';
import {
  h, mount, field, fmtDateTime, handleSubmit, openModal, confirmDialog, toast, pageHead, pager, skeleton,
  emptyState, debounce, qs, btn, initials,
} from '../dom.js';
import { icon } from '../icons.js';

/** Card com tabela paginada; `load(page)` busca e devolve { res, rows }. */
function pagedTable(headers, fetchPage, renderRow, emptyText, toolbar) {
  const body = h('div', null, skeleton(4));
  const card = h('section', { class: 'card' }, toolbar ?? null, body);
  async function load(page = 1) {
    mount(body, skeleton(4));
    const res = await fetchPage(page);
    mount(
      body,
      res.items.length
        ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, h('thead', null, h('tr', null, headers.map((t) => h('th', null, t)))), h('tbody', null, res.items.map(renderRow))))
        : emptyState('Nada por aqui', emptyText, null, 'search'),
      pager(res, load),
    );
  }
  return { card, load };
}

// ---- Categorias ------------------------------------------------------------------

export async function renderCategories(main) {
  let current = 1;
  let q = '';
  const table = pagedTable(
    ['Nome', 'Tipo', 'Produtos', ''],
    (page) => {
      current = page;
      return api(`/categories?${qs({ q, page, pageSize: 20 })}`);
    },
    (c) =>
      h(
        'tr',
        null,
        h('td', null, h('strong', null, c.name)),
        h('td', null, h('span', { class: `badge ${c.perishable ? 'badge-blue' : 'badge-muted'}` }, c.perishable ? 'Perecível' : 'Não perecível')),
        h('td', null, c.product_count),
        h(
          'td',
          null,
          h(
            'div',
            { class: 'row-actions' },
            h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => edit(c), 'aria-label': `Editar ${c.name}` }, icon('edit', 15), 'Editar'),
            h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => remove(c), 'aria-label': `Excluir ${c.name}` }, icon('trash', 15)),
          ),
        ),
      ),
    'Nenhuma categoria encontrada.',
    h('div', { class: 'toolbar' }, h('div', { class: 'input-icon' }, icon('search', 16), h('input', { type: 'search', placeholder: 'Buscar categoria', 'aria-label': 'Buscar categoria', oninput: debounce((e) => { q = e.target.value.trim(); table.load(1); }) }))),
  );
  const refresh = () => {
    invalidateCategories();
    return table.load(current);
  };

  function edit(c) {
    const form = h(
      'form',
      { class: 'stack' },
      field('Nome', h('input', { name: 'name', required: true, maxlength: 60, value: c?.name ?? '' })),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'perishable', checked: c ? Boolean(c.perishable) : true }), 'Perecível (estraga rápido)'),
      h('p', { class: 'form-error', role: 'alert' }),
      h('div', { class: 'actions' }, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Salvar')),
    );
    const modal = openModal(c ? 'Editar categoria' : 'Nova categoria', form);
    handleSubmit(form, async (fd) => {
      const body = { name: fd.get('name'), perishable: fd.get('perishable') === 'on' };
      await api(c ? `/categories/${c.id}` : '/categories', { method: c ? 'PATCH' : 'POST', body });
      modal.close();
      toast('Categoria salva');
      refresh();
    });
  }

  async function remove(c) {
    if (!(await confirmDialog(`Excluir a categoria "${c.name}"?`, { confirmText: 'Excluir', danger: true }))) return;
    try {
      await api(`/categories/${c.id}`, { method: 'DELETE' });
      toast('Categoria excluída');
      refresh();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  mount(main, pageHead('Categorias', 'Tipos de produto. Perecível define o que estraga rápido (frutas, verduras, laticínios…).', btn('Nova categoria', { iconName: 'plus', cls: 'btn btn-primary', onclick: () => edit(null) })), table.card);
  await table.load(1);
}

// ---- Usuários ----------------------------------------------------------------------

const ROLE_LABEL = { admin: 'Administrador', funcionario: 'Funcionário' };

function userStatus(u) {
  if (!u.active) return h('span', { class: 'badge badge-muted' }, 'Desativado');
  if (u.pending) return h('span', { class: 'badge badge-warn' }, icon('mail', 12), 'Convite pendente');
  return h('span', { class: 'badge badge-ok' }, 'Ativo');
}

export async function renderUsers(main, ctx) {
  let current = 1;
  let q = '';
  const table = pagedTable(
    ['Usuário', 'Papel', 'Situação', 'Desde', ''],
    (page) => {
      current = page;
      return api(`/users?${qs({ q, page, pageSize: 20 })}`);
    },
    (u) =>
      h(
        'tr',
        { class: u.active ? null : 'row-muted' },
        h('td', null, h('div', { class: 'cell-product' }, h('span', { class: 'avatar' }, initials(u.name)), h('div', null, h('strong', null, u.name, u.id === ctx.user.id ? ' (você)' : ''), h('div', { class: 'xs muted' }, u.email)))),
        h('td', null, ROLE_LABEL[u.role]),
        h('td', null, userStatus(u)),
        h('td', { class: 'nowrap small muted' }, fmtDateTime(u.created_at)),
        h(
          'td',
          null,
          h(
            'div',
            { class: 'row-actions' },
            u.active ? h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => resend(u) }, icon('send', 15), u.pending ? 'Reenviar convite' : 'Enviar link de senha') : null,
            h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => edit(u) }, icon('edit', 15), 'Editar'),
          ),
        ),
      ),
    'Nenhum usuário encontrado.',
    h('div', { class: 'toolbar' }, h('div', { class: 'input-icon' }, icon('search', 16), h('input', { type: 'search', placeholder: 'Buscar por nome ou e-mail', 'aria-label': 'Buscar usuário', oninput: debounce((e) => { q = e.target.value.trim(); table.load(1); }) }))),
  );
  const refresh = () => table.load(current);

  const roleSelect = (value) => h('select', { name: 'role' }, Object.entries(ROLE_LABEL).map(([v, l]) => h('option', { value: v, selected: v === value }, l)));

  function invite() {
    const form = h(
      'form',
      { class: 'stack' },
      h('p', { class: 'small muted' }, 'A pessoa recebe um e-mail com um link para criar a própria senha. Você não precisa (nem deve) saber a senha de ninguém.'),
      field('Nome', h('input', { name: 'name', required: true, maxlength: 100 })),
      field('E-mail', h('input', { name: 'email', type: 'email', required: true, autocomplete: 'off' })),
      field('Papel', roleSelect('funcionario')),
      h('p', { class: 'xs muted' }, 'Funcionário: cadastra produtos e entradas, registra vendas e perdas. Administrador: tudo, inclusive relatório e usuários.'),
      h('p', { class: 'form-error', role: 'alert' }),
      h('div', { class: 'actions' }, h('button', { class: 'btn btn-primary', type: 'submit' }, icon('send', 16), 'Enviar convite')),
    );
    const modal = openModal('Convidar usuário', form);
    handleSubmit(form, async (fd) => {
      const res = await api('/users', { method: 'POST', body: Object.fromEntries(fd) });
      modal.close();
      if (res.inviteSent) toast(`Convite enviado para ${res.email}`);
      else toast('Usuário criado, mas o e-mail não foi enviado. Confira o SMTP e use "Reenviar convite".', 'error');
      refresh();
    });
  }

  async function resend(u) {
    try {
      await api(`/users/${u.id}/invite`, { method: 'POST' });
      toast(`E-mail enviado para ${u.email}`);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function edit(u) {
    const self = u.id === ctx.user.id;
    const form = h(
      'form',
      { class: 'stack' },
      field('Nome', h('input', { name: 'name', required: true, maxlength: 100, value: u.name })),
      self ? h('p', { class: 'small muted' }, 'Você não pode mudar o próprio papel nem se desativar.') : field('Papel', roleSelect(u.role)),
      self ? null : h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'active', checked: Boolean(u.active) }), 'Ativo (pode entrar no sistema)'),
      self ? null : h('p', { class: 'xs muted' }, 'Mudar o papel ou desativar encerra na hora as sessões abertas dessa pessoa.'),
      h('p', { class: 'form-error', role: 'alert' }),
      h('div', { class: 'actions' }, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Salvar')),
    );
    const modal = openModal(`Editar ${u.name}`, form);
    handleSubmit(form, async (fd) => {
      const body = { name: fd.get('name') };
      if (!self) {
        body.role = fd.get('role');
        body.active = fd.get('active') === 'on';
      }
      await api(`/users/${u.id}`, { method: 'PATCH', body });
      modal.close();
      toast('Usuário atualizado');
      refresh();
    });
  }

  mount(main, pageHead('Usuários', 'Quem tem acesso ao sistema e o que cada um pode fazer.', btn('Convidar usuário', { iconName: 'send', cls: 'btn btn-primary', onclick: invite })), table.card);
  await table.load(1);
}

// ---- Auditoria ---------------------------------------------------------------------

const ACTION_LABEL = {
  login: 'Entrou',
  login_falhou: 'Login falhou',
  senha_alterada: 'Trocou a senha',
  senha_esquecida: 'Pediu redefinição de senha',
  senha_definida: 'Definiu a senha pelo link',
  acesso_negado: 'Acesso negado',
  usuario_criado: 'Convidou usuário',
  usuario_alterado: 'Alterou usuário',
  convite_reenviado: 'Reenviou convite',
  produto_excluido: 'Excluiu produto',
  lote_excluido: 'Excluiu lote',
};

export async function renderAudit(main) {
  let action = '';
  const ALERT = new Set(['acesso_negado', 'login_falhou']);
  const table = pagedTable(
    ['Quando', 'Quem', 'O quê', 'Detalhe', 'IP'],
    (page) => api(`/audit?${qs({ action, page, pageSize: 25 })}`),
    (r) =>
      h(
        'tr',
        { class: ALERT.has(r.action) ? 'row-alert' : null },
        h('td', { class: 'nowrap small' }, fmtDateTime(r.created_at)),
        h('td', null, r.user_name ?? '—'),
        h('td', null, h('span', { class: `badge ${ALERT.has(r.action) ? 'badge-danger' : 'badge-muted'}` }, ACTION_LABEL[r.action] ?? r.action)),
        h('td', { class: 'mono' }, r.detail ? JSON.stringify(r.detail) : ''),
        h('td', { class: 'small muted' }, r.ip ?? ''),
      ),
    'Nenhum evento.',
    h(
      'div',
      { class: 'toolbar' },
      h(
        'select',
        { 'aria-label': 'Tipo de evento', onchange: (e) => { action = e.target.value; table.load(1); } },
        h('option', { value: '' }, 'Todos os eventos'),
        Object.entries(ACTION_LABEL).map(([v, l]) => h('option', { value: v }, l)),
      ),
    ),
  );
  mount(main, pageHead('Auditoria', 'Eventos de segurança: logins, tentativas que falharam, acessos negados e mudanças de usuários.'), table.card);
  await table.load(1);
}
