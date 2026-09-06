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
