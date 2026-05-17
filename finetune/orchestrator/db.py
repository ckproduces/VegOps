import json
import sqlite3
import time
from pathlib import Path
from typing import Any, Optional

DB_PATH = Path(__file__).parent / "data.db"
DEFAULT_HEALTH_URL = "/target/health"


def _conn():
    c = sqlite3.connect(DB_PATH, check_same_thread=False)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    return c


def init():
    c = _conn()
    c.executescript(
        """
        CREATE TABLE IF NOT EXISTS settings (
            k TEXT PRIMARY KEY, v TEXT
        );
        CREATE TABLE IF NOT EXISTS incidents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            started_at REAL NOT NULL,
            resolved_at REAL,
            summary TEXT,
            initial_error TEXT
        );
        CREATE TABLE IF NOT EXISTS chats (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            incident_id INTEGER,
            kind TEXT NOT NULL,  -- 'incident' | 'user'
            title TEXT,
            created_at REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_id INTEGER NOT NULL,
            role TEXT NOT NULL,  -- 'user' | 'agent' | 'system'
            agent TEXT,          -- 'rick' | 'morty' | 'darwin' | null
            content TEXT NOT NULL,
            ts REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS tool_calls (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_id INTEGER NOT NULL,
            tool TEXT NOT NULL,
            args TEXT,
            status TEXT NOT NULL,  -- 'pending_approval' | 'approved' | 'denied' | 'executing' | 'executed' | 'failed'
            result TEXT,
            tier INTEGER NOT NULL,
            ts REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts REAL NOT NULL,
            kind TEXT NOT NULL,
            summary TEXT NOT NULL,
            ref_id INTEGER
        );
        CREATE TABLE IF NOT EXISTS incident_reports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            incident_id INTEGER NOT NULL,
            audience TEXT NOT NULL,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            ts REAL NOT NULL,
            UNIQUE(incident_id, audience)
        );
        """
    )
    # default settings
    cur = c.execute("SELECT v FROM settings WHERE k='healthUrl'")
    if not cur.fetchone():
        c.execute("INSERT INTO settings(k,v) VALUES (?,?)", ("healthUrl", DEFAULT_HEALTH_URL))
    cur = c.execute("SELECT v FROM settings WHERE k='allowedTier'")
    if not cur.fetchone():
        c.execute("INSERT INTO settings(k,v) VALUES (?,?)", ("allowedTier", "0"))
    c.commit()
    c.close()


def reset_runtime():
    c = _conn()
    c.executescript(
        """
        DELETE FROM incident_reports;
        DELETE FROM tool_calls;
        DELETE FROM messages;
        DELETE FROM chats;
        DELETE FROM logs;
        DELETE FROM incidents;
        DELETE FROM sqlite_sequence
        WHERE name IN ('incident_reports', 'tool_calls', 'messages', 'chats', 'logs', 'incidents');
        """
    )
    c.execute(
        "INSERT INTO settings(k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v",
        ("healthUrl", DEFAULT_HEALTH_URL),
    )
    c.commit()
    c.close()


def get_setting(k: str, default: Optional[str] = None) -> Optional[str]:
    c = _conn()
    row = c.execute("SELECT v FROM settings WHERE k=?", (k,)).fetchone()
    c.close()
    value = row["v"] if row else default
    if k == "healthUrl" and value and value.strip().lstrip("/").startswith("target/"):
        return f"/{value.strip().lstrip('/')}"
    return value


def set_setting(k: str, v: str):
    c = _conn()
    c.execute("INSERT INTO settings(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", (k, v))
    c.commit()
    c.close()


def add_log(kind: str, summary: str, ref_id: Optional[int] = None) -> int:
    c = _conn()
    cur = c.execute(
        "INSERT INTO logs(ts,kind,summary,ref_id) VALUES(?,?,?,?)",
        (time.time(), kind, summary, ref_id),
    )
    c.commit()
    rid = cur.lastrowid
    c.close()
    return rid


