import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname } from 'node:path';

const defaultPollMs = 25;

function acquireKernelLock(lockPath) {
  return new Promise((resolve, reject) => {
    const child = spawn('flock', ['-n', lockPath, '/bin/sh', '-c', 'printf ready; IFS= read -r _'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let ready = false;
    let settled = false;
    let output = '';
    const fail = error => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    child.on('error', fail);
    child.stdout.on('data', chunk => {
      output += chunk.toString();
      if (!ready && output.includes('ready')) {
        ready = true;
        settled = true;
        resolve(child);
      }
    });
    child.on('exit', (code, signal) => {
      if (ready || settled) return;
      settled = true;
      if (code === 1 && signal === null) resolve(null);
      else reject(new Error(`flock exited before acquisition (code=${code}, signal=${signal || 'none'})`));
    });
  });
}

async function releaseKernelLock(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise(resolve => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    child.once('exit', finish);
    child.once('error', finish);
    child.stdin.end('\n');
    setTimeout(() => {
      if (!settled) child.kill('SIGTERM');
      finish();
    }, 1_000).unref();
  });
}

export async function acquireFileLock(lockPath, { waitMs = 30_000, pollMs = defaultPollMs, label = lockPath } = {}) {
  const started = Date.now();
  await mkdir(dirname(lockPath), { recursive: true, mode: 0o700 });
  while (true) {
    const child = await acquireKernelLock(lockPath);
    if (child) return () => releaseKernelLock(child);
    if (Date.now() - started >= waitMs) throw new Error(`timed out waiting for ${label}: ${lockPath}`);
    await new Promise(resolve => setTimeout(resolve, pollMs));
  }
}
