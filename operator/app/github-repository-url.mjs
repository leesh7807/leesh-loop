#!/usr/bin/env node

export function githubRepositoryTransport(remoteUrl) {
  if (typeof remoteUrl !== 'string' || !remoteUrl || /[\r\n\0]/.test(remoteUrl)) {
    throw new Error('the configured Git upstream has no usable remote URL');
  }
  if (remoteUrl.startsWith('https://')) {
    let parsed;
    try { parsed = new URL(remoteUrl); } catch { throw new Error('the configured Git upstream remote URL is invalid'); }
    if (parsed.hostname !== 'github.com') throw new Error('the existing Operator Project contract requires a GitHub repository upstream URL');
    if (parsed.username || parsed.password) throw new Error('the configured upstream URL contains credentials; remove them before running init');
    if (parsed.search || parsed.hash || parsed.pathname.split('/').filter(Boolean).length < 2) {
      throw new Error('the configured Git upstream URL does not identify a GitHub repository');
    }
    return 'https';
  }
  if (/^git@github\.com:[^/\s]+\/[^/\s]+$/.test(remoteUrl)) return 'ssh';
  if (/^ssh:\/\/git@github\.com\/[^/\s]+\/[^/\s]+$/.test(remoteUrl)) return 'ssh';
  throw new Error('the existing Operator Project contract requires an HTTPS or SSH GitHub upstream URL');
}

if (process.argv[1] && new URL(`file://${process.argv[1]}`).pathname === new URL(import.meta.url).pathname) {
  try {
    process.stdout.write(`${githubRepositoryTransport(process.argv[2])}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