def create_incident(initial_error: str) -> int:
    c = _conn()
    cur = c.execute(
        "INSERT INTO incidents(started_at, initial_error) VALUES(?, ?)",
        (time.time(), initial_error),
    )
    c.commit()
    iid = cur.lastrowid
    c.close()
    return iid


def resolve_incident(incident_id: int, summary: str):
    c = _conn()
    c.execute(
        "UPDATE incidents SET resolved_at=?, summary=? WHERE id=?",
        (time.time(), summary, incident_id),
    )
    c.commit()
    c.close()


def get_incident(incident_id: int) -> Optional[dict]:
    c = _conn()
    row = c.execute("SELECT * FROM incidents WHERE id=?", (incident_id,)).fetchone()
    c.close()
    return dict(row) if row else None


def get_chat_for_incident(incident_id: int) -> Optional[dict]:
    c = _conn()
    row = c.execute("SELECT * FROM chats WHERE incident_id=? LIMIT 1", (incident_id,)).fetchone()
    c.close()
    return dict(row) if row else None


def get_latest_open_incident_chat() -> Optional[dict]:
    c = _conn()
    row = c.execute(
        """
        SELECT
            c.id AS chat_id,
            i.id AS incident_id,
            i.initial_error
        FROM incidents i
        JOIN chats c ON c.incident_id = i.id
        WHERE i.resolved_at IS NULL
        ORDER BY i.id DESC
        LIMIT 1
        """
    ).fetchone()
    c.close()
    return dict(row) if row else None


def has_pending_tool_call(chat_id: int) -> bool:
    c = _conn()
    row = c.execute(
        "SELECT 1 FROM tool_calls WHERE chat_id=? AND status='pending_approval' LIMIT 1",
        (chat_id,),
    ).fetchone()
    c.close()
    return row is not None


def has_any_pending_tool_call() -> bool:
    c = _conn()
    row = c.execute(
        "SELECT 1 FROM tool_calls WHERE status='pending_approval' LIMIT 1"
    ).fetchone()
    c.close()
    return row is not None


def create_chat(kind: str, title: str, incident_id: Optional[int] = None) -> int:
    c = _conn()
    cur = c.execute(
        "INSERT INTO chats(incident_id, kind, title, created_at) VALUES(?,?,?,?)",
        (incident_id, kind, title, time.time()),
    )
    c.commit()
    cid = cur.lastrowid
    c.close()
    return cid


def list_chats() -> list[dict]:
    c = _conn()
    rows = c.execute(
        "SELECT c.*, i.resolved_at, i.summary AS incident_summary "
        "FROM chats c LEFT JOIN incidents i ON c.incident_id=i.id "
        "ORDER BY c.created_at DESC"
    ).fetchall()
    c.close()
    return [dict(r) for r in rows]


def get_chat(chat_id: int) -> Optional[dict]:
    c = _conn()
    row = c.execute("SELECT * FROM chats WHERE id=?", (chat_id,)).fetchone()
    c.close()
    return dict(row) if row else None


def add_message(chat_id: int, role: str, content: str, agent: Optional[str] = None) -> int:
    c = _conn()
    cur = c.execute(
        "INSERT INTO messages(chat_id, role, agent, content, ts) VALUES(?,?,?,?,?)",
        (chat_id, role, agent, content, time.time()),
    )
    c.commit()
    mid = cur.lastrowid
    c.close()
    return mid


def get_message(message_id: int) -> Optional[dict]:
    c = _conn()
    row = c.execute("SELECT * FROM messages WHERE id=?", (message_id,)).fetchone()
    c.close()
    return dict(row) if row else None


def get_messages(chat_id: int) -> list[dict]:
    c = _conn()
    rows = c.execute(
        "SELECT * FROM messages WHERE chat_id=? ORDER BY id ASC", (chat_id,)
    ).fetchall()
    c.close()
    return [dict(r) for r in rows]


