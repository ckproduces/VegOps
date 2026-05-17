"""Per-chat in-memory event bus for SSE."""
import asyncio
from collections import defaultdict
from typing import Any


_subscribers: dict[int, list[asyncio.Queue]] = defaultdict(list)


def subscribe(chat_id: int) -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue()
    _subscribers[chat_id].append(q)
    return q


def unsubscribe(chat_id: int, q: asyncio.Queue):
    if q in _subscribers[chat_id]:
        _subscribers[chat_id].remove(q)


async def publish(chat_id: int, event: dict[str, Any]):
    for q in list(_subscribers[chat_id]):
        await q.put(event)


# Global bus (for things like "new chat created" so the UI can refresh)
_global: list[asyncio.Queue] = []


def subscribe_global() -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue()
    _global.append(q)
    return q


def unsubscribe_global(q: asyncio.Queue):
    if q in _global:
        _global.remove(q)


async def publish_global(event: dict[str, Any]):
    for q in list(_global):
        await q.put(event)
