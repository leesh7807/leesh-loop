from __future__ import annotations
import argparse, json, os, sys
from pathlib import Path
from .core import PublicationError, build_page_blocks, build_task_properties, derive_identifier, load_config
from .notion import NotionClient

def main(argv=None):
    p = argparse.ArgumentParser(description="Publish one completed plan artifact to Notion")
    p.add_argument("--plan", required=True); p.add_argument("--config", required=True); p.add_argument("--source-base")
    args = p.parse_args(argv)
    try:
        if not os.environ.get("NOTION_TOKEN"):
            env = Path.cwd() / ".env"
            if env.is_file():
                for line in env.read_text().splitlines():
                    if line.startswith("NOTION_TOKEN="): os.environ["NOTION_TOKEN"] = line.split("=", 1)[1].strip().strip("'\"")
        if not os.environ.get("NOTION_TOKEN"): raise PublicationError("missing NOTION_TOKEN")
        plan_path = Path(args.plan).expanduser().resolve(); plan = plan_path.read_text(encoding="utf-8")
        config, policy = load_config(args.config, args.source_base)
        client = NotionClient(os.environ["NOTION_TOKEN"])
        ds = client.ensure_surface(config["parent_id"], policy)
        identifier = derive_identifier(plan, plan_path)
        if client.duplicate(ds, policy, identifier): raise PublicationError(f"duplicate publication: {identifier} already exists")
        title = next((x[1:].strip() for x in plan.splitlines() if x.startswith("# ")), plan_path.stem)
        page = client.create_task(ds, build_task_properties(policy, identifier, title, config.get("plan_source")), identifier)
        try: client.append_blocks(page["id"], build_page_blocks(policy, plan))
        except Exception:
            client.archive(page["id"])
            raise PublicationError("provider/API failure while publishing Plan; incomplete task was cleaned up")
        print(json.dumps({"identifier": identifier, "page_id": page["id"], "url": page.get("url")}, ensure_ascii=False))
        return 0
    except PublicationError as exc: print(f"publisher error: {exc}", file=sys.stderr); return 2
    except Exception as exc: print(f"provider/API failure: {exc}", file=sys.stderr); return 3

if __name__ == "__main__": raise SystemExit(main())
