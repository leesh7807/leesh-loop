from __future__ import annotations
import json, urllib.error, urllib.request
from .core import Policy, PublicationError

class NotionClient:
    version = "2025-09-03"
    ownership_marker = "Publisher-owned Symphony coordination surface v1"
    def __init__(self, token, opener=urllib.request.urlopen): self.token, self.opener = token, opener
    def request(self, method, path, body=None):
        req = urllib.request.Request("https://api.notion.com/v1" + path, method=method, headers={"Authorization": "Bearer " + self.token, "Notion-Version": self.version, "Content-Type": "application/json"}, data=json.dumps(body).encode() if body is not None else None)
        try:
            with self.opener(req) as response: return json.loads(response.read())
        except urllib.error.HTTPError as exc:
            if exc.code == 401: raise PublicationError("authentication failure: NOTION_TOKEN was rejected")
            if exc.code in (403, 404): raise PublicationError("target inaccessible to the integration: share the parent page and grant insert/read access")
            detail = exc.read().decode(errors="replace")
            raise PublicationError(f"provider/API failure ({exc.code}): {detail[:300]}")
    def ensure_surface(self, parent_id: str, policy: Policy):
        cursor = None
        while True:
            suffix = "&start_cursor=" + cursor if cursor else ""
            page = self.request("GET", f"/blocks/{parent_id}/children?page_size=100{suffix}")
            for block in page.get("results", []):
                if block.get("type") == "child_database" and block.get("child_database", {}).get("title") == policy.surface_name:
                    db = self.request("GET", f"/databases/{block['id']}")
                    description = " ".join(x.get("plain_text", "") for x in db.get("description", []))
                    if self.ownership_marker not in description:
                        raise PublicationError("incompatible schema: a same-named database exists but is not publisher-owned")
                    dsid = db.get("data_sources", [{}])[0].get("id")
                    if not dsid: raise PublicationError("incompatible schema: coordination surface has no data source")
                    schema = self.request("GET", f"/data_sources/{dsid}")
                    try: self.check_schema(schema, policy, dsid)
                    except PublicationError: self.complete_bootstrap(schema, dsid, policy)
                    return dsid
            if not page.get("has_more"): break
            cursor = page.get("next_cursor")
            if not cursor: raise PublicationError("provider/API failure: paginated children response omitted next_cursor")
        schema = {policy.identifier:{"rich_text":{}}, policy.title:{"title":{}}, policy.state:{"select":{"options":[{"name":x} for x in policy.bootstrap_states]}}, policy.priority:{"number":{}}, policy.labels:{"multi_select":{}}, policy.blocked_by:{"relation":{"data_source_id":"__SELF__"}}, policy.description:{"rich_text":{}}, policy.source:{"url":{}}}
        schema[policy.blocked_by] = {"relation":{"data_source_id":"__SELF__"}}
        # Relation is established in a second deterministic request because the data source id is not known yet.
        schema.pop(policy.blocked_by)
        db = self.request("POST", "/databases", {"parent":{"type":"page_id","page_id":parent_id}, "title":[{"text":{"content":policy.surface_name}}], "description":[{"text":{"content":self.ownership_marker}}], "initial_data_source":{"properties":schema}})
        dbid = db["id"]; dsid = self.request("GET", f"/databases/{dbid}").get("data_sources", [{}])[0].get("id")
        if not dsid: raise PublicationError("provider/API failure: created surface did not expose its data source")
        self.request("PATCH", f"/data_sources/{dsid}", {"properties":{policy.blocked_by:{"relation":{"data_source_id":dsid, "single_property":{}}}}})
        return dsid
    @staticmethod
    def check_schema(data, policy, dsid=None):
        expected={policy.identifier:"rich_text",policy.title:"title",policy.state:"select",policy.priority:"number",policy.labels:"multi_select",policy.blocked_by:"relation",policy.description:"rich_text",policy.source:"url"}
        props=data.get("properties", {})
        for name, kind in expected.items():
            if name not in props or props[name].get("type") != kind: raise PublicationError(f"incompatible schema: property {name!r} must be {kind}")
        relation = props[policy.blocked_by].get("relation", {})
        if dsid is not None and relation.get("data_source_id") != dsid:
            raise PublicationError(f"incompatible schema: property {policy.blocked_by!r} must be a self-relation")
        if dsid is not None and not ("single_property" in relation or "dual_property" in relation):
            raise PublicationError(f"incompatible schema: property {policy.blocked_by!r} has an invalid relation shape")
    def complete_bootstrap(self, data, dsid, policy):
        props = data.get("properties", {})
        missing = {}
        definitions = {policy.identifier:{"rich_text":{}}, policy.title:{"title":{}}, policy.state:{"select":{"options":[{"name":x} for x in policy.bootstrap_states]}}, policy.priority:{"number":{}}, policy.labels:{"multi_select":{}}, policy.blocked_by:{"relation":{"data_source_id":dsid,"single_property":{}}}, policy.description:{"rich_text":{}}, policy.source:{"url":{}}}
        for name, definition in definitions.items():
            if name not in props: missing[name] = definition
            elif props[name].get("type") != ("relation" if name == policy.blocked_by else next(iter(definition))):
                raise PublicationError(f"incompatible schema: property {name!r} has the wrong type")
            elif name == policy.blocked_by and (props[name].get("relation", {}).get("data_source_id") != dsid or not ("single_property" in props[name].get("relation", {}) or "dual_property" in props[name].get("relation", {}))):
                raise PublicationError(f"incompatible schema: property {name!r} must be a self-relation")
        if missing: self.request("PATCH", f"/data_sources/{dsid}", {"properties": missing})
    def duplicate(self, ds, policy, identifier):
        data=self.request("POST",f"/data_sources/{ds}/query",{"filter":{"property":policy.identifier,"rich_text":{"equals":identifier}}})
        return bool(data.get("results"))
    def create_task(self, ds, properties, identifier): return self.request("POST","/pages",{"parent":{"type":"data_source_id","data_source_id":ds},"properties":properties})
    def append_blocks(self, page_id, blocks):
        for i in range(0,len(blocks),50): self.request("PATCH",f"/blocks/{page_id}/children",{"children":blocks[i:i+50]})
    def archive(self,page_id): self.request("PATCH",f"/pages/{page_id}",{"archived":True})
