// Shared production Project defaults used by both generated Projects and the
// Operator's runtime fallbacks.
export const PROJECT_DEFAULTS = Object.freeze({
  symphony_port: 4100,
  ui_port: 4310,
  startup_timeout_ms: 30 * 60_000,
  browser_acknowledgement_timeout_ms: 1_000
});
