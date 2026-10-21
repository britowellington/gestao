// Testes dos cálculos e regras do TEM Pessoas.
// Rodar: node --test tem-pessoas.test.js
// Extrai do próprio gestao-people.html o bloco de configuração e os blocos TP-CALC e TP-SINTESE,
// então o que é testado é exatamente o código que roda no app.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'gestao-people.html'), 'utf8');
function bloco(ini, fim) {
  const a = html.indexOf(ini), b = html.indexOf(fim);
  assert.ok(a > 0 && b > a, 'bloco não encontrado: ' + ini);
  return html.slice(a, b);
}
const cfgSrc = html.slice(html.indexOf('const TP_VERSAO'), html.indexOf('// TP-CALC-START'));
const code = cfgSrc + bloco('// TP-CALC-START', '// TP-CALC-END') + bloco('// TP-SINTESE-START', '// TP-SINTESE-END');
const ctx = {}; vm.createContext(ctx); vm.runInContext(code + '\nthis.X={TP_CONFIG,TP_VERSAO,TP_CRITERIO,TP_MIN_TEMA,tpValida,tpMedia,tpFav,tpDist,tpResumo,tpResumoIndividual,tpParticipacao,tpPodeExibir,tpPodeComparar,tpAtivas,tpPorSetor,tpMontaResposta,tpDentroPeriodo,tpTemasContagem,tpFmt,tpPct,tpSinteseIndividual,tpSinteseColetiva,tpSinteseCamadas,tpValsPergunta,TP_LIMITE_PISO,TP_MIN_VALIDAS_CAMADA};', ctx);
const X = ctx.X;
const cfg = X.TP_CONFIG;
const R = (o) => ({ respostas: o });
const todos = (v) => { const o = {}; cfg.perguntas.forEach(p => { o[p.id] = v; }); return o; };

