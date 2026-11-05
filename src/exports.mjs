import { getAll, put } from './idb.mjs';
import { breakdown, DEFAULT_SETTINGS, fmtMinutes, localDateTime } from './domain.mjs';
import { selectBackupData, assertBackupOwnership } from './ownership.mjs';
function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 120000);
}
async function encode(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
function decode(base64, type) {
  const bytes = atob(base64);
  const array = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) array[i] = bytes.charCodeAt(i);
  return new Blob([array], { type });
}
export async function backup(settings, ownerId = null) {
  const {entries,audit,files} = selectBackupData(await getAll('entries'), await getAll('audit'), await getAll('files'), ownerId);
  const serialized = [];
  for (const f of files) serialized.push({ ...f, blob: undefined, data: await encode(f.blob) });
  const archive = { format: 'resguardo-complete-backup', version: 2, exportedAt: new Date().toISOString(),
    settings, entries, audit, files: serialized };
  download(new Blob([JSON.stringify(archive)], { type: 'application/json' }), `resguardo-backup-${new Date().toISOString().slice(0, 10)}.json`);
  return entries.length;
}
export async function importBackup(file, ownerId = null) {
  if (file.size > 300 * 1024 * 1024) throw new Error('Backup acima do limite desta importação (300 MB).');
  const parsed = JSON.parse(await file.text());
  if (!['resguardo-complete-backup', 'resguardo-backup'].includes(parsed.format) || !Array.isArray(parsed.entries) || !Array.isArray(parsed.files))
    throw new Error('Arquivo não é um backup do Resguardo.');
  assertBackupOwnership(parsed.entries, ownerId);
  if (!confirm(`Importar ${parsed.entries.length} registros e ${parsed.files.length} arquivos? Não será apagado nada já salvo.`)) return;
  const original = await getAll('entries'); const ids = new Set(original.map(e => e.id));
  const existingFiles = new Map((await getAll('files')).map(f => [f.id, f]));
  const checkedFiles = [];
  for (const f of parsed.files) {
    if (typeof f.data !== 'string' || !f.id) continue;
    const blob = decode(f.data, f.type || 'application/octet-stream');
    const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    const actualHash = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
    if (f.hash && f.hash !== actualHash) throw new Error(`Integridade inválida no anexo ${f.name}.`);
    if (existingFiles.has(f.id) && existingFiles.get(f.id).hash && existingFiles.get(f.id).hash !== actualHash) throw new Error(`Conflito de ID do anexo ${f.name}. Nenhum arquivo existente será sobrescrito.`);
    if (!existingFiles.has(f.id)) checkedFiles.push({ ...f, data: undefined, blob });
  }
  for (const f of checkedFiles) await put('files', f);
  for (const e of parsed.entries) {
    if (!e.id || !['incident', 'shift'].includes(e.type) || ids.has(e.id)) continue;
    // Never import claimed remote sync state or ownership into another user.
    await put('entries', { ...e, remoteVersion: undefined, ownerId: ownerId || undefined, syncDirty: true, conflict: false });
  }
  for (const e of parsed.audit || []) if (e.id) await put('audit', e);
  return { records: parsed.entries.length, attachments: parsed.files.length };
}
export async function csv(records) {
  const header = ['Tipo','Título','Categoria','Início / ocorrência','Fim','Minutos efetivos','Observação','Canal','Pessoas','Desdobramento','Anexos','Registrado em','Alterado em'];
  const { segments } = await import('./domain.mjs');
  const lines = [header, ...records.map(e => [
    e.type,e.title||'',e.category || e.kind || '',e.start || e.at || '',e.end || '',
    e.type === 'shift' ? Math.round(segments(e).reduce((n,[a,b]) => n+b-a,0)/60000) : '',
    e.note||e.description||'',e.channel||'',e.people||'',e.impact||'',
    (e.attachments||[]).map(a => `${a.name} (${a.sha256})`).join(' | '),e.createdAt||'',e.updatedAt||'',
  ])];
  const safeCell = value => { const s = String(value ?? ''); return /^[\t\r\n=+@-]/.test(s) ? "'" + s : s; };
  const content = '\ufeff' + lines.map(row => row.map(v => '"' + safeCell(v).replaceAll('"', '""') + '"').join(';')).join('\r\n');
  download(new Blob([content], { type: 'text/csv;charset=utf-8' }), `resguardo-${new Date().toISOString().slice(0, 10)}.csv`);
}
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function printReport(records, settings = DEFAULT_SETTINGS) {
  const sorted = [...records].sort((a,b) => +(new Date(a.start||a.at)) - +(new Date(b.start||b.at)));
  const html = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Resguardo: relatório pessoal</title><style>body{font:14px Arial,sans-serif;color:#234;max-width:780px;margin:40px auto;padding:0 25px;line-height:1.5}h1{font-size:26px}h2{font-size:17px}article{padding:12px 0;border-bottom:1px solid #ddd;break-inside:avoid}small{color:#567}p{white-space:pre-wrap}footer{font-size:11px;color:#677;margin-top:34px}</style><h1>Resguardo. Relatório pessoal</h1><p>Gerado em ${escapeHtml(localDateTime(new Date(), settings.timezone))}</p><p>Jornada de referência: ${fmtMinutes(settings.weeklyMinutes)} por semana; alvo diário: ${fmtMinutes(settings.dailyTargetMinutes)} (seg. a sex.).</p><h2>Registros (${sorted.length})</h2>${sorted.map(e => `<article><h3>${escapeHtml(e.title || (e.type === 'shift' ? 'Jornada' : 'Ocorrência'))}</h3><small>${escapeHtml(localDateTime(e.start||e.at,settings.timezone))} | ${escapeHtml(e.type === 'shift' ? e.kind : e.category)}</small>${e.end?`<p>Fim: ${escapeHtml(localDateTime(e.end,settings.timezone))}</p>`:''}<p>${escapeHtml(e.description||e.note||'')}</p>${e.people?`<p>Pessoas: ${escapeHtml(e.people)}</p>`:''}${e.impact?`<p>Impacto: ${escapeHtml(e.impact)}</p>`:''}${e.attachments?.length?`<p>Anexos no backup: ${escapeHtml(e.attachments.map(a=>a.name+' / SHA-256 '+a.sha256).join('; '))}</p>`:''}<small>Criação local: ${escapeHtml(e.createdAt||'não informado')}. ${e.archivedAt?'Arquivado: '+escapeHtml(e.archivedAt):''}</small></article>`).join('')}<footer>Relato autodeclarado, não constitui certificação jurídica. Arquivos originais e revisões completas estão no backup.</footer></html>`;
  const w = window.open('', '_blank');
  if (!w) throw new Error('Ative janelas pop-up para imprimir o relatório.');
  w.document.open(); w.document.write(html); w.document.close();
  setTimeout(() => w.print(), 300);
}
