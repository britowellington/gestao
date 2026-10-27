// Teste ponta a ponta da Voz do Aluno no navegador (Chromium headless), viewport de celular.
// O banco é SIMULADO em memória. Rodar: NODE_PATH=$(npm root -g) node e2e-voz-aluno.js
const { chromium } = require('playwright');
const crypto = require('crypto');
const path = require('path');
const FILE = 'file://' + path.join(__dirname, 'gestao-people.html');
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'content-type': 'application/json' };
const db = { voz_aluno: [], solicitacoes: [] };
const flags = { falhaPost: false, tabelaAusente: false };
async function handler(route) {
  const req = route.request(); const u = new URL(req.url());
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  const t = u.pathname.replace('/rest/v1/', ''); const rows = db[t];
  const ok = (s, b) => route.fulfill({ status: s, headers: CORS, body: b === undefined ? '' : JSON.stringify(b) });
  if (!rows) return ok(200, []);
  if (t === 'voz_aluno' && flags.tabelaAusente) return ok(404, { code: '42P01', message: 'relation does not exist' });
  if (t === 'voz_aluno' && req.method() === 'POST' && flags.falhaPost) return route.abort('failed');
  const filt = r => { for (const [k, v] of u.searchParams) { if (['select', 'order', 'limit'].includes(k)) continue; if (v.startsWith('eq.') && String(r[k]) !== v.slice(3)) return false; } return true; };
  const m = req.method();
  if (m === 'GET') return ok(200, JSON.parse(JSON.stringify(rows.filter(filt))));
  if (m === 'POST') {
    const body = JSON.parse(req.postData() || '{}');
    const row = Object.assign({ id: crypto.randomUUID(), criado_em: new Date().toISOString() }, body);
    if (t === 'voz_aluno') {
      if (!['ate3m', '3a12m', '1a3a', 'mais3a'].includes(row.tempo) || !['manha', 'tarde', 'noite', 'varia'].includes(row.horario)) return ok(400, { code: '23514', message: 'check violation' });
      if ('nome' in row || 'contato' in row) return ok(400, { message: 'coluna inexistente' });
    }
    rows.unshift(row); return ok(201, [row]);
  }
  if (m === 'DELETE') { const keep = rows.filter(r => !filt(r)); rows.length = 0; keep.forEach(r => rows.push(r)); return ok(204); }
  return ok(405, {});
}
const res = []; const check = (nome, cond, det) => { res.push(!!cond); console.log(cond ? 'OK   ' : 'FALHA', nome, cond ? '' : '→ ' + det); };
const hojeLocal = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

