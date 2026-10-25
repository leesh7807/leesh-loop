export function runtimeUpdateCompletionMessage(result, managerRuntimeVersion) {
  if (!result.changed) {
    return `Runtime is already up to date at version ${result.active?.version || 'unknown'}. No running Loop or Workflow was changed.`;
  }

  const recoveryNote = result.recovered_from_invalid_active
    ? ' The previous active Runtime could not be validated; the validated source Runtime is now active.'
    : '';
  if (result.manager_restart_required) {
    return `Installed Runtime ${result.active?.version || ''} for future Loop starts. The Manager still uses Runtime ${managerRuntimeVersion}; run leesh-loop to reopen it. Running Loops and Workflow files were not changed.${recoveryNote}`;
  }
  return `Installed Runtime ${result.active?.version || ''} for future Loop starts. Running Loops and Workflow files were not changed.${recoveryNote}`;
}
