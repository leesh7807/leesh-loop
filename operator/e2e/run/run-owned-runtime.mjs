export function recordedRunRuntimeId(record) {
  if (record.runtime?.runtime_id) return record.runtime.runtime_id;
  for (const snapshot of [...(record.evidence?.snapshots || [])].reverse()) {
    const runtimeId = snapshot.symphony?.runtime?.runtime_id;
    if (runtimeId) return runtimeId;
  }
  return null;
}

export async function readRunOwnedRuntime(record, operatorClient, signal) {
  const runtimeId = recordedRunRuntimeId(record);
  const dashboard = record.runtime?.dashboard || null;
  if (!dashboard || typeof operatorClient?.readSymphonyRuntimeStatus !== 'function') {
    return { status: 'unconfirmed', runtime_id: runtimeId, dashboard, error: 'recorded run-owned runtime identity or dashboard readback is unavailable' };
  }

  let observed;
  try {
    observed = await operatorClient.readSymphonyRuntimeStatus(dashboard, signal);
  } catch (error) {
    if (error?.cause?.code === 'ECONNREFUSED') {
      return { status: 'absent', runtime_id: runtimeId, dashboard, reason: 'runtime dashboard refused the connection' };
    }
    return { status: 'unconfirmed', runtime_id: runtimeId, dashboard, error: String(error?.message || error) };
  }

  if (typeof observed?.runtime_id !== 'string' || !observed.runtime_id) {
    return { status: 'unconfirmed', runtime_id: runtimeId, dashboard, error: 'runtime status did not include a runtime identity' };
  }
  if (!runtimeId) {
    return { status: 'unconfirmed', runtime_id: null, dashboard, observed, error: 'recorded run-owned runtime identity is unavailable' };
  }
  if (observed.runtime_id !== runtimeId) {
    return { status: 'absent', runtime_id: runtimeId, dashboard, observed_runtime_id: observed?.runtime_id || null };
  }
  return { status: 'present', runtime_id: runtimeId, dashboard, observed };
}
