export function normalizeRef(ref) {
  if (typeof ref !== 'string' || !/^refs\/heads\/[A-Za-z0-9._/-]+$/.test(ref) || ref.includes('..')) {
    throw new Error(`seed_source_ref must be a safe remote branch ref: ${ref}`);
  }
  return ref;
}

export function assertBranch(branch) {
  if (typeof branch !== 'string' || !branch || branch.includes('..') || branch.startsWith('-') || branch.endsWith('/') || branch.includes('\\')) {
    throw new Error(`invalid run-scoped branch name: ${branch}`);
  }
  return branch;
}
