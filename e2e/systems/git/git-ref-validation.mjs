export function assertBranch(branch) {
  if (typeof branch !== 'string' || !branch || branch.includes('..') || branch.startsWith('-') || branch.endsWith('/') || branch.includes('\\')) {
    throw new Error(`invalid run-scoped branch name: ${branch}`);
  }
  return branch;
}
