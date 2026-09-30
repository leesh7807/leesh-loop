import assert from 'node:assert/strict';
import { execFile as execute } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
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
printf 'child %s\\n' "$*" >> "$OPERATOR_TEST_LOG"
printf 'discovery=%s\\n' "\${CHATGPT_SHOT_WORKER_DISCOVERY_PATH-}" >> "$OPERATOR_TEST_LOG"
printf 'readiness=%s\\n' "\${SYMPHONY_OPERATOR_READINESS_FILE-}" >> "$OPERATOR_TEST_LOG"
printf 'interface=%s\\n' "\${CHATGPT_SHOT_WORKER_INTERFACE_ROOT-}" >> "$OPERATOR_TEST_LOG"
`);
  t.after(async () => {
    try {
      const pid = Number(await readFile(join(directory, 'external', 'health-server.pid'), 'utf8'));
      if (Number.isInteger(pid) && pid > 0) process.kill(pid, 'SIGTERM');
    } catch {
      // Readiness-failure fixtures do not launch the local health server.
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
  await Promise.all([
    mkdir(join(configHome, 'chatgpt-shot'), { recursive: true }),
    mkdir(join(dataHome, 'chatgpt-shot'), { recursive: true }),
    mkdir(join(cacheHome, 'chatgpt-shot'), { recursive: true })
  ]);
  await writeFile(serverScript, `import fs from 'node:fs';
import http from 'node:http';

const discoveryPath = process.argv[2];
const server = http.createServer((request, response) => {
  const record = JSON.parse(fs.readFileSync(discoveryPath, 'utf8'));
  response.writeHead(request.url === '/health' && request.headers.authorization === 'Bearer fixture-token' ? 200 : 403, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ pid: record.pid, protocolVersion: 1, accepting: true }));
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
      node "$OPERATOR_TEST_HEALTH_SERVER" "$XDG_CACHE_HOME/chatgpt-shot/runtime.json" >/dev/null 2>&1 &
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
  env.CHATGPT_SHOT_START_MODE = startMode;
  return { ...fixtureValue, env, discovery };
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
    SYMPHONY_OPERATOR_STARTUP_STATUS_FILE: fixture.status
  };
  delete env.CHATGPT_SHOT_WORKER_DISCOVERY_PATH;
  delete env.SYMPHONY_OPERATOR_READINESS_FILE;
  delete env.CHATGPT_SHOT_WORKER_INTERFACE_ROOT;
  return env;
}

test('skip external readiness reaches the child without reading or preparing external state', async t => {
  const fixtureValue = await fixture(t);
  const result = await execFile('sh', [bootstrap, '--skip-external-readiness', '--', fixtureValue.child, 'symphony'], { env: environment(fixtureValue) });
  assert.match(result.stdout, /external-readiness=skipped/);
  const log = await readFile(fixtureValue.log, 'utf8');
  assert.match(log, /git /);
  assert.match(log, /gh /);
  assert.match(log, /curl /);
  assert.match(log, /child symphony/);
  assert.match(log, /discovery=\n/);
  assert.match(log, /readiness=\n/);
  assert.match(log, /interface=\n/);
  assert.equal((await stat(fixtureValue.blocked)).isFile(), true);
  await assert.rejects(stat(join(fixtureValue.blocked, 'chatgpt-shot')), /ENOTDIR/);
  assert.equal(await readFile(fixtureValue.status, 'utf8'), 'starting Symphony process\n');
});

test('GitHub SSH upstreams use SSH Git authentication while preserving the Operator readiness path', async t => {
  const fixtureValue = await fixture(t);
  const env = environment(fixtureValue);
  env.SYMPHONY_GITHUB_REPOSITORY_URL = 'git@github.com:example/repository.git';
  const result = await execFile('sh', [bootstrap, '--skip-external-readiness', '--', fixtureValue.child, 'symphony'], { env });
  assert.match(result.stdout, /Operator core readiness passed/);
  const log = await readFile(fixtureValue.log, 'utf8');
  assert.match(log, /ls-remote git@github\.com:example\/repository\.git HEAD/);
  assert.doesNotMatch(log, /credential fill/);
  assert.match(log, /child symphony/);
});

test('external readiness remains required unless explicitly skipped', async t => {
  const fixtureValue = await fixture(t);
  await assert.rejects(
    execFile('sh', [bootstrap, '--', fixtureValue.child], { env: environment(fixtureValue) }),
    error => /chatgpt-shot is not installed/.test(String(error.stderr))
  );
  await assert.rejects(readFile(fixtureValue.log, 'utf8'), /./);
});

test('failed Service readiness uses public startup, preserves discovery, and fails before worker dispatch', async t => {
  const fixtureValue = await externalReadinessFixture(t, 'stale');
  const staleDiscovery = '{"host":"127.0.0.1","port":0,"pid":123,"credential":"stale"}\n';
  await writeFile(fixtureValue.discovery, staleDiscovery);

  await assert.rejects(
    execFile('sh', [bootstrap, '--', fixtureValue.child], { env: fixtureValue.env }),
    error => /chatgpt-shot Service is not healthy and accepting requests/.test(String(error.stderr))
  );

  assert.equal(await readFile(fixtureValue.discovery, 'utf8'), staleDiscovery);
  const log = await readFile(fixtureValue.log, 'utf8');
  assert.match(log, /chatgpt-shot start/);
  assert.doesNotMatch(log, /chatgpt-shot stop/);
  assert.doesNotMatch(log, /chatgpt-shot submit/);
  assert.doesNotMatch(log, /chatgpt-shot jobs/);
  assert.doesNotMatch(log, /child /);
});

test('public startup, Service readiness, smoke Job, and worker dispatch continue on success', async t => {
  const fixtureValue = await externalReadinessFixture(t);
  const result = await execFile('sh', [bootstrap, '--', fixtureValue.child, 'symphony'], { env: fixtureValue.env });

  assert.match(result.stdout, /Operator readiness passed/);
  const log = await readFile(fixtureValue.log, 'utf8');
  assert.match(log, /chatgpt-shot start/);
  assert.match(log, /chatgpt-shot submit Operator readiness smoke check/);
  assert.match(log, /chatgpt-shot jobs 00000000-0000-4000-8000-000000000001/);
  assert.match(log, /child symphony/);
  assert.doesNotMatch(log, /chatgpt-shot stop/);
  assert.match(await readFile(fixtureValue.discovery, 'utf8'), /"credential":"fixture-token"/);
});

test('nested E2E bootstrap permits a run-owned workspace inside the current repository when explicitly configured', async t => {
  const fixtureValue = await fixture(t);
  const nestedWorkspace = join(root, 'operator', 'e2e', `.operator-bootstrap-test-${process.pid}-${Date.now()}`);
  t.after(() => rm(nestedWorkspace, { recursive: true, force: true }));
  const env = environment(fixtureValue);
  env.SYMPHONY_WORKSPACE_ROOT = nestedWorkspace;
  env.SYMPHONY_ALLOW_WORKSPACE_ROOT_INSIDE_REPOSITORY = 'true';
  const result = await execFile('sh', [bootstrap, '--skip-external-readiness', '--', fixtureValue.child, 'nested'], { env });
  assert.match(result.stdout, /external-readiness=skipped/);
  assert.match(await readFile(fixtureValue.log, 'utf8'), /child nested/);
});
