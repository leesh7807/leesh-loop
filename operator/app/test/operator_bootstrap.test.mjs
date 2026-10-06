import assert from 'node:assert/strict';
import { execFile as execute, spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFile = promisify(execute);
const root = join(import.meta.dirname, '../../..');
const bootstrap = join(root, 'operator/app/operator-bootstrap');
const commit = '0123456789012345678901234567890123456789';

async function executable(path, contents) {
  await writeFile(path, contents);
  await chmod(path, 0o755);
}

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-operator-bootstrap-'));
  const bin = join(directory, 'bin');
  const log = join(directory, 'commands.log');
  const workspace = join(directory, 'workspace');
  const blocked = join(directory, 'blocked-external-state');
  const status = join(directory, 'startup-status');
  await mkdir(bin);
  await writeFile(blocked, 'external state is unavailable\n');
  await executable(join(bin, 'node'), `#!/bin/sh\nexec "${process.execPath}" "$@"\n`);
  await executable(join(bin, 'git'), `#!/bin/sh
printf 'git %s\\n' "$*" >> "$OPERATOR_TEST_LOG"
case "$1" in
  check-ref-format) exit 0 ;;
  config) printf 'gh auth git-credential\\n'; exit 0 ;;
  credential) printf 'username=fixture\\npassword=fixture-token\\n'; exit 0 ;;
  ls-remote)
    case "$*" in
      *'refs/heads/main'*) printf '${commit} refs/heads/main\\n' ;;
      *) printf '${commit} HEAD\\n' ;;
    esac
    exit 0
    ;;
  -c) exit 0 ;;
  *) exit 0 ;;
esac
`);
  await executable(join(bin, 'gh'), `#!/bin/sh
printf 'gh %s\\n' "$*" >> "$OPERATOR_TEST_LOG"
exit 0
`);
  await executable(join(bin, 'curl'), `#!/bin/sh
printf 'curl %s\\n' "$*" >> "$OPERATOR_TEST_LOG"
exit 0
`);
  const child = join(directory, 'child');
  await executable(child, `#!/bin/sh
set -eu
printf 'child %s\\n' "$*" >> "$OPERATOR_TEST_LOG"
printf 'discovery=%s\\n' "\${CHATGPT_SHOT_WORKER_DISCOVERY_PATH-}" >> "$OPERATOR_TEST_LOG"
printf 'readiness=%s\\n' "\${SYMPHONY_OPERATOR_READINESS_FILE-}" >> "$OPERATOR_TEST_LOG"
printf 'interface=%s\\n' "\${CHATGPT_SHOT_WORKER_INTERFACE_ROOT-}" >> "$OPERATOR_TEST_LOG"
if [ "\${OPERATOR_TEST_USE_WORKER_INTERFACE:-false}" = true ]; then
  PATH="$CHATGPT_SHOT_WORKER_INTERFACE_ROOT:$PATH"
  export PATH
  printf 'selected=%s\\n' "$(command -v chatgpt-shot)" >> "$OPERATOR_TEST_LOG"
  worker_job_id=$(chatgpt-shot submit 'worker review request')
  printf 'worker-job=%s\\n' "$worker_job_id" >> "$OPERATOR_TEST_LOG"
  printf 'worker-snapshot=' >> "$OPERATOR_TEST_LOG"
  chatgpt-shot jobs "$worker_job_id" >> "$OPERATOR_TEST_LOG"
fi
`);
  t.after(async () => {
    try {
      const pid = Number(await readFile(join(directory, 'external', 'health-server.pid'), 'utf8'));
      if (Number.isInteger(pid) && pid > 0) process.kill(pid, 'SIGTERM');
    } catch {
      // Readiness-failure fixtures do not launch the local health server.
    }
    for (const stateRoot of ['config', 'data', 'cache'].map(name => join(directory, 'external', name, 'chatgpt-shot'))) {
      try {
        await chmod(stateRoot, 0o755);
        for (const entry of await readdir(stateRoot, { withFileTypes: true })) {
          if (entry.isFile()) await chmod(join(stateRoot, entry.name), 0o644);
        }
      } catch {
        // Bootstrap fixtures without external state have nothing to restore.
      }
    }
    await rm(directory, { recursive: true, force: true });
  });
  return { directory, bin, log, workspace, blocked, status, child };
}

