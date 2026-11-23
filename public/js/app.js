import { api, setUnauthorizedHandler } from './api.js';
import { h, mount, skeleton, toast, initials, emptyState } from './dom.js';
import { icon } from './icons.js';
import * as auth from './views/auth.js';
import * as painel from './views/painel.js';
import * as vencimentos from './views/vencimentos.js';
import * as produtos from './views/produtos.js';
import * as produto from './views/produto.js';
import * as lote from './views/lote.js';
import * as relatorio from './views/relatorio.js';
import * as admin from './views/admin.js';
import * as conta from './views/conta.js';
import * as ajuda from './views/ajuda.js';

const $ = (id) => document.getElementById(id);
const state = { user: null, expiredCount: 0 };
const can = (permission) => Boolean(state.user?.permissions.includes(permission));

const ROLE_LABEL = { admin: 'Administrador', funcionario: 'Funcionário' };

// Telas sem login
const PUBLIC_ROUTES = [
  { pattern: /^\/login$/, view: auth.renderLogin },
  { pattern: /^\/esqueci-senha$/, view: auth.renderForgot },
  { pattern: /^\/definir-senha$/, view: auth.renderSetPassword },
];

// A permissão aqui só esconde a tela; quem barra de verdade é o authorize() da API.
const ROUTES = [
  { pattern: /^\/painel$/, view: painel.render, perm: 'lots:read' },
  { pattern: /^\/vencimentos$/, view: vencimentos.render, perm: 'lots:read' },
  { pattern: /^\/produtos$/, view: produtos.render, perm: 'products:read' },
  { pattern: /^\/produtos\/novo$/, view: produto.renderForm, perm: 'products:write' },
  { pattern: /^\/produtos\/(\d+)$/, view: produto.renderDetail, perm: 'products:read' },
  { pattern: /^\/produtos\/(\d+)\/editar$/, view: produto.renderForm, perm: 'products:write' },
  { pattern: /^\/lotes\/novo$/, view: lote.renderForm, perm: 'lots:write' },
  { pattern: /^\/lotes\/(\d+)\/editar$/, view: lote.renderForm, perm: 'lots:write' },
  { pattern: /^\/relatorio$/, view: relatorio.render, perm: 'reports:read' },
  { pattern: /^\/categorias$/, view: admin.renderCategories, perm: 'categories:write' },
  { pattern: /^\/usuarios$/, view: admin.renderUsers, perm: 'users:manage' },
  { pattern: /^\/auditoria$/, view: admin.renderAudit, perm: 'audit:read' },
  { pattern: /^\/conta$/, view: conta.render, perm: null },
  { pattern: /^\/ajuda$/, view: ajuda.render, perm: null },
];

const MENU = [
  { section: 'Operação' },
  { label: 'Painel', href: '/painel', iconName: 'dashboard', perm: 'lots:read' },
  { label: 'Vencimentos', href: '/vencimentos', iconName: 'calendar', perm: 'lots:read', badge: () => state.expiredCount },
  { label: 'Produtos', href: '/produtos', iconName: 'package', perm: 'products:read' },
  { label: 'Nova entrada', href: '/lotes/novo', iconName: 'plusCircle', perm: 'lots:write' },
  { label: 'Guia da equipe', href: '/ajuda', iconName: 'leaf', perm: null },
  { section: 'Gestão', perm: 'reports:read' },
  { label: 'Relatório', href: '/relatorio', iconName: 'chart', perm: 'reports:read' },
  { label: 'Categorias', href: '/categorias', iconName: 'tag', perm: 'categories:write' },
  { label: 'Usuários', href: '/usuarios', iconName: 'users', perm: 'users:manage' },
  { label: 'Auditoria', href: '/auditoria', iconName: 'shield', perm: 'audit:read' },
];

function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/painel';
  const [path, query] = raw.split('?');
  return { path, query: new URLSearchParams(query ?? '') };
}

export function go(path) {
  location.hash = `#${path}`;
}

// ---- Menu lateral --------------------------------------------------------------------