test('configuração: 12 perguntas, 6 dimensões, cada pergunta em exatamente uma dimensão', () => {
  assert.equal(cfg.perguntas.length, 12);
  assert.equal(cfg.dimensoes.length, 6);
  assert.equal(cfg.abertas.length, 3);
  const cont = {};
  cfg.dimensoes.forEach(d => d.perguntas.forEach(q => { cont[q] = (cont[q] || 0) + 1; }));
  cfg.perguntas.forEach(p => assert.equal(cont[p.id], 1, p.id + ' deve estar em uma dimensão'));
});
test('configuração: mapeamento solicitado das dimensões', () => {
  const m = {}; cfg.dimensoes.forEach(d => { m[d.key] = d.perguntas.join(','); });
  assert.deepEqual(m, { d1: 'p1,p2', d2: 'p3,p6', d3: 'p4,p5', d4: 'p7,p11', d5: 'p9,p10', d6: 'p8,p12' });
});
test('validade: só inteiros de 1 a 5; "na", 0, nulos e ausentes não são notas', () => {
  [1, 2, 3, 4, 5].forEach(v => assert.equal(X.tpValida(v), true));
  ['na', 0, 6, 3.5, null, undefined, '4', NaN].forEach(v => assert.equal(X.tpValida(v), false, String(v)));
});
test('média ignora "na" e ausentes e nunca trata como zero', () => {
  assert.equal(X.tpMedia([5, 'na', undefined, 3]), 4);
  assert.equal(X.tpMedia(['na', undefined, null]), null);
  assert.equal(X.tpMedia([]), null);
});
test('favorabilidade = (4 ou 5) ÷ válidas, com denominador', () => {
  const f = X.tpFav([5, 4, 3, 2, 1, 'na', undefined]);
  assert.deepEqual({ fav: f.fav, n: f.n, pct: f.pct }, { fav: 2, n: 5, pct: 40 });
  assert.equal(X.tpFav(['na']).pct, null);
  assert.equal(X.tpFav([]).n, 0);
});
test('distribuição conta só respostas válidas', () => {
  const d = X.tpDist([5, 5, 4, 'na', 1]);
  assert.equal(d.n, 4); assert.equal(d.counts[5], 2); assert.equal(d.counts[1], 1);
});
test('resumo agregado: média das respostas válidas reunidas (não média das médias)', () => {
  // pessoa A respondeu 12 perguntas com 5; pessoa B respondeu só p1 com 1 e o resto "na"
  const b = todos('na'); b.p1 = 1;
  const r = X.tpResumo([R(todos(5)), R(b)], cfg);
  assert.equal(r.nValidas, 13);
  assert.equal(+r.media.toFixed(4), +((12 * 5 + 1) / 13).toFixed(4));
  const media_das_medias = (5 + 1) / 2;
  assert.notEqual(+r.media.toFixed(2), media_das_medias);
  const d1 = r.dims.find(d => d.key === 'd1'); // p1,p2: valores 5,5,1
  assert.equal(d1.n, 3); assert.equal(+d1.media.toFixed(4), +((5 + 5 + 1) / 3).toFixed(4));
});
test('dimensão sem dados válidos devolve null, não zero', () => {
  const r = X.tpResumo([R({ p1: 'na', p2: 'na' })], cfg);
  assert.equal(r.dims.find(d => d.key === 'd1').media, null);
  assert.equal(r.media, null);
});
test('resumo individual: média das perguntas respondidas pela própria pessoa', () => {
  const r = X.tpResumoIndividual(R({ p1: 5, p2: 3, p3: 'na', p6: 4 }), cfg);
  assert.equal(r.nValidas, 3); assert.equal(r.nRespondidas, 4);
  assert.equal(r.dims.find(d => d.key === 'd1').media, 4);
  assert.equal(r.dims.find(d => d.key === 'd2').media, 4); // só p6 válida
  assert.equal(r.dims.find(d => d.key === 'd5').media, null);
});
test('participação: enviados ÷ elegíveis; sem elegíveis não divide por zero', () => {
  assert.equal(X.tpParticipacao(3, 4), 75);
  assert.equal(X.tpParticipacao(0, 0), null);
});
test('limite mínimo: exibe só com n >= limite', () => {
  assert.equal(X.tpPodeExibir(4, 5), false); assert.equal(X.tpPodeExibir(5, 5), true);
});
test('comparação entre ciclos exige mesma versão e mesmo critério', () => {
  const a = { versao_questionario: 'v1', criterio: 'agregada-v1' };
  assert.equal(X.tpPodeComparar(a, { ...a }), true);
  assert.equal(X.tpPodeComparar(a, { ...a, versao_questionario: 'v2' }), false);
  assert.equal(X.tpPodeComparar(a, { ...a, criterio: 'outro' }), false);
  assert.equal(X.tpPodeComparar(a, null), false);
});
test('respostas substituídas não entram nos cálculos', () => {
  assert.equal(X.tpAtivas([{ id: 1 }, { id: 2, substituida: true }]).length, 1);
});
test('agrupamento por setor com "Sem setor"', () => {
  const g = X.tpPorSetor([{ setor: 'A' }, { setor: 'A' }, { setor: null }]);
  assert.equal(g['A'].length, 2); assert.equal(g['Sem setor'].length, 1);
});
test('modo anônimo: linha gravada sem nome, sem horário e só com a data', () => {
  const ciclo = { id: 'c1', modo: 'anonima', versao_questionario: 'v1' };
  const link = { colaborador: 'Maria', setor: 'Recepção', token: 'tok' };
  const l = X.tpMontaResposta(ciclo, link, { p1: 5 }, { a1: 'x' }, '2026-10-17');
  assert.equal(l.colaborador, null);
  assert.equal(l.criado_em, '2026-10-17');
  assert.equal(JSON.stringify(l).includes('Maria'), false);
  assert.equal(JSON.stringify(l).includes('tok'), false);
});
test('modo identificado: linha leva o colaborador', () => {
  const l = X.tpMontaResposta({ id: 'c1', modo: 'identificada', versao_questionario: 'v1' }, { colaborador: 'Maria', setor: 'X' }, {}, {}, '2026-10-17');
  assert.equal(l.colaborador, 'Maria');
});
test('período: só aceita resposta com ciclo aberto e dentro das datas', () => {
  const c = { status: 'aberto', inicio: '2026-10-01', fim: '2026-10-31' };
  assert.equal(X.tpDentroPeriodo(c, '2026-10-15'), true);
  assert.equal(X.tpDentroPeriodo(c, '2026-09-30'), false);
  assert.equal(X.tpDentroPeriodo(c, '2026-11-01'), false);
  assert.equal(X.tpDentroPeriodo({ ...c, status: 'encerrado' }, '2026-10-15'), false);
  assert.equal(X.tpDentroPeriodo({ ...c, status: 'rascunho' }, '2026-10-15'), false);
});
test('temas: conta pessoas, e tema citado por 1 pessoa não é nomeado', () => {
  const rs = [{ temas: { a2: ['Recursos', 'Recursos', 'Outros'] } }, { temas: { a2: ['Recursos'] } }, { temas: {} }];
  const t = X.tpTemasContagem(rs, 'a2', 2);
  assert.deepEqual(JSON.parse(JSON.stringify(t.frequentes)), [{ tema: 'Recursos', n: 2 }]);
  assert.equal(t.unicos, 1);
});
test('síntese individual: sem base com poucas respostas válidas', () => {
  const s = X.tpSinteseIndividual(X.tpResumoIndividual(R({ p1: 5, p2: 4 }), cfg));
  assert.equal(s.insuficiente, true);
});
test('síntese individual: separa evidência, interpretação e recomendação, sem rótulos de pessoa', () => {
  const o = todos(4); o.p1 = 5; o.p2 = 5; o.p3 = 2; o.p6 = 2;
  const s = X.tpSinteseIndividual(X.tpResumoIndividual(R(o), cfg));
  assert.equal(s.insuficiente, false);
  assert.ok(s.evidencia.length >= 6 && s.interpretacao.length && s.recomendacao.length);
  const txt = JSON.stringify(s).toLowerCase();
  ['desmotivad', 'baixo desempenho', 'resiste', 'colaborador ruim', 'depress', 'ansied'].forEach(p => assert.equal(txt.includes(p), false, p));
  assert.ok(s.interpretacao[0].includes('indicam'));
});
test('síntese coletiva: sem base com poucos dados e sem afirmação causal', () => {
  const poucos = X.tpResumo([R(todos(4))], cfg);
  assert.equal(X.tpSinteseColetiva(poucos, null).insuficiente, true);
  const rs = [];
  for (let i = 0; i < 6; i++) { const o = todos(4); o.p1 = 5; o.p2 = 5; o.p8 = 2; o.p12 = 2; rs.push(R(o)); }
  const s = X.tpSinteseColetiva(X.tpResumo(rs, cfg), { a2: { frequentes: [{ tema: 'Recursos e condições de trabalho', n: 3 }] } });
  assert.equal(s.insuficiente, false);
  const txt = JSON.stringify(s).toLowerCase();
  ['porque', 'causado', 'por causa', 'melhor liderança'].forEach(p => assert.equal(txt.includes(p), false, p));
  assert.ok(txt.includes('não equivale'));
});
test('formatação pt-BR', () => {
  assert.equal(X.tpFmt(4.5), '4,50'); assert.equal(X.tpFmt(null), '—'); assert.equal(X.tpPct(66.6), '67%'); assert.equal(X.tpPct(null), '—');
});
test('texto das perguntas igual ao especificado', () => {
  assert.equal(cfg.perguntas[0].texto, 'Sei claramente o que se espera de mim no desempenho das minhas funções.');
  assert.equal(cfg.perguntas[11].texto, 'Consigo enxergar possibilidades de evolução profissional dentro da TEM.');
  assert.equal(cfg.abertas[1].texto, 'Qual é a principal dificuldade que você enfrenta hoje para realizar seu trabalho da maneira que gostaria?');
});

