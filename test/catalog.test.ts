import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { app, request, createUser, login, PNG, storage } from './helpers.js';
import { addDays, today } from '../src/lib/dates.js';

let admin: Awaited<ReturnType<typeof login>>;
let staff: Awaited<ReturnType<typeof login>>;
const files = (storage as unknown as { files: Map<string, unknown> }).files;

before(async () => {
  await createUser('admin@teste.com', 'admin');
  await createUser('func@teste.com', 'funcionario');
  admin = await login('admin@teste.com');
  staff = await login('func@teste.com');
});

async function product(name: string, categoryId = 3, extra: Record<string, unknown> = {}) {
  return (await staff.post('/api/products').send({ name, categoryId, ...extra }).expect(201)).body;
}
async function lot(productId: number, days: number, quantity = 5, extra: Record<string, unknown> = {}) {
  return (
    await staff
      .post('/api/lots')
      .send({ productId, quantity, expiryDate: addDays(today(), days), costPrice: 4, salePrice: 6, ...extra })
      .expect(201)
  ).body;
}
const ids = (page: { items: { id: number }[] }) => page.items.map((i) => i.id).sort((a, b) => a - b);

// ---- Busca por dias -----------------------------------------------------------------------

test('busca de vencimentos: 5 dias, 10 dias, vencidos e combinação', async () => {
  const p = await product('Iogurte natural');
  const expired = await lot(p.id, -3);
  const in2 = await lot(p.id, 2);
  const in5 = await lot(p.id, 5);
  const in8 = await lot(p.id, 8);
  const in20 = await lot(p.id, 20);
  const q = `productId=${p.id}`;

  assert.deepEqual(ids((await staff.get(`/api/lots?days=5&${q}`).expect(200)).body), [in2.id, in5.id]);
  assert.deepEqual(ids((await staff.get(`/api/lots?days=10&${q}`).expect(200)).body), [in2.id, in5.id, in8.id]);
  assert.deepEqual(ids((await staff.get(`/api/lots?days=0&${q}`).expect(200)).body), []);
  assert.deepEqual(ids((await staff.get(`/api/lots?expired=true&${q}`).expect(200)).body), [expired.id]);
  assert.deepEqual(ids((await staff.get(`/api/lots?expired=true&days=5&${q}`).expect(200)).body), [expired.id, in2.id, in5.id]);
  assert.deepEqual(ids((await staff.get(`/api/lots?expired=false&${q}`).expect(200)).body), [in2.id, in5.id, in8.id, in20.id]);

  const first = (await staff.get(`/api/lots?days=10&${q}`).expect(200)).body.items[0];
  assert.equal(first.days_left, 2);
  assert.equal(first.product_name, 'Iogurte natural');
});

test('busca valida os parâmetros', async () => {
  await staff.get('/api/lots?days=-1').expect(400);
  await staff.get('/api/lots?days=366').expect(400);
  await staff.get('/api/lots?days=abc').expect(400);
  await staff.get('/api/lots?sort=drop table').expect(400);
});

test('busca filtra por nome, categoria, perecível e promoção', async () => {
  const arroz = await product('Arroz tipo 1', 7);
  const a = await lot(arroz.id, 4);
  const banana = await product('Banana nanica', 1);
  const b = await lot(banana.id, 4);
  await staff.post(`/api/lots/${b.id}/promo`).send({ promoPrice: 3 }).expect(200);

  assert.deepEqual(ids((await staff.get('/api/lots?days=5&q=arroz').expect(200)).body), [a.id]);
  assert.deepEqual(ids((await staff.get('/api/lots?days=5&categoryId=1').expect(200)).body), [b.id]);
  const nonPerishable = (await staff.get('/api/lots?days=5&perishable=false').expect(200)).body.items;
  assert.ok(nonPerishable.every((l: { perishable: boolean }) => l.perishable === false));
  const promo = (await staff.get('/api/lots?promo=true').expect(200)).body.items;
  assert.deepEqual(promo.map((l: { id: number }) => l.id), [b.id]);
  assert.equal(promo[0].in_promo, true);
});

// ---- Paginação ------------------------------------------------------------------------------

