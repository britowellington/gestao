// Teste ponta a ponta do TEM Pessoas no navegador (Chromium headless), viewport de celular.
// O banco é SIMULADO em memória e imita as regras da migração: unicidade, colunas protegidas e auditoria imutável.
// Rodar: NODE_PATH=$(npm root -g) node e2e-tem-pessoas.js
const { chromium } = require('playwright');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const FILE = 'file://' + path.join(__dirname, 'gestao-people.html');
fs.mkdirSync(path.join(__dirname, 'shots'), { recursive: true });

// ── banco simulado ────────────────────────────────────────────────────────────
const uuid = () => crypto.randomUUID();
const NOMES = ['Ana', 'Bruno', 'Carla', 'Diego', 'Elisa', 'Fabio', 'Gabi', 'Hugo'];
const db = { tp_ciclos: [], tp_links: [], tp_respostas: [], tp_setores: [], tp_colab_setor: [], tp_acoes: [], tp_auditoria: [], colaboradores: NOMES.map(n => ({ nome: n, whatsapp: '', email: '' })) };
const DEF = {
  tp_ciclos: () => ({ id: uuid(), status: 'rascunho', modo: 'identificada', limite_min: 5, responsaveis: 'Wellington Brito', retencao_meses: 24, versao_questionario: 'v1', criterio: 'agregada-v1', elegiveis: [], publicado_em: null, criado_em: new Date().toISOString() }),
  tp_links: () => ({ id: uuid(), token: uuid(), respondido: false, respondido_em: null, criado_em: new Date().toISOString() }),
  tp_respostas: () => ({ id: uuid(), abertas: {}, temas: {}, substituida: false, criado_em: new Date().toISOString().slice(0, 10) }),
  tp_setores: () => ({ id: uuid(), criado_em: new Date().toISOString() }),
  tp_colab_setor: () => ({ criado_em: new Date().toISOString() }),
  tp_acoes: () => ({ id: uuid(), escopo: 'institucional', status: 'nao_iniciada', atualizacoes: [], criado_em: new Date().toISOString() }),
  tp_auditoria: () => ({ id: uuid(), criado_em: new Date().toISOString() })
};
const COL_UPD = { tp_respostas: ['temas', 'substituida'], tp_links: ['respondido', 'respondido_em'] };
const UNIQ = (t, row, rows) => {
  if (t === 'tp_links') return rows.some(r => r.ciclo_id === row.ciclo_id && r.colaborador === row.colaborador);
  if (t === 'tp_respostas') return row.colaborador != null && !row.substituida && rows.some(r => r.ciclo_id === row.ciclo_id && r.colaborador === row.colaborador && !r.substituida);
  if (t === 'tp_setores') return rows.some(r => r.nome === row.nome);
  if (t === 'tp_colab_setor') return rows.some(r => r.colaborador === row.colaborador);
  return false;
};
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'content-type': 'application/json' };
const log = { posts: [] };
async function handler(route) {
  const req = route.request(); const u = new URL(req.url());
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  const t = u.pathname.replace('/rest/v1/', '');
  const rows = db[t];
  if (!rows) return route.fulfill({ status: 200, headers: CORS, body: '[]' });
  const filt = r => { for (const [k, v] of u.searchParams) { if (['select', 'order', 'limit', 'on_conflict'].includes(k)) continue; if (v.startsWith('eq.') && String(r[k]) !== v.slice(3)) return false; } return true; };
  const wantRep = (req.headers()['prefer'] || '').includes('return=representation');
  const ok = (s, b) => route.fulfill({ status: s, headers: CORS, body: b === undefined ? '' : JSON.stringify(b) });
  const m = req.method();
  if (m === 'GET') { let out = rows.filter(filt); const lim = u.searchParams.get('limit'); if (lim) out = out.slice(0, +lim); return ok(200, JSON.parse(JSON.stringify(out))); }
  if (m === 'POST') {
    const body = JSON.parse(req.postData() || '{}'); const arr = Array.isArray(body) ? body : [body]; const made = [];
    for (const b of arr) {
      const row = Object.assign(DEF[t] ? DEF[t]() : {}, b);
      if (UNIQ(t, row, rows.concat(made))) return ok(409, { code: '23505', message: 'duplicate key' });
      made.push(row);
    }
    made.forEach(r => rows.push(r)); log.posts.push([t, made.length]);
    return wantRep ? ok(201, made) : ok(201);
  }
  if (m === 'PATCH') {
    const body = JSON.parse(req.postData() || '{}');
    if (COL_UPD[t] && Object.keys(body).some(k => !COL_UPD[t].includes(k))) return ok(403, { code: '42501', message: 'permission denied for column' });
    const hit = rows.filter(filt);
    if (t === 'tp_respostas' && body.substituida === false) { /* nada */ }
    hit.forEach(r => Object.assign(r, body));
    return wantRep ? ok(200, JSON.parse(JSON.stringify(hit))) : ok(204);
  }
  if (m === 'DELETE') {
    if (t === 'tp_auditoria') return ok(403, { code: '42501', message: 'permission denied' });
    const keep = rows.filter(r => !filt(r)); const n = rows.length - keep.length; rows.length = 0; keep.forEach(r => rows.push(r));
    if (t === 'tp_ciclos') ['tp_links', 'tp_respostas'].forEach(tt => { const k = db[tt].filter(r => db.tp_ciclos.some(c => c.id === r.ciclo_id)); db[tt].length = 0; k.forEach(r => db[tt].push(r)); });
    return ok(204);
  }
  return ok(405, {});
}

