"""Incident state machine. Runs the Rick to Morty to Darwin loop per incident chat."""
import asyncio
import json
import re

import httpx

from agents import prompts
from agents.runtime import MODELS, complete, stream_chat
from agents.tools import TOOL_TIERS, TOOL_LABELS, execute_tool
from bus import publish, publish_global
import db
import target_state


# Active incident tasks indexed by chat_id
_active: dict[int, "IncidentRunner"] = {}
# Pending approvals: tool_call_id -> asyncio.Future[bool]
_pending_approvals: dict[int, asyncio.Future] = {}

REPORT_AUDIENCES = [
    (
        "customer_success",
        "Customer Success Team",
        "Write for customer-facing account owners. Focus on impact, current status, customer messaging, and follow-up timing. Avoid implementation detail.",
    ),
    (
        "developer",
        "Developer Team",
        "Write for application developers. Focus on suspected code path, regression clues, debugging notes, and follow-up engineering work.",
    ),
    (
        "devops_sre",
        "DevOps and SRE Teams",
        "Write for operators. Focus on detection, remediation actions, tooling, runbook changes, and monitoring follow-ups.",
    ),
]

DECISION_REVIEW_URL = "https://hired-career-man-gibraltar.trycloudflare.com/v1/chat/completions"
DECISION_REVIEW_MODEL = "mymodel"
DECISION_REVIEW_PROMPT = "do you think there are errors in this decision?"
DECISION_REVIEW_REJECTION = "yes, there are errors"


async def _stream_agent_message(chat_id: int, agent: str, model: str, system: str, context_messages: list[dict]) -> str:
    """Stream tokens to UI and persist final message."""
    await publish(chat_id, {"type": "message_start", "agent": agent})
    buf: list[str] = []
    async for tok in stream_chat(model, system, context_messages):
        buf.append(tok)
        await publish(chat_id, {"type": "message_delta", "agent": agent, "delta": tok})
    final = "".join(buf).strip()
    message_id = db.add_message(chat_id, role="agent", content=final, agent=agent)
    message = db.get_message(message_id)
    await publish(chat_id, {"type": "message_end", "agent": agent, "content": final, "message": message})
    return final


async def _publish_agent_message(chat_id: int, agent: str, content: str) -> None:
    """Publish and persist a complete agent message that was generated silently."""
    final = content.strip()
    await publish(chat_id, {"type": "message_start", "agent": agent})
    if final:
        await publish(chat_id, {"type": "message_delta", "agent": agent, "delta": final})
    message_id = db.add_message(chat_id, role="agent", content=final, agent=agent)
    message = db.get_message(message_id)
    await publish(chat_id, {"type": "message_end", "agent": agent, "content": final, "message": message})


async def _review_darwin_decision(decision_text: str) -> tuple[bool, str]:
    prompt = f"{DECISION_REVIEW_PROMPT}\n\nDecision:\n{decision_text}"
    payload = {
        "model": DECISION_REVIEW_MODEL,
        "messages": [{"role": "user", "content": prompt}],
    }
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.post(
            DECISION_REVIEW_URL,
            headers={"Content-Type": "application/json"},
            json=payload,
        )
        response.raise_for_status()
    data = response.json()
    answer = data["choices"][0]["message"]["content"].strip()
    normalized = answer.lower().rstrip(".")
    return normalized == DECISION_REVIEW_REJECTION, answer


async def wait_for_approval(tool_call_id: int) -> bool:
    fut: asyncio.Future = asyncio.get_event_loop().create_future()
    _pending_approvals[tool_call_id] = fut
    try:
        return await fut
    finally:
        _pending_approvals.pop(tool_call_id, None)


def resolve_approval(tool_call_id: int, approved: bool) -> bool:
    fut = _pending_approvals.get(tool_call_id)
    if fut and not fut.done():
        fut.set_result(approved)
        return True
    return False


def _parse_darwin(text: str) -> dict | None:
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        return None
    try:
        data = json.loads(m.group(0))
        if "tool" in data and data["tool"] in TOOL_TIERS:
            return data
    except Exception:
        return None
    return None


