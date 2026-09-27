// Shared production Project defaults. Bootstrap writes these values into a
// generated Project, while the Operator uses the same values when a Project
// leaves an optional setting out.
export const PROJECT_DEFAULTS = Object.freeze({
  symphony_port: 4100,
  ui_port: 4310,
  startup_timeout_ms: 30 * 60_000,
  browser_acknowledgement_timeout_ms: 1_000,
  skip_external_readiness: false
});