function renderNav(currentPath) {
  const items = MENU.filter((m) => !m.perm || can(m.perm)).map((m) => {
    if (m.section) return h('div', { class: 'nav-section' }, m.section);
    const active = currentPath === m.href || (m.href !== '/painel' && currentPath.startsWith(`${m.href}/`) && m.href !== '/lotes/novo');
    const badge = m.badge?.();
    return h(
      'a',
      { href: `#${m.href}`, class: `nav-link ${active ? 'active' : ''}`, 'aria-current': active ? 'page' : null },
      icon(m.iconName, 19),
      m.label,
      badge ? h('span', { class: 'nav-badge', title: 'Lotes vencidos em estoque' }, badge > 99 ? '99+' : badge) : null,
    );
  });
  mount($('nav'), items);
}

function setMenu(open) {
  $('sidebar').classList.toggle('open', open);
  $('backdrop').hidden = !open;
  $('menu-toggle').setAttribute('aria-expanded', String(open));
}

async function refreshBadge() {
  if (!can('lots:read')) return;
  try {
    state.expiredCount = (await api('/lots?expired=true&pageSize=1')).total;
  } catch {
    /* sem badge, sem problema */
  }
}

// ---- Roteamento ------------------------------------------------------------------------

async function route() {
  const { path, query } = parseHash();
  setMenu(false);

  const publicMatch = PUBLIC_ROUTES.find((r) => r.pattern.test(path));
  if (publicMatch) {
    if (state.user && path === '/login') return go('/painel');
    showPublic();
    await publicMatch.view($('public-view'), { query, go, onLogin: showApp });
    return;
  }
  if (!state.user) return go('/login');

  showShell();
  const main = $('view');
  renderNav(path);

  const match = ROUTES.map((r) => ({ ...r, m: path.match(r.pattern) })).find((r) => r.m);
  if (!match) return go('/painel');
  if (match.perm && !can(match.perm)) {
    mount(main, emptyState('Sem permissão', 'Seu usuário não tem acesso a esta área.', null, 'lock'));
    return;
  }

  mount(main, skeleton());
  try {
    await match.view(main, { user: state.user, can, go, params: match.m.slice(1), query, refreshBadge: () => refreshBadge().then(() => renderNav(path)) });
  } catch (err) {
    if (err.status === 401) return;
    mount(main, emptyState('Não foi possível carregar', err.message || 'Tente novamente.', null, 'alert'));
  }
  main.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

function showPublic() {
  $('app-shell').hidden = true;
  $('public-screen').hidden = false;
}

function showShell() {
  $('public-screen').hidden = true;
  $('app-shell').hidden = false;
}

function renderUserChip() {
  const u = state.user;
  mount(
    $('user-chip'),
    h('span', { class: 'avatar' }, initials(u.name)),
    h('span', { class: 'user-chip-text' }, h('strong', null, u.name), h('span', null, ROLE_LABEL[u.role])),
  );
}

async function showApp(user) {
  state.user = user;
  renderUserChip();
  await refreshBadge();
  const { path } = parseHash();
  if (PUBLIC_ROUTES.some((r) => r.pattern.test(path))) go('/painel');
  else route();
}

function logoutLocal() {
  state.user = null;
  document.getElementById('modal').close();
  go('/login');
}

setUnauthorizedHandler(() => {
  if (state.user) toast('Sua sessão terminou. Entre novamente.', 'error');
  logoutLocal();
});

// ---- Eventos fixos ----------------------------------------------------------------------

mount($('menu-toggle'), icon('menu', 20));
mount($('logout'), icon('logout', 19), 'Sair');
$('menu-toggle').addEventListener('click', () => setMenu(!$('sidebar').classList.contains('open')));
$('backdrop').addEventListener('click', () => setMenu(false));
$('logout').addEventListener('click', async () => {
  await api('/auth/logout', { method: 'POST' }).catch(() => {});
  logoutLocal();
});
window.addEventListener('hashchange', route);

// ---- Início -------------------------------------------------------------------------------

const { path } = parseHash();
if (PUBLIC_ROUTES.some((r) => r.pattern.test(path)) && path !== '/login') {
  route();
} else {
  api('/auth/me')
    .then(({ user }) => showApp(user))
    .catch(() => {
      state.user = null;
      if (parseHash().path === '/login') route();
      else go('/login');
    });
}
