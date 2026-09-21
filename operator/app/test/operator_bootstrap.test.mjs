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
  t.after(() => rm(directory, { recursive: true, force: true }));
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
  return { directory, bin, log, workspace, blocked, status, child };
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

test('default bootstrap still requires external readiness before child startup', async t => {
  const fixtureValue = await fixture(t);
  await assert.rejects(
    execFile('sh', [bootstrap, '--', fixtureValue.child], { env: environment(fixtureValue) }),
    error => /chatgpt-shot is not installed/.test(String(error.stderr))
  );
  await assert.rejects(readFile(fixtureValue.log, 'utf8'), /./);
});
