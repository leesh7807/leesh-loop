export function createManagerSelectionGate(initialInstanceId = '') {
  let instanceId = initialInstanceId;
  let generation = 0;

  return {
    get instanceId() { return instanceId; },
    select(nextInstanceId) {
      if (nextInstanceId !== instanceId) {
        instanceId = nextInstanceId;
        generation += 1;
      }
    },
    capture() {
      return { instanceId, generation };
    },
    isCurrent(snapshot) {
      return snapshot?.instanceId === instanceId && snapshot?.generation === generation;
    }
  };
}
