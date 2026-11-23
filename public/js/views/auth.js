import { api } from '../api.js';
import { h, mount, field, handleSubmit } from '../dom.js';
import { icon } from '../icons.js';

function card(...children) {
  return h('div', { class: 'auth-card' }, h('div', { class: 'brand' }, h('span', { class: 'brand-mark', 'aria-hidden': 'true' }), 'Controle de Validade'), children);
}

export function renderLogin(main, ctx) {
  const form = h(
    'form',
    { class: 'stack', novalidate: true },
    field('E-mail', h('input', { type: 'email', name: 'email', autocomplete: 'username', required: true, placeholder: 'voce@mercadinho.com' })),
    field('Senha', h('input', { type: 'password', name: 'password', autocomplete: 'current-password', required: true })),
    h('p', { class: 'form-error', role: 'alert' }),
    h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Entrar'),
    h('div', { class: 'auth-links' }, h('a', { href: '#/esqueci-senha' }, 'Esqueci minha senha')),
  );
  handleSubmit(form, async (fd) => {
    const { user } = await api('/auth/login', { method: 'POST', body: Object.fromEntries(fd) });
    await ctx.onLogin(user);
  });
  mount(main, card(h('div', null, h('h1', null, 'Entrar'), h('p', { class: 'muted' }, 'Use o e-mail e a senha do seu acesso.')), form));
  form.querySelector('input').focus();
}

export function renderForgot(main) {
  const result = h('div');
  const form = h(
    'form',
    { class: 'stack' },
    field('E-mail', h('input', { type: 'email', name: 'email', autocomplete: 'username', required: true })),
    h('p', { class: 'form-error', role: 'alert' }),
    h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, icon('send', 16), 'Enviar link'),
  );
  handleSubmit(form, async (fd) => {
    const res = await api('/auth/forgot-password', { method: 'POST', body: { email: fd.get('email') } });
    mount(result, h('p', { class: 'notice' }, res.message));
    form.reset();
  });
  mount(
    main,
    card(
      h('div', null, h('h1', null, 'Esqueci minha senha'), h('p', { class: 'muted' }, 'Informe seu e-mail. Se ele estiver cadastrado, enviamos um link para criar uma senha nova.')),
      result,
      form,
      h('div', { class: 'auth-links' }, h('a', { href: '#/login' }, '← Voltar para o login')),
    ),
  );
}

export function renderSetPassword(main, ctx) {
  const token = ctx.query.get('token');
  if (!token) {
    mount(main, card(h('h1', null, 'Link inválido'), h('p', { class: 'muted' }, 'Abra o link que chegou no seu e-mail ou peça um novo.'), h('a', { href: '#/esqueci-senha', class: 'btn' }, 'Pedir novo link')));
    return;
  }
  const form = h(
    'form',
    { class: 'stack' },
    field('Nova senha', h('input', { type: 'password', name: 'password', minlength: 8, required: true, autocomplete: 'new-password' }), 'Mínimo de 8 caracteres.'),
    field('Repita a senha', h('input', { type: 'password', name: 'confirm', minlength: 8, required: true, autocomplete: 'new-password' })),
    h('p', { class: 'form-error', role: 'alert' }),
    h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Salvar senha e entrar'),
  );
  handleSubmit(form, async (fd) => {
    if (fd.get('password') !== fd.get('confirm')) throw new Error('As senhas não conferem');
    const { user } = await api('/auth/set-password', { method: 'POST', body: { token, password: fd.get('password') } });
    // Tira o token da barra de endereço
    history.replaceState(null, '', `${location.pathname}#/painel`);
    await ctx.onLogin(user);
  });
  mount(
    main,
    card(
      h('div', null, h('h1', null, 'Crie sua senha'), h('p', { class: 'muted' }, 'Escolha uma senha para acessar o sistema. O link só funciona uma vez.')),
      form,
      h('div', { class: 'auth-links' }, h('a', { href: '#/login' }, 'Já tenho senha')),
    ),
  );
}
