import assert from 'node:assert/strict';
import test from 'node:test';
import { identifyE2ERunOrigin } from '../model/run-origin.mjs';

test('worker-originated run records the repository workspace rather than the workspace pool root', () => {
  const result = identifyE2ERunOrigin({
    repositoryRoot: '/operator/workspaces/PLAN-123',
    environment: {
      SYMPHONY_WORKSPACE_ROOT: '/operator/workspaces',
      SYMPHONY_RUNTIME_ID: 'outer-runtime',
      SYMPHONY_ISSUE_IDENTIFIER: 'PLAN-123',
      SYMPHONY_EXECUTION_ID: 'execution-456'
    }
  });
  assert.equal(result.origin, 'worker-originated');
  assert.deepEqual(result.outer_execution_provenance, {
    operator_runtime_id: 'outer-runtime',
    issue_identifier: 'PLAN-123',
    execution_id: 'execution-456',
    workspace_root: '/operator/workspaces/PLAN-123'
  });
});

test('direct runs and repositories outside the configured worker workspace have no outer provenance', () => {
  assert.deepEqual(identifyE2ERunOrigin({ repositoryRoot: '/repository', environment: {} }), {
    origin: 'direct', outer_execution_provenance: null
  });
  assert.deepEqual(identifyE2ERunOrigin({ repositoryRoot: '/operator/workspaces-other/PLAN-123', environment: {
    SYMPHONY_WORKSPACE_ROOT: '/operator/workspaces'
  } }), { origin: 'direct', outer_execution_provenance: null });
  assert.deepEqual(identifyE2ERunOrigin({ repositoryRoot: '/operator/workspaces/PLAN-123', environment: {
    SYMPHONY_WORKSPACE_ROOT: '/operator/workspaces'
  } }), { origin: 'direct', outer_execution_provenance: null });
});
