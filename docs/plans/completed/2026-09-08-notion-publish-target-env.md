# 2026-09-08-notion-publish-target-env

## Objective

Separate the Notion publication target from publisher policy. The Notion location that receives published plans is an environment binding supplied through `.env`, while publisher configuration contains only behavior that may vary with Symphony execution policy.

## Definitions

### Publish target

The Notion page under which the publisher creates or reuses the task surface.

### Publisher policy

Configuration that controls how a published task is represented or initialized for the workflow, including state, priority, labels, surface name, plan source, and supported property-name overrides.

### Environment binding

A value that connects the publisher instance to its external Notion environment rather than defining workflow behavior.

## Decisions

Use `NOTION_TOKEN` and `NOTION_PUBLISH_TARGET_URL` as environment variables. `NOTION_PUBLISH_TARGET_URL` is the single authoritative source for the publish target.

Continue accepting a supported Notion page URL and preserve validation and conversion to the API page ID. Remove `parent_url` from publisher configuration. A configuration containing `parent_url` uses the old configuration contract and must fail rather than act as a fallback.

Preserve existing environment loading: process environment variables are authoritative, with `.env` in the process current directory as a local convenience source. Resolve and validate the publish target before any Notion mutation.

Do not move other publisher-policy values into `.env`, or otherwise alter Notion schema or publication semantics.

## Verification

Through the normal CLI, use `NOTION_TOKEN`, `NOTION_PUBLISH_TARGET_URL`, and a publisher configuration with no publish location. Verify a valid target publishes under that page; `parent_url` is rejected; policy and target can change independently; missing or invalid targets fail before a Notion mutation; documentation and examples match the CLI contract; and unrelated publication behavior remains passing.

## Verification Tools

Use the Notion publisher test suite for parsing, environment resolution, URL validation, no-mutation failure paths, and regression behavior. Use the CLI with process environment or current-directory `.env` for its normal path. When safe credentials and a target are available, use Notion API readback to confirm a representative CLI publication appears beneath the configured target.
