import {
  DEFAULT_SETTINGS, CATEGORY_OPTIONS, id, iso, localDay, localDateTime, localTime,
  todayLocal, fmtMinutes, mondayFor, shiftDay, isWorkday, breakdown, segments,
  unionMinutes, validateShift, validateIncident, statutoryWeekInfo,
} from './domain.mjs';
import { openLocal, get, getAll, put, saveSettings, loadSettings, requestPersistence } from './idb.mjs';
import { currentUser, restoreSession, sessionExists, checkSession, authPassword,
  requestReset, updatePassword, signOut, rest, storageDownload } from './auth.mjs';
import { syncNow, pendingCount, onSync, resolveConflictCopy } from './sync.mjs';
import { backup, importBackup, csv, printReport } from './exports.mjs';
import { entriesForIdentity } from './ownership.mjs';

const root = document.getElementById('app');
const dialog = document.getElementById('dialog');
const sheet = document.getElementById('sheet');
const toastEl = document.getElementById('toast');
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const state = {
  entries: [], audit: [], settings: { ...DEFAULT_SETTINGS },
  tab: 'today', filter: 'all', search: '', weekOffset: 0,
  sync: 'local', syncMessage: '', pending: 0, selectedId: null,
  ready: false, cloudUser: null, authMode: 'login',
};
const alertToast = message => {
  toastEl.textContent = message;
  toastEl.classList.add('visible');
  clearTimeout(alertToast.timer);
  alertToast.timer = setTimeout(() => toastEl.classList.remove('visible'), 4000);
};
const button = (label, action, cls = 'plain', props = '') => `<button type="button" class="btn ${cls}" data-action="${action}" ${props}>${label}</button>`;
const eDate = value => new Intl.DateTimeFormat('pt-BR', { timeZone: state.settings.timezone, day:'2-digit', month:'short', year:'numeric' }).format(new Date(value));
const dt = value => localDateTime(value, state.settings.timezone);
const tm = value => localTime(value, state.settings.timezone);
const today = () => todayLocal(state.settings.timezone);
const validUserEntries = () => entriesForIdentity(state.entries, state.cloudUser?.id);
const visibleEntries = () => validUserEntries().filter(e => !e.archivedAt);
const active = () => visibleEntries().find(e => e.type === 'shift' && !e.end);
const activeBreak = shift => (shift?.breaks || []).find(b => !b.end);
const week = offset => {
  const start = shiftDay(mondayFor(today()), offset * 7);
  const end = shiftDay(start, 6);
  return { start, end, stats: breakdown(visibleEntries(), start, end, state.settings) };
};
function title(text, kicker, action = '') {
  return `<div class="heading"><div><p class="eyebrow">${escape(kicker)}</p><h1>${escape(text)}</h1></div>${action}</div>`;
}
function entryCard(entry) {
  const incident = entry.type === 'incident';
  const title = entry.title || (incident ? 'Problema' : entry.kind === 'extra' ? 'Atividade extra' : 'Jornada');
  const label = incident ? `${dt(entry.at)} · ${entry.category}` : `${eDate(entry.start)} · ${tm(entry.start)} – ${entry.end ? tm(entry.end) : 'em andamento'}`;
  const elapsed = Math.round(unionMinutes(segments(entry)) / 60000);
  return `<button class="item" data-action="detail" data-id="${entry.id}"><span class="glyph ${incident ? 'anger' : ''}">${incident ? '!' : entry.kind === 'extra' ? '+' : '◷'}</span><span class="itembody"><span class="itemtitle">${escape(title)}</span><span class="itemdesc">${escape(label)}${entry.attachments?.length ? ' · 📎 ' + entry.attachments.length : ''}</span></span><span class="itemend">${entry.conflict ? '<span class="tag warm">Conflito</span>' : incident ? '<span class="tag warm">Ocorrência</span>' : fmtMinutes(elapsed)}</span></button>`;
}
function blank(title, description, action = null, label = '') {
  return `<div class="blank"><h3>${escape(title)}</h3><p>${escape(description)}</p>${action ? `<div class="spaced">${button(label, action, 'outline')}</div>` : ''}</div>`;
}
function todayPage() {
  const a = active();
  const day = today();
  const stats = breakdown(visibleEntries(), day, day, state.settings);
  const ws = week(0).stats;
  const month = day.slice(0, 7);
  const incidents = visibleEntries().filter(e => e.type === 'incident' && localDay(e.at, state.settings.timezone).startsWith(month)).length;
  const daily = visibleEntries().filter(e => localDay(e.start || e.at, state.settings.timezone) === day).sort((a, b) => +new Date(b.start || b.at) - +new Date(a.start || a.at));
  return title('Hoje', new Intl.DateTimeFormat('pt-BR', { weekday:'long', day:'numeric', month:'long', timeZone:state.settings.timezone }).format(new Date())) +
    `<div class="stack"><section class="card hero"><p class="eyebrow">${a ? 'JORNADA EM ANDAMENTO' : 'SEU REGISTRO DE HOJE'}</p><div id="live" class="big">${fmtMinutes(stats.workedMinutes)} <small>trabalhadas hoje</small></div><p class="sub">${a ? (activeBreak(a) ? 'Pausa em andamento' : 'Jornada iniciada às ' + tm(a.start)) : 'Suas horas reais, em poucos toques.'}</p><div class="actions">${a ? button(activeBreak(a) ? '▶ Retomar' : 'Ⅱ Pausa', activeBreak(a) ? 'resume' : 'pause', 'plain') + button('Finalizar jornada', 'stop', 'primary') : button('● Iniciar jornada', 'start', 'primary')}${button('+ Lançar horário', 'new-shift', 'plain')}</div></section><div class="grid3"><div class="card"><div class="statlabel">Esta semana</div><div class="stat">${fmtMinutes(ws.workedMinutes)}</div><div class="meta">de ${fmtMinutes(state.settings.weeklyMinutes)}</div></div><div class="card"><div class="statlabel">Excedentes*</div><div class="stat">${fmtMinutes(ws.flaggedExtraMinutes)}</div><div class="meta">estimados</div></div><div class="card"><div class="statlabel">Problemas</div><div class="stat">${incidents}</div><div class="meta">neste mês</div></div></div><section class="card"><h3>Precisa documentar alguma coisa?</h3><p class="sub">Pedido fora do expediente, cobrança ou outro fato relevante.</p><div class="spaced">${button('+ Registrar problema', 'new-incident', 'primary wide')}</div></section></div><section class="section"><div class="sectionhead"><h2>Registros de hoje</h2>${button('Ver histórico', 'history', 'outline smallbtn')}</div><div class="entries">${daily.length ? daily.map(entryCard).join('') : blank('Tudo em branco por enquanto', 'Quando você registrar algo, aparecerá aqui.', 'new-shift', 'Adicionar horário')}</div></section><p class="bottomnote">* Indicador pessoal, não cálculo legal de horas extras. Horários sobrepostos contam apenas uma vez no total trabalhado.</p>`;
}
function historyPage() {
  let records = [...visibleEntries()].sort((a, b) => +new Date(b.start || b.at) - +new Date(a.start || a.at));
  if (state.filter === 'shifts') records = records.filter(e => e.type === 'shift');
  if (state.filter === 'incidents') records = records.filter(e => e.type === 'incident');
  if (state.search) records = records.filter(e => [e.title, e.note, e.description, e.people, e.category, e.channel, e.impact].join(' ').toLowerCase().includes(state.search.toLowerCase()));
  return title('Histórico', 'Linha do tempo pessoal', button('Exportar', 'export-modal', 'outline smallbtn')) +
    `<input id="search" class="search" type="search" placeholder="Buscar palavras, pessoas ou acontecimentos..." value="${escape(state.search)}" aria-label="Pesquisar registros"><div class="tabs">${[['all','Todos'],['shifts','Horários'],['incidents','Problemas']].map(([key,label]) => `<button class="tab ${state.filter===key?'selected':''}" data-action="filter" data-filter="${key}">${label}</button>`).join('')}</div><div class="entries">${records.length ? records.map(entryCard).join('') : blank('Nenhum registro encontrado', 'Experimente outra busca ou crie um registro.')}</div>`;
}
function problemsPage() {
  const all = visibleEntries().filter(e => e.type === 'incident').sort((a,b) => +new Date(b.at)-+new Date(a.at));
  const month = today().slice(0, 7);
  const count = all.filter(e => localDay(e.at,state.settings.timezone).startsWith(month)).length;
  return title('Problemas', 'Documentação privada') + `<div class="card"><div class="row"><div><div class="statlabel">Ocorrências neste mês</div><div class="stat">${count}</div></div><span class="tag warm">Registro pessoal</span></div><p class="sub">Descreva fatos, horários, contexto e pessoas. Preserve os anexos originais.</p><div class="spaced">${button('+ Nova ocorrência', 'new-incident', 'primary wide')}</div></div><section class="section"><div class="sectionhead"><h2>Ocorrências</h2><span class="meta">${all.length} no total</span></div><div class="entries">${all.length ? all.map(entryCard).join('') : blank('Nenhuma ocorrência', 'Se acontecer algo importante, registre o que houve.', 'new-incident','Criar ocorrência')}</div></section>`;
}
function panelPage() {
  const {start,end,stats}=week(state.weekOffset);
  const legal=statutoryWeekInfo(start,end);
  const days=Array.from({length:7},(_,i)=>shiftDay(start,i));
  const max=Math.max(state.settings.dailyTargetMinutes, ...days.map(d=>stats.byDay[d]?.workedMinutes||0));
  const chart=days.map((d,i)=>{const n=stats.byDay[d]?.workedMinutes||0,ex=stats.byDay[d]?.flaggedExtraMinutes||0;return `<div class="barcol" title="${escape(d)}: ${fmtMinutes(n)}"><span class="barcap">${n?fmtMinutes(n):'·'}</span><div class="barbase"><div class="bar ${ex?'extra':''}" style="height:${n?Math.max(2,Math.round(n/max*100)):0}%"></div></div><span class="barmeta">${['S','T','Q','Q','S','S','D'][i]}</span></div>`}).join('');
  const count=visibleEntries().filter(e=>e.type==='incident').length;
  return title('Painel', 'Sua jornada em perspectiva') + `<div class="card"><div class="row">${button('‹','week-prev','outline smallbtn')}<div style="text-align:center"><h3>${escape(start)} a ${escape(end)}</h3><p class="meta">Semana selecionada</p></div>${button('›','week-next','outline smallbtn')}</div><div class="chart" role="img" aria-label="Gráfico de horas trabalhadas por dia">${chart}</div></div><div class="grid3 spaced"><div class="card"><div class="statlabel">Trabalhadas</div><div class="stat">${fmtMinutes(stats.workedMinutes)}</div></div><div class="card"><div class="statlabel">Referência</div><div class="stat">${fmtMinutes(state.settings.weeklyMinutes)}</div></div><div class="card"><div class="statlabel">Saldo semanal</div><div class="stat">${stats.weeklyBalanceMinutes>0?'+':''}${fmtMinutes(stats.weeklyBalanceMinutes)}</div></div></div><div class="grid2 spaced"><div class="card"><h3>Tempo excedente identificado*</h3><div class="stat">${fmtMinutes(stats.flaggedExtraMinutes)}</div><p class="sub">Acima da meta diária, marcado como extra ou em finais de semana, descontando sobreposições.</p></div><div class="card"><h3>Ocorrências documentadas</h3><div class="stat">${count}</div><p class="sub">Com data de acontecimento e de registro, além de anexos quando houver.</p></div></div><div class="card spaced"><h3>Seu histórico precisa sobreviver a um celular perdido</h3><p class="sub">Exporte todos os registros, revisões e arquivos originais. Mantenha uma cópia pessoal segura.</p><div class="spaced">${button('Exportar / fazer backup', 'export-modal', 'outline wide')}</div></div><div class="message spaced"><b>Limite legal geral nesta semana (EC 141/2026):</b> ${legal.transition?'Semana de transição entre '+fmtMinutes(legal.beginningMinutes)+' e '+fmtMinutes(legal.endingMinutes):fmtMinutes(legal.limitMinutes)}. A meta pessoal de ${fmtMinutes(state.settings.weeklyMinutes)} não muda automaticamente. Verifique o acordo aplicável.</div><p class="bottomnote">* Não é holerite, banco de horas oficial nem comprovação pericial. Sábados, domingos, feriados, compensações e convenções coletivas exigem análise específica.</p>`;
}
function settingsPage() {
  const user=state.cloudUser;
  const unownedCount = state.entries.filter(e => !e.ownerId).length;
  const openSession=user?`<p class="sub">Conectado como <b>${escape(user.email||'usuário autenticado')}</b>.</p><div class="spaced">${button('Sincronizar agora','sync','outline')}${button('Sair da conta','logout','plain logout')}</div>${unownedCount ? `<p class="hint">${unownedCount} registro(s) antigos ainda não vinculados a uma conta.</p><div class="spaced">${button('Vincular registros locais a esta conta','claim-local','outline wide')}</div>` : ''}`:`<p class="sub">Você pode registrar offline sem conta. Entre para sincronizar seus registros entre aparelhos.</p><div class="spaced">${button('Entrar / criar conta','auth','primary')}</div>`;
  return title('Ajustes', 'Privacidade e controle') + `<div class="stack"><section class="card"><h3>Conta e sincronização</h3>${openSession}<div class="message spaced ${state.sync==='error'?'error':''}">${escape(syncText())}</div></section><section class="card"><h3>Sua jornada de referência</h3><p class="sub">Ajustável. Base inicial: 44 horas semanais distribuídas de segunda a sexta.</p><div class="fields2"><div class="field"><label for="weekly">Horas semanais</label><input id="weekly" type="number" min="1" max="80" step="0.5" value="${state.settings.weeklyMinutes/60}"></div><div class="field"><label for="daily">Horas diárias (meta)</label><input id="daily" type="number" min="0.5" max="24" step="0.1" value="${state.settings.dailyTargetMinutes/60}"></div></div>${button('Salvar metas','save-settings','primary')}</section><section class="card"><h3>Notificações</h3><p class="sub">Push real, mesmo com o aplicativo fechado, exige permissão do aparelho e servidor de envio configurado. No plano gratuito, o disparo pode variar dentro de uma hora.</p><div class="field"><label for="reminder">Horário pretendido</label><input id="reminder" type="time" value="${escape(state.settings.reminderTime)}"></div><div class="actions">${button('Ativar push','enable-push','outline')}${button('Lembrete na agenda','calendar','plain')}</div><p class="hint">O envio remoto nesta versão usa a janela das 18h30, horário de Brasília, em dias úteis. Para outro horário, use a agenda do celular.</p></section><section class="card"><h3>Seus dados, seus arquivos</h3><p class="sub">Backup completo com anexos originais e histórico de revisões. CSV para análise e relatório para impressão em PDF.</p><div class="actions">${button('Backup completo','backup','primary')}${button('Importar backup','restore','outline')}${button('CSV','csv','plain')}${button('PDF','pdf','plain')}</div><input id="restore-file" type="file" accept=".json,application/json" hidden></section><section class="card"><h3>Armazenamento offline</h3><p class="sub">Dados locais podem desaparecer ao limpar o navegador. Sincronização e backups são camadas complementares, não garantia absoluta de preservação.</p><div class="spaced">${button('Solicitar armazenamento persistente','persist','outline wide')}</div></section><div class="message spaced">EC 141/2026: redução geral escalonada de 44h para 42h em dezembro/2026 e para 40h em dezembro/2027. Suas metas são independentes e configuráveis.</div><div class="message warn">Seus registros são relatos pessoais. Guarde provas apenas quando tiver direito de acessá-las e evite arquivos confidenciais de terceiros. Registros não substituem orientação jurídica.</div></div>`;
}
function syncText(){
  if (!state.cloudUser) return 'Modo local. Nenhum registro foi enviado ao servidor.';
  if (state.sync==='syncing') return 'Sincronizando, sem apagar registros locais...';
  if (state.sync==='error') return `Não foi possível sincronizar. Seus registros locais permanecem salvos. ${state.syncMessage}`;
  if (state.sync==='conflict') return 'Há registros com conflito entre aparelhos. Veja o histórico e preserve as duas versões.';
  if (state.sync==='synced') return `Sincronizado no Supabase. ${state.pending?state.pending+' pendente(s).':'Nenhum registro pendente.'}`;
  return `Você está conectado. ${state.pending} registro(s) aguardando envio.`;
}
function render() {
  if (!state.ready) return;
  const pages={today:todayPage,history:historyPage,problems:problemsPage,panel:panelPage,settings:settingsPage};
  const secure=!!state.cloudUser;
  const tabs=[['today','⌂','Hoje'],['history','▤','Histórico'],['problems','◇','Problemas'],['panel','▥','Painel']];
  const hasOwnerRecords=state.entries.some(e=>e.ownerId);
  if (!secure && hasOwnerRecords) {
    root.innerHTML=`<div class="wrap"><header class="header"><div class="brand"><span class="brandicon">✓</span>resguardo.</div></header><main><div class="card" style="max-width:520px;margin:8vh auto"><p class="eyebrow">SEUS DADOS ESTÃO PROTEGIDOS</p><h1>Entre na sua conta.</h1><p class="sub">Este dispositivo já tem registros vinculados a uma conta. Entre para acessá-los; não vamos mostrá-los a outra pessoa.</p><div class="spaced">${button('Entrar','auth','primary wide')}</div></div></main></div>`;
    return;
  }
  root.innerHTML=`<div class="wrap"><header class="header"><div class="brand"><span class="brandicon">✓</span>resguardo<span style="color:#1c978a">.</span></div><div class="row"><span class="meta" id="sync-indicator">${secure?(state.sync==='synced'?'● Sincronizado':state.sync==='error'?'● Não sincronizado':'● '+state.pending+' pendente(s)'):'● Apenas neste aparelho'}</span>${button('⚙','settings','outline smallbtn','aria-label="Ajustes"')}</div></header><main>${pages[state.tab]()}</main></div><nav class="nav" aria-label="Navegação"><div class="navinner">${tabs.map(([tab,icon,label])=>`<button class="navbutton ${state.tab===tab?'selected':''}" data-action="${tab}" aria-current="${state.tab===tab?'page':'false'}"><b aria-hidden="true">${icon}</b>${label}</button>`).join('')}</div></nav>`;
  if (state.tab==='history') document.getElementById('search')?.addEventListener('input',onSearch);
}
function onSearch(event) {
  state.search=event.target.value;
  const pos=event.target.selectionStart;
  render();
  const input=document.getElementById('search'); input?.focus(); input?.setSelectionRange(pos,pos);
}
function modal(html) { sheet.innerHTML=html; if (!dialog.open) dialog.showModal(); sheet.scrollTop=0; }
function close(){if(dialog.open)dialog.close();state.selectedId=null;}
function head(label) { return `<div class="sheettitle"><h2>${escape(label)}</h2><button class="xbtn" data-action="close" aria-label="Fechar">×</button></div>`; }
function filesField(){return `<div class="field"><label>Fotos, capturas ou PDFs (opcional)</label><input name="attachments" type="file" accept="image/*,application/pdf" multiple><p class="hint">Arquivos originais, sem compressão. Até 30 MB por arquivo. Você pode anexar mais depois.</p></div>`;}
function localInput(isoValue){const date=new Date(isoValue);return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}T${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;}
function openShift(recordId=null){
  const old=recordId?state.entries.find(e=>e.id===recordId):null;
  const currentTime=new Date(),begin=new Date(currentTime);begin.setHours(9,0,0,0);
  const finish=new Date(currentTime);finish.setHours(18,0,0,0);
  modal(head(old?'Editar horário':'Novo horário')+`<form id="form-shift" data-id="${recordId||''}"><div class="field"><label>Tipo</label><select name="kind"><option value="regular" ${old?.kind!=='extra'?'selected':''}>Jornada normal</option><option value="extra" ${old?.kind==='extra'?'selected':''}>Atividade extra / fora de horário</option></select></div><div class="fields2"><div class="field"><label>Começou</label><input name="start" type="datetime-local" required value="${localInput(old?.start||begin)}"></div><div class="field"><label>Terminou</label><input name="end" type="datetime-local" required value="${localInput(old?.end||finish)}"></div></div><div class="field"><label>Tempo de intervalo (minutos)</label><input name="pause" type="number" min="0" max="1440" step="1" value="${old?.manualBreakMinutes??old?.manualPause??0}"></div><div class="field"><label>Atividade (opcional)</label><input name="title" maxlength="180" placeholder="Ex.: manutenção emergencial" value="${escape(old?.title||'')}"></div><div class="field"><label>Contexto / observações</label><textarea name="note" maxlength="8000" placeholder="Quem solicitou, o que foi feito, resultado...">${escape(old?.note||'')}</textarea></div>${filesField()}<p class="hint">Edições são versionadas. Sobreposição com outras jornadas não aumenta artificialmente o total.</p><div class="actions">${button('Cancelar','close','plain')}<button class="btn primary" type="submit">Salvar registro</button></div></form>`);
}
function openIncident(recordId=null){
  const old=recordId?state.entries.find(e=>e.id===recordId):null;
  modal(head(old?'Editar problema':'Registrar problema')+`<form id="form-incident" data-id="${recordId||''}"><div class="field"><label>O que aconteceu?</label><input name="title" required maxlength="180" placeholder="Resumo objetivo do fato" value="${escape(old?.title||'')}"></div><div class="fields2"><div class="field"><label>Quando aconteceu</label><input name="at" type="datetime-local" required value="${localInput(old?.at||new Date())}"></div><div class="field"><label>Categoria</label><select name="category">${CATEGORY_OPTIONS.map(c=>`<option ${old?.category===c?'selected':''}>${escape(c)}</option>`).join('')}</select></div></div><div class="field"><label>Descreva o que ocorreu</label><textarea name="description" required maxlength="20000" placeholder="Fatos, sequência, contexto. Diferencie o que presenciou do que ouviu.">${escape(old?.description||'')}</textarea></div><div class="fields2"><div class="field"><label>Local / canal</label><input name="channel" maxlength="180" placeholder="WhatsApp, reunião, presencial..." value="${escape(old?.channel||'')}"></div><div class="field"><label>Pessoas envolvidas</label><input name="people" maxlength="500" placeholder="Nomes ou funções" value="${escape(old?.people||'')}"></div></div><div class="field"><label>Impacto / desdobramentos (opcional)</label><textarea name="impact" maxlength="6000" placeholder="Consequências, próximos contatos, testemunhas...">${escape(old?.impact||'')}</textarea></div>${filesField()}<p class="hint">Horário do fato e horário do registro são armazenados separadamente. O aplicativo não altera seus anexos.</p><div class="actions">${button('Cancelar','close','plain')}<button class="btn primary" type="submit">Guardar ocorrência</button></div></form>`);
}
async function detail(recordId) {
  const e=state.entries.find(x=>x.id===recordId);
  if (!e) return;
  state.selectedId=recordId;
  const incident=e.type==='incident';
  const fields=incident?[
    ['Quando aconteceu',dt(e.at)],['Tipo',e.category],['O que ocorreu',e.description],
    ['Local / canal',e.channel],['Pessoas',e.people],['Desdobramento',e.impact],
  ]:[['Início',dt(e.start)],['Fim',e.end?dt(e.end):'Em andamento'],['Tipo',e.kind==='extra'?'Atividade extra':'Jornada'],['Trabalhadas',fmtMinutes(Math.round(unionMinutes(segments(e))/60000))],['Pausa manual',`${e.manualBreakMinutes||0} min`],['Contexto',e.note]];
  const attachments=(e.attachments||[]).map(a=>`<div class="file"><div class="filelabel"><b>${escape(a.name)}</b><p class="tiny">SHA-256: ${escape(a.sha256)}</p></div>${button('Abrir','open-file','outline smallbtn',`data-id="${escape(a.id)}"`)}</div>`).join('');
  let auditHtml=`<p class="hint">Criado localmente: ${escape(e.createdAt?dt(e.createdAt):'data indisponível')}. Alterado: ${escape(e.updatedAt?dt(e.updatedAt):'nunca')}</p>`;
  const localHistory=(e.revisions||[]).slice(-20).reverse();
  if (localHistory.length) auditHtml += `<p class="label spaced">Revisões locais: ${localHistory.length}</p>`+localHistory.map(r=>`<div class="file"><span class="filelabel">Edição local em ${escape(dt(r.at))}</span></div>`).join('');
  if (state.cloudUser&&e.ownerId===state.cloudUser.id) {
    try {
      const remote=await rest(`resguardo_audit?record_id=eq.${encodeURIComponent(e.id)}&select=action,client_at,saved_at,snapshot&order=saved_at.desc&limit=100`);
      auditHtml += `<p class="label spaced">Histórico do servidor (${remote.length})</p>`+remote.map(r=>`<div class="file"><div class="filelabel"><b>${escape(r.action)}</b> · versão ${escape(r.snapshot?.version||'?')}<div class="tiny">Recebido pelo banco: ${escape(dt(r.saved_at))}</div></div></div>`).join('');
    } catch { auditHtml += '<p class="hint">Histórico remoto indisponível no momento. O histórico local continua preservado.</p>'; }
  }
  modal(head(e.title||(incident?'Ocorrência':'Jornada'))+(e.conflict?`<div class="message warn"><b>Conflito de sincronização.</b><p>Outra versão foi gravada em outro aparelho. O aplicativo não apagou nenhuma delas.</p>${button('Preservar revisão como cópia','resolve-conflict','outline','data-id="'+e.id+'"')}</div>`:'')+`<dl class="detail">${fields.filter(([,value])=>value).map(([label,value])=>`<dt>${escape(label)}</dt><dd>${escape(value)}</dd>`).join('')}</dl>${attachments?`<h3 class="spaced2">Anexos originais</h3>${attachments}`:''}<div class="actions">${button('Editar / anexar','edit','primary',`data-id="${e.id}"`)}${button('Fechar','close','plain')}</div>${!e.archivedAt?`<div class="spaced">${button('Arquivar (sem apagar evidências)','archive','outline wide',`data-id="${e.id}"`)}</div>`:''}<hr class="sectionline"><h3>Histórico de alterações</h3>${auditHtml}`);
}
async function saveEntry(data, action) {
  const previous=state.entries.find(e=>e.id===data.id),time=new Date().toISOString();
  const item=structuredClone(data);
  item.createdAt=previous?.createdAt||time;
  if (state.cloudUser?.id && !item.ownerId) item.ownerId = state.cloudUser.id;
  item.updatedAt=time;
  item.syncDirty=true;
  if (previous) {
    item.revisions=[...(previous.revisions||[]).slice(-19),{at:time, previous:Object.fromEntries(Object.entries(previous).filter(([k])=>k!=='revisions'))}];
  } else item.revisions=[];
  await put('entries',item);
  await put('audit',{id:id(),entryId:item.id,action,at:time,after:structuredClone(item)});
  await reload(); render(); scheduleSync();
}
async function saveAttachments(item,files) {
  for(const f of Array.from(files||[])) {
    if(f.size>30*1024*1024) throw new Error(`Anexo ${f.name} excede 30 MB.`);
    if(!/^(image\/(jpeg|png|webp|gif|heic|heif|avif)|application\/pdf)$/.test(f.type)) throw new Error('Anexe foto, captura ou PDF.');
    const hashBytes=new Uint8Array(await crypto.subtle.digest('SHA-256',await f.arrayBuffer()));
    const hash=Array.from(hashBytes).map(v=>v.toString(16).padStart(2,'0')).join('');
    const attachmentId=id();
    await put('files',{id:attachmentId,blob:f,name:f.name,size:f.size,type:f.type,hash});
    item.attachments=[...(item.attachments||[]),{id:attachmentId,name:f.name,size:f.size,type:f.type,sha256:hash}];
  }
}
async function submitShift(form) {
  const old=state.entries.find(e=>e.id===form.dataset.id);
  if(old && !old.end) throw new Error('Finalize a jornada em andamento antes de editar seus horários.');
  const item=structuredClone(old||{id:id(),type:'shift',breaks:[],attachments:[]});
  item.kind=form.elements.namedItem('kind').value;
  item.start=fromLocal(form.elements.namedItem('start').value);
  item.end=fromLocal(form.elements.namedItem('end').value);
  item.title=form.elements.namedItem('title').value.trim();
  item.note=form.elements.namedItem('note').value.trim();
  item.manualBreakMinutes=Number(form.elements.namedItem('pause').value||0);
  item.breaks=[];
  validateShift(item);
  await saveAttachments(item,form.elements.namedItem('attachments').files);
  await saveEntry(item,old?'Editou horário':'Registrou horário');close();alertToast('Horário preservado.');
}
async function submitIncident(form) {
  const old=state.entries.find(e=>e.id===form.dataset.id);
  const item=structuredClone(old||{id:id(),type:'incident',attachments:[]});
  item.at=fromLocal(form.elements.namedItem('at').value);
  for(const field of ['title','description','category','channel','people','impact']) item[field]=form.elements.namedItem(field).value.trim();
  validateIncident(item);
  await saveAttachments(item,form.elements.namedItem('attachments').files);
  await saveEntry(item,old?'Editou ocorrência':'Registrou ocorrência');close();alertToast('Ocorrência preservada.');
}
function fromLocal(value){return iso(new Date(value));}
function authModal(mode='login') {
  state.authMode=mode;
  const signup=mode==='signup';
  modal(head(signup?'Criar conta pessoal':'Entrar no Resguardo')+`<p class="sub">Seus dados ficam separados por conta. Use um e-mail pessoal, nunca um e-mail controlado pela empresa.</p><form id="form-auth"><div class="field"><label>E-mail pessoal</label><input name="email" type="email" required autocomplete="email"></div><div class="field"><label>Senha</label><input name="password" type="password" minlength="8" required autocomplete="${signup?'new-password':'current-password'}"></div><div class="actions"><button class="btn primary" type="submit">${signup?'Criar conta':'Entrar'}</button>${button(signup?'Já tenho conta':'Criar conta',signup?'auth-login':'auth-signup','outline')}</div><p class="hint">${signup?'Um e-mail de confirmação pode ser necessário.':'Esqueceu a senha? Use “Recuperar acesso”.'}</p>${!signup?button('Recuperar acesso','recover','plain smallbtn'):''}</form>`);
}
function passwordResetModal(){modal(head('Criar nova senha') + `<p class="sub">Sua identidade foi confirmada. Escolha uma senha nova.</p><form id="form-reset"><div class="field"><label>Nova senha</label><input name="password" type="password" minlength="8" autocomplete="new-password" required></div><div class="actions"><button class="btn primary" type="submit">Salvar nova senha</button></div></form>`);}
function exportModal(){modal(head('Exportação e backup')+`<p class="sub">O arquivo de backup inclui fotos, PDFs, conteúdo dos relatos e revisões. Guarde em um espaço pessoal protegido.</p><div class="stack spaced">${button('↓ Backup completo (JSON + originais)','backup','primary wide')}${button('↓ Planilha CSV','csv','outline wide')}${button('▤ Relatório para imprimir ou salvar em PDF','pdf','plain wide')}</div>`);}
function sendCalendar() {
  const hhmm=state.settings.reminderTime.replace(':','')+'00';
  const start=shiftDay(today(),1).replaceAll('-','');
  const stamp=new Date().toISOString().replace(/[-:]/g,'').split('.')[0]+'Z';
  const content=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Resguardo//Pessoal//PT-BR','BEGIN:VEVENT','UID:resguardo-pessoal-reminder-2026@local','DTSTAMP:'+stamp,'DTSTART;TZID=America/Sao_Paulo:'+start+'T'+hhmm,'DURATION:PT5M','RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR','SUMMARY:Registrar minha jornada e acontecimentos','DESCRIPTION:Conferir o Resguardo, atualizar horas extras e ocorrências.','BEGIN:VALARM','TRIGGER:PT0M','ACTION:DISPLAY','DESCRIPTION:Hora de revisar meus registros.','END:VALARM','END:VEVENT','END:VCALENDAR'].join('\r\n');
  const url=URL.createObjectURL(new Blob([content],{type:'text/calendar'}));
  const a=document.createElement('a');a.href=url;a.download='resguardo-lembrete.ics';a.click();setTimeout(()=>URL.revokeObjectURL(url),90000);
  alertToast('Abra o arquivo na sua agenda pessoal.');
}
function vapidBytes(base64){const pad='='.repeat((4-base64.length%4)%4);const binary=atob((base64+pad).replaceAll('-','+').replaceAll('_','/'));return Uint8Array.from(binary,c=>c.charCodeAt(0));}
async function enablePush() {
  if(!state.cloudUser) throw new Error('Entre na sua conta antes de ativar push.');
  if(state.settings.reminderTime!=='18:30') throw new Error('No plano atual, push usa 18h30. Para outro horário, use a agenda pessoal.');
  if(!('PushManager' in window) || !('serviceWorker' in navigator)) throw new Error('Este navegador não oferece Web Push. Use o lembrete da agenda.');
  const conf=await fetch('/api/push-config').then(r=>r.json());
  if(!conf.enabled||!conf.publicKey) throw new Error('Envio push ainda não configurado no servidor. O lembrete de calendário funciona agora.');
  const permission=await Notification.requestPermission();
  if(permission!=='granted') throw new Error('Permissão de notificações não concedida.');
  const worker=await navigator.serviceWorker.ready;
  const subscription=await worker.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:vapidBytes(conf.publicKey)});
  await rest('resguardo_push_subscriptions?on_conflict=endpoint','POST',{
    owner_id:state.cloudUser.id,endpoint:subscription.endpoint,subscription:subscription.toJSON(),
    enabled:true,timezone:state.settings.timezone,reminder_time:'18:30',updated_at:new Date().toISOString(),
  },{'Prefer':'resolution=merge-duplicates'});
  state.settings.reminderEnabled=true; await saveSettings(state.settings);alertToast('Push ativado para dias úteis, sujeito à janela do provedor.');
}
async function reload(){state.entries=await getAll('entries');state.audit=await getAll('audit');state.pending=await pendingCount(state.cloudUser?.id);}
async function claimLocalDrafts(){
  if(!state.cloudUser?.id)throw new Error('Entre na conta antes de vincular registros.');
  const drafts=(await getAll('entries')).filter(e=>!e.ownerId);
  if(!drafts.length)return 0;
  if(!confirm(`Vincular ${drafts.length} registro(s) deste aparelho à conta atual? Depois de sincronizar, serão acessíveis por esta conta.`))return 0;
  for(const entry of drafts){
    if(entry.remoteVersion)throw new Error('Registro sem proprietário contém versão remota. Revisão manual necessária.');
    await put('entries',{...entry,ownerId:state.cloudUser.id,syncDirty:true});
  }
  await reload();render();scheduleSync();
  return drafts.length;
}
let syncTimer;
function scheduleSync(){clearTimeout(syncTimer);syncTimer=setTimeout(()=>syncNow(),600);}
onSync(async result=>{state.sync=result.status;state.syncMessage=result.message||'';await reload();render();if(result.status==='error')alertToast('Falha de sincronização. Seus dados locais continuam salvos.');});
async function handle(action,el){
  const recordId=el?.dataset.id;
  if(['today','history','problems','panel','settings'].includes(action)){
    state.tab=action;render();window.scrollTo({top:0,behavior:'smooth'});return;
  }
  switch(action){
    case 'close':close();break;
    case 'new-shift':openShift();break;
    case 'new-incident':openIncident();break;
    case 'start':{
      if(active())throw new Error('Finalize sua jornada atual primeiro.');
      const nowTime=new Date().toISOString();
      await saveEntry({id:id(),type:'shift',kind:'regular',title:'',note:'',start:nowTime,end:null,breaks:[],manualBreakMinutes:0,attachments:[]},'Iniciou jornada');alertToast('Jornada iniciada.');break;
    }
    case 'pause':{
      const a=active();if(!a||activeBreak(a))return;
      const e=structuredClone(a);e.breaks=[...(e.breaks||[]),{start:new Date().toISOString(),end:null}];
      await saveEntry(e,'Iniciou pausa');alertToast('Pausa iniciada.');break;
    }
    case 'resume':{
      const a=active();if(!a||!activeBreak(a))return;
      const e=structuredClone(a);e.breaks.find(b=>!b.end).end=new Date().toISOString();
      await saveEntry(e,'Retomou jornada');alertToast('Pausa finalizada.');break;
    }
    case 'stop':{
      const a=active();if(!a)return;
      const e=structuredClone(a);if(activeBreak(e))activeBreak(e).end=new Date().toISOString();
      e.end=new Date().toISOString();validateShift(e);
      await saveEntry(e,'Finalizou jornada');alertToast('Jornada encerrada e salva.');break;
    }
    case 'detail':await detail(recordId);break;
    case 'edit':{
      const e=state.entries.find(x=>x.id===recordId);if(!e)return;
      e.type==='incident'?openIncident(recordId):openShift(recordId);break;
    }
    case 'archive':{
      if(!confirm('Arquivar este registro? Ele permanecerá no backup e no histórico de revisões.'))return;
      const e=structuredClone(state.entries.find(x=>x.id===recordId));e.archivedAt=new Date().toISOString();
      await saveEntry(e,'Arquivou registro');close();alertToast('Registro arquivado.');break;
    }
    case 'resolve-conflict':{
      if(!confirm('Preservar a revisão local como um novo registro e recuperar a versão do servidor?'))return;
      await resolveConflictCopy(recordId);await reload();close();render();alertToast('Revisão salva como cópia.');break;
    }
    case 'open-file':{
      const file=await get('files',recordId);
      let blob=file?.blob;
      if(!blob){
        const attachment=state.entries.flatMap(e=>e.attachments||[]).find(a=>a.id===recordId);
        if(!attachment?.remotePath)throw new Error('Arquivo original não encontrado neste aparelho.');
        blob=await storageDownload(attachment.remotePath);
        if(attachment.sha256){
          const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()));
          const actual=Array.from(digest).map(x=>x.toString(16).padStart(2,'0')).join('');
          if(actual!==attachment.sha256)throw new Error('O hash do arquivo baixado não corresponde ao original.');
        }
        await put('files',{id:recordId,blob,name:attachment.name,type:attachment.type,size:blob.size,hash:attachment.sha256,remotePath:attachment.remotePath});
      }
      const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=file?.name||state.entries.flatMap(e=>e.attachments||[]).find(a=>a.id===recordId)?.name||'evidencia';document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),120000);break;
    }
    case 'filter':state.filter=el.dataset.filter;render();break;
    case 'week-prev':state.weekOffset--;render();break;
    case 'week-next':state.weekOffset++;render();break;
    case 'export-modal':exportModal();break;
    case 'backup':{
      alertToast('Preparando arquivo com anexos originais...');const n=await backup(state.settings,state.cloudUser?.id);
      close();alertToast(`${n} registros incluídos no backup completo.`);break;
    }
    case 'restore':{
      if(!document.getElementById('restore-file')){state.tab='settings';render();}
      document.getElementById('restore-file').click();break;
    }
    case 'csv':await csv(validUserEntries());close();alertToast('Planilha exportada.');break;
    case 'pdf':printReport(validUserEntries(),state.settings);close();break;
    case 'persist':alertToast(await requestPersistence()?'Armazenamento persistente concedido.':'Persistência não concedida. Faça backups regulares.');break;
    case 'save-settings':{
      const weekly=Number(document.getElementById('weekly')?.value),daily=Number(document.getElementById('daily')?.value);
      if(!Number.isFinite(weekly)||weekly<1||weekly>80||!Number.isFinite(daily)||daily<=0||daily>24)throw new Error('Verifique os limites de horas informados.');
      state.settings.weeklyMinutes=Math.round(weekly*60);
      state.settings.dailyTargetMinutes=Math.round(daily*60);
      await saveSettings(state.settings);render();alertToast('Metas atualizadas.');break;
    }
    case 'calendar':{
      state.settings.reminderTime=document.getElementById('reminder')?.value||'18:30';
      await saveSettings(state.settings);sendCalendar();break;
    }
    case 'enable-push':{
      state.settings.reminderTime=document.getElementById('reminder')?.value||'18:30';
      await saveSettings(state.settings);await enablePush();break;
    }
    case 'auth':authModal();break;
    case 'auth-login':authModal('login');break;
    case 'auth-signup':authModal('signup');break;
    case 'recover':{
      const address=sheet.querySelector('input[name=email]')?.value?.trim();if(!address)throw new Error('Digite seu e-mail pessoal primeiro.');
      await requestReset(address);alertToast('Se a conta existir, você receberá instruções no e-mail.');break;
    }
    case 'logout':{
      await signOut();state.cloudUser=null;state.sync='local';close();render();break;
    }
    case 'claim-local':{const n=await claimLocalDrafts();if(n)alertToast(`${n} registro(s) vinculados e preparados para sincronização.`);break;}
    case 'sync':await syncNow();break;
  }
}
document.addEventListener('click',event=>{
  const target=event.target.closest('[data-action]');if(!target)return;
  handle(target.dataset.action,target).catch(error=>{console.error(error);alertToast(error.message||'Não foi possível executar a ação.');});
});
document.addEventListener('submit',async event=>{
  const form=event.target;
  if(!['form-shift','form-incident','form-auth','form-reset'].includes(form.id))return;
  event.preventDefault();const submit=form.querySelector('[type=submit]');if(submit)submit.disabled=true;
  try {
    if(form.id==='form-reset'){ await updatePassword(form.elements.namedItem('password').value);close();alertToast('Senha atualizada. Você continua conectado.'); }
    if(form.id==='form-shift')await submitShift(form);
    if(form.id==='form-incident')await submitIncident(form);
    if(form.id==='form-auth'){
      const result=await authPassword(form.elements.namedItem('email').value,form.elements.namedItem('password').value,state.authMode);
      if(!result.access_token){alertToast('Verifique seu e-mail para confirmar a conta e depois entre.');close();}
      else{state.cloudUser=result.user;await reload();await claimLocalDrafts();close();render();scheduleSync();alertToast('Conta conectada.');}
    }
  }catch(error){console.error(error);alertToast(error.message||'Falha no formulário.');}
  finally{if(submit)submit.disabled=false;}
});
document.addEventListener('change',async event=>{
  if(event.target.id!=='restore-file'||!event.target.files?.length)return;
  try{const result=await importBackup(event.target.files[0],state.cloudUser?.id);if(result){await reload();render();scheduleSync();alertToast(`Importação concluída. ${result.records} registros no arquivo.`);}}
  catch(error){console.error(error);alertToast(error.message||'Falha ao importar backup.');}
  event.target.value='';
});
dialog.addEventListener('click',event=>{if(event.target===dialog)close();});
window.addEventListener('online',()=>scheduleSync());
window.addEventListener('visibilitychange',()=>{if(!document.hidden){scheduleSync();refreshLive();}});
function refreshLive(){if(!state.ready||state.tab!=='today')return;const el=document.getElementById('live');if(!el)return;const data=breakdown(visibleEntries(),today(),today(),state.settings);el.innerHTML=`${fmtMinutes(data.workedMinutes)} <small>trabalhadas hoje</small>`;}
function handleAuthRedirect(){
  // Supabase recovery / confirmation links can return a hash token pair.
  const hash=new URLSearchParams(location.hash.slice(1));
  if(hash.get('access_token') && hash.get('refresh_token')) {
    // The REST client keeps tokens private; browser history is stripped at once.
    import('./auth.mjs').then(({setSession})=>{
      setSession({access_token:hash.get('access_token'),refresh_token:hash.get('refresh_token'),
        expires_in:Number(hash.get('expires_in')||3600),token_type:'bearer'});
      const recovery=hash.get('type')==='recovery';
      history.replaceState(null,'',location.pathname+location.search);
      checkSession().then(user=>{state.cloudUser=user;reload().then(()=>{render();scheduleSync();if(recovery)passwordResetModal();});});
    });
  }
}
async function boot(){
  try{
    await openLocal();state.settings=await loadSettings(DEFAULT_SETTINGS);
    restoreSession();state.cloudUser=await checkSession();
    await reload();state.ready=true;render();handleAuthRedirect();
    if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js',{scope:'/'}).catch(console.warn);
    if(navigator.onLine&&state.cloudUser)scheduleSync();
    if(!localStorage.getItem('resguardo-seen')){
      localStorage.setItem('resguardo-seen','true');setTimeout(()=>alertToast('Faça seu primeiro backup. Os registros offline pertencem a este aparelho.'),1400);
    }
    setInterval(refreshLive,30000);setInterval(()=>state.cloudUser&&scheduleSync(),120000);
  }catch(error){console.error(error);root.innerHTML=`<main class="wrap" style="padding-top:20vh"><h1>Não foi possível abrir seus dados.</h1><p class="sub">Verifique a permissão de armazenamento do navegador. Não apague o cache: ele pode conter registros ainda não sincronizados.</p><p class="message warn spaced">${escape(error.message)}</p></main>`;}
}
boot();
