import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';

export const LOCAL_TASK_STORE_FILENAME = 'local-task-store.sqlite';
export const DEFAULT_TERMINAL_STATES = Object.freeze(['Done', 'Cancelled']);

const SCHEMA_VERSION = 1;
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    identifier TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    state TEXT NOT NULL,
    priority INTEGER,
    labels_json TEXT NOT NULL,
    accepted_plan TEXT NOT NULL,
    publication_key TEXT NOT NULL UNIQUE,
    publication_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS task_dependencies (
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    blocker_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY (task_id, blocker_task_id),
    CHECK (task_id <> blocker_task_id)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS task_records (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('workpad', 'comment')),
    author TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL
  ) STRICT;

  CREATE INDEX IF NOT EXISTS tasks_state_created_idx ON tasks(state, created_at, id);
  CREATE INDEX IF NOT EXISTS dependencies_blocker_idx ON task_dependencies(blocker_task_id);
  CREATE INDEX IF NOT EXISTS task_records_task_sequence_idx ON task_records(task_id, sequence);

  CREATE TRIGGER IF NOT EXISTS task_accepted_plan_is_immutable
  BEFORE UPDATE OF accepted_plan ON tasks
  WHEN OLD.accepted_plan IS NOT NEW.accepted_plan
  BEGIN
    SELECT RAISE(ABORT, 'Accepted Plan is immutable');
  END;
`;

function requiredText(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${field} must be a non-empty string`);
  return value;
}

function normalizeLabels(labels) {
  if (!Array.isArray(labels) || labels.some(label => typeof label !== 'string' || !label.trim())) {
    throw new TypeError('labels must be an array of non-empty strings');
  }
  return [...new Set(labels)];
}

function normalizeTaskIds(taskIds, field) {
  if (!Array.isArray(taskIds) || taskIds.some(id => typeof id !== 'string' || !id.trim())) {
    throw new TypeError(`${field} must be an array of non-empty task IDs`);
  }
  return [...new Set(taskIds)].sort();
}

function normalizePriority(priority) {
  if (priority !== null && (!Number.isInteger(priority) || !Number.isSafeInteger(priority))) {
    throw new TypeError('priority must be an integer or null');
  }
  return priority;
}

function timestamp() {
  return new Date().toISOString();
}

