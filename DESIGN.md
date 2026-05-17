# Design

## Two services

| Component | Tech | Port | Role |
|---|---|---:|---|
| UI | Next.js 14 + TS | 3000 | Studio interface |
| Backend | FastAPI (Python) | 3001 | Mock target, poller, agents, REST, SSE |

UI calls the backend through a Next rewrite `/api/orch/* -> BACKEND_URL/api/*`
from [ui/next.config.js](ui/next.config.js). SSE uses the same base unless
`NEXT_PUBLIC_ORCH_STREAM_BASE` is set.

## Mock target

The mock target lives in the backend process in
[orchestrator/target_state.py](orchestrator/target_state.py).

- A 1 Hz background task samples the next error time from
  `N(mean_interval, mean_interval x 0.25)`.
- The timer does not run while an incident is active.
- `GET /target/health` returns 200 or 500 from in-memory target state.
- `POST /target/_control/page` records the page and keeps the error active.
- `POST /target/_control/restart` is a mock restart. It clears the error
  without restarting or stopping the backend process.
- `POST /target/_control/patch` clears the error, switches mode to `patched`,
  and keeps the next-error mean interval at 10 seconds.
- `POST /target/_debug/force-error` forces an error for local smoke tests.

## Backend

### Poller

[orchestrator/poller.py](orchestrator/poller.py) checks the in-process target
every second and publishes a `health` event on the global SSE channel.
One target failure owns one incident until the incident closes.

### Incident runner

[orchestrator/incident.py](orchestrator/incident.py) runs the Rick -> Morty ->
Darwin loop. Tool approvals block on `asyncio.Future`s keyed by `tool_call_id`.
While an approval is pending, agent behavior is paused until the user approves
or denies the action.

Darwin creates three reports before an incident is marked closed:

- Customer Success Team
- Developer Team
- DevOps and SRE Teams

### Storage

[orchestrator/db.py](orchestrator/db.py) uses SQLite for current-session state.
Startup clears incidents, chats, messages, tool calls, logs, and reports. The
browser does not use local storage.

### SSE bus

[orchestrator/bus.py](orchestrator/bus.py) keeps in-memory queues per chat and
globally. Chat streams emit message, tool, approval, and resolution events.
The global stream emits health, incident, logs, chats, and reports updates.

## UI

- Dashboard shows live target health and recent incidents.
- Chat panel streams agent messages, typing states, approvals, and tool results.
- Reports page groups the three team reports per incident. Each report opens in
  a modal and can be downloaded as a PDF.
- Settings exposes the fixed backend target endpoint and the approval tier.

## Incident flow

```
/target/health 500
        |
poller creates incident + chat
        |
IncidentRunner
  |-- Rick streams
  |-- Morty streams
  |-- Darwin chooses one tool
  |-- approval gate blocks if needed
  |-- execute mock target action
  |-- re-test target
  |-- create three reports
  |-- close incident
  |-- resume target error timer
```
