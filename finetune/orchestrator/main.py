import asyncio
import json
import re
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

import db
import incident as incident_mod
import poller
import target_state
from agents import prompts
from agents.runtime import MODELS, stream_chat
from bus import (
    publish, publish_global,
    subscribe, unsubscribe,
    subscribe_global, unsubscribe_global,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init()
    db.reset_runtime()
    target_state.state.reset()
    target_task = asyncio.create_task(target_state.error_loop())
    task = asyncio.create_task(poller.poll_loop())
    yield
    task.cancel()
    target_task.cancel()


app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------- Settings ----------
class SettingsBody(BaseModel):
    healthUrl: str | None = None
    allowedTier: int | None = None


@app.get("/api/settings")
def get_settings():
    return {
        "healthUrl": db.get_setting("healthUrl", db.DEFAULT_HEALTH_URL),
        "allowedTier": int(db.get_setting("allowedTier", "0") or "0"),
    }


@app.post("/api/settings")
async def post_settings(body: SettingsBody):
    if body.healthUrl is not None:
        health_url = body.healthUrl.strip()
        if health_url.startswith("target/"):
            health_url = f"/{health_url}"
        if not health_url.startswith("/target/"):
            raise HTTPException(400, "healthUrl must be a backend target endpoint")
        db.set_setting("healthUrl", health_url)
    if body.allowedTier is not None:
        if body.allowedTier not in (0, 1, 2):
            raise HTTPException(400, "allowedTier must be 0,1,2")
        db.set_setting("allowedTier", str(body.allowedTier))
    settings = get_settings()
    await publish_global({"type": "settings_changed", "settings": settings})
    return settings


# ---------- Health snapshot ----------
@app.get("/api/health-target")
def health_target():
    return {
        "status": poller.state.last_status,
        "message": poller.state.last_message,
        "ts": poller.state.last_check_ts,
    }


# ---------- In-process mock target ----------
@app.get("/target/health")
@app.get("/target/health-mock")
def target_health():
    status_code, payload = target_state.health_payload()
    return Response(
        content=json.dumps(payload),
        status_code=status_code,
        media_type="application/json",
    )


@app.post("/target/_control/page")
def target_control_page():
    return target_state.control_page()


@app.post("/target/_control/restart")
def target_control_restart():
    return target_state.control_restart()


@app.post("/target/_control/patch")
def target_control_patch():
    return target_state.control_patch()


@app.post("/target/_debug/force-error")
def target_debug_force_error():
    return target_state.force_error()


@app.get("/target/_debug/state")
def target_debug_state():
    return target_state.debug_state()


# ---------- Chats ----------
@app.get("/api/chats")
def list_chats():
    return db.list_chats()


@app.get("/api/chats/{chat_id}")
def get_chat(chat_id: int):
    chat = db.get_chat(chat_id)
    if not chat:
        raise HTTPException(404)
    return {
        "chat": chat,
        "messages": db.get_messages(chat_id),
        "tool_calls": db.get_tool_calls_for_chat(chat_id),
        "active": incident_mod.is_active(chat_id),
    }


class CreateChatBody(BaseModel):
    title: str | None = None


@app.post("/api/chats")
async def create_chat(body: CreateChatBody):
    cid = db.create_chat(kind="user", title=body.title or "New chat")
    await publish_global({"type": "data_changed", "scope": "chats"})
    return {"id": cid}


class PostMessageBody(BaseModel):
    content: str


@app.post("/api/chats/{chat_id}/messages")
async def post_message(chat_id: int, body: PostMessageBody):
    chat = db.get_chat(chat_id)
    if not chat:
        raise HTTPException(404)
    message_id = db.add_message(chat_id, role="user", content=body.content)
    message = db.get_message(message_id)
    await publish(chat_id, {"type": "user_message", "message": message, "content": body.content})
    # If message contains @mention, route to that agent.
    asyncio.create_task(_handle_user_message(chat_id, body.content))
    return {"ok": True, "message": message}


async def _handle_user_message(chat_id: int, content: str):
    if db.has_any_pending_tool_call():
        message_id = db.add_message(
            chat_id,
            role="system",
            content="Approval is pending. Agents are paused until the action is approved or denied.",
        )
        message = db.get_message(message_id)
        await publish(chat_id, {
            "type": "system",
            "content": message["content"] if message else "",
            "message": message,
        })
        return
    mention = re.search(r"@(rick|morty|darwin)\b", content, re.I)
    agent = mention.group(1).lower() if mention else "darwin"
    model = MODELS[agent]
    # Comprehensive history: every recent incident with its tool_calls + outcome.
    history_text = db.full_history_brief(max_incidents=10, max_chats=6)
    chat_msgs = db.get_messages(chat_id)
    convo = [
        {"role": "assistant" if m["role"] == "agent" else m["role"], "content": m["content"]}
        for m in chat_msgs[-10:]
        if m["role"] in ("user", "agent", "system")
    ]
    convo.append({
        "role": "user",
        "content": (
            "Use the following current-session history of past incidents and chats to answer. "
            "Treat it as authoritative memory of what your team has actually done since startup.\n\n"
            f"=== HISTORY ===\n{history_text}\n=== END HISTORY ===\n\n"
            f"Question: {content}"
        ),
    })
    system = prompts.MENTION_SYS_TPL.format(agent=agent.capitalize())

    await publish(chat_id, {"type": "message_start", "agent": agent})
    buf = []
    async for tok in stream_chat(model, system, convo):
        buf.append(tok)
        await publish(chat_id, {"type": "message_delta", "agent": agent, "delta": tok})
    final = "".join(buf).strip()
    message_id = db.add_message(chat_id, role="agent", content=final, agent=agent)
    message = db.get_message(message_id)
    await publish(chat_id, {"type": "message_end", "agent": agent, "content": final, "message": message})


# ---------- Approval ----------
class ApprovalBody(BaseModel):
    toolCallId: int
    approved: bool


@app.post("/api/chats/{chat_id}/approval")
async def post_approval(chat_id: int, body: ApprovalBody):
    ok = incident_mod.resolve_approval(body.toolCallId, body.approved)
    if not ok:
        raise HTTPException(400, "no pending approval")
    status = "approved" if body.approved else "denied"
    db.update_tool_call(body.toolCallId, status)
    tool_call = db.get_tool_call(body.toolCallId)
    await publish(chat_id, {
        "type": "tool_status",
        "tool_call_id": body.toolCallId,
        "status": status,
        "tool_call": tool_call,
    })
    return {"ok": True, "tool_call": tool_call}


# ---------- Logs ----------
@app.get("/api/logs")
def list_logs(limit: int = 200):
    return db.list_logs(limit=limit)


# ---------- Reports ----------
@app.get("/api/reports")
def list_reports():
    return db.list_reports()


# ---------- SSE streams ----------
@app.get("/api/chats/{chat_id}/stream")
async def chat_stream(chat_id: int):
    q = subscribe(chat_id)

    async def gen():
        try:
            yield {"event": "open", "data": json.dumps({"chat_id": chat_id})}
            while True:
                ev = await q.get()
                yield {"event": "message", "data": json.dumps(ev)}
        finally:
            unsubscribe(chat_id, q)

    return EventSourceResponse(gen())


@app.get("/api/stream")
async def global_stream():
    q = subscribe_global()

    async def gen():
        try:
            yield {"event": "open", "data": "{}"}
            while True:
                ev = await q.get()
                yield {"event": "message", "data": json.dumps(ev)}
        finally:
            unsubscribe_global(q)

    return EventSourceResponse(gen())
