---
tracker:
  kind: memory
---

You are working on a Memory ticket `{{ issue.identifier }}`.

Issue context:
- Identifier: {{ issue.identifier }}
- Title: {{ issue.title }}
- Current status: {{ issue.state }}
- URL: {{ issue.url }}

This is an unattended orchestration session. Only stop early for a true external blocker.
Do not include "next steps for user".
{% if attempt %}Follow-up context: follow-up attempt #{{ attempt }}{% endif %}
