# Publish UI evidence

These screenshots capture the actual Operator Publish page in Chrome 154 at a 1440 px wide viewport and a 375 px narrow viewport. The narrow capture includes the full page so the Plan editor, State control, and Publish action can be reviewed together; the browser reported no horizontal overflow at either width.

The monochrome styling is a first pass for checking layout and hierarchy, not a final color policy. Review whether Plan → State → Publish → result reads in that order, whether Plan remains the main work surface, and whether secondary navigation stays quiet. Color should not be needed to identify the primary action, the result, or success versus failure. The responsive screenshots retain the same document order.

State choices come from the Publisher configuration through its existing `loadConfig()` path. Leaving the control at `Publisher default` continues to use the Publisher's `Ready` default. This UI change does not add a validation rule or change publication semantics.

## Captures

| File | What it shows |
| --- | --- |
| [`normal-wide.png`](normal-wide.png) | Filled Plan and selected `Backlog` State at 1440 px. The Plan editor is the largest work surface; State and `Publish Plan` form one decision area. |
| [`normal-narrow.png`](normal-narrow.png) | The same Plan and State at 375 px. No horizontal overflow; the State selector and full-width primary action follow the editor. |
| [`success-wide.png`](success-wide.png) | Successful publication result with Identifier, the just-published State, a link to the Notion task, and a `Publish another Plan` action. Raw Publisher JSON and `page_id` are not shown. |
| [`failure-wide.png`](failure-wide.png) | Duplicate-publication failure from the actual Publisher. The Plan and selected `Backlog` State remain in the form with the Publisher error and retry guidance. |

## Live publication readback

The final success capture used the real Publish form, Operator POST endpoint, and Publisher. Notion readback confirmed task `PLAN-147FB533129F` exists with State `Backlog`, and its related Plan page contains the submitted Markdown. [Open the published verification task](https://app.notion.com/p/3e88a2658625814d8189e365c9581092).

An earlier live pass created task `PLAN-477A8A47C5AA` with State `Backlog`; it was then resubmitted to produce the duplicate failure. Both publications remain in the task database as separate verification records. The final screenshots use the second successful publication so the success result includes the selected State.