async function externalReadinessFixture(t, startMode = 'ready') {
  const fixtureValue = await fixture(t);
  const externalRoot = join(fixtureValue.directory, 'external');
  const configHome = join(externalRoot, 'config');
  const dataHome = join(externalRoot, 'data');
  const cacheHome = join(externalRoot, 'cache');
  const discovery = join(cacheHome, 'chatgpt-shot', 'runtime.json');
  const serverScript = join(externalRoot, 'health-server.mjs');
  const serverPidFile = join(externalRoot, 'health-server.pid');
  const serviceRequests = join(externalRoot, 'service-requests.jsonl');
  await Promise.all([
    mkdir(join(configHome, 'chatgpt-shot'), { recursive: true }),
    mkdir(join(dataHome, 'chatgpt-shot'), { recursive: true }),
    mkdir(join(cacheHome, 'chatgpt-shot'), { recursive: true })
  ]);
  await writeFile(serverScript, `import fs from 'node:fs';
import http from 'node:http';

const discoveryPath = process.argv[2];
const requestsPath = process.argv[3];
const id = '00000000-0000-4000-8000-000000000001';
const server = http.createServer((request, response) => {
  let body = '';
  request.setEncoding('utf8');
  request.on('data', chunk => body += chunk);
  request.on('end', () => {
    const record = JSON.parse(fs.readFileSync(discoveryPath, 'utf8'));
    response.setHeader('content-type', 'application/json');
    if (request.headers.authorization !== 'Bearer fixture-token') {
      response.writeHead(403);
      response.end(JSON.stringify({ code: 'FORBIDDEN', message: 'invalid credential' }));
      return;
    }
    if (request.url === '/health') {
      response.writeHead(200);
      response.end(JSON.stringify({ pid: record.pid, protocolVersion: 1, accepting: true }));
      return;
    }
    fs.appendFileSync(requestsPath, JSON.stringify({ method: request.method, url: request.url, body }) + '\\n');
    if (request.method === 'POST' && request.url === '/jobs') {
      response.writeHead(200);
      response.end(JSON.stringify({ id }));
      return;
    }
    if (request.method === 'GET' && request.url === '/jobs/' + id) {
      response.writeHead(200);
      response.end(JSON.stringify({ id, state: 'completed', result: 'review result', error: null }));
      return;
    }
    response.writeHead(404);
    response.end(JSON.stringify({ code: 'NOT_FOUND', message: 'not found' }));
  });
});
server.listen(0, '127.0.0.1', () => {
  fs.writeFileSync(discoveryPath, JSON.stringify({ host: '127.0.0.1', port: server.address().port, pid: process.pid, credential: 'fixture-token' }) + '\\n');
});
process.on('SIGTERM', () => server.close(() => process.exit(0)));
`);
  await executable(join(fixtureValue.bin, 'chatgpt-shot'), `#!/bin/sh
printf 'chatgpt-shot %s\\n' "$*" >> "$OPERATOR_TEST_LOG"
case "$1" in
  config)
    case "$2" in
      path) printf '%s\\n' "$XDG_CONFIG_HOME/chatgpt-shot/.env" ;;
      show) printf 'NOTION_TOKEN: set\\nCHATGPT_SHOT_NOTION_DATABASE_URL: set\\n' ;;
      *) exit 2 ;;
    esac
    ;;
  doctor) exit 0 ;;
  start)
    if [ "$CHATGPT_SHOT_START_MODE" = ready ]; then
      node "$OPERATOR_TEST_HEALTH_SERVER" "$XDG_CACHE_HOME/chatgpt-shot/runtime.json" "$OPERATOR_TEST_SERVICE_REQUESTS" >/dev/null 2>&1 &
      printf '%s\\n' "$!" > "$OPERATOR_TEST_SERVER_PID_FILE"
      wait_count=0
      while [ ! -s "$XDG_CACHE_HOME/chatgpt-shot/runtime.json" ]; do
        [ "$wait_count" -lt 100 ] || exit 1
        sleep 0.01
        wait_count=$((wait_count + 1))
      done
    fi
    ;;
  submit) printf '00000000-0000-4000-8000-000000000001\\n' ;;
  jobs) printf '{"state":"completed","result":"READY","error":null}\\n' ;;
  stop) printf 'unexpected stop\\n' >> "$OPERATOR_TEST_LOG"; exit 99 ;;
  *) exit 2 ;;
esac
`);
  const env = environment(fixtureValue);
  env.XDG_CONFIG_HOME = configHome;
  env.XDG_DATA_HOME = dataHome;
  env.XDG_CACHE_HOME = cacheHome;
  env.OPERATOR_TEST_HEALTH_SERVER = serverScript;
  env.OPERATOR_TEST_SERVER_PID_FILE = serverPidFile;
  env.OPERATOR_TEST_SERVICE_REQUESTS = serviceRequests;
  env.CHATGPT_SHOT_START_MODE = startMode;
  return { ...fixtureValue, env, discovery, configHome, dataHome, cacheHome, serverScript, serverPidFile, serviceRequests };
}

