const STORAGE_KEY = 'leesh-loop.operator.publication-draft.v1';

function browserStorage() {
  try { return globalThis.sessionStorage; }
  catch { return null; }
}

function resolveStorage(storage) {
  return storage === undefined ? browserStorage() : storage;
}

function normalizeBlockers(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const result = [];
  for (const task of value) {
    if (!task || typeof task.taskId !== 'string' || !task.taskId.trim() || seen.has(task.taskId)) continue;
    seen.add(task.taskId);
    result.push({
      taskId: task.taskId,
      title: typeof task.title === 'string' ? task.title : '(Untitled)',
      state: typeof task.state === 'string' ? task.state : '—',
      identifier: typeof task.identifier === 'string' ? task.identifier : ''
    });
  }
  return result;
}

function normalizeDraft(value) {
  return {
    plan: typeof value?.plan === 'string' ? value.plan : '',
    state: typeof value?.state === 'string' ? value.state : '',
    selectedBlockers: normalizeBlockers(value?.selectedBlockers)
  };
}

export function readPublicationDraft(storage) {
  const target = resolveStorage(storage);
  if (!target) return normalizeDraft(null);
  try {
    const value = target.getItem(STORAGE_KEY);
    return value ? normalizeDraft(JSON.parse(value)) : normalizeDraft(null);
  } catch {
    return normalizeDraft(null);
  }
}

export function writePublicationDraft(value, storage) {
  const target = resolveStorage(storage);
  if (!target) return;
  try { target.setItem(STORAGE_KEY, JSON.stringify(normalizeDraft(value))); }
  catch { /* Session storage is an optional recovery aid; the live form remains usable. */ }
}

export function clearPublicationDraft(storage) {
  const target = resolveStorage(storage);
  if (!target) return;
  try { target.removeItem(STORAGE_KEY); }
  catch { /* Session storage is an optional recovery aid; the live form remains usable. */ }
}