def add_tool_call(chat_id: int, tool: str, args: dict, tier: int, status: str = "pending_approval") -> int:
    c = _conn()
    cur = c.execute(
        "INSERT INTO tool_calls(chat_id, tool, args, status, tier, ts) VALUES(?,?,?,?,?,?)",
        (chat_id, tool, json.dumps(args), status, tier, time.time()),
    )
    c.commit()
    tid = cur.lastrowid
    c.close()
    return tid


def update_tool_call(tool_call_id: int, status: str, result: Optional[dict] = None):
    c = _conn()
    c.execute(
        "UPDATE tool_calls SET status=?, result=? WHERE id=?",
        (status, json.dumps(result) if result is not None else None, tool_call_id),
    )
    c.commit()
    c.close()


def get_tool_call(tool_call_id: int) -> Optional[dict]:
    c = _conn()
    row = c.execute("SELECT * FROM tool_calls WHERE id=?", (tool_call_id,)).fetchone()
    c.close()
    if not row:
        return None
    d = dict(row)
    d["args"] = json.loads(d["args"]) if d["args"] else {}
    d["result"] = json.loads(d["result"]) if d["result"] else None
    return d


def get_tool_calls_for_chat(chat_id: int) -> list[dict]:
    c = _conn()
    rows = c.execute(
        "SELECT * FROM tool_calls WHERE chat_id=? ORDER BY id ASC", (chat_id,)
    ).fetchall()
    c.close()
    out = []
    for r in rows:
        d = dict(r)
        d["args"] = json.loads(d["args"]) if d["args"] else {}
        d["result"] = json.loads(d["result"]) if d["result"] else None
        out.append(d)
    return out


