import unittest
from notion_plan_publisher.notion import NotionClient
from notion_plan_publisher.core import DEFAULT_POLICY, PublicationError

class FakeClient(NotionClient):
 def __init__(self, responses): super().__init__("token"); self.responses=iter(responses); self.calls=[]
 def request(self, method, path, body=None): self.calls.append((method,path,body)); return next(self.responses)

class NotionTests(unittest.TestCase):
 def test_duplicate_query_and_page_creation_use_data_source(self):
  c=FakeClient([{"results":[]},{"id":"page"}]); self.assertFalse(c.duplicate("ds",DEFAULT_POLICY,"PLAN-X")); c.create_task("ds",{"Title":{}},"PLAN-X")
  self.assertEqual(c.calls[0][1],"/data_sources/ds/query"); self.assertEqual(c.calls[1][2]["parent"]["type"],"data_source_id")
 def test_incompatible_schema_is_explicit(self):
  with self.assertRaisesRegex(PublicationError,"incompatible schema"): NotionClient.check_schema({"properties":{"Title":{"type":"title"}}},DEFAULT_POLICY)
 def test_same_named_compatible_unowned_surface_is_rejected(self):
  c=FakeClient([{"results":[{"type":"child_database","id":"db","child_database":{"title":DEFAULT_POLICY.surface_name}}]}, {"description":[],"data_sources":[{"id":"ds"}]}, {"properties":{k:{"type":t} for k,t in {DEFAULT_POLICY.identifier:"rich_text",DEFAULT_POLICY.title:"title",DEFAULT_POLICY.state:"select",DEFAULT_POLICY.priority:"number",DEFAULT_POLICY.labels:"multi_select",DEFAULT_POLICY.blocked_by:"relation",DEFAULT_POLICY.description:"rich_text",DEFAULT_POLICY.source:"url"}.items()}}])
  with self.assertRaisesRegex(PublicationError,"not publisher-owned"): c.ensure_surface("parent",DEFAULT_POLICY)
 def test_owned_surface_with_non_self_blocked_by_relation_is_rejected(self):
  props={k:{"type":t} for k,t in {DEFAULT_POLICY.identifier:"rich_text",DEFAULT_POLICY.title:"title",DEFAULT_POLICY.state:"select",DEFAULT_POLICY.priority:"number",DEFAULT_POLICY.labels:"multi_select",DEFAULT_POLICY.blocked_by:"relation",DEFAULT_POLICY.description:"rich_text",DEFAULT_POLICY.source:"url"}.items()}
  props[DEFAULT_POLICY.blocked_by]["relation"]={"data_source_id":"other-ds","single_property":{}}
  c=FakeClient([{"results":[{"type":"child_database","id":"db","child_database":{"title":DEFAULT_POLICY.surface_name}}]}, {"description":[{"plain_text":c_marker()}],"data_sources":[{"id":"ds"}]}, {"properties":props}])
  with self.assertRaisesRegex(PublicationError,"self-relation"): c.ensure_surface("parent",DEFAULT_POLICY)
 def test_children_are_paginated_before_bootstrap(self):
  filler=[{"type":"paragraph"}]*100
  child={"type":"child_database","id":"db","child_database":{"title":DEFAULT_POLICY.surface_name}}
  schema={"properties":{k:{"type":t} for k,t in {DEFAULT_POLICY.identifier:"rich_text",DEFAULT_POLICY.title:"title",DEFAULT_POLICY.state:"select",DEFAULT_POLICY.priority:"number",DEFAULT_POLICY.labels:"multi_select",DEFAULT_POLICY.blocked_by:"relation",DEFAULT_POLICY.description:"rich_text",DEFAULT_POLICY.source:"url"}.items()}}
  schema["properties"][DEFAULT_POLICY.blocked_by]["relation"]={"data_source_id":"ds","single_property":{}}
  c=FakeClient([{"results":filler,"has_more":True,"next_cursor":"cursor"},{"results":[child],"has_more":False},{"description":[{"plain_text":c_marker()}],"data_sources":[{"id":"ds"}]},schema])
  self.assertEqual(c.ensure_surface("parent",DEFAULT_POLICY),"ds"); self.assertIn("start_cursor=cursor",c.calls[1][1])

def c_marker():
 return NotionClient.ownership_marker
