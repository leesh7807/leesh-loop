export function workflowComparisonAfterApply(currentComparison, { selectionGate, selectionSnapshot, candidateDigest }) {
  if (!currentComparison || !selectionGate.isCurrent(selectionSnapshot)) return currentComparison;
  if (currentComparison.candidate_digest !== candidateDigest) return currentComparison;
  return { ...currentComparison, current: currentComparison.candidate, changed: false };
}