async def _darwin_report(context: str, audience_label: str, instruction: str) -> str:
    facts = {}
    for line in context.splitlines():
        if ": " in line:
            key, value = line.split(": ", 1)
            facts[key.lower()] = value
    incident = facts.get("incident #", context.splitlines()[0] if context else "Incident")
    outcome = facts.get("outcome", "unknown")
    initial_error = facts.get("initial error", "unknown")
    last_error = facts.get("last error", initial_error)
    attempts = facts.get("attempts", "unknown")
    tools = facts.get("tool calls", "none")
    summary = facts.get("summary", "No summary recorded.")
    report_body = (
        f"{audience_label} report\n\n"
        f"Incident: {incident}\n"
        f"Status: {outcome}\n"
        f"Initial error: {initial_error}\n"
        f"Last observed error: {last_error}\n"
        f"Attempts: {attempts}\n"
        f"Actions: {tools}\n"
        f"Summary: {summary}\n\n"
        f"Darwin guidance: {instruction}"
    )
    return report_body


async def create_reports_for_incident(
    incident_id: int,
    chat_id: int,
    outcome: str,
    summary: str,
    initial_error: str,
    last_error: str,
    attempts: int,
):
    tool_calls = db.get_tool_calls_for_chat(chat_id)
    messages = db.get_messages(chat_id)
    tools = ", ".join(
        f"{tc['tool']}({tc['status']})" for tc in tool_calls
    ) or "none"
    conversation_tail = "\n".join(
        f"- {m['agent'] or m['role']}: {(m['content'] or '')[:240]}"
        for m in messages[-8:]
    ) or "- no messages"
    context = (
        f"Incident #{incident_id}\n"
        f"Outcome: {outcome}\n"
        f"Initial error: {initial_error}\n"
        f"Last error: {last_error}\n"
        f"Attempts: {attempts}\n"
        f"Tool calls: {tools}\n"
        f"Summary: {summary}\n"
        f"Conversation tail:\n{conversation_tail}"
    )
    reports = []
    for audience, label, instruction in REPORT_AUDIENCES:
        content = await _darwin_report(context, label, instruction)
        title = f"Incident #{incident_id} - {label}"
        reports.append((audience, title, content))
    for audience, title, content in reports:
        db.add_report(incident_id, audience, title, content)
    db.add_log("reports_created", f"Darwin created 3 reports for incident #{incident_id}", incident_id)
    await publish_global({"type": "data_changed", "scope": "reports"})
    await publish_global({"type": "data_changed", "scope": "logs"})


async def backfill_missing_reports():
    for inc in db.list_closed_incidents_missing_reports(len(REPORT_AUDIENCES)):
        chat = db.get_chat_for_incident(inc["id"])
        if not chat:
            continue
        summary = inc["summary"] or "Incident closed without summary."
        outcome = "unresolved" if "could not resolve" in summary.lower() else "resolved"
        tool_calls = db.get_tool_calls_for_chat(chat["id"])
        await create_reports_for_incident(
            incident_id=inc["id"],
            chat_id=chat["id"],
            outcome=outcome,
            summary=summary,
            initial_error=inc["initial_error"] or "",
            last_error=summary,
            attempts=len(tool_calls),
        )


