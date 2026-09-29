import { sha256 } from '../../model/plan-identity.mjs';

export class RunDoneVerifier {
  constructor({ runCompletionVerifier }) {
    this.runCompletionVerifier = runCompletionVerifier;
  }

  ensurePlanBinding(record, task) {
    if (record.artifacts.plan_binding) return record.artifacts.plan_binding;
    const acceptedPlan = record.workload?.accepted_plan ?? task.accepted_plan ?? '';
    record.artifacts.plan_binding = {
      task_id: task.id,
      publisher_plan_sha256: sha256(acceptedPlan),
      tracker_description_sha256: sha256(task.accepted_plan || ''),
      worker_input_sha256: null,
      status: 'published_and_tracker_readback'
    };
    return record.artifacts.plan_binding;
  }

  observeTrackerInput(record, task, snapshot) {
    const binding = this.ensurePlanBinding(record, task);
    const workerInput = snapshot?.symphony?.tracker_input;
    if (workerInput?.description === undefined) {
      return { observed: false, status: binding.status, reason: 'Done was observed without dispatch-bound production tracker input evidence' };
    }

    binding.worker_input_sha256 = sha256(workerInput.description || '');
    binding.status = workerInput.description === task.accepted_plan
      ? 'verified_by_production_tracker_input'
      : 'mismatch';
    return {
      observed: true,
      status: binding.status,
      reason: binding.status === 'mismatch'
        ? 'production Tracker.Issue.description does not match the Publisher Accepted Plan'
        : null
    };
  }

  async verifyDoneDelivery({ record, task, snapshot, baseBranch }) {
    const binding = this.observeTrackerInput(record, task, snapshot);
    if (!binding.observed || binding.status !== 'verified_by_production_tracker_input') {
      return {
        ok: false,
        phase: 'plan_binding',
        reason: binding.reason
      };
    }

    if (Array.isArray(snapshot?.github?.delivery_prs)) record.artifacts.delivery_prs = snapshot.github.delivery_prs;
    const verification = await this.runCompletionVerifier.verifyDoneDelivery(record, baseBranch);
    if (!verification.ok) return { ...verification, phase: 'done_verification' };

    record.artifacts.merged_head = verification.delivered_head;
    record.artifacts.remote_base_commit = verification.remote_base_commit;
    return verification;
  }
}
