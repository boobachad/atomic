---
title: Daily Briefings
description: Generate cited summaries of recently added atoms.
---

Daily briefings summarize recently captured atoms and show citations back to source atoms. They are designed for catching up on what changed in your knowledge base.

## How Briefings Work

The daily briefing task:

1. Looks for atoms created since the last successful briefing run.
2. Uses an LLM to identify important themes and related context.
3. Writes a short briefing with citation markers.
4. Stores the briefing and citation rows.
5. Emits a `briefing-ready` WebSocket event when a new briefing is available.

If there are no new atoms in the window, Atomic does not create a new briefing. It still advances the last-run timestamp so the quiet period does not repeatedly generate empty summaries.

## Schedule

Fresh databases seed these settings:

| Setting | Default |
|---------|---------|
| `task.daily_briefing.enabled` | `true` |
| `task.daily_briefing.interval_hours` | `24` |

The scheduled task runs per database on the server. This matters in multi-database setups: each database has its own briefing state.

## Run Manually

```bash
curl -X POST http://localhost:8080/api/briefings/run \
  -H "Authorization: Bearer <token>"
```

If a briefing is generated, the response contains the briefing and citations. If no new atoms are available, the route can return no content.

## Read Briefings

```bash
curl http://localhost:8080/api/briefings/latest \
  -H "Authorization: Bearer <token>"

curl http://localhost:8080/api/briefings?limit=20 \
  -H "Authorization: Bearer <token>"

curl http://localhost:8080/api/briefings/<briefing-id> \
  -H "Authorization: Bearer <token>"
```

## Troubleshooting

- If no briefing appears, add atoms and run the task after the server has processed them.
- If generation fails, check the configured wiki model/provider because briefings use the wiki-model path.
- If self-hosting multiple databases, verify you are viewing the database that received the new atoms.

## Related

- [AI Providers](/getting-started/ai-providers/)
- [Atoms](/concepts/atoms/)
- [WebSocket Events](/api/websocket-events/)