// ── resultados ────────────────────────────────────────────────────────────────
const res = []; const check = (nome, cond, det) => { res.push([!!cond, nome, det]); console.log((cond ? 'OK   ' : 'FALHA'), nome, cond ? '' : '→ ' + det); };
const DADOS = {
  Ana:   [5,4,5,4,5,4,5,5,4,5,4,5], Bruno: [4,4,3,4,4,3,4,4,5,4,3,4], Carla: [3,2,4,3,4,3,2,4,4,5,3,3],
  Diego: [5,5,4,5,5,5,4,5,5,5,5,4], Elisa: [4,3,'na',4,4,4,3,4,4,4,4,'na'], Fabio: [2,2,3,3,4,3,3,4,4,4,3,2], Gabi: [4,4,4,4,4,4,4,4,4,4,4,4]
};
const COMENT = { Ana: ['Equipe unida', 'Falta de bicicletas', 'Mais cursos'], Bruno: ['', 'Falta de bicicletas', ''], Carla: ['Bom clima', 'Horários apertados', 'Escala fixa'] };

async function responder(ctx, token, nome, valores, coment, opts) {
  const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto(FILE + '?tptoken=' + token); await pg.waitForSelector('#modal-tp-publico .tpp h1');
  if (opts && opts.ficarNaIntro) return { pg, errs };
  await pg.click('#modal-tp-publico .go');
  for (let i = 0; i < 12; i++) {
    const v = valores[i];
    if (v === 'na') await pg.click(`#tpq-p${i + 1} .tpp-na`); else await pg.click(`#tpq-p${i + 1} [data-v="${v}"]`);
  }
  const c = coment || [];
  for (let k = 0; k < 3; k++) if (c[k]) await pg.fill('#tpa-a' + (k + 1), c[k]);
  await pg.click('#tpp-rev'); await pg.waitForSelector('#modal-tp-publico >> text=Revise antes de enviar');
  if (opts && opts.shot) await pg.screenshot({ path: path.join(__dirname, 'shots', opts.shot + '-revisao.png'), fullPage: true });
  if (opts && opts.pararAntesDeEnviar) return { pg, errs };
  await pg.click('#modal-tp-publico button.go:has-text("Enviar respostas")'); await pg.waitForSelector('#modal-tp-publico >> text=Respostas recebidas', { timeout: 8000 }).catch(() => {});
  return { pg, errs };
}

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.route('**/rest/v1/**', handler);
  const erros = [];
  const adm = await ctx.newPage(); adm.on('pageerror', e => erros.push('adm: ' + e.message)); adm.on('dialog', d => d.accept());
  await adm.goto(FILE); await adm.waitForTimeout(1500);
  const hoje = await adm.evaluate(() => tpHoje());
  const mais = n => { const d = new Date(hoje + 'T00:00:00'); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

  // 1. módulo existe no menu e abre vazio
  await adm.click('#nav-mais'); check('item "TEM Pessoas" no menu Mais', await adm.isVisible('#nav-tempessoas'));
  await adm.click('#nav-tempessoas'); await adm.waitForSelector('#tp-body');
  await adm.waitForTimeout(500);
  check('estado vazio claro sem ciclos', (await adm.textContent('#tp-body')).includes('Nenhuma avaliação criada ainda'));
  await adm.screenshot({ path: path.join(__dirname, 'shots', '01-vazio.png') });

  // 2. setores e atribuição
  await adm.click('.tp-tab:has-text("Config")');
  await adm.click('text=+ Musculação'); await adm.waitForTimeout(200); await adm.click('text=+ Recepção'); await adm.waitForTimeout(200);
  check('setores criados', db.tp_setores.length === 2, JSON.stringify(db.tp_setores.map(s => s.nome)));
  const sets = { Ana: 'Musculação', Bruno: 'Musculação', Carla: 'Musculação', Diego: 'Musculação', Elisa: 'Musculação', Fabio: 'Musculação', Gabi: 'Recepção', Hugo: 'Recepção' };
  for (let i = 0; i < NOMES.length; i++) { await adm.selectOption('#cs-' + i, sets[NOMES[i]]); await adm.waitForTimeout(120); }
  check('setor de cada colaborador gravado', db.tp_colab_setor.length === 8 && db.tp_colab_setor.find(x => x.colaborador === 'Gabi').setor === 'Recepção');

  // 3. ciclo identificado: criar e abrir
  await adm.click('.tp-tab:has-text("Ciclos")'); await adm.click('text=+ Novo ciclo');
  await adm.click('text=Salvar rascunho');
  check('validação: nome obrigatório', (await adm.textContent('#tp-body')).includes('Dê um nome ao ciclo'));
  await adm.fill('#cf-n', 'Referência 2026'); await adm.fill('#cf-i', hoje); await adm.fill('#cf-f', mais(7)); await adm.fill('#cf-l', '2');
  await adm.click('text=Salvar rascunho');
  check('validação: mínimo de respostas não pode ser menor que 3', (await adm.textContent('#tp-body')).includes('não pode ser menor que 3'));
  await adm.fill('#cf-l', '5'); await adm.click('text=Salvar rascunho'); await adm.waitForSelector('text=Abrir ciclo e gerar links');
  check('ciclo salvo como rascunho', db.tp_ciclos.length === 1 && db.tp_ciclos[0].status === 'rascunho' && db.tp_ciclos[0].elegiveis.length === 8);
  await adm.click('text=Abrir ciclo e gerar links'); await adm.waitForSelector('text=Participação e links');
  check('ciclo aberto e 8 links individuais gerados', db.tp_ciclos[0].status === 'aberto' && db.tp_links.length === 8);
  check('setor copiado para o link', db.tp_links.find(l => l.colaborador === 'Gabi').setor === 'Recepção');
  check('abertura registrada na auditoria', db.tp_auditoria.some(a => a.acao === 'ciclo_aberto'));
  const tok = n => db.tp_links.find(l => l.colaborador === n).token;

  // 4. colaboradores respondem
  const intro = await responder(ctx, tok('Ana'), 'Ana', [], [], { ficarNaIntro: true });
  const txtIntro = await intro.pg.textContent('#modal-tp-publico');
  check('intro: identificada, mostra quem acessa e o mínimo', txtIntro.includes('identificada e confidencial') && txtIntro.includes('Wellington Brito') && txtIntro.includes('pelo menos 5'));
  check('intro: opção N/A e LGPD informadas', txtIntro.includes('Não sei avaliar / Não se aplica') && txtIntro.includes('LGPD'));
  check('link da pesquisa não carregou dados do app (sem sync)', await intro.pg.evaluate(() => !localStorage.getItem('gp_reunioes') || localStorage.getItem('gp_reunioes') === '[]'));
  await intro.pg.screenshot({ path: path.join(__dirname, 'shots', '02-intro.png'), fullPage: true });
  await intro.pg.click('#modal-tp-publico .go');
  check('botão revisar bloqueado até responder tudo', await intro.pg.isDisabled('#tpp-rev'));
  await intro.pg.click('#tpq-p1 [data-v="5"]');
  check('indicador de progresso atualiza (1 de 12)', (await intro.pg.textContent('#tpp-prog-t')).startsWith('1 de 12'));
  await intro.pg.screenshot({ path: path.join(__dirname, 'shots', '03-perguntas.png') });
  const overflow = await intro.pg.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check('pesquisa sem rolagem horizontal no celular', !overflow);
  await intro.pg.close();

  for (const n of Object.keys(DADOS)) {
    const r = await responder(ctx, tok(n), n, DADOS[n], COMENT[n], n === 'Ana' ? { shot: '04' } : null);
    const fim = (await r.pg.textContent('#modal-tp-publico')).includes('Respostas recebidas');
    if (!fim) check('envio de ' + n, false, 'não chegou na confirmação');
    if (r.errs.length) erros.push(n + ': ' + r.errs.join('|'));
    if (n === 'Ana') await r.pg.screenshot({ path: path.join(__dirname, 'shots', '05-confirmacao.png') });
    await r.pg.close();
  }
  check('7 respostas gravadas', db.tp_respostas.length === 7, String(db.tp_respostas.length));
  check('7 links marcados como respondidos, Hugo pendente', db.tp_links.filter(l => l.respondido).length === 7 && !db.tp_links.find(l => l.colaborador === 'Hugo').respondido);
  const rAna = db.tp_respostas.find(r => r.colaborador === 'Ana');
  check('N/A guardado como "na" e nunca como zero', db.tp_respostas.find(r => r.colaborador === 'Elisa').respostas.p3 === 'na' && !db.tp_respostas.some(r => Object.values(r.respostas).includes(0)));
  check('comentário opcional vazio não é gravado', !('a1' in db.tp_respostas.find(r => r.colaborador === 'Bruno').abertas));
  check('resposta guarda versão do questionário', rAna.versao_questionario === 'v1');

  // 5. duplicidade
  const re = await b.newPage ? null : null;
  const again = await ctx.newPage(); await again.goto(FILE + '?tptoken=' + tok('Ana')); await again.waitForSelector('#modal-tp-publico .tpp');
  check('reabrir o link já respondido mostra aviso e não o formulário', (await again.textContent('#modal-tp-publico')).includes('já foram recebidas'));
  await again.close();
  const p1 = await responder(ctx, tok('Hugo'), 'Hugo', [4,4,4,4,4,4,4,4,4,4,4,4], [], { pararAntesDeEnviar: true });
  const p2 = await responder(ctx, tok('Hugo'), 'Hugo', [2,2,2,2,2,2,2,2,2,2,2,2], [], { pararAntesDeEnviar: true });
  await Promise.all([p1.pg.click('#modal-tp-publico button.go:has-text("Enviar respostas")'), p2.pg.click('#modal-tp-publico button.go:has-text("Enviar respostas")')]);
  await p1.pg.waitForTimeout(1200);
  const txts = [(await p1.pg.textContent('#modal-tp-publico')), (await p2.pg.textContent('#modal-tp-publico'))];
  const hugoRows = db.tp_respostas.filter(r => r.colaborador === 'Hugo');
  check('envio simultâneo do mesmo link: só uma resposta gravada', hugoRows.length === 1, String(hugoRows.length));
  check('quem chegou depois vê "já recebidas"', txts.some(t => t.includes('já foram recebidas')) && txts.some(t => t.includes('Respostas recebidas')));
  await p1.pg.close(); await p2.pg.close();
  check('unicidade no banco simulado: segunda linha ativa do mesmo colaborador é recusada', await adm.evaluate(async (cid) => {
    const r = await tpReq('POST', 'tp_respostas', '', { ciclo_id: cid, colaborador: 'Ana', respostas: {}, substituida: false }, false); return r.status === 409; }, db.tp_ciclos[0].id));
  check('banco simulado recusa edição do conteúdo de respostas já enviadas', await adm.evaluate(async (id) => {
    const r = await tpReq('PATCH', 'tp_respostas', 'id=eq.' + id, { respostas: { p1: 1 } }, true); return r.status === 403; }, rAna.id));

  // 6. relatórios (8 respostas agora: Hugo respondeu)
  await adm.evaluate(() => tpCarregar()); await adm.waitForTimeout(500);
  await adm.click('.tp-tab:has-text("Resumo")');
  const hugoVals = Object.keys(db.tp_respostas.find(r => r.colaborador === 'Hugo').respostas).sort((a, b) => +a.slice(1) - +b.slice(1)).map(k => db.tp_respostas.find(r => r.colaborador === 'Hugo').respostas[k]);
  const todosVals = Object.values(DADOS).concat([hugoVals]).flat().filter(v => v !== 'na');
  const media = todosVals.reduce((a, c) => a + c, 0) / todosVals.length;
  const fav = Math.round(todosVals.filter(v => v >= 4).length / todosVals.length * 100);
  const resumoTxt = await adm.textContent('#tp-body');
  check('resumo: participação 8 de 8 = 100%', resumoTxt.includes('100%') && resumoTxt.includes('8 de 8'));
  check('resumo: favorabilidade bate com cálculo independente (' + fav + '%)', resumoTxt.includes(fav + '%') && resumoTxt.includes(todosVals.filter(v => v >= 4).length + ' de ' + todosVals.length));
  check('resumo: média geral bate (' + media.toFixed(2).replace('.', ',') + ')', resumoTxt.includes(media.toFixed(2).replace('.', ',')));
  check('resumo: lista as 6 dimensões', TP_DIMS().every(d => resumoTxt.includes(d)));
  await adm.screenshot({ path: path.join(__dirname, 'shots', '06-resumo.png'), fullPage: true });

  await adm.click('.tp-tab:has-text("Individual")'); await adm.selectOption('#tp-ind', 'Carla'); await adm.waitForTimeout(200);
  const ind = await adm.textContent('#tp-body');
  const carla = DADOS.Carla; const cm = carla.reduce((a, c) => a + c, 0) / 12;
  check('individual: nome, 12 respondidas e média', ind.includes('Carla') && ind.includes('12 de 12') && ind.includes(cm.toFixed(2).replace('.', ',')));
  check('individual: comentários da pessoa aparecem', ind.includes('Horários apertados'));
  check('individual: evidência, interpretação e recomendação separadas', ind.includes('Evidência') && ind.includes('Interpretação') && ind.includes('Recomendação'));
  check('individual: aviso de acesso restrito e de percepção', ind.includes('restrito a quem a gestão autorizou') && ind.includes('percepções registradas'));
  await adm.screenshot({ path: path.join(__dirname, 'shots', '07-individual.png'), fullPage: true });
  await adm.selectOption('#tp-ind', 'Elisa'); await adm.waitForTimeout(200);
  check('individual: N/A fica fora (Elisa: 10 válidas)', (await adm.textContent('#tp-body')).includes('10 com nota válida'));

  await adm.click('.tp-tab:has-text("Setorial")'); await adm.waitForTimeout(200);
  const set = await adm.textContent('#tp-body');
  check('setorial: Recepção (2 respostas) oculta por mínimo de 5', set.includes('Resultados ocultos') && set.includes('Recepção'));
  check('setorial: Musculação (6) exibida com distribuição', set.includes('Musculação') && set.includes('Distribuição das respostas'));
  check('setorial: tabela comparativa só aparece com 2+ setores liberados (aqui só 1)', !set.includes('Comparação entre setores'));
  check('setorial: leitura por camada, da base para o topo, com as 4 camadas', set.includes('Leitura por camada') && ['1. Básicas', '2. Individuais', '3. Coletivas', '4. Crescimento'].every(t => set.includes(t)) && set.indexOf('1. Básicas') < set.indexOf('4. Crescimento'));
  check('setorial: síntese por camada separa evidência, interpretação e recomendação', set.includes('Síntese por camada'));
  check('setorial: camadas não aparecem para setor oculto (Recepção tem só o aviso)', (set.match(/Leitura por camada/g) || []).length === 1);
  await adm.screenshot({ path: path.join(__dirname, 'shots', '08-setorial.png'), fullPage: true });

  await adm.click('.tp-tab:has-text("Executivo")'); await adm.waitForTimeout(200);
  const ex = await adm.textContent('#tp-body');
  check('executivo: cinco perguntas da direção respondidas', ['Como está a experiência', 'pontos fortes', 'dificuldades merecem atenção', 'setores ou processos', 'ações devem ser priorizadas'].every(t => ex.includes(t)));
  check('executivo: dado observado, interpretação e recomendação', ex.includes('Dado observado') && ex.includes('Interpretação') && ex.includes('Recomendação'));
  check('executivo: card de leitura por camada com as 4 camadas e aviso de que a ordem não prova causa', ex.includes('Leitura por camada') && ['1. Básicas', '2. Individuais', '3. Coletivas', '4. Crescimento'].every(t => ex.includes(t)) && ex.includes('não prova') );
  check('executivo: não existe índice geral de engajamento', !/índice (geral )?de engajamento/i.test(ex));
  await adm.screenshot({ path: path.join(__dirname, 'shots', '09-executivo.png'), fullPage: true });

  // 7. temas
  await adm.click('.tp-tab:has-text("Temas")'); await adm.waitForTimeout(200);
  const temasTxt = await adm.textContent('#tp-body');
  check('temas: nenhum nome de colaborador aparece na tela de comentários', !NOMES.some(n => new RegExp('\\b' + n + '\\b').test(temasTxt)));
  const chips = adm.locator('.tp-com:has-text("Falta de bicicletas") .tp-chip:has-text("Recursos e condições de trabalho")');
  await chips.first().click(); await adm.waitForTimeout(200);
  await adm.locator('.tp-com:has-text("Falta de bicicletas") .tp-chip:has-text("Recursos e condições de trabalho")').nth(1).click().catch(() => {});
  await adm.waitForTimeout(200);
  const classif = db.tp_respostas.filter(r => r.temas && r.temas.a2 && r.temas.a2.length).length;
  check('classificação de tema salva (PATCH só em "temas")', classif >= 1, String(classif));
  await adm.click('.tp-tab:has-text("Setorial")'); await adm.waitForTimeout(200);
  const set2 = await adm.textContent('#tp-body');
  check('setorial mostra temas, não frases', !set2.includes('Falta de bicicletas'));

  // 8. planos de ação
  await adm.click('.tp-tab:has-text("Ações")'); await adm.click('text=+ Nova ação');
  await adm.fill('#af-t', 'Revisar equipamentos da sala'); await adm.fill('#af-r', 'Wellington'); await adm.fill('#af-p', mais(-3)); await adm.fill('#af-c', 'Lista conferida com a equipe');
  await adm.click('text=Salvar ação'); await adm.waitForSelector('text=Revisar equipamentos da sala');
  check('ação criada e marcada como atrasada (prazo vencido)', db.tp_acoes.length === 1 && (await adm.textContent('#tp-body')).includes('Atrasada'));
  await adm.selectOption('select[aria-label="Status"]', 'andamento'); await adm.waitForTimeout(300);
  check('mudança de status registra atualização', db.tp_acoes[0].status === 'andamento' && db.tp_acoes[0].atualizacoes.length === 1);
  await adm.click('.tp-tab:has-text("Individual")'); await adm.selectOption('#tp-ind', 'Fabio'); await adm.click('text=Criar ação para este colaborador');
  check('criar ação a partir do relatório individual preenche a origem', (await adm.inputValue('#af-o')).includes('Relatório individual'));
  await adm.click('text=Cancelar');

  // 9. reabertura autorizada
  await adm.click('.tp-tab:has-text("Ciclos")'); await adm.waitForSelector('text=Participação e links');
  const antes = db.tp_respostas.length;
  await adm.locator('.tp-row:has-text("Ana") >> text=Liberar novo envio').click(); await adm.waitForTimeout(500);
  check('reabertura: resposta antiga marcada como substituída, não apagada', db.tp_respostas.length === antes && db.tp_respostas.find(r => r.colaborador === 'Ana').substituida === true);
  check('reabertura registrada na auditoria', db.tp_auditoria.some(a => a.acao === 'reenvio_liberado'));
  const r2 = await responder(ctx, tok('Ana'), 'Ana', [1,1,1,1,1,1,1,1,1,1,1,1], []); await r2.pg.close();
  check('novo envio aceito e só a ativa conta', db.tp_respostas.filter(r => r.colaborador === 'Ana' && !r.substituida).length === 1 && db.tp_respostas.filter(r => r.colaborador === 'Ana').length === 2);
  await adm.evaluate(() => tpCarregar()); await adm.waitForTimeout(400); await adm.click('.tp-tab:has-text("Resumo")');
  const novaMedia = (Object.entries(DADOS).filter(([n]) => n !== 'Ana').flatMap(([, v]) => v).concat(hugoVals, Array(12).fill(1))).filter(v => v !== 'na');
  check('cálculo ignora a resposta substituída', (await adm.textContent('#tp-body')).includes((novaMedia.reduce((a, c) => a + c, 0) / novaMedia.length).toFixed(2).replace('.', ',')));

  // 10. encerrar e bloquear
  await adm.click('.tp-tab:has-text("Ciclos")'); await adm.click('text=Encerrar ciclo'); await adm.waitForTimeout(300);
  check('ciclo encerrado', db.tp_ciclos[0].status === 'encerrado');
  const pos = await ctx.newPage(); await pos.goto(FILE + '?tptoken=' + tok('Ana')); await pos.waitForSelector('#modal-tp-publico .tpp');
  check('após encerrar, link já respondido ou fora do período não aceita envio', !(await pos.isVisible('#modal-tp-publico .go:has-text("Começar")')));
  await pos.close();
  await adm.click('text=Registrar publicação dos resultados'); await adm.waitForTimeout(300);
  check('publicação dos resultados registrada', !!db.tp_ciclos[0].publicado_em);

  // 11. ciclo anônimo
  await adm.click('text=+ Novo ciclo'); await adm.fill('#cf-n', 'Pulso anônimo'); await adm.fill('#cf-i', hoje); await adm.fill('#cf-f', mais(7));
  await adm.click('#cf-m2'); await adm.click('text=Salvar rascunho'); await adm.waitForSelector('text=Abrir ciclo e gerar links');
  await adm.click('text=Abrir ciclo e gerar links'); await adm.waitForSelector('text=Participação e links');
  const cAn = db.tp_ciclos.find(c => c.modo === 'anonima');
  const linksAn = db.tp_links.filter(l => l.ciclo_id === cAn.id);
  const anIntro = await responder(ctx, linksAn[0].token, '', [], [], { ficarNaIntro: true });
  const anTxt = await anIntro.pg.textContent('#modal-tp-publico');
  check('intro anônima: promete só o que cumpre', anTxt.includes('anônima') && anTxt.includes('não o que respondeu'));
  await anIntro.pg.close();
  for (let i = 0; i < 5; i++) { const r = await responder(ctx, linksAn[i].token, '', [3 + (i % 3), 4, 5, 4, 3, 4, 4, 5, 3, 4, 4, 5], ['', 'Pouco tempo para planejar', '']); await r.pg.close(); }
  const rowsAn = db.tp_respostas.filter(r => r.ciclo_id === cAn.id);
  check('anônimo: 5 respostas, nenhuma com nome', rowsAn.length === 5 && rowsAn.every(r => r.colaborador === null));
  const dump = JSON.stringify(rowsAn);
  check('anônimo: nenhuma linha contém nome de colaborador nem token', !NOMES.some(n => dump.includes('"' + n + '"')) && !linksAn.some(l => dump.includes(l.token)));
  check('anônimo: só a data, sem horário', rowsAn.every(r => /^\d{4}-\d{2}-\d{2}$/.test(r.criado_em)));
  check('anônimo: participação rastreada à parte (5 de 8 marcados)', db.tp_links.filter(l => l.ciclo_id === cAn.id && l.respondido).length === 5);
  await adm.evaluate(() => tpCarregar()); await adm.waitForTimeout(400);
  await adm.evaluate((id) => { tp.cicloSel = id; tpRender(); }, cAn.id);
  await adm.click('.tp-tab:has-text("Individual")'); await adm.waitForTimeout(200);
  check('anônimo: sem relatório individual', (await adm.textContent('#tp-body')).includes('Ciclo anônimo'));
  await adm.click('.tp-tab:has-text("Setorial")'); await adm.waitForTimeout(200);
  const anSet = await adm.textContent('#tp-body');
  check('anônimo: setor com menos de 5 respostas continua oculto', anSet.includes('Resultados ocultos'));
  await adm.click('.tp-tab:has-text("Temas")'); await adm.waitForTimeout(200);
  await adm.click('.tp-tab:has-text("Ciclos")'); await adm.selectOption('#tp-cc', cAn.id); await adm.click('text=Encerrar ciclo'); await adm.waitForTimeout(300);
  const pend = await ctx.newPage(); await pend.goto(FILE + '?tptoken=' + linksAn[5].token); await pend.waitForSelector('#modal-tp-publico .tpp');
  const pendTxt = await pend.textContent('#modal-tp-publico');
  check('link pendente de ciclo encerrado: recusa e não mostra formulário', pendTxt.includes('não está aberta') && !(await pend.isVisible('#modal-tp-publico .go')));
  await pend.close();
  await adm.click('.tp-tab:has-text("Temas")'); await adm.waitForTimeout(200);
  check('anônimo: temas lista comentário sem autor', (await adm.textContent('#tp-body')).includes('Pouco tempo para planejar'));

  // 12. menu existente intacto
  await adm.click('#nav-dashboard'); await adm.waitForTimeout(300);
  check('app existente continua abrindo (Visão Geral)', await adm.isVisible('#v-dashboard'));
  const ov = await adm.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check('sem rolagem horizontal na tela Geral', !ov);

  check('nenhum erro de JavaScript', erros.length === 0, erros.join(' || '));
  await b.close();
  const falhas = res.filter(r => !r[0]);
  console.log(`\n${res.length - falhas.length} de ${res.length} verificações passaram`);
  process.exit(falhas.length ? 1 : 0);
})().catch(e => { console.error('ERRO NO TESTE', e); process.exit(2); });

function TP_DIMS() { return ['Clareza e condições de trabalho', 'Desenvolvimento e potencial profissional', 'Reconhecimento e cuidado', 'Liderança, escuta e feedback', 'Equipe e colaboração', 'Propósito e crescimento na organização']; }
