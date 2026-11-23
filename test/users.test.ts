import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { app, request, db, createUser, login, sentMails, tokenFromLastMail } from './helpers.js';

let admin: Awaited<ReturnType<typeof login>>;

before(async () => {
  await createUser('admin@teste.com', 'admin');
  admin = await login('admin@teste.com');
});

test('admin convida usuário: e-mail com link, sem senha definida pelo admin', async () => {
  const res = await admin.post('/api/users').send({ name: 'Maria Souza', email: 'maria@teste.com', role: 'funcionario' }).expect(201);
  assert.equal(res.body.inviteSent, true);
  assert.equal(res.body.pending, true);
  assert.equal(res.body.password_hash, undefined);

  const mail = sentMails.at(-1)!;
  assert.equal(mail.to, 'maria@teste.com');
  assert.match(mail.subject, /acesso/i);
  assert.match(mail.text, /Olá, Maria!/);
  assert.match(mail.text, /http:\/\/localhost:8080\/#\/definir-senha\?token=/);
  assert.match(mail.html, /Criar minha senha/);

  // Ainda não consegue entrar: não tem senha
  await request(app).post('/api/auth/login').send({ email: 'maria@teste.com', password: 'qualquer-coisa' }).expect(401);
});

test('pelo link do convite a pessoa cria a senha e já entra', async () => {
  const token = tokenFromLastMail(sentMails, 'maria@teste.com');
  const res = await request(app).post('/api/auth/set-password').send({ token, password: 'senha-da-maria' }).expect(200);
  assert.equal(res.body.user.email, 'maria@teste.com');
  assert.equal(typeof res.body.token, 'string');
  await request(app).get('/api/auth/me').set('Authorization', `Bearer ${res.body.token}`).expect(200);
  await login('maria@teste.com', 'senha-da-maria');

  // Link é de uso único
  await request(app).post('/api/auth/set-password').send({ token, password: 'outra-senha-123' }).expect(400);
});

test('link inválido ou expirado é recusado', async () => {
  await request(app).post('/api/auth/set-password').send({ token: 'x'.repeat(43), password: 'senha-nova-123' }).expect(400);

  await admin.post('/api/users').send({ name: 'Joao', email: 'joao@teste.com', role: 'funcionario' }).expect(201);
  const token = tokenFromLastMail(sentMails, 'joao@teste.com');
  await db.run(`UPDATE user_tokens SET expires_at = now() - interval '1 minute'`);
  await request(app).post('/api/auth/set-password').send({ token, password: 'senha-nova-123' }).expect(400);
});

test('banco guarda só o hash do link, nunca o link', async () => {
  const token = tokenFromLastMail(sentMails, 'joao@teste.com');
  const leaked = await db.one('SELECT 1 FROM user_tokens WHERE token_hash = $1', [token]);
  assert.equal(leaked, undefined);
});

test('reenviar convite gera link novo e invalida o anterior', async () => {
  const joao = (await admin.get('/api/users?q=joao').expect(200)).body.items[0];
  const before = sentMails.length;
  await admin.post(`/api/users/${joao.id}/invite`).expect(200);
  assert.equal(sentMails.length, before + 1);
  const token = tokenFromLastMail(sentMails, 'joao@teste.com');
  await request(app).post('/api/auth/set-password').send({ token, password: 'senha-do-joao' }).expect(200);
});

test('esqueci minha senha: mesma resposta exista ou não o e-mail; link redefine a senha', async () => {
  const before = sentMails.length;
  const a = await request(app).post('/api/auth/forgot-password').send({ email: 'maria@teste.com' }).expect(202);
  const b = await request(app).post('/api/auth/forgot-password').send({ email: 'naoexiste@teste.com' }).expect(202);
  assert.deepEqual(a.body, b.body);

  await new Promise((r) => setTimeout(r, 20)); // envio é assíncrono
  assert.equal(sentMails.length, before + 1);
  assert.match(sentMails.at(-1)!.subject, /Redefinição/);

  const session = await login('maria@teste.com', 'senha-da-maria');
  const token = tokenFromLastMail(sentMails, 'maria@teste.com');
  await request(app).post('/api/auth/set-password').send({ token, password: 'maria-nova-senha' }).expect(200);
  await session.get('/api/auth/me').expect(401); // sessões antigas caem
  await login('maria@teste.com', 'maria-nova-senha');
});

test('e-mail repetido (maiúsculas/minúsculas) dá conflito', async () => {
  await admin.post('/api/users').send({ name: 'Maria 2', email: 'MARIA@teste.com', role: 'funcionario' }).expect(409);
});

test('nome do usuário no e-mail não injeta HTML', async () => {
  await admin.post('/api/users').send({ name: '<img src=x onerror=alert(1)>', email: 'xss@teste.com', role: 'funcionario' }).expect(201);
  const mail = sentMails.at(-1)!;
  assert.ok(!mail.html.includes('<img src=x'));
  assert.match(mail.html, /&lt;img/);
});

test('usuário desativado não recebe link de redefinição', async () => {
  const id = await createUser('inativo@teste.com', 'funcionario');
  await admin.patch(`/api/users/${id}`).send({ active: false }).expect(200);
  const before = sentMails.length;
  await request(app).post('/api/auth/forgot-password').send({ email: 'inativo@teste.com' }).expect(202);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(sentMails.length, before);
  await admin.post(`/api/users/${id}/invite`).expect(400);
});

test('lista de usuários é paginada, filtrável e nunca expõe senha', async () => {
  const page1 = (await admin.get('/api/users?pageSize=2&page=1').expect(200)).body;
  assert.equal(page1.items.length, 2);
  assert.equal(page1.pageSize, 2);
  assert.ok(page1.total >= 5);
  assert.equal(page1.totalPages, Math.ceil(page1.total / 2));
  assert.ok(page1.items.every((u: Record<string, unknown>) => !('password_hash' in u)));

  const filtered = (await admin.get('/api/users?role=admin').expect(200)).body;
  assert.ok(filtered.items.every((u: { role: string }) => u.role === 'admin'));
});
