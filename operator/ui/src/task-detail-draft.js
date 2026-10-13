export function readTaskDetailDraft(task) {
  return {
    state: task.state,
    blockedBy: [...task.blockedBy]
  };
}