async function startPreparedService(fixtureValue) {
  const server = spawn(process.execPath, [fixtureValue.serverScript, fixtureValue.discovery, fixtureValue.serviceRequests], { stdio: 'ignore' });
  if (!server.pid) throw new Error('could not start the prepared chatgpt-shot Service fixture');
  server.unref();
  await writeFile(fixtureValue.serverPidFile, `${server.pid}\n`);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      JSON.parse(await readFile(fixtureValue.discovery, 'utf8'));
      return;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
  throw new Error('prepared chatgpt-shot Service did not publish discovery');
}

async function makeOperatorStateReadOnly(fixtureValue) {
  const roots = [
    join(fixtureValue.configHome, 'chatgpt-shot'),
    join(fixtureValue.dataHome, 'chatgpt-shot'),
    join(fixtureValue.cacheHome, 'chatgpt-shot')
  ];
  for (const root of roots) {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (entry.isFile()) await chmod(join(root, entry.name), 0o444);
    }
    await chmod(root, 0o555);
  }
}

async function snapshotOperatorState(fixtureValue) {
  const roots = [
    join(fixtureValue.configHome, 'chatgpt-shot'),
    join(fixtureValue.dataHome, 'chatgpt-shot'),
    join(fixtureValue.cacheHome, 'chatgpt-shot')
  ];
  return Promise.all(roots.map(async root => {
    const directory = await stat(root);
    const entries = await Promise.all((await readdir(root)).sort().map(async name => {
      const path = join(root, name);
      const details = await stat(path);
      return { name, mode: details.mode & 0o777, mtimeMs: details.mtimeMs, contents: await readFile(path, 'utf8') };
    }));
    return { mode: directory.mode & 0o777, mtimeMs: directory.mtimeMs, entries };
  }));
}

function environment(fixture) {
  const env = {
    ...process.env,
    PATH: `${fixture.bin}:/usr/bin:/bin`,
    HOME: fixture.blocked,
    XDG_CONFIG_HOME: fixture.blocked,
    XDG_DATA_HOME: fixture.blocked,
    XDG_CACHE_HOME: fixture.blocked,
    OPERATOR_TEST_LOG: fixture.log,
    SYMPHONY_WORKSPACE_ROOT: fixture.workspace,
    SYMPHONY_GITHUB_REPOSITORY_URL: 'https://github.com/example/repository.git',
    SYMPHONY_GITHUB_BASE_BRANCH: 'main',
    SYMPHONY_OPERATOR_INTERFACE_ROOT: join(fixture.directory, 'worker-interface'),
    SYMPHONY_OPERATOR_STARTUP_STATUS_FILE: fixture.status
  };
  delete env.CHATGPT_SHOT_WORKER_DISCOVERY_PATH;
  delete env.SYMPHONY_CHATGPT_SHOT_SMOKE_PROMPT;
  delete env.SYMPHONY_OPERATOR_READINESS_FILE;
  delete env.CHATGPT_SHOT_WORKER_INTERFACE_ROOT;
  return env;
}

test('skip external readiness still prepares the worker interface without inspecting external state', async t => {
  const fixtureValue = await fixture(t);
  const result = await execFile('sh', [bootstrap, '--skip-external-readiness', '--', fixtureValue.child, 'symphony'], { env: environment(fixtureValue) });
  assert.match(result.stdout, /Review service checks were skipped by configuration/);
  const log = await readFile(fixtureValue.log, 'utf8');
  assert.match(log, /git /);
  assert.match(log, /gh /);
  assert.match(log, /curl /);
  assert.match(log, /child symphony/);
  assert.match(log, new RegExp(`discovery=${fixtureValue.blocked}/chatgpt-shot/runtime\\.json`));
  assert.match(log, /readiness=\n/);
  assert.match(log, new RegExp(`interface=${fixtureValue.directory}/worker-interface`));
  assert.equal(await readFile(join(fixtureValue.directory, 'worker-interface/chatgpt-shot'), 'utf8'), await readFile(join(root, 'operator/external/chatgpt-shot/chatgpt-shot'), 'utf8'));
  assert.equal((await stat(join(fixtureValue.directory, 'worker-interface/chatgpt-shot'))).mode & 0o111, 0o111);
  assert.equal((await stat(fixtureValue.blocked)).isFile(), true);
  assert.doesNotMatch(log, /chatgpt-shot (?:config|doctor|start|submit|jobs)/);
  assert.equal(await readFile(fixtureValue.status, 'utf8'), 'starting task processing\n');
});

