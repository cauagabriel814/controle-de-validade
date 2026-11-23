import './env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { can, permissionsOf, PERMISSIONS } from '../src/lib/permissions.js';
import { addDays, lastMonths, today } from '../src/lib/dates.js';
import { likePattern } from '../src/lib/validation.js';
import { Where } from '../src/lib/pagination.js';
import { detectImage, FILE_NAME_RE } from '../src/middleware/upload.js';
import { inviteMail, resetMail } from '../src/lib/mailer.js';

// ---- Permissões ----------------------------------------------------------------

test('admin tem todas as permissões', () => {
  for (const p of PERMISSIONS) assert.ok(can('admin', p), p);
});

test('funcionário opera o dia a dia mas não administra', () => {
  for (const p of ['products:read', 'products:write', 'lots:read', 'lots:write', 'movements:write'] as const) {
    assert.ok(can('funcionario', p), p);
  }
  for (const p of ['users:manage', 'reports:read', 'audit:read', 'products:delete', 'lots:delete', 'categories:write', 'settings:write'] as const) {
    assert.ok(!can('funcionario', p), p);
  }
});

test('papel desconhecido não tem nenhuma permissão', () => {
  assert.deepEqual(permissionsOf('hacker' as never), []);
  assert.equal(can('hacker' as never, 'products:read'), false);
});

// ---- Datas ------------------------------------------------------------------------

test('addDays atravessa mês, ano e fevereiro bissexto', () => {
  assert.equal(addDays('2026-11-25', 7), '2026-12-02');
  assert.equal(addDays('2026-12-30', 3), '2027-01-02');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

test('today está no formato AAAA-MM-DD', () => {
  assert.match(today(), /^\d{4}-\d{2}-\d{2}$/);
});

test('lastMonths termina no mês atual e volta corretamente na virada do ano', () => {
  const months = lastMonths(13);
  assert.equal(months.length, 13);
  assert.equal(months.at(-1), today().slice(0, 7));
  const [y, m] = today().split('-').map(Number) as [number, number];
  assert.equal(months[0], `${y - 1}-${String(m).padStart(2, '0')}`);
});

// ---- Consultas ----------------------------------------------------------------------

test('likePattern escapa curingas do LIKE', () => {
  assert.equal(likePattern('leite'), '%leite%');
  assert.equal(likePattern('100%'), '%100\\%%');
  assert.equal(likePattern('a_b'), '%a\\_b%');
  assert.equal(likePattern('c:\\'), '%c:\\\\%');
});

test('Where numera os parâmetros e ignora filtros vazios', () => {
  const w = new Where();
  const t = w.param('2026-11-17');
  w.add('a = ?', 1).addIf(undefined, 'b = ?', 2).addIf('', 'c = ?', 3).add('d BETWEEN ? AND ?', 4, 5);
  assert.equal(t, '$1');
  assert.equal(String(w), 'WHERE a = $2 AND d BETWEEN $3 AND $4');
  assert.deepEqual(w.params, ['2026-11-17', 1, 4, 5]);
  assert.equal(String(new Where()), '');
});

// ---- Uploads ----------------------------------------------------------------------

test('detectImage reconhece JPG, PNG e WEBP pela assinatura real', () => {
  const pad = Buffer.alloc(16);
  assert.equal(detectImage(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), pad])), '.jpg');
  assert.equal(detectImage(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pad])), '.png');
  assert.equal(detectImage(Buffer.concat([Buffer.from('RIFF\0\0\0\0WEBP'), pad])), '.webp');
});

test('detectImage recusa HTML, SVG, PDF e arquivos minúsculos', () => {
  assert.equal(detectImage(Buffer.from('<html><script>alert(1)</script></html>')), null);
  assert.equal(detectImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
  assert.equal(detectImage(Buffer.from('%PDF-1.7 aaaaaaaaaaaa')), null);
  assert.equal(detectImage(Buffer.from([0xff, 0xd8])), null);
});

test('nome de arquivo aceito é só o gerado pelo servidor', () => {
  assert.ok(FILE_NAME_RE.test('0f8fad5b-d9cb-469f-a165-70867728950e.jpg'));
  for (const bad of ['../.env', '..\\db', 'foto.jpg', '0f8fad5b-d9cb-469f-a165-70867728950e.svg', '0f8fad5b-d9cb-469f-a165-70867728950e.jpg/../x']) {
    assert.ok(!FILE_NAME_RE.test(bad), bad);
  }
});

// ---- Impacto econômico (ODS 8) -----------------------------------------------------

test('impacto econômico conta só meses em uso e compara com a linha de base', async () => {
  const { economicImpact } = await import('../src/routes/reports.js');
  const monthly = [
    { inUse: false, lossValue: 0, recoveredValue: 0 },
    { inUse: true, lossValue: 120, recoveredValue: 40 },
    { inUse: true, lossValue: 80, recoveredValue: 60 },
  ];
  assert.deepEqual(economicImpact(monthly, 200), {
    monthsInUse: 2, lossInUse: 200, recovered: 100, avoidedLoss: 200, annualProjection: 1200,
  });
  // Sem linha de base: não inventa perdas evitadas
  const semBase = economicImpact(monthly, null);
  assert.equal(semBase.avoidedLoss, null);
  assert.equal(semBase.annualProjection, null);
  assert.equal(semBase.recovered, 100);
  // Sistema ainda sem uso
  assert.equal(economicImpact([{ inUse: false, lossValue: 0, recoveredValue: 0 }], 200).avoidedLoss, null);
});

// ---- E-mails -----------------------------------------------------------------------

test('e-mail de convite tem texto puro, HTML e link', () => {
  const m = inviteMail('ana@x.com', 'Ana Paula', 'Seu Zé', 'http://app/#/definir-senha?token=abc');
  assert.equal(m.to, 'ana@x.com');
  assert.match(m.text, /Olá, Ana!/);
  assert.match(m.text, /Seu Zé criou um acesso/);
  assert.match(m.text, /token=abc/);
  assert.match(m.html, /href="http:\/\/app\/#\/definir-senha\?token=abc"/);
  assert.match(m.text, /72 horas/);
});

test('e-mail de redefinição avisa a validade de 1 hora', () => {
  const m = resetMail('ana@x.com', 'Ana', 'http://app/#/definir-senha?token=abc');
  assert.match(m.subject, /Redefinição/);
  assert.match(m.text, /1 hora/);
});
