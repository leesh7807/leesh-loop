import json, tempfile, unittest
from pathlib import Path
from notion_plan_publisher.core import *

class CoreTests(unittest.TestCase):
 def test_paths_and_identity(self):
  with tempfile.TemporaryDirectory() as d:
   c=Path(d)/"config.json"; c.write_text(json.dumps({"parent_url":"https://app.notion.com/p/3d28a26586258052b3ecccc9c33787e3","state":"Unlisted","labels":[" symphony "]}))
   cfg, pol=load_config(c); self.assertEqual(cfg["parent_id"],"3d28a265-8625-8052-b3ec-ccc9c33787e3"); self.assertEqual(pol.default_state,"Unlisted"); self.assertEqual(pol.default_labels,("symphony",))
 def test_bad_types_unknown_and_open_state(self):
  for key,value in (("labels","not-list"),("state",["Ready"]),("priority","3"),("plan_source",3)):
   with tempfile.TemporaryDirectory() as d:
    p=Path(d)/"c.json"; p.write_text(json.dumps({"parent_url":"https://notion.so/3d28a26586258052b3ecccc9c33787e3",key:value}))
    with self.assertRaises(PublicationError): load_config(p)
 def test_plan_is_structurally_separate_and_chunked(self):
  plan="x"*4000; blocks=build_page_blocks(DEFAULT_POLICY,plan); self.assertEqual(blocks[0]["type"],"heading_1"); self.assertEqual(blocks[-1]["heading_1"]["rich_text"][0]["text"]["content"],"Workpad"); self.assertEqual("".join(x["paragraph"]["rich_text"][0]["text"]["content"] for x in blocks[1:-1]),plan)
 def test_unknown_key_fails(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/"c.json"; p.write_text(json.dumps({"parent_url":"https://notion.so/3d28a26586258052b3ecccc9c33787e3","statuz":"Ready"}))
   with self.assertRaisesRegex(PublicationError,"unknown"): load_config(p)
 def test_invalid_url_fails(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/"c.json"; p.write_text(json.dumps({"parent_url":"not-a-url"}))
   with self.assertRaisesRegex(PublicationError,"invalid target URL"): load_config(p)