test('GitHub SSH upstreams use SSH Git authentication while preserving the Operator readiness path', async t => {
  const fixtureValue = await fixture(t);
  const env = environment(fixtureValue);
  env.SYMPHONY_GITHUB_REPOSITORY_URL = 'git@github.com:example/repository.git';
  const result = await execFile('sh', [bootstrap, '--skip-external-readiness', '--', fixtureValue.child, 'symphony'], { env });
  assert.match(result.stdout, /Loop setup checks passed/);
  const log = await readFile(fixtureValue.log, 'utf8');
  assert.match(log, /ls-remote git@github\.com:example\/repository\.git HEAD/);
  assert.doesNotMatch(log, /credential fill/);
  assert.match(log, /child symphony/);
});

test('external readiness remains required unless explicitly skipped', async t => {
  const fixtureValue = await fixture(t);
  await assert.rejects(
    execFile('sh', [bootstrap, '--', fixtureValue.child], { env: environment(fixtureValue) }),
    error => /chatgpt-shot review command is not installed/.test(String(error.stderr))
  );
  await assert.rejects(readFile(fixtureValue.log, 'utf8'), /./);
});

test('failed Service readiness uses public startup, preserves discovery, and fails before worker dispatch', async t => {
  const fixtureValue = await externalReadinessFixture(t, 'stale');
  const staleDiscovery = '{"host":"127.0.0.1","port":0,"pid":123,"credential":"stale"}\n';
  await writeFile(fixtureValue.discovery, staleDiscovery);

  await assert.rejects(
    execFile('sh', [bootstrap, '--', fixtureValue.child], { env: fixtureValue.env }),
    error => /review service is not accepting requests/.test(String(error.stderr))
  );

  assert.equal(await readFile(fixtureValue.discovery, 'utf8'), staleDiscovery);
  const log = await readFile(fixtureValue.log, 'utf8');
  assert.match(log, /chatgpt-shot start/);
  assert.doesNotMatch(log, /chatgpt-shot stop/);
  assert.doesNotMatch(log, /chatgpt-shot submit/);
  assert.doesNotMatch(log, /chatgpt-shot jobs/);
  assert.doesNotMatch(log, /child /);
});

test('normal startup keeps readiness and dispatches the same worker-facing review commands', async t => {
  const fixtureValue = await externalReadinessFixture(t);
  const env = { ...fixtureValue.env, OPERATOR_TEST_USE_WORKER_INTERFACE: 'true' };
  const result = await execFile('sh', [bootstrap, '--', fixtureValue.child, 'symphony'], { env });

  assert.match(result.stdout, /Loop setup checks passed/);
  const log = await readFile(fixtureValue.log, 'utf8');
  assert.match(log, /chatgpt-shot start/);
  assert.match(log, /chatgpt-shot submit Operator readiness smoke check/);
  assert.match(log, /chatgpt-shot jobs 00000000-0000-4000-8000-000000000001/);
  assert.match(log, /child symphony/);
  assert.match(log, new RegExp(`discovery=${fixtureValue.discovery}`));
  assert.match(log, new RegExp(`interface=${fixtureValue.directory}/worker-interface`));
  assert.match(log, new RegExp(`selected=${fixtureValue.directory}/worker-interface/chatgpt-shot`));
  assert.match(log, /worker-job=00000000-0000-4000-8000-000000000001/);
  assert.match(log, /worker-snapshot=\{"id":"00000000-0000-4000-8000-000000000001","state":"completed","result":"review result","error":null\}/);
  assert.doesNotMatch(log, /chatgpt-shot stop/);
  assert.match(await readFile(fixtureValue.discovery, 'utf8'), /"credential":"fixture-token"/);
  const serviceRequests = (await readFile(fixtureValue.serviceRequests, 'utf8')).trim().split('\n').map(value => JSON.parse(value));
  assert.deepEqual(serviceRequests, [
    { method: 'POST', url: '/jobs', body: JSON.stringify({ prompt: 'worker review request' }) },
    { method: 'GET', url: '/jobs/00000000-0000-4000-8000-000000000001', body: '' }
  ]);
});

