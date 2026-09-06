from __future__ import annotations

import hashlib
import json
import os
import re
from dataclasses import dataclass, replace
from pathlib import Path
from urllib.parse import urlparse


class PublicationError(Exception):
    """An actionable publisher error."""


@dataclass(frozen=True)
class Policy:
    surface_name: str = "Symphony Tasks"
    identifier: str = "Identifier"
    title: str = "Title"
    state: str = "State"
    priority: str = "Priority"
    labels: str = "Labels"
    blocked_by: str = "Blocked By"
    description: str = "Description"
    source: str = "Plan Source"
    plan_heading: str = "Plan"
    workpad_heading: str = "Workpad"
    default_state: str = "Ready"
    default_priority: int | None = 3
    default_labels: tuple[str, ...] = ()
    bootstrap_states: tuple[str, ...] = ("Backlog", "Ready", "In Progress", "Blocked", "Done")


DEFAULT_POLICY = Policy()
CONFIG_KEYS = {"parent_url", "state", "priority", "labels", "plan_source", "surface_name", "property_names"}
OVERRIDABLE_PROPERTIES = {"identifier", "title", "state", "priority", "labels", "blocked_by", "description", "source"}


def resolve_path(value: str, base: str | Path | None = None) -> Path:
    path = Path(value).expanduser()
    return path if path.is_absolute() else (Path(base) if base else Path.cwd()) / path


def notion_id(value: str) -> str:
    parsed = urlparse(value)
    if parsed.scheme and (parsed.scheme not in ("http", "https") or not parsed.netloc):
        raise PublicationError("invalid target URL: expected an http(s) Notion page URL")
    if not parsed.scheme and not re.fullmatch(r"[0-9a-fA-F-]{32,36}", value):
        raise PublicationError("invalid target URL: expected a Notion page URL")
    raw = value if not parsed.scheme else parsed.path.rsplit("/", 1)[-1]
    compact = re.sub(r"[^0-9a-fA-F]", "", raw)
    if len(compact) != 32:
        raise PublicationError("invalid target URL: expected a Notion page URL containing a 32-character page id")
    return f"{compact[:8]}-{compact[8:12]}-{compact[12:16]}-{compact[16:20]}-{compact[20:]}"


def _yamlish(text: str) -> dict:
    """Parse the intentionally small YAML subset used by examples without a dependency."""
    result = {}
    for line_no, line in enumerate(text.splitlines(), 1):
        line = line.strip()
        if not line or line.startswith("#"): continue
        if ":" not in line: raise PublicationError(f"invalid configuration line {line_no}")
        key, value = line.split(":", 1); key = key.strip(); value = value.strip()
        if value.startswith("[") or value.startswith("{"):
            try: value = json.loads(value)
            except json.JSONDecodeError: raise PublicationError(f"invalid value for {key}")
        elif value.lower() in ("null", "~"): value = None
        elif value.lower() in ("true", "false"): value = value.lower() == "true"
        elif re.fullmatch(r"-?\d+", value): value = int(value)
        elif len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"": value = value[1:-1]
        result[key] = value
    return result


def load_config(path: str | Path, base: str | Path | None = None, policy: Policy = DEFAULT_POLICY) -> tuple[dict, Policy]:
    config_path = resolve_path(str(path), base)
    if not config_path.is_file(): raise PublicationError(f"missing configuration: {config_path}")
    try:
        raw = json.loads(config_path.read_text()) if config_path.suffix.lower() == ".json" else _yamlish(config_path.read_text())
    except json.JSONDecodeError as exc: raise PublicationError(f"invalid configuration: {exc}") from exc
    if not isinstance(raw, dict): raise PublicationError("configuration must be an object")
    unknown = set(raw) - CONFIG_KEYS
    if unknown: raise PublicationError(f"unknown configuration key(s): {', '.join(sorted(unknown))}")
    if "parent_url" not in raw: raise PublicationError("missing configuration: parent_url")
    if not isinstance(raw["parent_url"], str): raise PublicationError("parent_url must be a string URL")
    parent_id = notion_id(raw["parent_url"])
    if "state" in raw and (not isinstance(raw["state"], str) or not raw["state"].strip()): raise PublicationError("state must be a non-empty string")
    if "priority" in raw and raw["priority"] is not None and (not isinstance(raw["priority"], int) or isinstance(raw["priority"], bool) or raw["priority"] not in (1, 2, 3, 4, 5)): raise PublicationError("priority must be null or an integer from 1 to 5")
    if "labels" in raw and (not isinstance(raw["labels"], list) or not all(isinstance(x, str) for x in raw["labels"])): raise PublicationError("labels must be a list of strings")
    if "plan_source" in raw and not isinstance(raw["plan_source"], str): raise PublicationError("plan_source must be a string URL or path")
    if "surface_name" in raw and (not isinstance(raw["surface_name"], str) or not raw["surface_name"].strip()): raise PublicationError("surface_name must be a non-empty string")
    props = raw.get("property_names", {})
    if not isinstance(props, dict) or set(props) - OVERRIDABLE_PROPERTIES or not all(isinstance(v, str) and v.strip() for v in props.values()): raise PublicationError("property_names must map supported names to non-empty strings")
    resolved = replace(policy, default_state=raw.get("state", policy.default_state), default_priority=raw.get("priority", policy.default_priority), default_labels=tuple(dict.fromkeys(x.strip() for x in raw.get("labels", list(policy.default_labels)) if x.strip())), surface_name=raw.get("surface_name", policy.surface_name))
    for field, value in props.items(): resolved = replace(resolved, **{field: value})
    return {"parent_url": raw["parent_url"], "parent_id": parent_id, "plan_source": raw.get("plan_source")}, resolved


def derive_identifier(plan: str, artifact: str | Path) -> str:
    digest = hashlib.sha256(plan.encode("utf-8")).hexdigest()[:12].upper()
    return f"PLAN-{digest}"


def normalize_labels(labels: list[str] | tuple[str, ...]) -> list[str]:
    return list(dict.fromkeys(x.strip() for x in labels if x.strip()))


def build_task_properties(policy: Policy, identifier: str, title: str, source: str | None = None) -> dict:
    return {policy.identifier: {"rich_text": [{"text": {"content": identifier}}]}, policy.title: {"title": [{"text": {"content": title}}]}, policy.state: {"select": {"name": policy.default_state}}, policy.priority: {"number": policy.default_priority}, policy.labels: {"multi_select": [{"name": x} for x in normalize_labels(policy.default_labels)]}, policy.description: {"rich_text": [{"text": {"content": "Completed plan artifact; see Plan section."}}]}, policy.source: {"url": source if source and source.startswith(("http://", "https://")) else None}}


def chunk_text(text: str, limit: int = 1900) -> list[str]:
    return [text[i:i+limit] for i in range(0, len(text), limit)] or [""]


def build_page_blocks(policy: Policy, plan: str) -> list[dict]:
    blocks = [{"object": "block", "type": "heading_1", "heading_1": {"rich_text": [{"type": "text", "text": {"content": policy.plan_heading}}]}}]
    blocks += [{"object": "block", "type": "paragraph", "paragraph": {"rich_text": [{"type": "text", "text": {"content": part}}]}} for part in chunk_text(plan)]
    blocks.append({"object": "block", "type": "heading_1", "heading_1": {"rich_text": [{"type": "text", "text": {"content": policy.workpad_heading}}]}})
    return blocks
