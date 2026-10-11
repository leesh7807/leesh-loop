import { openLocalTaskStore } from './local-task-store.mjs';
import { publishAcceptedPlan } from './local-publisher.mjs';

function requiredText(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${field} must be a non-empty string`);
  return value;
}

function taskForTracker(store, task, terminalStates) {
  const blockers = task.blockedBy.map(id => {
    const blocker = store.getTask(id);
    return { id, terminal: terminalStates.includes(blocker.state) };
  });
  return { ...task, blockedBy: blockers, dispatchable: blockers.every(blocker => blocker.terminal) };
}

async function main() {
  const [operation, inputJson] = process.argv.slice(2);
  const databasePath = requiredText(process.env.LEESH_LOOP_LOCAL_TASK_STORE_PATH, 'LEESH_LOOP_LOCAL_TASK_STORE_PATH');
  let input;
  try { input = JSON.parse(inputJson || '{}'); }
  catch { throw new TypeError('operation input must be valid JSON'); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('operation input must be an object');

  const store = await openLocalTaskStore(databasePath);
  try {
    let result;
    switch (operation) {
      case 'list_tasks': {
        const states = input.states;
        const terminalStates = input.terminalStates;
        if (!Array.isArray(states) || states.some(state => typeof state !== 'string' || !state.trim())) throw new TypeError('states must be a list of non-empty strings');
        if (!Array.isArray(terminalStates) || terminalStates.some(state => typeof state !== 'string' || !state.trim())) throw new TypeError('terminalStates must be a list of non-empty strings');
        const unique = new Map();
        for (const state of [...new Set(states)]) {
          for (const task of store.listTasks({ state })) unique.set(task.id, task);
        }
        result = [...unique.values()].map(task => taskForTracker(store, task, terminalStates));
        break;
      }
      case 'get_tasks': {
        const ids = input.ids;
        const terminalStates = input.terminalStates;
        if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !id.trim())) throw new TypeError('ids must be a list of non-empty task IDs');
        if (!Array.isArray(terminalStates) || terminalStates.some(state => typeof state !== 'string' || !state.trim())) throw new TypeError('terminalStates must be a list of non-empty strings');
        result = ids.map(id => store.getTask(id)).filter(Boolean).map(task => taskForTracker(store, task, terminalStates));
        break;
      }
      case 'get_task': {
        const task = store.getTask(requiredText(input.taskId, 'taskId'));
        result = task && taskForTracker(store, task, input.terminalStates || ['Done', 'Cancelled']);
        break;
      }
      case 'list_records':
        result = store.listRecords(requiredText(input.taskId, 'taskId'), input.kind ? { kind: input.kind } : {});
        break;
      case 'append_workpad':
        result = store.appendWorkpad(requiredText(input.taskId, 'taskId'), input.content);
        break;
      case 'update_task':
        result = store.updateTask(requiredText(input.taskId, 'taskId'), input.changes);
        break;
      case 'set_state':
        result = store.updateTask(requiredText(input.taskId, 'taskId'), { state: requiredText(input.state, 'state') });
        break;
      case 'add_blocked_by':
        result = store.addBlockedBy(requiredText(input.taskId, 'taskId'), requiredText(input.blockerTaskId, 'blockerTaskId'));
        break;
      case 'publish_task':
        result = publishAcceptedPlan(store, input.plan, { state: input.state ?? 'Backlog', blockedBy: input.blockedBy ?? [] });
        break;
      default:
        throw new Error(`unsupported Local Task Store operation: ${String(operation)}`);
    }
    process.stdout.write(`${JSON.stringify({ ok: true, result })}\n`);
  } finally {
    store.close();
  }
}

main().catch(error => {
  process.stdout.write(`${JSON.stringify({ ok: false, error: String(error?.message || error) })}\n`);
  process.exitCode = 1;
});
