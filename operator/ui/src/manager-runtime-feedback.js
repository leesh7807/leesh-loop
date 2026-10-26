export function runtimeUpdateCompletionMessage(result, managerRuntimeVersion) {
  if (!result.changed) {
    if (result.manager_restart_required) {
      return `Runtime is already up to date at version ${result.active?.version || 'unknown'}, but Manager still requires a restart to load it. Run leesh-loop to reopen Manager. No running Loop or Workflow was changed.`;
    }
    return `Runtime is already up to date at version ${result.active?.version || 'unknown'}. No running Loop or Workflow was changed.`;
  }

  const recoveryDetails = result.recovered_from_invalid_active
    ? [
        'The previous active Runtime could not be validated; the validated source Runtime is now active.',
        result.active_runtime_error ? `Validation detail: ${result.active_runtime_error}` : '',
        result.preserved_runtime_path ? `Damaged Runtime preserved at ${result.preserved_runtime_path}.` : ''
      ].filter(Boolean).join(' ')
    : '';
  const recoveryNote = recoveryDetails ? ` ${recoveryDetails}` : '';
  if (result.manager_restart_required) {
    if (result.repaired_distribution && managerRuntimeVersion === result.active?.id) {
      return `Repaired Runtime ${result.active?.version || ''} for future Loop starts. Reopen Manager with leesh-loop to load the repaired Runtime. Running Loops and Workflow files were not changed.${recoveryNote}`;
    }
    return `Installed Runtime ${result.active?.version || ''} for future Loop starts. The Manager still uses Runtime ${managerRuntimeVersion}; run leesh-loop to reopen it. Running Loops and Workflow files were not changed.${recoveryNote}`;
  }
  return `Installed Runtime ${result.active?.version || ''} for future Loop starts. Running Loops and Workflow files were not changed.${recoveryNote}`;
}
