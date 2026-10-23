import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, utimes, writeFile } from 'node:fs/promises';
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
  await symlink(process.execPath, join(binDirectory, 'node'));
  const fakeNpm = join(binDirectory, 'npm');
  await writeFile(fakeNpm, [
    '#!/usr/bin/env node',
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    "if (process.argv[2] !== 'ci' || process.argv[3] !== '--include=dev') process.exit(19);",
    "fs.appendFileSync(process.env.TEST_NPM_INSTALL_LOG, `${process.cwd()}\\n`);",
    "if (process.env.TEST_NPM_DELAY) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(process.env.TEST_NPM_DELAY));",
    "if (process.env.TEST_NPM_FAIL === '1') process.exit(17);",
    "const write = (file, contents) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, contents); };",
    "if (process.cwd().endsWith('/operator/ui')) {",
    "  write('node_modules/.bin/vite', '{\"name\":\"vite\"}\\n');",
    "  write('node_modules/react/package.json', '{\"name\":\"react\"}\\n');",
    "  write('node_modules/react-dom/package.json', '{\"name\":\"react-dom\"}\\n');",
    "} else if (process.cwd().endsWith('/operator/local_task_store')) {",
    "  write('node_modules/better-sqlite3/build/Release/better_sqlite3.node', 'native binary fixture\\n');",
    "} else if (process.cwd().endsWith('/loop')) {",
    "  if (fs.readFileSync('package.json', 'utf8').includes('tiny-dep')) write('node_modules/tiny-dep/package.json', '{\"name\":\"tiny-dep\"}\\n');",
    "} else process.exit(18);",
    ''
  ].join('\n'));
  await chmod(fakeNpm, 0o755);
  const environment = {
    ...process.env,
    PATH: `${binDirectory}:${process.env.PATH}`,
    TEST_NPM_INSTALL_LOG: installLog
  };
  return { directory, loopRoot, uiDirectory, storeDirectory, installLog, binDirectory, environment };
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
  const environment = { ...target.environment, PATH: target.binDirectory };
  prepareNpmDependencies({ loopRoot: target.loopRoot, component: 'local-task-store', environment });
  assert.equal(await installCount(target.installLog), 1);

  await writeFile(join(target.storeDirectory, 'package-lock.json'), JSON.stringify({ name: 'changed-store', lockfileVersion: 3, packages: {} }));
  await assert.rejects(
    Promise.resolve().then(() => prepareNpmDependencies({
      loopRoot: target.loopRoot,
      component: 'local-task-store',
      environment: { ...environment, TEST_NPM_FAIL: '1' }
    })),
    /Local Task Store dependency preparation failed: npm ci failed \(exit code 17\)/
  );
  await assert.rejects(readFile(recordPath(target.loopRoot, 'local-task-store')), { code: 'ENOENT' });

  prepareNpmDependencies({ loopRoot: target.loopRoot, component: 'local-task-store', environment });
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
  const environment = { ...target.environment, TEST_NPM_DELAY: '200' };
  await Promise.all([
    runConcurrentPreparation(target.loopRoot, environment),
    runConcurrentPreparation(target.loopRoot, environment)
  ]);

  assert.equal(await installCount(target.installLog), 1);
  assert.equal(JSON.parse(await readFile(recordPath(target.loopRoot, 'local-task-store'), 'utf8')).component, 'local-task-store');
});

test('portable lock recovery serializes concurrent preparations without flock and reclaims an abandoned owner', async t => {
  const target = await fixture(t);
  const environment = { ...target.environment, PATH: target.binDirectory, TEST_NPM_DELAY: '200' };
  const portableLockPath = join(target.loopRoot, '.leesh-loop/dependency-preparation/local-task-store.portable-lock');
  await mkdir(portableLockPath, { recursive: true });
  await writeFile(join(portableLockPath, 'owner.json'), JSON.stringify({ pid: 999999999, processStartIdentity: null, token: 'abandoned' }));

  await Promise.all([
    runConcurrentPreparation(target.loopRoot, environment),
    runConcurrentPreparation(target.loopRoot, environment)
  ]);

  assert.equal(await installCount(target.installLog), 1);
  assert.equal(JSON.parse(await readFile(recordPath(target.loopRoot, 'local-task-store'), 'utf8')).component, 'local-task-store');

  await rm(recordPath(target.loopRoot, 'local-task-store'));
  await writeFile(join(target.storeDirectory, 'package-lock.json'), JSON.stringify({ name: 'changed-store', lockfileVersion: 3, packages: {} }));
  await rm(portableLockPath, { recursive: true, force: true });
  await mkdir(portableLockPath);
  const oldTime = new Date(Date.now() - 60_000);
  await utimes(portableLockPath, oldTime, oldTime);
  await runConcurrentPreparation(target.loopRoot, environment);
  assert.equal(await installCount(target.installLog), 2, 'an interrupted lock acquisition without owner metadata is reclaimed safely');

  await rm(recordPath(target.loopRoot, 'local-task-store'));
  await writeFile(join(target.storeDirectory, 'package-lock.json'), JSON.stringify({ name: 'reused-pid-store', lockfileVersion: 3, packages: {} }));
  await mkdir(portableLockPath);
  await writeFile(join(portableLockPath, 'owner.json'), JSON.stringify({
    pid: process.pid,
    processStartIdentity: process.platform === 'linux' ? 'proc:prior-incarnation' : 'ps:prior-incarnation',
    token: 'reused-pid'
  }));
  await runConcurrentPreparation(target.loopRoot, environment);
  assert.equal(await installCount(target.installLog), 3, 'a reused PID does not keep an abandoned portable lock alive');
});
