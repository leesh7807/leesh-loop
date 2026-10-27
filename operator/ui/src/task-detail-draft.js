const STORAGE_KEY = 'leesh-loop.operator.task-detail-draft.v1';

function scopedStorageKey(instanceId, taskId) {
  if (typeof instanceId !== 'string' || !instanceId.trim() || typeof taskId !== 'string' || !taskId.trim()) return null;
  return `${STORAGE_KEY}:${instanceId}:${taskId}`;
}

function browserStorage() {
  try { return globalThis.sessionStorage; }
  catch { return null; }
}

function resolveStorage(storage) {
  return storage === undefined ? browserStorage() : storage;
}

function normalizeTaskIds(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const result = [];
  for (const id of value) {
    if (typeof id !== 'string' || !id.trim() || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

function sameItems(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function readTaskDetailDraft(task, { instanceId, states = [], storage } = {}) {
  const fallback = { state: task.state, blockedBy: normalizeTaskIds(task.blockedBy), comment: '' };
  const target = resolveStorage(storage);
  const key = scopedStorageKey(instanceId, task.id);
  if (!target || !key) return fallback;

  try {
    const value = JSON.parse(target.getItem(key) || 'null');
    return {
      state: typeof value?.state === 'string' && states.includes(value.state) ? value.state : fallback.state,
      blockedBy: Array.isArray(value?.blockedBy) ? normalizeTaskIds(value.blockedBy) : fallback.blockedBy,
      comment: typeof value?.comment === 'string' ? value.comment : ''
    };
  } catch {
    return fallback;
  }
}

export function writeTaskDetailDraft(task, draft, { instanceId, storage } = {}) {
  const target = resolveStorage(storage);
  const key = scopedStorageKey(instanceId, task.id);
  if (!target || !key) return;

  const value = {};
  if (typeof draft?.state === 'string' && draft.state !== task.state) value.state = draft.state;
  if (Array.isArray(draft?.blockedBy)) {
    const blockedBy = normalizeTaskIds(draft.blockedBy);
    if (!sameItems(blockedBy, normalizeTaskIds(task.blockedBy))) value.blockedBy = blockedBy;
  }
  if (typeof draft?.comment === 'string' && draft.comment.length > 0) value.comment = draft.comment;

  try {
    if (Object.keys(value).length) target.setItem(key, JSON.stringify(value));
    else target.removeItem(key);
  } catch { /* Session storage is an optional recovery aid; the live form remains usable. */ }
}
