// Arquivo separado: roda em outro processo, então o bloqueio não afeta os demais testes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { app, request } from './helpers.js';

test('login bloqueia após 10 tentativas erradas (força bruta)', async () => {
  for (let i = 0; i < 10; i++) {
    const res = await request(app).post('/api/auth/login').send({ email: 'alvo@teste.com', password: `chute${i}` });
    assert.equal(res.status, 401);
  }
  const blocked = await request(app).post('/api/auth/login').send({ email: 'alvo@teste.com', password: 'mais-um' });
  assert.equal(blocked.status, 429);
  assert.match(blocked.body.error, /Muitas tentativas/);
});

test('"esqueci a senha" limita pedidos para não disparar e-mails em massa', async () => {
  for (let i = 0; i < 5; i++) {
    await request(app).post('/api/auth/forgot-password').send({ email: `x${i}@teste.com` }).expect(202);
  }
  await request(app).post('/api/auth/forgot-password').send({ email: 'x@teste.com' }).expect(429);
});
