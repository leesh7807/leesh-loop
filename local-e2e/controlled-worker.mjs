#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { dirname } from 'node:path';

const eventPath = process.env.LOCAL_E2E_WORKER_EVENT_FILE;
const runId = process.env.LOCAL_E2E_RUN_ID;
const taskId = process.env.LOCAL_E2E_EXPECTED_TASK_ID;
const planHash = process.env.LOCAL_E2E_EXPECTED_PLAN_SHA256;
const expectedComment = process.env.LOCAL_E2E_EXPECTED_COMMENT;
const failAt = process.env.LOCAL_E2E_FAIL_AT;
const workpadText = 'Local E2E ' + runId + ': controlled Worker data access completed.';

if (![eventPath, runId, taskId, planHash, expectedComment].every(value => typeof value === 'string' && value.length > 0)) {
  throw new Error('Local E2E controlled Worker is missing its run binding.');
}

const steps = [
  { tool: 'local_task_read', arguments: {}, validate: value => {
    if (value.id !== taskId || value.state !== 'Ready' || createHash('sha256').update(value.acceptedPlan).digest('hex') !== planHash) {
      throw new Error('bound Task or immutable Accepted Plan did not match the published input');
    }
  } },
  { tool: 'local_task_comments', arguments: {}, validate: value => {
    if (!value.comments?.some(comment => comment.content === expectedComment)) throw new Error('published user Comment was not visible through the Local Worker tool');
  } },
  { tool: 'local_task_read_workpad', arguments: {}, validate: value => {
    if (!Array.isArray(value.records) || value.records.length !== 0) throw new Error('Workpad was not initially empty');
  } },
  { tool: 'local_task_set_state', arguments: failAt === 'worker-tool' ? { state: '' } : { state: 'In Progress' }, validate: value => {
    if (failAt !== 'worker-tool' && value.state !== 'In Progress') throw new Error('Worker State change was not returned by the Local tool');
  } },
  { tool: 'local_task_append_workpad', arguments: { text: workpadText }, validate: value => {
    if (value.taskId !== taskId || value.content !== workpadText || value.kind !== 'workpad') throw new Error('Workpad append did not return the expected record');
  } },
  { tool: 'local_task_read', arguments: {}, validate: value => {
    if (value.id !== taskId || value.state !== 'In Progress' || createHash('sha256').update(value.acceptedPlan).digest('hex') !== planHash) {
      throw new Error('updated Task could not be read back through the Local Worker tool');
    }
  } },
  { tool: 'local_task_read_workpad', arguments: {}, validate: value => {
    if (!value.records?.some(record => record.content === workpadText)) throw new Error('Workpad append could not be read back through the Local Worker tool');
  } }
];

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
let pendingToolId;
let nextStep = 0;
const calls = [];
let finished = false;

function send(value) {
  process.stdout.write(JSON.stringify(value) + '\n');
}

async function record(status, error) {
  if (finished) return;
  finished = true;
  await mkdir(dirname(eventPath), { recursive: true });
  await writeFile(eventPath, JSON.stringify({
    runId,
    taskId,
    workerPid: process.pid,
    status,
    calls,
    ...(error ? { error } : {})
  }, null, 2) + '\n');
}

function failTurn(error) {
  const message = error instanceof Error ? error.message : String(error);
  record('failed', message).then(() => {
    send({ method: 'turn/failed', params: { error: { message } } });
    process.exitCode = 1;
    input.close();
  });
}

function requestNextTool() {
  if (nextStep >= steps.length) {
    record('complete').then(() => {
      send({ method: 'turn/completed' });
      input.close();
    });
    return;
  }
  const step = steps[nextStep];
  pendingToolId = 'local-e2e-tool-' + (nextStep + 1);
  send({
    id: pendingToolId,
    method: 'item/tool/call',
    params: { tool: step.tool, arguments: step.arguments }
  });
}

input.on('line', line => {
  try {
    const message = JSON.parse(line);
    if (message.id === 1) {
      send({ id: 1, result: {} });
    } else if (message.method === 'initialized') {
      // The app-server client sends this notification after initialize.
    } else if (message.method === 'thread/start') {
      send({ id: message.id, result: { thread: { id: 'local-e2e-thread-' + runId } } });
    } else if (message.method === 'turn/start') {
      send({ id: message.id, result: { turn: { id: 'local-e2e-turn-' + runId } } });
      requestNextTool();
    } else if (message.id === pendingToolId) {
      const step = steps[nextStep];
      const result = message.result || {};
      const call = { tool: step.tool, success: result.success === true };
      calls.push(call);
      if (!call.success) {
        failTurn(new Error('Local Worker tool failed: ' + step.tool + ': ' + (result.output || 'no error detail')));
      } else {
        const value = JSON.parse(result.output || '{}');
        step.validate(value);
        pendingToolId = undefined;
        nextStep += 1;
        requestNextTool();
      }
    }
  } catch (error) {
    failTurn(error);
  }
});

input.on('close', () => {
  if (!finished && process.exitCode === undefined) process.exitCode = 1;
});

input.on('error', error => failTurn(error));
