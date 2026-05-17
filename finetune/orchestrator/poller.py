import asyncio
import time

import httpx

import db
from bus import publish_global
import incident as incident_mod
import target_state


POLL_INTERVAL = 1.0


class PollerState:
    def __init__(self):
        self.last_status: str = "unknown"  # 'ok' | 'error' | 'down' | 'unreachable'
        self.last_message: str = ""
        self.last_check_ts: float = 0.0
        self.current_chat_id: int | None = None
        self.current_incident_id: int | None = None


state = PollerState()


def _is_internal_target_url(url: str) -> bool:
    clean = url.strip().lstrip("/")
    return clean.startswith("target/")


async def _check(url: str) -> tuple[str, str]:
    url = (url or db.DEFAULT_HEALTH_URL).strip()
    if _is_internal_target_url(url):
        return target_state.health_status()
    if not url.startswith(("http://", "https://")):
        return "unreachable", f"Invalid health URL: {url}. Use /target/health or an absolute http(s) URL."
    try:
        async with httpx.AsyncClient(timeout=4.0) as c:
            r = await c.get(url)
        if r.status_code == 200:
            return "ok", "ok"
        if r.status_code == 503:
            try:
                return "down", r.json().get("message", "down")
            except Exception:
                return "down", "down"
        if r.status_code >= 500:
            try:
                return "error", r.json().get("message", f"HTTP {r.status_code}")
            except Exception:
                return "error", f"HTTP {r.status_code}"
        return "ok", f"HTTP {r.status_code}"
    except Exception as e:
        return "unreachable", str(e)


async def poll_loop():
    while True:
        try:
            url = db.get_setting("healthUrl", db.DEFAULT_HEALTH_URL)
            status, msg = await _check(url)
            state.last_status = status
            state.last_message = msg
            state.last_check_ts = time.time()

            await publish_global({
                "type": "health",
                "status": status,
                "message": msg,
                "ts": state.last_check_ts,
            })

            # One target failure owns one incident until the target returns OK.
            if status == "error" and state.current_chat_id is None:
                open_incident = db.get_latest_open_incident_chat()
                if open_incident:
                    chat_id = open_incident["chat_id"]
                    incident_id = open_incident["incident_id"]
                    state.current_chat_id = chat_id
                    state.current_incident_id = incident_id
                    target_state.state.pause_timer("open_incident")
                    incident_mod.start_incident(chat_id, incident_id, open_incident["initial_error"] or msg)
                else:
                    incident_id = db.create_incident(msg)
                    chat_id = db.create_chat(
                        kind="incident",
                        title=f"Incident #{incident_id}: {msg[:60]}",
                        incident_id=incident_id,
                    )
                    db.add_message(chat_id, role="system", content=f"Health check failed: {msg}")
                    db.add_log("incident_opened", f"Incident #{incident_id} opened: {msg}", incident_id)
                    state.current_chat_id = chat_id
                    state.current_incident_id = incident_id
                    target_state.state.pause_timer("incident_opened")
                    await publish_global({
                        "type": "incident_opened",
                        "incident_id": incident_id,
                        "chat_id": chat_id,
                        "message": msg,
                    })
                    await publish_global({"type": "data_changed", "scope": "chats"})
                    await publish_global({"type": "data_changed", "scope": "logs"})
                    incident_mod.start_incident(chat_id, incident_id, msg)
            elif status == "ok" and state.current_chat_id is not None:
                if not db.get_latest_open_incident_chat():
                    state.current_chat_id = None
                    state.current_incident_id = None
        except Exception as e:
            print(f"[poller] error: {e}")
        await asyncio.sleep(POLL_INTERVAL)
