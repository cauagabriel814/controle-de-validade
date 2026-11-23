import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { app, request, db, createUser, login, PASSWORD } from './helpers.js';
import { PROTECTED_ROUTERS, PUBLIC_ROUTERS } from '../src/app.js';

let admin: Awaited<ReturnType<typeof login>>;
let staff: Awaited<ReturnType<typeof login>>;

before(async () => {
  await createUser('admin@teste.com', 'admin');
  await createUser('func@teste.com', 'funcionario');
  admin = await login('admin@teste.com');
  staff = await login('func@teste.com');
});

// ---- O middleware de acesso cobre TODAS as rotas --------------------------------------

interface Layer {
  route?: { path: string; methods: Record<string, boolean>; stack: { handle: unknown }[] };
  handle: unknown;
}

/** Percorre o router e devolve cada rota com a informação de acesso (própria ou herdada de router.use). */
function walk(stack: Layer[]) {
  const routes: { method: string; path: string; access?: { public?: true; permissions?: string[] } }[] = [];
  let inherited: { permissions: string[] } | undefined;
  for (const layer of stack) {
    if (layer.route) {
      const own = layer.route.stack.map((l) => (l.handle as { access?: never }).access).find(Boolean);
      for (const method of Object.keys(layer.route.methods)) {
        routes.push({ method: method.toUpperCase(), path: layer.route.path, access: own ?? inherited });
      }
    } else if ((layer.handle as { access?: never }).access) {
      inherited = (layer.handle as { access: { permissions: string[] } }).access;
    }
  }
  return routes;
}

const allRoutes = [
  ...PUBLIC_ROUTERS.flatMap(([prefix, router]) => walk((router as unknown as { stack: Layer[] }).stack).map((r) => ({ ...r, prefix }))),
  ...PROTECTED_ROUTERS.flatMap(([prefix, router]) => walk((router as unknown as { stack: Layer[] }).stack).map((r) => ({ ...r, prefix }))),
];

test('toda rota declara controle de acesso (authorize ou publicRoute)', () => {
  assert.ok(allRoutes.length > 30, `poucas rotas encontradas: ${allRoutes.length}`);
  const unguarded = allRoutes.filter((r) => !r.access).map((r) => `${r.method} ${r.prefix}${r.path}`);
  assert.deepEqual(unguarded, [], `Rotas sem authorize(): ${unguarded.join(', ')}`);
});

test('nenhuma rota protegida responde sem token', async () => {
  const protectedRoutes = allRoutes.filter((r) => !r.access?.public);
  for (const r of protectedRoutes) {
    const url = `/api${r.prefix}${r.path.replace(/:[a-z]+/gi, (p) => (p === ':name' ? '0f8fad5b-d9cb-469f-a165-70867728950e.jpg' : '1'))}`;
    const res = await request(app)[r.method.toLowerCase() as 'get'](url).send({});
    assert.equal(res.status, 401, `${r.method} ${url} respondeu ${res.status}`);
  }
});

test('as únicas rotas públicas são as de entrar e recuperar senha', () => {
  const pub = allRoutes.filter((r) => r.access?.public).map((r) => `${r.method} ${r.prefix}${r.path}`).sort();
  assert.deepEqual(pub, [
    'POST /auth/forgot-password',
    'POST /auth/login',
    'POST /auth/logout',
    'POST /auth/set-password',
  ]);
});

// ---- Token ---------------------------------------------------------------------------------