test('listagens são paginadas e respeitam o limite máximo de 100', async () => {
  const p = await product('Biscoito', 7);
  for (let i = 0; i < 7; i++) await lot(p.id, 30 + i, 1);

  const page1 = (await staff.get(`/api/lots?productId=${p.id}&pageSize=3&page=1`).expect(200)).body;
  const page3 = (await staff.get(`/api/lots?productId=${p.id}&pageSize=3&page=3`).expect(200)).body;
  assert.equal(page1.items.length, 3);
  assert.equal(page1.total, 7);
  assert.equal(page1.totalPages, 3);
  assert.equal(page3.items.length, 1);
  assert.ok(page1.items[0].expiry_date < page3.items[0].expiry_date);

  const beyond = (await staff.get(`/api/lots?productId=${p.id}&pageSize=3&page=9`).expect(200)).body;
  assert.deepEqual(beyond.items, []);
  assert.equal(beyond.total, 7);

  for (const url of ['/api/lots', '/api/products', '/api/categories']) {
    await staff.get(`${url}?pageSize=101`).expect(400);
    await staff.get(`${url}?page=0`).expect(400);
    const def = (await staff.get(url).expect(200)).body;
    assert.equal(def.pageSize, 20);
    assert.ok(def.items.length <= 20);
  }
  for (const url of ['/api/users', '/api/audit']) {
    await admin.get(`${url}?pageSize=101`).expect(400);
  }
});

// ---- Produtos -------------------------------------------------------------------------------

test('produto com foto: vai para o armazenamento e só aparece logado', async () => {
  const res = await staff
    .post('/api/products')
    .field('name', 'Maçã gala')
    .field('categoryId', '1')
    .field('unit', 'kg')
    .attach('photo', PNG, { filename: 'maca.png', contentType: 'image/png' })
    .expect(201);
  const photo = res.body.photo as string;
  assert.ok(files.has(photo));

  const img = await staff.get(`/api/files/${photo}`).expect(200);
  assert.equal(img.headers['content-type'], 'image/png');
  assert.equal(img.body.length, PNG.length);
  await request(app).get(`/api/files/${photo}`).expect(401);
  await staff.get('/api/files/..%2F..%2F.env').expect(404);
  await staff.get('/api/files/0f8fad5b-d9cb-469f-a165-70867728950e.jpg').expect(404);
});

test('upload recusa arquivo que finge ser imagem', async () => {
  await staff
    .post('/api/products')
    .field('name', 'Fake')
    .field('categoryId', '1')
    .attach('photo', Buffer.from('<script>alert(1)</script>'), { filename: 'x.png', contentType: 'image/png' })
    .expect(400);
  await staff
    .post('/api/products')
    .field('name', 'Fake')
    .field('categoryId', '1')
    .attach('photo', Buffer.from('<svg/>'), { filename: 'x.svg', contentType: 'image/svg+xml' })
    .expect(400);
});

test('trocar e remover a foto apaga o arquivo antigo do armazenamento', async () => {
  const created = await staff
    .post('/api/products')
    .field('name', 'Pão francês')
    .field('categoryId', '5')
    .attach('photo', PNG, { filename: 'a.png', contentType: 'image/png' })
    .expect(201);
  const old = created.body.photo;
  const updated = await staff
    .patch(`/api/products/${created.body.id}`)
    .field('name', 'Pão francês')
    .field('categoryId', '5')
    .attach('photo', PNG, { filename: 'b.png', contentType: 'image/png' })
    .expect(200);
  assert.ok(!files.has(old));
  assert.ok(files.has(updated.body.photo));

  const removed = await staff
    .patch(`/api/products/${created.body.id}`)
    .field('name', 'Pão francês')
    .field('categoryId', '5')
    .field('removePhoto', 'true')
    .expect(200);
  assert.equal(removed.body.photo, null);
  assert.ok(!files.has(updated.body.photo));
});

test('lista de produtos: busca, filtros, estoque e próximo vencimento', async () => {
  const leite = await product('Leite integral', 3, { unit: 'l', barcode: '7891000100103' });
  await lot(leite.id, 9, 12);
  await lot(leite.id, 3, 6);

  const res = (await staff.get('/api/products?q=leite').expect(200)).body;
  const item = res.items.find((p: { id: number }) => p.id === leite.id);
  assert.equal(item.stock, 18);
  assert.equal(item.open_lots, 2);
  assert.equal(item.next_expiry, addDays(today(), 3));
  assert.equal(item.days_left, 3);

  assert.equal((await staff.get('/api/products?q=7891000100103').expect(200)).body.items[0].id, leite.id);
  const np = (await staff.get('/api/products?perishable=false').expect(200)).body.items;
  assert.ok(np.length >= 1 && np.every((p: { perishable: boolean }) => p.perishable === false));
  const noStock = (await staff.get('/api/products?inStock=false').expect(200)).body.items;
  assert.ok(noStock.every((p: { open_lots: number }) => p.open_lots === 0));

  const detail = (await staff.get(`/api/products/${leite.id}`).expect(200)).body;
  assert.equal(detail.stock, 18);
});

