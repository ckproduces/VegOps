import asyncio
import random
import time
from dataclasses import dataclass, field


ERROR_MESSAGES = [
    "Database connection pool exhausted",
    "Upstream timeout on /orders service (504)",
    "OOM in worker process pid=2381",
    "Disk usage on /var hit 97%",
    "Redis cluster reported 2 failed nodes",
    "TLS handshake failed: certificate expired",
]


@dataclass
class TargetState:
    error: bool = False
    mean_interval: float = 40.0
    mode: str = "normal"
    last_error_message: str = ""
    next_error_at: float = field(default_factory=lambda: time.time() + 5.0)
    events: list = field(default_factory=list)
    timer_paused: bool = False

    def reset(self):
        self.error = False
        self.mean_interval = 40.0
        self.mode = "normal"
        self.last_error_message = ""
        self.events.clear()
        self.timer_paused = False
        self.schedule_next()

    def schedule_next(self):
        delay = max(5.0, random.gauss(self.mean_interval, self.mean_interval * 0.25))
        self.next_error_at = time.time() + delay
        return delay

    def pause_timer(self, reason: str):
        if not self.timer_paused:
            self.events.append({"ts": time.time(), "kind": "timer_paused", "reason": reason})
        self.timer_paused = True
        self.schedule_next()

    def resume_timer(self, reason: str):
        self.timer_paused = False
        delay = self.schedule_next()
        self.events.append({"ts": time.time(), "kind": "timer_resumed", "reason": reason, "next_error_s": delay})

    def trigger_error(self):
        self.last_error_message = random.choice(ERROR_MESSAGES)
        self.error = True
        self.events.append({"ts": time.time(), "kind": "error_raised", "msg": self.last_error_message})

    def clear_error(self, kind: str):
        self.error = False
        self.events.append({"ts": time.time(), "kind": kind, "msg": self.last_error_message})


state = TargetState()


def health_status() -> tuple[str, str]:
    if state.error:
        return "error", state.last_error_message
    return "ok", "ok"


def health_payload() -> tuple[int, dict]:
    status, message = health_status()
    if status == "error":
        return 500, {"status": "error", "message": message}
    return 200, {"status": "ok", "mode": state.mode}


def control_page() -> dict:
    state.events.append({"ts": time.time(), "kind": "team_paged", "msg": state.last_error_message})
    return {
        "ok": True,
        "action": "page",
        "error_persists": True,
        "message": state.last_error_message,
    }


def control_restart() -> dict:
    state.clear_error("mock_restart_complete")
    if not state.timer_paused:
        state.schedule_next()
    return {
        "ok": True,
        "action": "restart",
        "message": "Restart command completed. Service returned healthy.",
    }


def control_patch() -> dict:
    state.mode = "patched"
    state.mean_interval = 80.0
    state.clear_error("patch_applied")
    if not state.timer_paused:
        state.schedule_next()
    return {"ok": True, "action": "patch", "new_endpoint": "/target/health-mock"}


def abandon_current_error():
    state.clear_error("incident_abandoned")


def force_error() -> dict:
    state.trigger_error()
    return {"ok": True, "message": state.last_error_message}


def debug_state() -> dict:
    return {
        "error": state.error,
        "mode": state.mode,
        "mean_interval": state.mean_interval,
        "last_error_message": state.last_error_message,
        "timer_paused": state.timer_paused,
        "seconds_to_next_error": max(0.0, state.next_error_at - time.time()),
        "recent_events": state.events[-10:],
    }


async def error_loop():
    while True:
        await asyncio.sleep(1.0)
        if state.timer_paused or state.error:
            state.schedule_next()
            continue
        if time.time() >= state.next_error_at:
            state.trigger_error()
            state.schedule_next()
