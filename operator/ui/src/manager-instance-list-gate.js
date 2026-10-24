export function createManagerInstanceListGate() {
  let revision = 0;

  return {
    begin() {
      revision += 1;
      return revision;
    },
    invalidate() {
      revision += 1;
    },
    isCurrent(requestRevision) {
      return requestRevision === revision;
    }
  };
}