test('validação recusa dados ruins e busca com caracteres especiais é segura', async () => {
  await staff.post('/api/lots').send({ productId: 1, quantity: -1, expiryDate: '2026-02-30' }).expect(400);
  await staff.post('/api/products').send({ name: 'Xy', categoryId: 9999 }).expect(400);
  await staff.post('/api/products').send({ name: 'Arroz', categoryId: 7, barcode: "1' OR 1=1" }).expect(400);
  const res = await staff.get(`/api/products?q=${encodeURIComponent("%' OR 1=1 --")}`).expect(200);
  assert.deepEqual(res.body.items, []);
});

test('código de barras repetido dá conflito; liberado após excluir o produto', async () => {
  const p = await product('Feijão', 7, { barcode: '7891234567890' });
  const dup = await staff.post('/api/products').send({ name: 'Outro feijão', categoryId: 7, barcode: '7891234567890' });
  assert.equal(dup.status, 409);
  await admin.delete(`/api/products/${p.id}`).expect(204);
  await product('Feijão novo', 7, { barcode: '7891234567890' });
});

// ---- Lotes e saídas ------------------------------------------------------------------------------

test('lote com foto da validade, edição e exclusão só pelo admin', async () => {
  const p = await product('Requeijão');
  const created = (
    await staff
      .post('/api/lots')
      .field('productId', String(p.id))
      .field('quantity', '6')
      .field('expiryDate', addDays(today(), 3))
      .field('costPrice', '2.5')
      .attach('expiryPhoto', PNG, { filename: 'etiqueta.png', contentType: 'image/png' })
      .expect(201)
  ).body;
  assert.ok(files.has(created.expiry_photo));
  assert.equal(created.days_left, 3);

  const edited = (await staff.patch(`/api/lots/${created.id}`).send({ expiryDate: addDays(today(), 10), costPrice: 3 }).expect(200)).body;
  assert.equal(edited.days_left, 10);
  assert.equal(edited.cost_price, 3);
  assert.equal(edited.expiry_photo, created.expiry_photo);

  await staff.delete(`/api/lots/${created.id}`).expect(403);
  await admin.delete(`/api/lots/${created.id}`).expect(204);
  assert.ok(!files.has(created.expiry_photo));
  await staff.get(`/api/lots/${created.id}`).expect(404);
});

test('venda usa preço promocional só com promoção ativa; ajuste não tem valor', async () => {
  const p = await product('Queijo minas', 3, { unit: 'kg' });
  const l = await lot(p.id, 2, 4, { costPrice: 20, salePrice: 35 });
  await staff.post(`/api/lots/${l.id}/promo`).send({ promoPrice: 25 }).expect(200);
  await staff.post(`/api/lots/${l.id}/movements`).send({ type: 'venda', quantity: 1 }).expect(201);
  await staff.delete(`/api/lots/${l.id}/promo`).expect(200);
  await staff.post(`/api/lots/${l.id}/movements`).send({ type: 'venda', quantity: 1 }).expect(201);
  await staff.post(`/api/lots/${l.id}/movements`).send({ type: 'ajuste', quantity: 0.5, reason: 'contagem' }).expect(201);

  const moves = (await staff.get(`/api/lots/${l.id}/movements`).expect(200)).body;
  assert.equal(moves.total, 3);
  const [ajuste, normal, promo] = moves.items;
  assert.deepEqual([promo.unit_value, promo.in_promo], [25, true]);
  assert.deepEqual([normal.unit_value, normal.in_promo], [35, false]);
  assert.equal(ajuste.unit_value, 0);
  assert.equal((await staff.get(`/api/lots/${l.id}`).expect(200)).body.quantity, 1.5);
});

test('não sai mais do que tem, nem com pedidos simultâneos', async () => {
  const p = await product('Alface', 2, { unit: 'maço' });
  const l = await lot(p.id, 1, 3);
  await staff.post(`/api/lots/${l.id}/movements`).send({ type: 'perda', quantity: 4 }).expect(400);

  const results = await Promise.all(
    [1, 2, 3, 4, 5].map(() => staff.post(`/api/lots/${l.id}/movements`).send({ type: 'venda', quantity: 1 })),
  );
  assert.equal(results.filter((r) => r.status === 201).length, 3);
  const after = (await staff.get(`/api/lots/${l.id}`).expect(200)).body;
  assert.equal(after.quantity, 0);

  // Lote zerado sai da busca e não aceita promoção
  const open = (await staff.get(`/api/lots?productId=${p.id}`).expect(200)).body;
  assert.equal(open.total, 0);
  const closed = (await staff.get(`/api/lots?productId=${p.id}&state=closed`).expect(200)).body;
  assert.equal(closed.total, 1);
  await staff.post(`/api/lots/${l.id}/promo`).send({ promoPrice: 1 }).expect(400);
});

