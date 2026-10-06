#!/usr/bin/env node

function decodeRepositoryPart(value) {
  try { return decodeURIComponent(value); }
  catch { throw new Error('the configured Git upstream URL does not identify a GitHub repository'); }
}

export function githubRepositoryDetails(remoteUrl) {
  if (typeof remoteUrl !== 'string' || !remoteUrl || /[\r\n\0]/.test(remoteUrl)) {
    throw new Error('the configured Git upstream has no usable remote URL');
  }
  let transport;
  let owner;
  let repository;
  if (remoteUrl.startsWith('https://')) {
    let parsed;
    try { parsed = new URL(remoteUrl); } catch { throw new Error('the configured Git upstream remote URL is invalid'); }
    if (parsed.hostname !== 'github.com') throw new Error('the existing Operator Project contract requires a GitHub repository upstream URL');
    if (parsed.username || parsed.password) throw new Error('the configured upstream URL contains credentials; remove them before running init');
    const path = parsed.pathname.split('/').filter(Boolean);
    if (parsed.search || parsed.hash || path.length !== 2) {
      throw new Error('the configured Git upstream URL does not identify a GitHub repository');
    }
    [owner, repository] = path.map(decodeRepositoryPart);
    transport = 'https';
  } else {
    let match = /^git@github\.com:([^/\s]+)\/([^/\s]+)$/.exec(remoteUrl);
    if (!match) match = /^ssh:\/\/git@github\.com\/([^/\s]+)\/([^/\s]+)$/.exec(remoteUrl);
    if (!match) throw new Error('the existing Operator Project contract requires an HTTPS or SSH GitHub upstream URL');
    [, owner, repository] = match;
    transport = 'ssh';
  }

  if (!/^[A-Za-z0-9._-]+$/.test(owner) || !/^[A-Za-z0-9._-]+$/.test(repository)) {
    throw new Error('the configured Git upstream URL does not identify a GitHub repository');
  }
  repository = repository.endsWith('.git') ? repository.slice(0, -4) : repository;
  if (!repository) throw new Error('the configured Git upstream URL does not identify a GitHub repository');
  const identity = `${owner}/${repository}`;
  const browserRepositoryUrl = `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`;
  return {
    transport,
    owner,
    repository,
    identity,
    name: repository,
    browserRepositoryUrl
  };
}

export function githubRepositoryTransport(remoteUrl) {
  return githubRepositoryDetails(remoteUrl).transport;
}

if (process.argv[1] && new URL(`file://${process.argv[1]}`).pathname === new URL(import.meta.url).pathname) {
  try {
    process.stdout.write(`${githubRepositoryTransport(process.argv[2])}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
