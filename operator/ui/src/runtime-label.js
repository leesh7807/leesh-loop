export function runtimeLabel(runtimeId, distributions = []) {
  if (typeof runtimeId !== 'string' || !runtimeId) return '—';
  const version = distributions.find(distribution => distribution.id === runtimeId)?.version;
  const identity = runtimeId.slice(0, 12);
  return version ? `${version} · ${identity}` : identity;
}