test('lote com histórico não pode ser apagado', async () => {
  const p = await product('Manteiga');
  const l = await lot(p.id, 4);
  await staff.post(`/api/lots/${l.id}/movements`).send({ type: 'venda', quantity: 1 }).expect(201);
  await admin.delete(`/api/lots/${l.id}`).expect(409);
});

// ---- Painel e relatório -------------------------------------------------------------------

test('painel conta vencidos, 7 e 15 dias sem sobreposição', async () => {
  const dash = (await staff.get('/api/dashboard').expect(200)).body;
  const count = async (qs: string) => (await staff.get(`/api/lots?${qs}&pageSize=1`).expect(200)).body.total;
  assert.equal(dash.expired, await count('expired=true'));
  assert.equal(dash.within7, await count('days=7'));
  assert.equal(dash.within7 + dash.within15, await count('days=15'));
  assert.ok(dash.valueAtRisk > 0);
  assert.equal(dash.today, today());
});

test('relatório: perdas a preço de custo, recuperado em promoção, linha de base e CSV', async () => {
  const p = await product('Presunto', 4);
  const l = await lot(p.id, 3, 10, { costPrice: 4, salePrice: 6 });
  await staff.post(`/api/lots/${l.id}/promo`).send({ promoPrice: 4.5 }).expect(200);
  await staff.post(`/api/lots/${l.id}/movements`).send({ type: 'venda', quantity: 8 }).expect(201);
  await staff.post(`/api/lots/${l.id}/movements`).send({ type: 'perda', quantity: 2, reason: 'Vencido' }).expect(201);

  const report = (await admin.get('/api/reports/monthly?months=2').expect(200)).body;
  assert.equal(report.monthly.length, 2);
  const current = report.monthly.at(-1);
  assert.ok(current.lossValue >= 8); // 2 × custo 4
  assert.ok(current.recoveredValue >= 36); // 8 × 4,50
  assert.ok(report.topLosses.some((t: { product: string }) => t.product === 'Presunto'));

  await admin.put('/api/reports/settings').send({ baselineMonthlyLoss: current.lossValue * 2 }).expect(200);
  const withBase = (await admin.get('/api/reports/monthly?months=1').expect(200)).body;
  assert.equal(withBase.monthly[0].changeVsBaseline, -50);

  // Meses antes do sistema ser usado não aparecem como "100% menor"
  const six = (await admin.get('/api/reports/monthly?months=6').expect(200)).body.monthly;
  for (const m of six.slice(0, -1)) {
    assert.equal(m.inUse, false);
    assert.equal(m.changeVsBaseline, null);
    assert.equal(m.changeVsPrevMonth, null);
  }
  assert.equal(six.at(-1).inUse, true);

  const csv = await admin.get('/api/reports/monthly.csv?months=2').expect(200);
  assert.match(csv.headers['content-type'], /text\/csv/);
  assert.ok(csv.text.startsWith('﻿'));
  const lines = csv.text.slice(1).split('\r\n');
  assert.equal(lines.length, 3);
  assert.match(lines[0]!, /^Mês;Perdas/);
});

test('produto excluído some da lista mas a perda continua no relatório', async () => {
  const p = await product('Tomate', 2, { unit: 'kg' });
  const l = await lot(p.id, 0, 5, { costPrice: 6 });
  await staff.post(`/api/lots/${l.id}/movements`).send({ type: 'perda', quantity: 5 }).expect(201);
  await admin.delete(`/api/products/${p.id}`).expect(204);
  await staff.get(`/api/products/${p.id}`).expect(404);
  assert.equal((await staff.get('/api/products?q=Tomate').expect(200)).body.total, 0);
  const report = (await admin.get('/api/reports/monthly?months=1').expect(200)).body;
  assert.ok(report.topLosses.some((t: { product: string }) => t.product === 'Tomate'));
});

// ---- Categorias ----------------------------------------------------------------------------------

test('categorias: admin cria, edita, não duplica e não exclui com produtos', async () => {
  const cat = (await admin.post('/api/categories').send({ name: 'Ovos', perishable: true }).expect(201)).body;
  await admin.patch(`/api/categories/${cat.id}`).send({ name: 'Ovos e granja', perishable: true }).expect(200);
  await admin.post('/api/categories').send({ name: 'OVOS E GRANJA', perishable: false }).expect(409);
  await admin.delete('/api/categories/3').expect(409);
  await admin.delete(`/api/categories/${cat.id}`).expect(204);

  const list = (await staff.get('/api/categories?pageSize=100').expect(200)).body;
  assert.equal(list.total, 10);
  const dairy = list.items.find((c: { id: number }) => c.id === 3);
  assert.ok(dairy.product_count >= 1);
});
