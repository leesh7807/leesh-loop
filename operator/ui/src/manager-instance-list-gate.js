export function createManagerInstanceListGate() {
  let requestSequence = 0;
  let mutationGeneration = 0;
  let appliedSequence = 0;

  return {
    begin() {
      requestSequence += 1;
      return { requestSequence, mutationGeneration };
    },
    invalidate() {
      mutationGeneration += 1;
      appliedSequence = requestSequence;
    },
    accept(request) {
      if (request?.mutationGeneration !== mutationGeneration || request.requestSequence <= appliedSequence) return false;
      appliedSequence = request.requestSequence;
      return true;
    }
  };
}
