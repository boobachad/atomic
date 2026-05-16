---
title: WebSocket Events
description: Subscribe to realtime Atomic server events for pipeline progress, chat streaming, ingestion, feeds, and briefings.
---

Atomic broadcasts realtime events over a WebSocket endpoint:

```text
ws://localhost:8080/ws?token=<token>
```

Use `wss://` when Atomic is behind HTTPS.

## Authentication

The WebSocket token is passed as a query parameter:

```text
/ws?token=<your-token>
```

Use a dedicated token for long-running integrations where possible.

## Event Envelope

Server events are JSON objects with a `type` field:

```json
{
  "type": "EmbeddingComplete",
  "atom_id": "uuid"
}
```

The React frontend normalizes these to kebab-case event names, but raw WebSocket clients receive the original server event shape.

## Pipeline Events

Raw server event types:

- `EmbeddingStarted`
- `EmbeddingComplete`
- `EmbeddingFailed`
- `TaggingComplete`
- `TaggingFailed`
- `TaggingSkipped`
- `BatchProgress`
- `PipelineQueueStarted`
- `PipelineQueueProgress`
- `PipelineQueueCompleted`
- `EventsLagged`

Frontend-normalized names include `embedding-started`, `embedding-complete`, `tagging-complete`, `batch-progress`, `pipeline-queue-started`, `pipeline-queue-progress`, `pipeline-queue-completed`, and `server-events-lagged`.

## Atom Events

- `AtomCreated`
- `AtomUpdated`

These are emitted when atoms are created or updated through API, bulk create, or MCP paths that broadcast lifecycle events.

## Import and Ingestion Events

- `ImportProgress`
- `IngestionFetchStarted`
- `IngestionFetchComplete`
- `IngestionFetchFailed`
- `IngestionSkipped`
- `IngestionComplete`
- `IngestionFailed`
- `FeedPollComplete`
- `FeedPollFailed`

These power progress UI for Obsidian import, URL ingestion, browser clipping, iOS share ingestion, and feed polling.

## Chat Events

- `ChatStreamDelta`
- `ChatToolStart`
- `ChatToolComplete`
- `ChatComplete`
- `ChatCanvasAction`
- `ChatError`

The message send endpoint returns a final response, but the UI receives streaming deltas and tool events over WebSocket.

## Briefing Events

- `BriefingReady`

The payload includes `db_id` and `briefing_id`.

## Lag Handling

The server uses a broadcast channel. If a client falls behind, it can receive an `EventsLagged` event with the number of skipped events. Clients should reconcile state by refetching the relevant resource, such as atoms, pipeline status, or the latest briefing.

## Related

- [API Overview](/api/overview/)
- [Daily Briefings](/concepts/daily-briefings/)
- [URL Ingestion and Feeds](/guides/url-ingestion-and-feeds/)