test('fast worker submits and reads a Job through the shared interface with read-only Operator state', async t => {
  const fixtureValue = await externalReadinessFixture(t);
  await startPreparedService(fixtureValue);
  await makeOperatorStateReadOnly(fixtureValue);
  const before = await snapshotOperatorState(fixtureValue);
  const env = { ...fixtureValue.env, OPERATOR_TEST_USE_WORKER_INTERFACE: 'true' };
  const result = await execFile('sh', [bootstrap, '--skip-external-readiness', '--', fixtureValue.child, 'symphony'], { env });

  assert.match(result.stdout, /Review service checks were skipped by configuration/);
  const log = await readFile(fixtureValue.log, 'utf8');
  assert.match(log, new RegExp(`discovery=${fixtureValue.discovery}`));
  assert.match(log, new RegExp(`interface=${fixtureValue.directory}/worker-interface`));
  assert.match(log, new RegExp(`selected=${fixtureValue.directory}/worker-interface/chatgpt-shot`));
  assert.match(log, /worker-job=00000000-0000-4000-8000-000000000001/);
  assert.match(log, /worker-snapshot=\{"id":"00000000-0000-4000-8000-000000000001","state":"completed","result":"review result","error":null\}/);
  assert.doesNotMatch(log, /chatgpt-shot (?:config|doctor|start|submit|jobs)/);
  const serviceRequests = (await readFile(fixtureValue.serviceRequests, 'utf8')).trim().split('\n').map(value => JSON.parse(value));
  assert.deepEqual(serviceRequests, [
    { method: 'POST', url: '/jobs', body: JSON.stringify({ prompt: 'worker review request' }) },
    { method: 'GET', url: '/jobs/00000000-0000-4000-8000-000000000001', body: '' }
  ]);
  assert.deepEqual(await snapshotOperatorState(fixtureValue), before);
});

test('fast worker reports a missing prepared Service without falling back or changing Operator state', async t => {
  const fixtureValue = await externalReadinessFixture(t);
  await makeOperatorStateReadOnly(fixtureValue);
  const before = await snapshotOperatorState(fixtureValue);
  const env = { ...fixtureValue.env, OPERATOR_TEST_USE_WORKER_INTERFACE: 'true' };

  await assert.rejects(
    execFile('sh', [bootstrap, '--skip-external-readiness', '--', fixtureValue.child, 'symphony'], { env }),
    error => /BROWSER_UNAVAILABLE: No prepared chatgpt-shot Service discovery/.test(String(error.stderr))
  );

  const log = await readFile(fixtureValue.log, 'utf8');
  assert.match(log, new RegExp(`selected=${fixtureValue.directory}/worker-interface/chatgpt-shot`));
  assert.doesNotMatch(log, /chatgpt-shot (?:config|doctor|start|submit|jobs)/);
  assert.deepEqual(await snapshotOperatorState(fixtureValue), before);
  await assert.rejects(stat(fixtureValue.discovery), error => error.code === 'ENOENT');
  await assert.rejects(readFile(fixtureValue.serviceRequests, 'utf8'), error => error.code === 'ENOENT');
});

test('nested E2E bootstrap permits a run-owned workspace inside the current repository when explicitly configured', async t => {
  const fixtureValue = await fixture(t);
  const nestedWorkspace = join(root, 'operator', 'e2e', `.operator-bootstrap-test-${process.pid}-${Date.now()}`);
  t.after(() => rm(nestedWorkspace, { recursive: true, force: true }));
  const env = environment(fixtureValue);
  env.SYMPHONY_WORKSPACE_ROOT = nestedWorkspace;
  env.SYMPHONY_ALLOW_WORKSPACE_ROOT_INSIDE_REPOSITORY = 'true';
  const result = await execFile('sh', [bootstrap, '--skip-external-readiness', '--', fixtureValue.child, 'nested'], { env });
  assert.match(result.stdout, /Review service checks were skipped by configuration/);
  assert.match(await readFile(fixtureValue.log, 'utf8'), /child nested/);
});