class IncidentRunner:
    def __init__(self, chat_id: int, incident_id: int, error_message: str):
        self.chat_id = chat_id
        self.incident_id = incident_id
        self.initial_error = error_message
        self.error_message = error_message
        self.allowed_tier = int(db.get_setting("allowedTier", "0") or "0")
        self.attempts = 0
        self.consecutive_devops_pages = 0

    async def _health_status(self) -> tuple[bool, str]:
        """Returns (is_error, message)."""
        status, message = target_state.health_status()
        return status == "error", message

    async def run(self):
        try:
            await self._loop()
        except Exception as e:
            await publish(self.chat_id, {"type": "system", "content": f"Incident loop crashed: {e}"})
        finally:
            _active.pop(self.chat_id, None)

    async def _loop(self):
        max_attempts = 4
        while self.attempts < max_attempts:
            self.attempts += 1
            # 1. Rick
            recent = db.recent_history(limit=15)
            recent_summary = "\n".join(f"- {r['kind']}: {r['text']}" for r in recent[:10]) or "(no prior logs)"
            rick_ctx = [{
                "role": "user",
                "content": (
                    f"Incident attempt #{self.attempts}.\n"
                    f"Health endpoint reported: {self.error_message}\n\n"
                    f"Recent system logs:\n{recent_summary}\n\n"
                    "Diagnose."
                ),
            }]
            rick_text = await _stream_agent_message(self.chat_id, "rick", MODELS["rick"], prompts.RICK_SYS, rick_ctx)

            # 2. Morty
            morty_ctx = [{
                "role": "user",
                "content": (
                    f"Error: {self.error_message}\n"
                    f"Rick said: {rick_text}\n\n"
                    "Cross-check and suggest the safest remediation tier."
                ),
            }]
            morty_text = await _stream_agent_message(self.chat_id, "morty", MODELS["morty"], prompts.MORTY_SYS, morty_ctx)

            # 3. Darwin decides
            darwin_ctx = [{
                "role": "user",
                "content": (
                    f"Error: {self.error_message}\n"
                    f"Rick: {rick_text}\n"
                    f"Morty: {morty_text}\n\n"
                    f"Attempt {self.attempts} of {max_attempts}. "
                    f"Consecutive DevOps pages already executed: {self.consecutive_devops_pages}. "
                    "If this count is 2 or more, page_devops is unavailable. "
                    "Choose exactly one tool. Reply with JSON only."
                ),
            }]
            darwin_raw = await complete(MODELS["darwin"], prompts.DARWIN_SYS, darwin_ctx)
            review_failed = False
            try:
                decision_has_errors, review_answer = await _review_darwin_decision(darwin_raw)
            except Exception as e:
                review_failed = True
                decision_has_errors = False
                review_answer = f"review request failed: {e}"

            if decision_has_errors:
                db.add_log(
                    "decision_rejected",
                    f"Darwin decision suppressed for incident #{self.incident_id}: {review_answer}",
                    self.incident_id,
                )
                await publish_global({"type": "data_changed", "scope": "logs"})
                continue

            db.add_log(
                "decision_review_failed" if review_failed else "decision_reviewed",
                f"Darwin decision review for incident #{self.incident_id}: {review_answer}",
                self.incident_id,
            )
            await publish_global({"type": "data_changed", "scope": "logs"})
            await _publish_agent_message(self.chat_id, "darwin", darwin_raw)
            decision = _parse_darwin(darwin_raw)
            if not decision:
                # fallback: escalate by attempt
                fallback = ["page_devops", "restart_server", "patch_code", "patch_code"][min(self.attempts - 1, 3)]
                decision = {"tool": fallback, "reason": "fallback (Darwin response unparsable)"}

            if self.consecutive_devops_pages >= 2 and decision["tool"] == "page_devops":
                decision = {
                    "tool": "restart_server",
                    "reason": "two consecutive DevOps pages did not clear the incident; forcing a resolving restart",
                }

            tool = decision["tool"]
            tier = TOOL_TIERS[tool]
            tool_call_id = db.add_tool_call(
                self.chat_id, tool, {"reason": decision.get("reason", "")}, tier=tier,
                status="pending_approval" if tier > self.allowed_tier else "approved",
            )
            tool_call = db.get_tool_call(tool_call_id)
            db.add_log("tool_proposed", f"{TOOL_LABELS[tool]} proposed for incident #{self.incident_id}", tool_call_id)
            await publish_global({"type": "data_changed", "scope": "logs"})
            await publish(self.chat_id, {
                "type": "tool_call",
                "tool_call_id": tool_call_id,
                "tool": tool,
                "label": TOOL_LABELS[tool],
                "tier": tier,
                "reason": decision.get("reason", ""),
                "status": "pending_approval" if tier > self.allowed_tier else "approved",
                "needs_approval": tier > self.allowed_tier,
                "allowed_tier": self.allowed_tier,
                "tool_call": tool_call,
            })

            # 4. Approval gate
            if tier > self.allowed_tier:
                approved = await wait_for_approval(tool_call_id)
                db.update_tool_call(tool_call_id, "approved" if approved else "denied")
                tool_call = db.get_tool_call(tool_call_id)
                await publish(self.chat_id, {
                    "type": "tool_status",
                    "tool_call_id": tool_call_id,
                    "status": "approved" if approved else "denied",
                    "tool_call": tool_call,
                })
                if not approved:
                    db.add_log("tool_denied", f"{TOOL_LABELS[tool]} denied by user", tool_call_id)
                    message_id = db.add_message(
                        self.chat_id, role="system",
                        content=f"User denied {TOOL_LABELS[tool]}. Agents will retry with a lower-tier option.",
                    )
                    message = db.get_message(message_id)
                    await publish(self.chat_id, {
                        "type": "system",
                        "content": f"User denied {TOOL_LABELS[tool]}. Retrying with a safer approach.",
                        "message": message,
                    })
                    continue

            # 5. Execute
            db.update_tool_call(tool_call_id, "executing")
            tool_call = db.get_tool_call(tool_call_id)
            await publish(self.chat_id, {
                "type": "tool_status",
                "tool_call_id": tool_call_id,
                "status": "executing",
                "tool_call": tool_call,
            })
            result = await execute_tool(tool)
            db.update_tool_call(tool_call_id, "executed", result)
            tool_call = db.get_tool_call(tool_call_id)
            db.add_log("tool_executed", f"{TOOL_LABELS[tool]} executed: {result}", tool_call_id)
            await publish_global({"type": "data_changed", "scope": "logs"})
            await publish(self.chat_id, {
                "type": "tool_result",
                "tool_call_id": tool_call_id,
                "status": "executed",
                "result": result,
                "tool_call": tool_call,
            })
            if tool == "page_devops":
                self.consecutive_devops_pages += 1
            else:
                self.consecutive_devops_pages = 0

            # 6. Wait then re-test
            await asyncio.sleep(2.0)
            is_err, msg = await self._health_status()
            if not is_err:
                summary = (
                    f"Resolved after {self.attempts} attempt(s). Final action: {TOOL_LABELS[tool]}. "
                    f"Original error: {self.error_message}"
                )
                # Post-mortem
                pm_ctx = [{
                    "role": "user",
                    "content": (
                        f"Incident summary: {summary}\n"
                        f"Original error: {self.error_message}\n"
                        f"Final action: {TOOL_LABELS[tool]} (reason: {decision.get('reason','')}).\n"
                        "Write the post-mortem."
                    ),
                }]
                await _stream_agent_message(self.chat_id, "darwin", MODELS["darwin"], prompts.POSTMORTEM_SYS, pm_ctx)
                await self._create_reports("resolved", summary)
                db.resolve_incident(self.incident_id, summary)
                target_state.state.resume_timer("incident_resolved")
                db.add_log("incident_resolved", summary, self.incident_id)
                await publish(self.chat_id, {"type": "incident_resolved", "incident_id": self.incident_id, "outcome": "resolved", "summary": summary})
                await publish_global({"type": "data_changed", "scope": "chats"})
                await publish_global({"type": "data_changed", "scope": "logs"})
                return
            else:
                self.error_message = msg
                message_id = db.add_message(
                    self.chat_id, role="system",
                    content=f"Re-test after {TOOL_LABELS[tool]}: still failing - {msg}",
                )
                message = db.get_message(message_id)
                await publish(self.chat_id, {
                    "type": "system",
                    "content": f"Re-test after {TOOL_LABELS[tool]}: still failing - {msg}",
                    "message": message,
                })

        # Out of attempts
        summary = f"Could not resolve incident after {max_attempts} attempts. Last error: {self.error_message}"
        await self._create_reports("unresolved", summary)
        db.resolve_incident(self.incident_id, summary)
        target_state.abandon_current_error()
        target_state.state.resume_timer("incident_abandoned")
        db.add_log("incident_abandoned", summary, self.incident_id)
        message_id = db.add_message(self.chat_id, role="system", content=summary)
        message = db.get_message(message_id)
        await publish(self.chat_id, {"type": "system", "content": summary, "message": message})
        await publish(self.chat_id, {"type": "incident_resolved", "incident_id": self.incident_id, "outcome": "abandoned", "summary": summary})
        await publish_global({"type": "data_changed", "scope": "chats"})
        await publish_global({"type": "data_changed", "scope": "logs"})

    async def _create_reports(self, outcome: str, summary: str):
        await create_reports_for_incident(
            incident_id=self.incident_id,
            chat_id=self.chat_id,
            outcome=outcome,
            summary=summary,
            initial_error=self.initial_error,
            last_error=self.error_message,
            attempts=self.attempts,
        )


def start_incident(chat_id: int, incident_id: int, error_message: str):
    if chat_id in _active:
        return
    runner = IncidentRunner(chat_id, incident_id, error_message)
    _active[chat_id] = runner
    asyncio.create_task(runner.run())


def is_active(chat_id: int) -> bool:
    return chat_id in _active