function toTask(row, blockedBy) {
  if (!row) return null;
  return {
    id: row.id,
    identifier: row.identifier,
    title: row.title,
    state: row.state,
    priority: row.priority,
    labels: JSON.parse(row.labels_json),
    blockedBy,
    acceptedPlan: row.accepted_plan,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toRecord(row) {
  return {
    id: row.id,
    sequence: row.sequence,
    taskId: row.task_id,
    kind: row.kind,
    author: row.author,
    content: row.content,
    createdAt: row.created_at
  };
}

function publicationInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('publication must be an object');
  const labels = normalizeLabels(input.labels ?? []);
  const blockedBy = normalizeTaskIds(input.blockedBy ?? [], 'blockedBy');
  const normalized = {
    publicationKey: requiredText(input.publicationKey, 'publicationKey'),
    identifier: requiredText(input.identifier, 'identifier'),
    title: requiredText(input.title, 'title'),
    state: requiredText(input.state ?? 'Ready', 'state'),
    priority: normalizePriority(Object.hasOwn(input, 'priority') ? input.priority : 3),
    labels,
    blockedBy,
    acceptedPlan: requiredText(input.acceptedPlan, 'acceptedPlan')
  };
  const hashInput = JSON.stringify({
    identifier: normalized.identifier,
    title: normalized.title,
    state: normalized.state,
    priority: normalized.priority,
    labels: normalized.labels,
    blockedBy: normalized.blockedBy,
    acceptedPlan: normalized.acceptedPlan
  });
  return { ...normalized, hash: createHash('sha256').update(hashInput).digest('hex') };
}

async function ensureDatabaseDirectory(databasePath) {
  const absolutePath = resolve(databasePath);
  await mkdir(dirname(absolutePath), { recursive: true, mode: 0o700 });
  return absolutePath;
}

export async function openLocalTaskStore(databasePath) {
  if (typeof databasePath !== 'string' || !databasePath.trim() || databasePath === ':memory:') {
    throw new TypeError('databasePath must identify a persistent SQLite file');
  }
  const absolutePath = await ensureDatabaseDirectory(databasePath);
  const database = new Database(absolutePath, { timeout: 10_000 });
  try {
    database.pragma('foreign_keys = ON');
    database.pragma('busy_timeout = 10000');
    database.pragma('journal_mode = WAL');
    database.pragma('synchronous = FULL');

    const version = database.pragma('user_version', { simple: true });
    if (version > SCHEMA_VERSION) throw new Error(`Local Task Store schema ${version} is newer than supported schema ${SCHEMA_VERSION}`);
    if (version === 0) {
      database.transaction(() => {
        database.exec(SCHEMA);
        database.pragma(`user_version = ${SCHEMA_VERSION}`);
      }).exclusive();
    }
    await chmod(absolutePath, 0o600);
    return new LocalTaskStore(database);
  } catch (error) {
    database.close();
    throw error;
  }
}

export class LocalTaskStore {
  #database;
  #closed = false;

  constructor(database) {
    this.#database = database;
  }

  #assertOpen() {
    if (this.#closed) throw new Error('Local Task Store is closed');
  }

  #requireTask(taskId) {
    const id = requiredText(taskId, 'taskId');
    const row = this.#database.prepare('SELECT id FROM tasks WHERE id = ?').get(id);
    if (!row) throw new Error(`Task not found: ${id}`);
    return id;
  }

  #blockedBy(taskId) {
    return this.#database.prepare(`
      SELECT blocker_task_id AS id
      FROM task_dependencies
      WHERE task_id = ?
      ORDER BY created_at, blocker_task_id
    `).all(taskId).map(row => row.id);
  }

  #taskFromRow(row) {
    if (!row) return null;
    return toTask(row, this.#blockedBy(row.id));
  }

  publishTask(input) {
    this.#assertOpen();
    const publication = publicationInput(input);
    const create = this.#database.transaction(() => {
      const existing = this.#database.prepare('SELECT * FROM tasks WHERE publication_key = ?').get(publication.publicationKey);
      if (existing) {
        if (existing.publication_hash !== publication.hash) {
          throw new Error(`publicationKey was already used with different task data: ${publication.publicationKey}`);
        }
        return this.#taskFromRow(existing);
      }

      const id = randomUUID();
      const now = timestamp();
      this.#database.prepare(`
        INSERT INTO tasks (
          id, identifier, title, state, priority, labels_json, accepted_plan,
          publication_key, publication_hash, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        publication.identifier,
        publication.title,
        publication.state,
        publication.priority,
        JSON.stringify(publication.labels),
        publication.acceptedPlan,
        publication.publicationKey,
        publication.hash,
        now,
        now
      );
      const addDependency = this.#database.prepare(`
        INSERT INTO task_dependencies (task_id, blocker_task_id, created_at)
        VALUES (?, ?, ?)
      `);
      for (const blockerId of publication.blockedBy) {
        if (blockerId === id) throw new Error('a task cannot block itself');
        addDependency.run(id, blockerId, now);
      }
      return this.#taskFromRow(this.#database.prepare('SELECT * FROM tasks WHERE id = ?').get(id));
    });
    return create.immediate();
  }

  getTask(taskId) {
    this.#assertOpen();
    const id = requiredText(taskId, 'taskId');
    const row = this.#database.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
    return this.#taskFromRow(row);
  }

  listTasks({ state } = {}) {
    this.#assertOpen();
    if (state !== undefined) requiredText(state, 'state');
    const rows = state === undefined
      ? this.#database.prepare('SELECT * FROM tasks ORDER BY created_at, id').all()
      : this.#database.prepare('SELECT * FROM tasks WHERE state = ? ORDER BY created_at, id').all(state);
    return rows.map(row => this.#taskFromRow(row));
  }

  updateTask(taskId, changes) {
    this.#assertOpen();
    const id = requiredText(taskId, 'taskId');
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw new TypeError('changes must be an object');
    const allowed = new Set(['title', 'state', 'priority', 'labels']);
    const keys = Object.keys(changes);
    if (!keys.length) throw new TypeError('changes must include at least one mutable task property');
    for (const key of keys) if (!allowed.has(key)) throw new TypeError(`task property cannot be changed: ${key}`);

    const values = {};
    if (Object.hasOwn(changes, 'title')) values.title = requiredText(changes.title, 'title');
    if (Object.hasOwn(changes, 'state')) values.state = requiredText(changes.state, 'state');
    if (Object.hasOwn(changes, 'priority')) values.priority = normalizePriority(changes.priority);
    if (Object.hasOwn(changes, 'labels')) values.labels_json = JSON.stringify(normalizeLabels(changes.labels));

    const update = this.#database.transaction(() => {
      this.#requireTask(id);
      const assignments = [...Object.keys(values).map(key => `${key} = @${key}`), 'updated_at = @updated_at'];
      this.#database.prepare(`UPDATE tasks SET ${assignments.join(', ')} WHERE id = @id`).run({
        ...values,
        updated_at: timestamp(),
        id
      });
      return this.#taskFromRow(this.#database.prepare('SELECT * FROM tasks WHERE id = ?').get(id));
    });
    return update.immediate();
  }

  setBlockedBy(taskId, blockerTaskIds) {
    this.#assertOpen();
    const id = requiredText(taskId, 'taskId');
    const blockers = normalizeTaskIds(blockerTaskIds, 'blockerTaskIds');
    if (blockers.includes(id)) throw new Error('a task cannot block itself');
    const update = this.#database.transaction(() => {
      this.#requireTask(id);
      this.#database.prepare('DELETE FROM task_dependencies WHERE task_id = ?').run(id);
      const addDependency = this.#database.prepare(`
        INSERT INTO task_dependencies (task_id, blocker_task_id, created_at)
        VALUES (?, ?, ?)
      `);
      const now = timestamp();
      for (const blockerId of blockers) addDependency.run(id, blockerId, now);
      this.#database.prepare('UPDATE tasks SET updated_at = ? WHERE id = ?').run(now, id);
      return this.#taskFromRow(this.#database.prepare('SELECT * FROM tasks WHERE id = ?').get(id));
    });
    return update.immediate();
  }

  addBlockedBy(taskId, blockerTaskId) {
    this.#assertOpen();
    const id = requiredText(taskId, 'taskId');
    const blockerId = requiredText(blockerTaskId, 'blockerTaskId');
    if (id === blockerId) throw new Error('a task cannot block itself');
    const add = this.#database.transaction(() => {
      this.#requireTask(id);
      this.#requireTask(blockerId);
      const result = this.#database.prepare(`
        INSERT OR IGNORE INTO task_dependencies (task_id, blocker_task_id, created_at)
        VALUES (?, ?, ?)
      `).run(id, blockerId, timestamp());
      if (result.changes) this.#database.prepare('UPDATE tasks SET updated_at = ? WHERE id = ?').run(timestamp(), id);
      return { added: result.changes === 1, blockedBy: this.#blockedBy(id) };
    });
    return add.immediate();
  }

  isBlocked(taskId, terminalStates = DEFAULT_TERMINAL_STATES) {
    this.#assertOpen();
    const id = this.#requireTask(taskId);
    if (!Array.isArray(terminalStates) || terminalStates.some(state => typeof state !== 'string' || !state.trim())) {
      throw new TypeError('terminalStates must be an array of non-empty strings');
    }
    if (!terminalStates.length) return this.#blockedBy(id).length > 0;
    const placeholders = terminalStates.map(() => '?').join(', ');
    const blocker = this.#database.prepare(`
      SELECT 1
      FROM task_dependencies AS dependency
      JOIN tasks AS blocker ON blocker.id = dependency.blocker_task_id
      WHERE dependency.task_id = ? AND blocker.state NOT IN (${placeholders})
      LIMIT 1
    `).get(id, ...terminalStates);
    return blocker !== undefined;
  }

  appendWorkpad(taskId, content, author = 'worker') {
    return this.#appendRecord(taskId, 'workpad', author, content);
  }

  appendComment(taskId, content, author = 'user') {
    return this.#appendRecord(taskId, 'comment', author, content);
  }

  #appendRecord(taskId, kind, author, content) {
    this.#assertOpen();
    const id = requiredText(taskId, 'taskId');
    const recordAuthor = requiredText(author, 'author');
    if (typeof content !== 'string') throw new TypeError('content must be a string');
    const addRecord = this.#database.transaction(() => {
      this.#requireTask(id);
      const now = timestamp();
      const recordId = randomUUID();
      const row = this.#database.prepare(`
        INSERT INTO task_records (id, task_id, kind, author, content, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        RETURNING sequence, id, task_id, kind, author, content, created_at
      `).get(recordId, id, kind, recordAuthor, content, now);
      this.#database.prepare('UPDATE tasks SET updated_at = ? WHERE id = ?').run(now, id);
      return toRecord(row);
    });
    return addRecord.immediate();
  }

  listRecords(taskId, { kind } = {}) {
    this.#assertOpen();
    const id = this.#requireTask(taskId);
    if (kind !== undefined && kind !== 'workpad' && kind !== 'comment') throw new TypeError('kind must be workpad or comment');
    const rows = kind === undefined
      ? this.#database.prepare('SELECT * FROM task_records WHERE task_id = ? ORDER BY sequence').all(id)
      : this.#database.prepare('SELECT * FROM task_records WHERE task_id = ? AND kind = ? ORDER BY sequence').all(id, kind);
    return rows.map(toRecord);
  }

  listCommentsAfter(taskId, baselineCommentId = null) {
    this.#assertOpen();
    const id = this.#requireTask(taskId);
    if (baselineCommentId === null) {
      return this.#database.prepare(`
        SELECT * FROM task_records WHERE task_id = ? AND kind = 'comment' ORDER BY sequence
      `).all(id).map(toRecord);
    }
    const baseline = this.#database.prepare(`
      SELECT sequence FROM task_records WHERE task_id = ? AND id = ? AND kind = 'comment'
    `).get(id, requiredText(baselineCommentId, 'baselineCommentId'));
    if (!baseline) throw new Error(`Comment baseline not found: ${baselineCommentId}`);
    return this.#database.prepare(`
      SELECT * FROM task_records
      WHERE task_id = ? AND kind = 'comment' AND sequence > ?
      ORDER BY sequence
    `).all(id, baseline.sequence).map(toRecord);
  }

  latestCommentId(taskId) {
    this.#assertOpen();
    const id = this.#requireTask(taskId);
    return this.#database.prepare(`
      SELECT id FROM task_records WHERE task_id = ? AND kind = 'comment' ORDER BY sequence DESC LIMIT 1
    `).get(id)?.id ?? null;
  }

  close() {
    this.#assertOpen();
    this.#database.close();
    this.#closed = true;
  }
}
