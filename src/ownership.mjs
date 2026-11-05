/** Client identity boundary. Never mix private records from different accounts. */
export function entriesForIdentity(entries, ownerId) {
  return entries.filter(entry => ownerId ? entry.ownerId === ownerId : !entry.ownerId);
}
export function selectBackupData(allEntries, allAudits, allFiles, ownerId) {
  const entries = entriesForIdentity(allEntries, ownerId);
  const ids = new Set(entries.map(entry => entry.id));
  const fileIds = new Set(entries.flatMap(entry => (entry.attachments || []).map(a => a.id)));
  return {
    entries,
    audit: allAudits.filter(item => ids.has(item.entryId)),
    files: allFiles.filter(item => fileIds.has(item.id)),
  };
}
export function assertBackupOwnership(entries, ownerId) {
  if (!Array.isArray(entries)) throw new Error('Backup sem registros válidos.');
  for (const entry of entries) {
    if (entry.ownerId && entry.ownerId !== ownerId) {
      throw new Error('Este backup contém dados de outra conta. Entre na conta de origem para restaurá-lo.');
    }
  }
}
