import { api } from '../api.js';
import { h, mount, field, handleSubmit, toast, pageHead, initials } from '../dom.js';
import { icon } from '../icons.js';

const ROLE_LABEL = { admin: 'Administrador', funcionario: 'Funcionário' };

export async function render(main, ctx) {
  const u = ctx.user;
  const form = h(
    'form',
    { class: 'card form-narrow' },
    h(
      'div',
      { class: 'form-section' },
      h('div', { class: 'form-section-title' }, icon('lock', 18), 'Trocar senha'),
      field('Senha atual', h('input', { name: 'currentPassword', type: 'password', required: true, autocomplete: 'current-password' })),
      h(
        'div',
        { class: 'grid-2' },
        field('Nova senha', h('input', { name: 'newPassword', type: 'password', required: true, minlength: 8, autocomplete: 'new-password' }), 'Mínimo de 8 caracteres.'),
        field('Repita a nova senha', h('input', { name: 'confirm', type: 'password', required: true, minlength: 8, autocomplete: 'new-password' })),
      ),
      h('p', { class: 'xs muted' }, 'Ao trocar, as sessões abertas em outros aparelhos são encerradas.'),
      h('p', { class: 'form-error', role: 'alert' }),
    ),
    h('div', { class: 'form-footer' }, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Trocar senha')),
  );

  handleSubmit(form, async (fd) => {
    if (fd.get('newPassword') !== fd.get('confirm')) throw new Error('As senhas novas não conferem');
    await api('/auth/change-password', { method: 'POST', body: { currentPassword: fd.get('currentPassword'), newPassword: fd.get('newPassword') } });
    form.reset();
    toast('Senha alterada');
  });

  mount(
    main,
    pageHead('Minha conta'),
    h(
      'section',
      { class: 'card card-pad form-narrow' },
      h(
        'div',
        { class: 'cell-product' },
        h('span', { class: 'avatar', style: null }, initials(u.name)),
        h('div', null, h('strong', null, u.name), h('div', { class: 'small muted' }, `${u.email} · ${ROLE_LABEL[u.role]}`)),
      ),
    ),
    h('div', { class: 'section-gap' }, form),
  );
}
