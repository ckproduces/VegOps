# VegOps

Multi-agent incident response demo. A Next.js studio UI watches an in-process
mock production target through a Python backend. When the mock target errors,
Rick, Morty, and Darwin collaborate to triage and resolve it, streaming their
conversation into the UI in real time.

See [AGENTS.md](AGENTS.md) and [DESIGN.md](DESIGN.md) for the deep dive.

## Run locally

You need two terminals. Make sure `.env` at the repo root contains
`FAL_KEY=...`.

```bash
# Terminal 1 - backend (port 3001)
cd orchestrator
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn main:app --port 3001

# Terminal 2 - UI (port 3000)
cd ui
npm install
npm run dev
```

Open <http://localhost:3000>.

## Smoke checks

```bash
# Backend health snapshot
curl localhost:3001/api/health-target

# Mock target lives inside the backend
curl localhost:3001/target/health
curl localhost:3001/target/_debug/state
curl -X POST localhost:3001/target/_debug/force-error
```

## Deployment

Backend:

```bash
cd orchestrator
docker build -t vegaops-backend .
docker run -p 3001:3001 --env-file ../.env vegaops-backend
```

UI:

```bash
cd ui
docker build --build-arg BACKEND_URL=https://your-backend.example.com -t vegaops-ui .
docker run -p 3000:3000 -e PORT=3000 vegaops-ui
```

Environment:

- Backend requires `FAL_KEY`.
- UI uses `BACKEND_URL` at build time for the `/api/orch/*` rewrite.
- For cross-origin direct calls instead of rewrites, set
  `NEXT_PUBLIC_ORCH_API_BASE=https://your-backend.example.com/api` and
  `NEXT_PUBLIC_ORCH_STREAM_BASE=https://your-backend.example.com/api`.

## Runtime behavior

- Startup clears incidents, chats, logs, tool calls, and reports.
- Browser local storage is not used.
- The mock target error timer pauses while an incident is active and resumes
  only after the incident is resolved or abandoned and reports are created.
- `restart_server` is a mock action. It clears the target error without
  restarting the backend process.

## Layout

```
turksat-hackathon/
├── .env                 # FAL_KEY
├── orchestrator/        # backend, agents, mock target, poller, SSE
└── ui/                  # Next.js studio
```