// ── Leitura por camada (hierarquia do engajamento) ────────────────────────────
const grupo = (n, vals) => { const rs = []; for (let i = 0; i < n; i++) { const o = todos(4); Object.keys(vals).forEach(k => { o[k] = vals[k]; }); rs.push(R(o)); } return rs; };

test('camadas: 4 camadas, cada pergunta em exatamente uma, no agrupamento definido', () => {
  assert.equal(cfg.camadas.length, 4);
  const m = {}; cfg.camadas.forEach(k => { m[k.key] = k.perguntas.join(','); });
  assert.deepEqual(m, { c1: 'p1,p2', c2: 'p3,p4,p5,p6', c3: 'p7,p8,p9,p10', c4: 'p11,p12' });
  assert.deepEqual(Array.from(cfg.camadas.map(k => k.nome)), ['Básicas', 'Individuais', 'Coletivas', 'Crescimento']);
  const cont = {}; cfg.camadas.forEach(k => k.perguntas.forEach(q => { cont[q] = (cont[q] || 0) + 1; }));
  cfg.perguntas.forEach(p => assert.equal(cont[p.id], 1, p.id));
});
test('camadas: média agregada das respostas válidas reunidas, "na" fora, nunca zero', () => {
  const b = todos('na'); b.p1 = 1;
  const r = X.tpResumo([R(todos(5)), R(b)], cfg);
  const c1 = r.camadas.find(k => k.key === 'c1');
  assert.equal(c1.n, 3); assert.equal(+c1.media.toFixed(4), +((5 + 5 + 1) / 3).toFixed(4));
  assert.equal(c1.fav.n, 3); assert.equal(c1.fav.fav, 2);
  const soNa = X.tpResumo([R(todos('na'))], cfg);
  soNa.camadas.forEach(k => { assert.equal(k.media, null); assert.equal(k.n, 0); });
});
test('camadas: não alteram a média geral nem as dimensões (mesmos dados, outra leitura)', () => {
  const rs = grupo(6, { p1: 2, p2: 3, p11: 5 });
  const r = X.tpResumo(rs, cfg);
  const somaCamadas = r.camadas.reduce((a, k) => a + k.n, 0);
  assert.equal(somaCamadas, r.nValidas);
  const somaDims = r.dims.reduce((a, d) => a + d.n, 0);
  assert.equal(somaDims, r.nValidas);
});
test('síntese por camada: sem base com poucos respondentes ou camadas com poucas respostas válidas', () => {
  assert.equal(X.tpSinteseCamadas(X.tpResumo(grupo(2, {}), cfg)).insuficiente, true);
  // 3 respondentes: Básicas teria 6 válidas (ok); mas só 1 camada com dados se as demais forem "na"
  const base = {}; cfg.perguntas.forEach(p => { base[p.id] = 'na'; }); base.p1 = 4; base.p2 = 4;
  const rs = []; for (let i = 0; i < 6; i++) rs.push(R(Object.assign({}, base)));
  assert.equal(X.tpSinteseCamadas(X.tpResumo(rs, cfg)).insuficiente, true);
});
test('síntese por camada: camada com poucas respostas válidas é marcada como insuficiente na evidência', () => {
  const rs = grupo(3, {});
  const res = X.tpResumo(rs, cfg); // Básicas e Crescimento: 6 válidas cada (3 x 2), mínimo 6
  const s = X.tpSinteseCamadas(res);
  assert.equal(s.insuficiente, false);
  const rs2 = grupo(3, {}); rs2.forEach(r => { r.respostas.p2 = 'na'; });  // Básicas cai para 3 válidas
  const s2 = X.tpSinteseCamadas(X.tpResumo(rs2, cfg));
  assert.ok(s2.evidencia.some(t => t.startsWith('Básicas: dados insuficientes')));
});
test('síntese por camada: destaca a primeira camada da base para o topo bem abaixo da mais favorável', () => {
  // Básicas 2 (baixa), Individuais 4, Coletivas 5, Crescimento 3 (também baixa): foco deve ser Básicas
  const rs = grupo(6, { p1: 2, p2: 2, p7: 5, p8: 5, p9: 5, p10: 5, p11: 3, p12: 3 });
  const s = X.tpSinteseCamadas(X.tpResumo(rs, cfg));
  assert.equal(s.insuficiente, false);
  assert.ok(s.interpretacao[0].includes('"Básicas"'));
  assert.ok(s.interpretacao.some(t => t.includes('Também ficaram abaixo') && t.includes('Crescimento')));
  assert.ok(s.recomendacao[0].includes('"Básicas"') && s.recomendacao[0].includes('Clareza de expectativas'));
});
test('síntese por camada: sem diferença relevante, sem foco e sem afirmação causal', () => {
  const s = X.tpSinteseCamadas(X.tpResumo(grupo(6, {}), cfg));
  assert.equal(s.insuficiente, false);
  assert.ok(s.interpretacao[0].includes('Não há diferença relevante'));
  const alta = X.tpSinteseCamadas(X.tpResumo(grupo(6, { p1: 1, p2: 1 }), cfg));
  const txt = JSON.stringify(alta).toLowerCase();
  ['porque', 'causado', 'por causa', 'melhor liderança', 'culpa'].forEach(p => assert.equal(txt.includes(p), false, p));
  assert.ok(txt.includes('não prova'));
});
test('síntese por camada: favorabilidade usa denominador de respostas válidas', () => {
  const rs = grupo(6, { p1: 5, p2: 'na' });
  const res = X.tpResumo(rs, cfg);
  const c1 = res.camadas[0];
  assert.equal(c1.n, 6); assert.equal(c1.fav.pct, 100);
});
