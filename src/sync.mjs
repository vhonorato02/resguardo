import { getAll, get, put } from './idb.mjs';
import { currentUser, rest, storageUpload, sessionExists } from './auth.mjs';

let running = false;
let listeners = new Set();
export const onSync = callback => { listeners.add(callback); return () => listeners.delete(callback); };
const emit = detail => listeners.forEach(fn => fn(detail));
export function isSyncing() { return running; }
export async function pendingCount(userId) {
  const records = await getAll('entries');
  return records.filter(e => e.syncDirty && userId && e.ownerId === userId).length;
}
function remotePayload(record) {
  const clean = structuredClone(record);
  for (const key of ['syncDirty', 'syncError', 'remoteVersion', 'syncedAt', 'ownerId', 'conflict']) delete clean[key];
  return clean;
}
async function uploadAttached(record, ownerId) {
  for (const attachment of record.attachments || []) {
    if (attachment.remotePath) continue;
    const file = await get('files', attachment.id);
    if (!file?.blob) throw new Error(`Arquivo original indisponível: ${attachment.name}. Restaure o backup antes de sincronizar.`);
    const extension = String(attachment.name).split('.').at(-1).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 9) || 'bin';
    const safePath = `${ownerId}/${record.id}/${attachment.id}.${extension}`;
    await storageUpload(safePath, file.blob, file.type || 'application/octet-stream');
    attachment.remotePath = safePath;
    file.remotePath = safePath;
    await put('files', file);
    await put('entries', record);
  }
}
async function pushRecord(e, userId) {
  const record = structuredClone(e);
  record.ownerId = userId;
  await uploadAttached(record, userId);
  const body = { id: record.id, owner_id: userId,
    entry_kind: record.type, event_at: record.type === 'shift' ? record.start : record.at,
    client_updated_at: record.updatedAt || record.createdAt || new Date().toISOString(),
    payload: remotePayload(record),
  };
  let result;
  if (record.remoteVersion) {
    result = await rest(`resguardo_records?id=eq.${record.id}&version=eq.${record.remoteVersion}&select=id,version,server_saved_at`, 'PATCH', body,
      { Prefer: 'return=representation' });
    if (!Array.isArray(result) || !result.length) {
      record.conflict = true; record.syncError = 'O registro também mudou em outro aparelho. Nenhuma versão foi apagada.';
      await put('entries', record);
      return { conflict: true };
    }
  } else {
    try {
      result = await rest('resguardo_records?select=id,version,server_saved_at', 'POST', body,
        { Prefer: 'return=representation' });
    } catch (err) {
      if (err.status === 409) {
        record.conflict = true; record.syncError = 'Este ID já existe no servidor. Faça uma revisão de conflito.';
        await put('entries', record);
        return { conflict: true };
      }
      throw err;
    }
  }
  const version = result?.[0]?.version;
  if (!version) throw new Error('O banco não confirmou o versionamento.');
  // If the entry changed while the upload was in progress, retain the newer
  // local revision as pending rather than falsely marking it as synchronized.
  const latest = await get('entries', record.id);
  const unchanged = latest?.updatedAt === record.updatedAt;
  await put('entries', { ...latest, ownerId: userId,
    attachments: unchanged ? record.attachments : latest.attachments,
    remoteVersion: version,
    ...(unchanged ? { syncDirty: false, syncError: null, conflict: false } : {}),
    syncedAt: new Date().toISOString(),
  });
  return { conflict: false };
}
async function pullAll(userId) {
  const collected = [];
  for (let offset = 0; offset < 100000; offset += 500) {
    const part = await rest(`resguardo_records?owner_id=eq.${userId}&select=id,payload,version,server_saved_at&order=server_saved_at.asc&limit=500&offset=${offset}`);
    collected.push(...part);
    if (part.length < 500) break;
  }
  for (const remote of collected) {
    const local = await get('entries', remote.id);
    if (local?.syncDirty) {
      if (local.remoteVersion && remote.version !== local.remoteVersion) {
        local.conflict = true;
        local.syncError = 'Versões diferentes em dois aparelhos. Ambos os registros foram preservados.';
        await put('entries', local);
      }
      continue;
    }
    if (!local || (remote.version > (local.remoteVersion || 0))) {
      await put('entries', { ...remote.payload, id: remote.id,
        ownerId: userId, remoteVersion: remote.version,
        syncDirty: false, conflict: false, syncedAt: remote.server_saved_at,
      });
    }
  }
  return collected.length;
}
export async function syncNow() {
  const user = currentUser();
  if (running || !sessionExists() || !user?.id || !navigator.onLine) return;
  running = true; emit({ status: 'syncing' });
  try {
    const all = await getAll('entries');
    // Unowned local drafts must be explicitly claimed before first upload.
    // Records from a different account are never pushed into this account.
    let conflicts = 0;
    for (const record of all) {
      if (!record.syncDirty && record.remoteVersion) continue;
      if (record.ownerId !== user.id) continue;
      if (record.conflict) { conflicts++; continue; }
      const result = await pushRecord(record, user.id);
      if (result.conflict) conflicts++;
    }
    const count = await pullAll(user.id);
    const pending = await pendingCount(user.id);
    emit({ status: conflicts ? 'conflict' : pending ? 'pending' : 'synced', pending, conflicts, count, at: new Date().toISOString() });
  } catch (error) {
    emit({ status: 'error', message: error.message });
  } finally { running = false; }
}
export async function resolveConflictCopy(recordId) {
  const local = await get('entries', recordId);
  if (!local?.conflict) return;
  const savedCopy = structuredClone(local);
  savedCopy.id = crypto.randomUUID();
  savedCopy.title = `[Revisão preservada] ${savedCopy.title || (savedCopy.type === 'incident' ? 'Ocorrência' : 'Jornada')}`;
  // Evidence is still accessible locally. Existing remote file paths belong
  // to original record and are read-only; this copy is not uploaded as a duplicate.
  savedCopy.remoteVersion = undefined;
  savedCopy.syncDirty = true; savedCopy.conflict = false; savedCopy.syncError = null;
  savedCopy.updatedAt = new Date().toISOString();
  await put('entries', savedCopy);
  local.syncDirty = false;
  local.conflict = false;
  await put('entries', local);
  await syncNow();
}
