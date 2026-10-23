import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { prepareNpmDependencies } from '../dependency-preparation.mjs';

const sourceRoot = resolve(import.meta.dirname, '../../..');

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-dependency-preparation-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const loopRoot = join(directory, 'loop');
  const uiDirectory = join(loopRoot, 'operator/ui');
  const storeDirectory = join(loopRoot, 'operator/local_task_store');
  await Promise.all([mkdir(uiDirectory, { recursive: true }), mkdir(storeDirectory, { recursive: true })]);
  for (const packageDirectory of [uiDirectory, storeDirectory]) {
    await writeFile(join(packageDirectory, 'package.json'), JSON.stringify({ name: packageDirectory, version: '1.0.0' }));
    await writeFile(join(packageDirectory, 'package-lock.json'), JSON.stringify({ name: packageDirectory, lockfileVersion: 3, packages: {} }));
  }
  await writeFile(join(loopRoot, 'package.json'), JSON.stringify({ name: 'test-loop', version: '1.0.0' }));
  await writeFile(join(loopRoot, 'package-lock.json'), JSON.stringify({ name: 'test-loop', lockfileVersion: 3, packages: {} }));

  const binDirectory = join(directory, 'bin');
  const installLog = join(directory, 'npm-ci.log');
  await mkdir(binDirectory);
  const fakeNpm = join(binDirectory, 'npm');
  await writeFile(fakeNpm, [
    '#!/bin/sh',
    'set -eu',
    '[ "$1" = "ci" ]',
    '[ "$2" = "--include=dev" ]',
    "printf '%s\\n' \"$PWD\" >> \"$TEST_NPM_INSTALL_LOG\"",
    'if [ -n "${TEST_NPM_DELAY:-}" ]; then sleep "$TEST_NPM_DELAY"; fi',
    'if [ "${TEST_NPM_FAIL:-0}" = "1" ]; then exit 17; fi',
    'case "$PWD" in',
    '  */operator/ui)',
    '    mkdir -p node_modules/.bin node_modules/react node_modules/react-dom',
    "    printf '{\"name\":\"vite\"}\\n' > node_modules/.bin/vite",
    "    printf '{\"name\":\"react\"}\\n' > node_modules/react/package.json",
    "    printf '{\"name\":\"react-dom\"}\\n' > node_modules/react-dom/package.json",
    '    ;;',
    '  */operator/local_task_store)',
    '    mkdir -p node_modules/better-sqlite3/build/Release',
    "    printf 'native binary fixture\\n' > node_modules/better-sqlite3/build/Release/better_sqlite3.node",
    '    ;;',
    '  */loop)',
    '    if grep -q "tiny-dep" package.json; then',
    '      mkdir -p node_modules/tiny-dep',
    "      printf '{\"name\":\"tiny-dep\"}\\n' > node_modules/tiny-dep/package.json",
    '    fi',
    '    ;;',
    '  *) exit 18 ;;',
    'esac',
    ''
  ].join('\n'));
  await chmod(fakeNpm, 0o755);
  const environment = {
    ...process.env,
    PATH: `${binDirectory}:${process.env.PATH}`,
    TEST_NPM_INSTALL_LOG: installLog
  };
  return { directory, loopRoot, uiDirectory, storeDirectory, installLog, environment };
}

async function installCount(path) {
  try { return (await readFile(path, 'utf8')).trim().split('\n').filter(Boolean).length; }
  catch (error) { if (error?.code === 'ENOENT') return 0; throw error; }
}

function recordPath(loopRoot, component) {
  return join(loopRoot, '.leesh-loop/dependency-preparation', `${component}.json`);
}

function runConcurrentPreparation(loopRoot, environment) {
  const moduleUrl = pathToFileURL(join(sourceRoot, 'operator/app/dependency-preparation.mjs')).href;
  const source = `import(${JSON.stringify(moduleUrl)}).then(({ prepareNpmDependencies }) => prepareNpmDependencies({ loopRoot: process.argv[1], component: 'local-task-store' })).catch(error => { console.error(error); process.exitCode = 1; });`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', source, loopRoot], {
    cwd: sourceRoot,
    env: environment,
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => { stderr += chunk; });
  return once(child, 'close').then(([code, signal]) => {
    if (code !== 0) throw new Error(`dependency preparation worker failed${signal ? ` (${signal})` : ` (exit code ${code})`}: ${stderr}`);
  });
}

