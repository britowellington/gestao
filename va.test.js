// Testes dos cálculos da Voz do Aluno.
// Rodar: node --test va.test.js
// Extrai do próprio gestao-people.html o bloco VA-CORE, então o que é testado é o código que roda no app.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, 'gestao-people.html'), 'utf8');
const a = html.indexOf('// VA-CORE-START'), b = html.indexOf('// VA-CORE-END');
assert.ok(a > 0 && b > a, 'bloco VA-CORE não encontrado');
const ctx = {}; vm.createContext(ctx);
vm.runInContext(html.slice(a, b) + '\nthis.X={VA_CONFIG,vaNorm,vaFiltrar,vaContar,vaTop,vaResumo,vaSintese,vaTextoResumo,vaSemanaDe,vaDiasEntre,vaGrupos};', ctx);
const X = ctx.X;
const J = v => JSON.parse(JSON.stringify(v));
const R = (data, o) => Object.assign({ data, tempo: 'ate3m', horario: 'manha', gosta: '', melhorar: '', gosta_areas: [], melhorar_areas: [] }, o || {});

test('configuração: áreas, tempos e horários esperados', () => {
  assert.equal(X.VA_CONFIG.metaPadrao, 10);
  assert.equal(X.VA_CONFIG.minCorte, 5);
  assert.deepEqual(J(X.VA_CONFIG.tempos.map(t => t.key)), ['ate3m', '3a12m', '1a3a', 'mais3a']);
  assert.deepEqual(J(X.VA_CONFIG.horarios.map(t => t.key)), ['manha', 'tarde', 'noite', 'varia']);
  assert.ok(X.VA_CONFIG.areas.includes('Recepção') && X.VA_CONFIG.areas.includes('Limpeza'));
});
test('normalização: texto ausente vira vazio e áreas aceitam array ou JSON em texto', () => {
  const r = X.vaNorm({ melhorar_areas: '["Limpeza"]', gosta_areas: null, gosta: null });
  assert.deepEqual(J(r.melhorar_areas), ['Limpeza']);
  assert.deepEqual(J(r.gosta_areas), []);
  assert.equal(r.gosta, '');
  assert.deepEqual(J(X.vaNorm({ melhorar_areas: 'não é json' }).melhorar_areas), []);
});
test('semana começa na segunda e vira de mês corretamente', () => {
  assert.equal(X.vaSemanaDe('2026-10-24'), '2026-10-19'); // sábado
  assert.equal(X.vaSemanaDe('2026-10-19'), '2026-10-19'); // segunda
  assert.equal(X.vaSemanaDe('2026-10-25'), '2026-10-19'); // domingo
  assert.equal(X.vaSemanaDe('2026-03-01'), '2026-02-23');
});
test('período: 7 dias inclui hoje e os 6 anteriores; futuro e fora da janela ficam de fora', () => {
  const rows = [R('2026-10-24'), R('2026-10-18'), R('2026-10-17'), R('2026-10-25')];
  assert.equal(X.vaFiltrar(rows, 7, '2026-10-24').length, 2);
  assert.equal(X.vaFiltrar(rows, 0, '2026-10-24').length, 4);
  assert.equal(X.vaFiltrar(rows, 30, '2026-10-24').length, 3);
});
test('ranking: conta conversas (não menções repetidas), ignora "Nada a melhorar", ordena e desempata por nome', () => {
  const rows = [
    R('2026-10-20', { melhorar_areas: ['Limpeza', 'Limpeza', 'Preço'] }),
    R('2026-10-20', { melhorar_areas: ['Limpeza'] }),
    R('2026-10-21', { melhorar_areas: ['Preço'] }),
    R('2026-10-21', { melhorar_areas: ['Nada a melhorar'] })
  ];
  const c = J(X.vaContar(rows, 'melhorar_areas'));
  assert.deepEqual(c, [{ area: 'Limpeza', n: 2, pct: 50 }, { area: 'Preço', n: 2, pct: 50 }]);
  assert.deepEqual(J(X.vaTop(rows)), { area: 'Limpeza', n: 2 });
  assert.equal(X.vaTop([R('2026-10-20')]), null);
});
test('resumo: totais, dias, média, dias na meta e hoje', () => {
  const rows = [];
  for (let i = 0; i < 10; i++) rows.push(R('2026-10-20'));
  for (let i = 0; i < 3; i++) rows.push(R('2026-10-21'));
  rows.push(R('2026-10-21', { melhorar_areas: ['Nada a melhorar'] }));
  const s = X.vaResumo(rows, 10, '2026-10-21');
  assert.equal(s.total, 14); assert.equal(s.dias, 2); assert.equal(s.mediaDia, 7);
  assert.equal(s.diasMeta, 1); assert.equal(s.hojeN, 4); assert.equal(s.nada, 1);
  assert.deepEqual(J(s.semanas), [{ semana: '2026-10-19', n: 14 }]);
  const vazio = X.vaResumo([], 10, '2026-10-21');
  assert.equal(vazio.total, 0); assert.equal(vazio.mediaDia, 0); assert.equal(vazio.diasMeta, 0);
});
test('cortes: grupo com menos de 5 conversas não mostra o ponto mais citado', () => {
  const rows = [];
  for (let i = 0; i < 4; i++) rows.push(R('2026-10-20', { tempo: '1a3a', melhorar_areas: ['Equipamentos'] }));
  for (let i = 0; i < 5; i++) rows.push(R('2026-10-20', { tempo: 'ate3m', melhorar_areas: ['Limpeza'] }));
  const s = X.vaResumo(rows, 10, '2026-10-20');
  const g = k => J(s.tempos.find(x => x.key === k));
  assert.equal(g('1a3a').n, 4); assert.equal(g('1a3a').suficiente, false); assert.equal(g('1a3a').top, null);
  assert.equal(g('ate3m').suficiente, true); assert.deepEqual(g('ate3m').top, { area: 'Limpeza', n: 5 });
  assert.equal(g('mais3a').n, 0);
});
test('síntese: período vazio, destaque de grupo diferente e aviso de leitura direcional', () => {
  assert.deepEqual(J(X.vaSintese(X.vaResumo([], 10, '2026-10-20'))), ['Ainda não há conversas neste período.']);
  const rows = [];
  for (let i = 0; i < 6; i++) rows.push(R('2026-10-20', { tempo: 'ate3m', horario: 'manha', gosta_areas: ['Instrutores'], melhorar_areas: ['Limpeza'] }));
  for (let i = 0; i < 5; i++) rows.push(R('2026-10-21', { tempo: 'mais3a', horario: 'noite', melhorar_areas: ['Horários e lotação'] }));
  const t = X.vaSintese(X.vaResumo(rows, 10, '2026-10-21')).join(' | ');
  assert.match(t, /Foram 11 conversas em 2 dias/);
  assert.match(t, /O que mais agrada: Instrutores \(6 de 11, 55%\)/);
  assert.match(t, /Ponto mais citado para melhorar: Limpeza \(6 de 11, 55%\)/);
  assert.match(t, /Com mais de 3 anos de academia \(5 conversas\), o ponto mais citado foi Horários e lotação/);
  assert.match(t, /No horário noite \(5 conversas\)/);
  assert.match(t, /não formam uma amostra aleatória/);
});
test('síntese: quando todos os grupos concordam, diz isso', () => {
  const rows = [];
  for (let i = 0; i < 5; i++) rows.push(R('2026-10-20', { tempo: 'ate3m', horario: 'manha', melhorar_areas: ['Limpeza'] }));
  const t = X.vaSintese(X.vaResumo(rows, 10, '2026-10-20')).join(' | ');
  assert.match(t, /mesmo em todos os grupos com dados suficientes/);
});
test('texto do resumo: cabeçalho, síntese e rankings', () => {
  const rows = [R('2026-10-20', { gosta_areas: ['Instrutores'], melhorar_areas: ['Limpeza'] })];
  const t = X.vaTextoResumo(X.vaResumo(rows, 10, '2026-10-20'), 'últimos 30 dias');
  assert.match(t, /^Voz do Aluno \| últimos 30 dias/);
  assert.match(t, /O que mais gostam:\n- Instrutores: 1 \(100%\)/);
  assert.match(t, /O que precisa melhorar:\n- Limpeza: 1 \(100%\)/);
});