async function registrar(pg, o) {
  await pg.click('#va-tab-registrar');
  if (o.gosta) await pg.fill('#va-gosta', o.gosta);
  if (o.melhorar) await pg.fill('#va-melhorar', o.melhorar);
  for (const a of (o.gostaAreas || [])) await pg.click(`#va-chips-gosta [data-a="${a}"]`);
  for (const a of (o.melhorarAreas || [])) await pg.click(`#va-chips-melhorar [data-a="${a}"]`);
  if (o.tempo) await pg.click(`#va-chips-tempo [data-k="${o.tempo}"]`);
  if (o.horario) await pg.click(`#va-chips-horario [data-k="${o.horario}"]`);
  await pg.click('#va-save-btn');
  await pg.waitForFunction(n => document.querySelector('#va-hoje-n') && +document.querySelector('#va-hoje-n').textContent === n, o.espera);
}

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, permissions: ['clipboard-read', 'clipboard-write'] });
  await ctx.route('**/rest/v1/**', handler);
  const erros = [];
  const pg = await ctx.newPage(); pg.on('pageerror', e => erros.push(e.message)); pg.on('dialog', d => d.accept());
  await pg.goto(FILE); await pg.waitForTimeout(1200);

  // 1. menu e tela
  await pg.click('#nav-mais'); check('item "Voz do Aluno" no menu Mais', await pg.isVisible('#nav-vozaluno'));
  await pg.click('#nav-vozaluno'); await pg.waitForSelector('#va-save-btn');
  check('abre na aba Registrar com contador 0 de 10', (await pg.textContent('#va-hoje-box')).replace(/\s+/g, ' ').includes('0 de 10'));
  check('botão Registrar começa desabilitado', await pg.isDisabled('#va-save-btn'));
  check('as duas perguntas e os dois campos de contexto aparecem', (await pg.textContent('#va-body')).includes('mais gosta na academia, e por quê?') && (await pg.textContent('#va-body')).includes('precisa melhorar, e por quê?') && (await pg.textContent('#va-body')).includes('Há quanto tempo') && (await pg.textContent('#va-body')).includes('horário costuma treinar'));

  // 2. validação: só texto não basta, precisa de tempo e horário
  await pg.fill('#va-gosta', 'Gosto dos instrutores, são atenciosos');
  check('só com texto ainda desabilitado', await pg.isDisabled('#va-save-btn'));
  await pg.click('#va-chips-tempo [data-k="ate3m"]');
  check('com texto e tempo, sem horário, desabilitado', await pg.isDisabled('#va-save-btn'));
  await pg.click('#va-chips-horario [data-k="manha"]');
  check('com texto, tempo e horário, habilitado', !(await pg.isDisabled('#va-save-btn')));

  // 3. "Nada a melhorar" é exclusivo
  await pg.click('#va-chips-melhorar [data-a="Limpeza"]'); await pg.click('#va-chips-melhorar [data-a="Preço"]');
  await pg.click('#va-chips-melhorar [data-a="Nada a melhorar"]');
  check('"Nada a melhorar" limpa as outras áreas', (await pg.$$('#va-chips-melhorar .on')).length === 1);
  await pg.click('#va-chips-melhorar [data-a="Limpeza"]');
  check('escolher uma área tira "Nada a melhorar"', (await pg.$$eval('#va-chips-melhorar .on', els => els.map(e => e.dataset.a))).join() === 'Limpeza');

  // 4. salvar a primeira
  await pg.fill('#va-melhorar', 'Banheiro sujo no fim da tarde');
  await pg.click('#va-chips-gosta [data-a="Instrutores"]');
  await pg.click('#va-save-btn'); await pg.waitForSelector('#va-success', { state: 'visible' });
  const r1 = db.voz_aluno[0];
  check('gravou no banco com os campos certos', r1 && r1.tempo === 'ate3m' && r1.horario === 'manha' && r1.gosta.startsWith('Gosto dos') && r1.melhorar === 'Banheiro sujo no fim da tarde' && JSON.stringify(r1.melhorar_areas) === '["Limpeza"]' && JSON.stringify(r1.gosta_areas) === '["Instrutores"]', JSON.stringify(r1));
  check('a data gravada é a data local de hoje', r1 && r1.data === hojeLocal(), r1 && r1.data);
  check('não grava nome nem contato', r1 && !('nome' in r1) && !('contato' in r1));
  check('contador foi para 1 e o formulário foi limpo', (await pg.textContent('#va-hoje-n')) === '1' && (await pg.inputValue('#va-gosta')) === '' && (await pg.$$('#va-body .chip-btn.on')).length === 0);
  check('mensagem de sucesso', (await pg.textContent('#va-success')).includes('Conversa registrada'));

  // 5. mais conversas variadas
  const lote = [
    { melhorar: 'Falta ventilação', melhorarAreas: ['Ambiente'], gostaAreas: ['Instrutores'], gosta: 'Instrutor presente', tempo: 'ate3m', horario: 'manha' },
    { melhorar: 'Banheiro', melhorarAreas: ['Limpeza'], tempo: 'ate3m', horario: 'manha' },
    { melhorar: 'Banheiro de novo', melhorarAreas: ['Limpeza'], tempo: 'ate3m', horario: 'manha' },
    { melhorar: 'Lotada à noite', melhorarAreas: ['Horários e lotação'], tempo: 'mais3a', horario: 'noite' },
    { melhorar: 'Falta aparelho livre', melhorarAreas: ['Horários e lotação', 'Equipamentos'], tempo: 'mais3a', horario: 'noite' },
    { melhorar: 'Sempre cheia', melhorarAreas: ['Horários e lotação'], tempo: 'mais3a', horario: 'noite' },
    { melhorarAreas: ['Nada a melhorar'], gosta: 'Tudo certo', gostaAreas: ['Recepção'], tempo: '1a3a', horario: 'tarde' },
    { melhorar: '<img src=x onerror="window.__xss=1"> teste', melhorarAreas: ['Outro'], tempo: 'mais3a', horario: 'noite' }
  ];
  let n = 1; for (const o of lote) { n++; o.espera = n; await registrar(pg, o); }
  check('contador chegou a 9 de 10 e o banco tem 9', (await pg.textContent('#va-hoje-n')) === '9' && db.voz_aluno.length === 9, db.voz_aluno.length);
  await pg.click('#va-tab-registrar'); await registrar(pg, { gosta: 'Ambiente bom', tempo: '3a12m', horario: 'varia', espera: 10 });
  check('com 10 a barra de progresso chega a 100%', (await pg.$eval('#va-hoje-box .va-bar i', e => e.style.width)) === '100%');

  // 6. relatório
  await pg.click('#va-tab-relatorio'); await pg.waitForSelector('.va-kpis');
  const kp = await pg.$$eval('.va-kpi', els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()));
  check('indicadores: 10 conversas, 1 dia, média 10, 1 dia na meta', kp.join('|') === '10conversas|1dias com conversa|10média por dia|1dias na meta de 10', kp.join('|'));
  const txt = await pg.textContent('#va-body');
  check('síntese cita o ponto mais citado para melhorar', txt.includes('Ponto mais citado para melhorar: Horários e lotação (3 de 10, 30%)'), txt.slice(0, 400));
  check('síntese avisa que não é amostra aleatória', txt.includes('não formam uma amostra aleatória'));
  check('corte por tempo: "mais de 3 anos" mostra o ponto mais citado; grupo pequeno diz poucos dados', txt.includes('Mais de 3 anos') && txt.includes('poucos dados'));
  check('"nada a melhorar" é contado à parte', txt.includes('1 aluno disse que não há nada a melhorar'));
  // frases
  await pg.click('.va-rank:has-text("Limpeza") button:has-text("Ver frases")');
  const fr = await pg.textContent('#va-fr-melhorar-' + (await pg.evaluate(() => vaUlt.res.melhorar.findIndex(x => x.area === 'Limpeza'))));
  check('"Ver frases" mostra as frases da área', fr.includes('Banheiro sujo no fim da tarde') && fr.includes('Banheiro de novo'), fr);
  check('HTML digitado pelo aluno não é executado', !(await pg.evaluate(() => window.__xss)));
  // período
  await pg.click('button:has-text("7 dias")'); check('filtro de 7 dias mantém as 10 de hoje', (await pg.textContent('.va-kpi b')) === '10');
  // copiar
  await pg.click('button:has-text("Copiar resumo")'); await pg.waitForTimeout(200);
  const clip = await pg.evaluate(() => navigator.clipboard.readText()).catch(() => '');
  check('copiar resumo coloca o texto na área de transferência', clip.startsWith('Voz do Aluno | últimos 7 dias') && clip.includes('O que precisa melhorar:'), clip.slice(0, 80));
  // criar solicitação
  await pg.click('.va-rank:has-text("Limpeza") button:has-text("Criar solicitação")'); await pg.waitForSelector('#v-solicitacoes.active');
  check('abre Solicitações com origem Aluno e assunto preenchidos', (await pg.inputValue('#sol-assunto')) === 'Melhorar limpeza (apontado por alunos)' && (await pg.inputValue('#sol-obs')).includes('3 de 10 conversas com alunos (30%)') && !(await pg.isDisabled('#sol-save-btn')), await pg.inputValue('#sol-assunto'));
  await pg.click('#sol-save-btn'); await pg.waitForTimeout(500);
  check('a solicitação foi gravada com origem aluno', db.solicitacoes.length === 1 && db.solicitacoes[0].origem === 'aluno', JSON.stringify(db.solicitacoes));

  // 7. lista e exclusão
  await pg.click('#nav-mais'); await pg.click('#nav-vozaluno'); await pg.click('#va-tab-conversas'); await pg.waitForSelector('.fb-card');
  check('lista mostra as 10 conversas, com HTML escapado', (await pg.$$('.fb-card')).length === 10 && (await pg.textContent('#va-body')).includes('<img src=x'));
  await pg.click('.fb-card:has-text("Ambiente bom") button[title="Excluir"]'); await pg.waitForTimeout(400);
  check('excluir remove do app e do banco', (await pg.$$('.fb-card')).length === 9 && db.voz_aluno.length === 9);

  // 8. sem conexão: guarda no aparelho e reenvia depois
  flags.falhaPost = true; await pg.click('#va-tab-registrar');
  await pg.fill('#va-gosta', 'Registro offline'); await pg.click('#va-chips-tempo [data-k="1a3a"]'); await pg.click('#va-chips-horario [data-k="tarde"]');
  await pg.click('#va-save-btn'); await pg.waitForSelector('#va-success', { state: 'visible' });
  check('sem conexão: avisa que foi salvo no aparelho', (await pg.textContent('#va-success')).includes('Salvo neste aparelho'));
  check('sem conexão: não chegou ao banco, mas está no app', db.voz_aluno.length === 9 && (await pg.evaluate(() => vaRows.filter(r => String(r.id).startsWith('local_')).length)) === 1);
  flags.falhaPost = false; await pg.evaluate(() => vaSync()); await pg.waitForTimeout(500);
  check('ao voltar a conexão, reenvia e troca o id local', db.voz_aluno.length === 10 && (await pg.evaluate(() => vaRows.filter(r => String(r.id).startsWith('local_')).length)) === 0 && (await pg.evaluate(() => vaRows.length)) === 10);

  // 9. tabela ainda não criada: não apaga o que está no aparelho nem quebra
  flags.tabelaAusente = true; const antes = await pg.evaluate(() => vaRows.length);
  await pg.evaluate(() => vaSync()); await pg.waitForTimeout(300);
  check('tabela ausente: mantém as conversas locais e não dá erro', (await pg.evaluate(() => vaRows.length)) === antes);
  flags.tabelaAusente = false;

  // 10. layout e erros
  await pg.click('#va-tab-relatorio'); const sw = await pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  check('sem rolagem horizontal no relatório', sw);
  await pg.screenshot({ path: path.join(__dirname, 'shots', 'va-relatorio.png'), fullPage: true }).catch(() => {});
  check('nenhum erro de JavaScript', erros.length === 0, erros.join(' | '));
  await b.close();
  const okN = res.filter(Boolean).length; console.log('\n' + okN + ' de ' + res.length + ' verificações passaram'); process.exit(okN === res.length ? 0 : 1);
})().catch(e => { console.error('ERRO', e); process.exit(2); });