test('component dependency fingerprints reuse valid installs and invalidate only the changed component', async t => {
  const target = await fixture(t);
  const productionEnvironment = { ...target.environment, NODE_ENV: 'production' };

  prepareNpmDependencies({ loopRoot: target.loopRoot, component: 'operator-ui', environment: productionEnvironment });
  assert.equal(await installCount(target.installLog), 1);
  prepareNpmDependencies({ loopRoot: target.loopRoot, component: 'operator-ui', environment: productionEnvironment });
  assert.equal(await installCount(target.installLog), 1, 'an unchanged recorded UI installation is reused');

  prepareNpmDependencies({ loopRoot: target.loopRoot, component: 'local-task-store', environment: target.environment });
  assert.equal(await installCount(target.installLog), 2);
  await writeFile(join(target.uiDirectory, 'package-lock.json'), JSON.stringify({ name: 'changed-ui', lockfileVersion: 3, packages: {} }));
  prepareNpmDependencies({ loopRoot: target.loopRoot, component: 'operator-ui', environment: productionEnvironment });
  assert.equal(await installCount(target.installLog), 3, 'a changed UI lockfile runs npm ci again');
  prepareNpmDependencies({ loopRoot: target.loopRoot, component: 'local-task-store', environment: target.environment });
  assert.equal(await installCount(target.installLog), 3, 'a UI change preserves the valid Local Task Store installation');

  await rm(join(target.uiDirectory, 'node_modules/.bin/vite'));
  prepareNpmDependencies({ loopRoot: target.loopRoot, component: 'operator-ui', environment: productionEnvironment });
  assert.equal(await installCount(target.installLog), 4, 'a missing required install file invalidates an otherwise matching record');
});

test('failed npm ci removes the old success record and a later retry recovers automatically', async t => {
  const target = await fixture(t);
  prepareNpmDependencies({ loopRoot: target.loopRoot, component: 'local-task-store', environment: target.environment });
  assert.equal(await installCount(target.installLog), 1);

  await writeFile(join(target.storeDirectory, 'package-lock.json'), JSON.stringify({ name: 'changed-store', lockfileVersion: 3, packages: {} }));
  await assert.rejects(
    Promise.resolve().then(() => prepareNpmDependencies({
      loopRoot: target.loopRoot,
      component: 'local-task-store',
      environment: { ...target.environment, TEST_NPM_FAIL: '1' }
    })),
    /Local Task Store dependency preparation failed/
  );
  await assert.rejects(readFile(recordPath(target.loopRoot, 'local-task-store')), { code: 'ENOENT' });

  prepareNpmDependencies({ loopRoot: target.loopRoot, component: 'local-task-store', environment: target.environment });
  assert.equal(await installCount(target.installLog), 3);
  assert.equal(JSON.parse(await readFile(recordPath(target.loopRoot, 'local-task-store'), 'utf8')).schemaVersion, 1);
});

test('generated Loop root uses its own package lock record', async t => {
  const target = await fixture(t);
  prepareNpmDependencies({ loopRoot: target.loopRoot, component: 'generated-loop', environment: target.environment });
  assert.equal(await installCount(target.installLog), 1);
  prepareNpmDependencies({ loopRoot: target.loopRoot, component: 'generated-loop', environment: target.environment });
  assert.equal(await installCount(target.installLog), 1, 'an unchanged root package installation is reused');

  await writeFile(join(target.loopRoot, 'package-lock.json'), JSON.stringify({ name: 'changed-loop', lockfileVersion: 3, packages: {} }));
  prepareNpmDependencies({ loopRoot: target.loopRoot, component: 'generated-loop', environment: target.environment });
  assert.equal(await installCount(target.installLog), 2, 'a changed root lockfile runs npm ci');

  await writeFile(join(target.loopRoot, 'package.json'), JSON.stringify({
    name: 'test-loop',
    version: '1.0.0',
    dependencies: { 'tiny-dep': '1.0.0' }
  }));
  await writeFile(join(target.loopRoot, 'package-lock.json'), JSON.stringify({ name: 'changed-loop', lockfileVersion: 3, packages: {} }));
  prepareNpmDependencies({ loopRoot: target.loopRoot, component: 'generated-loop', environment: target.environment });
  assert.equal(await installCount(target.installLog), 3, 'a root dependency change runs npm ci');

  await rm(join(target.loopRoot, 'node_modules/tiny-dep/package.json'));
  prepareNpmDependencies({ loopRoot: target.loopRoot, component: 'generated-loop', environment: target.environment });
  assert.equal(await installCount(target.installLog), 4, 'a missing direct root dependency file invalidates its record');
});

test('concurrent preparation of one component shares a lock and records only the completed install', async t => {
  const target = await fixture(t);
  const environment = { ...target.environment, TEST_NPM_DELAY: '0.2' };
  await Promise.all([
    runConcurrentPreparation(target.loopRoot, environment),
    runConcurrentPreparation(target.loopRoot, environment)
  ]);

  assert.equal(await installCount(target.installLog), 1);
  assert.equal(JSON.parse(await readFile(recordPath(target.loopRoot, 'local-task-store'), 'utf8')).component, 'local-task-store');
});