def list_logs(limit: int = 200) -> list[dict]:
    c = _conn()
    rows = c.execute("SELECT * FROM logs ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
    c.close()
    return [dict(r) for r in rows]


def add_report(incident_id: int, audience: str, title: str, content: str) -> int:
    c = _conn()
    cur = c.execute(
        """
        INSERT INTO incident_reports(incident_id, audience, title, content, ts)
        VALUES(?,?,?,?,?)
        ON CONFLICT(incident_id, audience)
        DO UPDATE SET title=excluded.title, content=excluded.content, ts=excluded.ts
        """,
        (incident_id, audience, title, content, time.time()),
    )
    c.commit()
    row = c.execute(
        "SELECT id FROM incident_reports WHERE incident_id=? AND audience=?",
        (incident_id, audience),
    ).fetchone()
    rid = row["id"] if row else cur.lastrowid
    c.close()
    return rid


def list_reports() -> list[dict]:
    c = _conn()
    rows = c.execute(
        """
        SELECT
            r.*,
            i.started_at,
            i.resolved_at,
            i.summary AS incident_summary,
            i.initial_error,
            c.title AS chat_title,
            c.id AS chat_id
        FROM incident_reports r
        JOIN incidents i ON i.id = r.incident_id
        LEFT JOIN chats c ON c.incident_id = i.id
        ORDER BY i.id DESC, r.id ASC
        """
    ).fetchall()
    c.close()
    return [dict(r) for r in rows]


def list_closed_incidents_missing_reports(required_count: int) -> list[dict]:
    c = _conn()
    rows = c.execute(
        """
        SELECT i.*, COUNT(r.id) AS report_count
        FROM incidents i
        LEFT JOIN incident_reports r ON r.incident_id = i.id
        WHERE i.resolved_at IS NOT NULL
        GROUP BY i.id
        HAVING COUNT(r.id) < ?
        ORDER BY i.id ASC
        """,
        (required_count,),
    ).fetchall()
    c.close()
    return [dict(r) for r in rows]


def search_history(query: str, limit: int = 30) -> list[dict]:
    """Free-text search across logs + messages, for @mention retrieval."""
    c = _conn()
    q = f"%{query}%"
    log_rows = c.execute(
        "SELECT 'log' AS source, ts, summary AS text, kind FROM logs WHERE summary LIKE ? ORDER BY id DESC LIMIT ?",
        (q, limit),
    ).fetchall()
    msg_rows = c.execute(
        "SELECT 'message' AS source, ts, content AS text, agent AS kind FROM messages WHERE content LIKE ? ORDER BY id DESC LIMIT ?",
        (q, limit),
    ).fetchall()
    c.close()
    out = [dict(r) for r in log_rows] + [dict(r) for r in msg_rows]
    out.sort(key=lambda r: r["ts"], reverse=True)
    return out[:limit]


def recent_history(limit: int = 50) -> list[dict]:
    c = _conn()
    log_rows = c.execute(
        "SELECT 'log' AS source, ts, summary AS text, kind FROM logs ORDER BY id DESC LIMIT ?",
        (limit,),
    ).fetchall()
    c.close()
    return [dict(r) for r in log_rows]


def full_history_brief(max_incidents: int = 10, max_chats: int = 6) -> str:
    """Build a compact-but-comprehensive history string for @mention context.

    Includes every recent incident with its tool calls + outcome, plus the last
    few non-incident chats' messages. Designed so an agent can answer 'what did
    we do for incident #2' or 'did you restart the server last week'.
    """
    c = _conn()
    incidents = c.execute(
        "SELECT * FROM incidents ORDER BY id DESC LIMIT ?", (max_incidents,)
    ).fetchall()
    blocks: list[str] = []
    for inc in incidents:
        chat_row = c.execute(
            "SELECT id FROM chats WHERE incident_id=? LIMIT 1", (inc["id"],)
        ).fetchone()
        chat_id = chat_row["id"] if chat_row else None
        tool_rows = c.execute(
            "SELECT tool, status, args FROM tool_calls WHERE chat_id=? ORDER BY id ASC",
            (chat_id,),
        ).fetchall() if chat_id else []
        msg_rows = c.execute(
            "SELECT agent, role, content FROM messages WHERE chat_id=? ORDER BY id ASC",
            (chat_id,),
        ).fetchall() if chat_id else []

        started = time.strftime("%Y-%m-%d %H:%M", time.localtime(inc["started_at"]))
        status = "RESOLVED" if inc["resolved_at"] else "UNRESOLVED"
        tools_str = ", ".join(f"{t['tool']}({t['status']})" for t in tool_rows) or "no tools used"
        last_msgs = []
        for m in msg_rows[-6:]:
            who = m["agent"] or m["role"]
            content = (m["content"] or "")[:200]
            last_msgs.append(f"    {who}: {content}")
        msgs_str = "\n".join(last_msgs) if last_msgs else "    (no messages)"
        blocks.append(
            f"INCIDENT #{inc['id']} [{status}] at {started}\n"
            f"  initial error: {inc['initial_error']}\n"
            f"  summary: {inc['summary'] or '(unresolved)'}\n"
            f"  tools: {tools_str}\n"
            f"  conversation tail:\n{msgs_str}"
        )

    user_chats = c.execute(
        "SELECT id, title, created_at FROM chats WHERE kind='user' ORDER BY id DESC LIMIT ?",
        (max_chats,),
    ).fetchall()
    for ch in user_chats:
        msgs = c.execute(
            "SELECT agent, role, content FROM messages WHERE chat_id=? ORDER BY id ASC",
            (ch["id"],),
        ).fetchall()
        tail = "\n".join(f"    {(m['agent'] or m['role'])}: {(m['content'] or '')[:200]}" for m in msgs[-6:]) or "    (empty)"
        when = time.strftime("%Y-%m-%d %H:%M", time.localtime(ch["created_at"]))
        blocks.append(f"USER CHAT #{ch['id']} '{ch['title']}' at {when}\n{tail}")

    c.close()
    return "\n\n".join(blocks) if blocks else "(no history yet)"