test('login devolve token que funciona como Authorization: Bearer', async () => {
  const res = await request(app).post('/api/auth/login').send({ email: 'func@teste.com', password: PASSWORD }).expect(200);
  assert.equal(typeof res.body.token, 'string');
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${res.body.token}`).expect(200);
  assert.equal(me.body.user.email, 'func@teste.com');
  // O mesmo token também respeita as permissões do papel
  await request(app).get('/api/users').set('Authorization', `Bearer ${res.body.token}`).expect(403);
});

test('Authorization malformado ou token adulterado é recusado', async () => {
  await request(app).get('/api/auth/me').set('Authorization', 'Basic abc').expect(401);
  await request(app).get('/api/auth/me').set('Authorization', 'Bearer abc.def.ghi').expect(401);
  await request(app).get('/api/auth/me').set('Cookie', 'sid=abc.def.ghi').expect(401);
});

test('token assinado com outro segredo é recusado', async () => {
  const jwt = (await import('jsonwebtoken')).default;
  const forged = jwt.sign({ tv: 0 }, 'segredo-do-atacante-com-mais-de-32-caracteres', { subject: '1' });
  await request(app).get('/api/auth/me').set('Authorization', `Bearer ${forged}`).expect(401);
});

test('token com algoritmo "none" é recusado', async () => {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: '1', tv: 0 })).toString('base64url');
  await request(app).get('/api/auth/me').set('Authorization', `Bearer ${header}.${payload}.`).expect(401);
});

test('login e /me nunca devolvem hash de senha', async () => {
  const res = await request(app).post('/api/auth/login').send({ email: 'admin@teste.com', password: PASSWORD }).expect(200);
  assert.deepEqual(Object.keys(res.body.user).sort(), ['email', 'id', 'name', 'permissions', 'role']);
  const me = await admin.get('/api/auth/me').expect(200);
  assert.deepEqual(Object.keys(me.body.user).sort(), ['email', 'id', 'name', 'permissions', 'role']);
});

test('login com senha errada: mesma mensagem para e-mail que existe e que não existe', async () => {
  const a = await request(app).post('/api/auth/login').send({ email: 'admin@teste.com', password: 'errada' });
  const b = await request(app).post('/api/auth/login').send({ email: 'ninguem@teste.com', password: 'errada' });
  assert.equal(a.status, 401);
  assert.equal(a.body.error, b.body.error);
});

test('e-mail no login não diferencia maiúsculas', async () => {
  await request(app).post('/api/auth/login').send({ email: 'ADMIN@Teste.com', password: PASSWORD }).expect(200);
});

test('cookie de sessão é httpOnly e SameSite=Strict', async () => {
  const res = await request(app).post('/api/auth/login').send({ email: 'func@teste.com', password: PASSWORD });
  const cookie = String(res.headers['set-cookie']);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
});

test('trocar a senha derruba as outras sessões e mantém a atual', async () => {
  await createUser('troca@teste.com', 'funcionario');
  const celular = await login('troca@teste.com');
  const computador = await login('troca@teste.com');
  await celular.post('/api/auth/change-password').send({ currentPassword: PASSWORD, newPassword: 'nova-senha-456' }).expect(200);
  await celular.get('/api/auth/me').expect(200);
  await computador.get('/api/auth/me').expect(401);
  await login('troca@teste.com', 'nova-senha-456');
});

test('troca de senha exige a atual correta e senha nova forte', async () => {
  await staff.post('/api/auth/change-password').send({ currentPassword: 'errada', newPassword: 'nova-senha-456' }).expect(400);
  await staff.post('/api/auth/change-password').send({ currentPassword: PASSWORD, newPassword: '123' }).expect(400);
});

test('usuário desativado perde a sessão na hora', async () => {
  const id = await createUser('temp@teste.com', 'funcionario');
  const temp = await login('temp@teste.com');
  await admin.patch(`/api/users/${id}`).send({ active: false }).expect(200);
  await temp.get('/api/auth/me').expect(401);
  await request(app).post('/api/auth/login').send({ email: 'temp@teste.com', password: PASSWORD }).expect(401);
});

// ---- Autorização por papel ---------------------------------------------------------------

test('funcionário não acessa área administrativa', async () => {
  await staff.get('/api/users').expect(403);
  await staff.post('/api/users').send({ name: 'X', email: 'x@x.com', role: 'admin' }).expect(403);
  await staff.get('/api/reports/monthly').expect(403);
  await staff.get('/api/audit').expect(403);
  await staff.post('/api/categories').send({ name: 'Nova', perishable: true }).expect(403);
  await staff.delete('/api/products/1').expect(403);
  await staff.delete('/api/lots/1').expect(403);
  await staff.put('/api/reports/settings').send({ baselineMonthlyLoss: 1 }).expect(403);
});

test('acesso negado fica registrado na auditoria', async () => {
  await staff.get('/api/users').expect(403);
  const res = await admin.get('/api/audit?action=acesso_negado').expect(200);
  assert.ok(res.body.total >= 1);
  assert.ok(res.body.items.every((a: { action: string }) => a.action === 'acesso_negado'));
});

test('promover funcionário a admin derruba a sessão antiga; no novo login vale o novo papel', async () => {
  const id = await createUser('promovido@teste.com', 'funcionario');
  const antes = await login('promovido@teste.com');
  await antes.get('/api/reports/monthly').expect(403);
  await admin.patch(`/api/users/${id}`).send({ role: 'admin' }).expect(200);
  await antes.get('/api/auth/me').expect(401);
  const depois = await login('promovido@teste.com');
  await depois.get('/api/reports/monthly').expect(200);
});

test('admin não pode rebaixar nem desativar a si mesmo', async () => {
  const me = (await admin.get('/api/auth/me')).body.user;
  await admin.patch(`/api/users/${me.id}`).send({ role: 'funcionario' }).expect(400);
  await admin.patch(`/api/users/${me.id}`).send({ active: false }).expect(400);
});

// ---- Outras barreiras --------------------------------------------------------------------------

test('POST de outro site é bloqueado (CSRF)', async () => {
  await staff.post('/api/categories').set('Origin', 'https://site-malicioso.com').send({}).expect(403);
  await staff.post('/api/auth/logout').set('Origin', 'null').expect(403);
});

test('cabeçalhos de segurança e API sem cache', async () => {
  const res = await staff.get('/api/dashboard').expect(200);
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.equal(res.headers['x-powered-by'], undefined);
  assert.equal(res.headers['cache-control'], 'no-store');
});

test('rota inexistente dá 404 em JSON; JSON quebrado dá 400 sem detalhes internos', async () => {
  const res = await staff.get('/api/nao-existe').expect(404);
  assert.equal(res.body.error, 'Rota não encontrada');
  const bad = await staff.post('/api/lots').set('Content-Type', 'application/json').send('{quebrado').expect(400);
  assert.equal(bad.body.stack, undefined);
});

test('IDs absurdos são recusados sem erro interno', async () => {
  await staff.get('/api/products/99999999999').expect(400);
  await staff.get('/api/products/abc').expect(400);
  await staff.get('/api/products/-1').expect(400);
});

test('/api/health é público e confere o banco', async () => {
  const res = await request(app).get('/api/health').expect(200);
  assert.equal(res.body.status, 'ok');
  assert.ok(await db.one('SELECT 1'));
});
