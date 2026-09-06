# Notion plan publisher

This plan implements a deterministic, location-independent CLI that publishes one completed Markdown plan as one Notion coordination task. The Markdown remains immutable in the Plan section; Workpad is created as a distinct empty section. Configuration is explicit and typed, the Notion schema is policy-owned, duplicate publication is rejected, and bootstrap/publication failures are retryable.

Verification covers the Symphony tracker issue contract, injected policy behavior, configuration/path validation, schema bootstrap and compatibility, duplicate and partial-failure cleanup, rich-text chunking, and live publication against the configured test parent.
