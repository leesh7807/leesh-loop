import { isAbsolute, relative, resolve, sep } from 'node:path';

export function identifyE2ERunOrigin({ repositoryRoot, environment = process.env } = {}) {
  const configuredWorkspaceRoot = environment.SYMPHONY_WORKSPACE_ROOT;
  if (typeof configuredWorkspaceRoot !== 'string' || !configuredWorkspaceRoot.trim()) {
    return { origin: 'direct', outer_execution_provenance: null };
  }

  const workspaceRoot = resolve(repositoryRoot);
  const workspacePoolRoot = resolve(configuredWorkspaceRoot);
  const suffix = relative(workspacePoolRoot, workspaceRoot);
  const belongsToWorker = suffix === '' || (suffix !== '..' && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix));
  const runtimeId = environment.SYMPHONY_RUNTIME_ID?.trim();
  if (!belongsToWorker || !runtimeId) return { origin: 'direct', outer_execution_provenance: null };

  return {
    origin: 'worker-originated',
    outer_execution_provenance: {
      operator_runtime_id: runtimeId,
      issue_identifier: environment.SYMPHONY_ISSUE_IDENTIFIER || null,
      execution_id: environment.SYMPHONY_EXECUTION_ID || null,
      workspace_root: workspaceRoot
    }
  };
}
