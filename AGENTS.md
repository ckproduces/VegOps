# Agents

Three agents collaborate on every incident. Models are reached through fal.ai's
OpenRouter compatibility shim (`https://fal.run/openrouter/router/openai/v1`)
using the standard OpenAI chat-completions schema. The auth header is
`Authorization: Key $FAL_KEY`.

| Agent  | Role               | Model (OpenRouter id)            |
|--------|--------------------|----------------------------------|
| Rick   | Investigator       | `qwen/qwen-2.5-7b-instruct`      |
| Morty  | Investigator       | `qwen/qwen-2.5-7b-instruct`      |
| Darwin | Decision-maker     | `deepseek/deepseek-v4-pro`        |

Model IDs live in [orchestrator/agents/runtime.py](orchestrator/agents/runtime.py#L17)
and can be swapped without touching the rest of the code.

## Roles & prompts

System prompts are kept short and consistent in
[orchestrator/agents/prompts.py](orchestrator/agents/prompts.py).

- **Rick** — skeptical senior SRE. Diagnoses in 2–3 sentences, ends with one
  sharp "what changed?" question. Never proposes actions.
- **Morty** — anxious junior. Cross-checks Rick, suggests the safest tier
  without committing.
- **Darwin** — calm decider. Reads Rick + Morty, picks exactly one tool and
  replies with a single line of strict JSON
  `{"tool": "...", "reason": "..."}`. The orchestrator parses this.

After resolution, Darwin also writes a 3–4 sentence post-mortem.

## Tools & tier hierarchy

Tools are ordered by blast radius — the user sets a threshold; anything above
needs inline approval in the chat.

The mock target is in the same backend as the multi-agent system. Agent APIs
live under `/api/*`; mock target APIs live under `/target/*`.

| Tier | Tool             | Target endpoint                    | Effect on target                            |
|------|------------------|------------------------------------|---------------------------------------------|
| 0    | `page_devops`    | `POST /target/_control/page`       | Records the page; **error persists**.       |
| 1    | `restart_server` | `POST /target/_control/restart`    | Mock restart; clears error without restarting the backend. |
| 2    | `patch_code`     | `POST /target/_control/patch`      | Switches to patched mode, clears error, next-error mean → 10s. |

Defined in [orchestrator/agents/tools.py](orchestrator/agents/tools.py).

## Incident loop

State machine in [orchestrator/incident.py](orchestrator/incident.py):

1. Poller detects 5xx on the configured health URL → opens incident + chat.
2. Rick → Morty → Darwin stream their messages into the chat (SSE).
3. Darwin's JSON decision becomes a `tool_call` record. Tier ≤ allowed → auto
   approved. Tier > allowed → `pending_approval`, agent loop awaits the inline
   Approve/Deny click.
4. Tool fires against the target. Wait, re-poll.
5. Still failing → loop back to step 2 with the new error text. Resolved →
   Darwin writes the post-mortem and the incident closes.

Max 4 attempts per incident — if still unresolved, it's marked abandoned.

## @mentions over history

Outside of an active incident, users can `@rick`, `@morty`, or `@darwin` in any
chat. The orchestrator pulls a free-text slice of `logs` + `messages` from
SQLite ([db.py](orchestrator/db.py)) and feeds it as a HISTORY block. The
addressed agent answers in 2–4 sentences using only what's in that block. With
no mention, queries default to Darwin.
