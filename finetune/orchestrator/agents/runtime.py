import os
from pathlib import Path
from typing import AsyncIterator

from dotenv import load_dotenv
from openai import AsyncOpenAI

load_dotenv(Path(__file__).parent.parent.parent / ".env")

FAL_KEY = os.environ.get("FAL_KEY", "")

client = AsyncOpenAI(
    base_url="https://fal.run/openrouter/router/openai/v1",
    api_key="not-needed",
    default_headers={"Authorization": f"Key {FAL_KEY}"},
)

MODELS = {
    "rick": "qwen/qwen-2.5-7b-instruct",
    "morty": "qwen/qwen-2.5-7b-instruct",
    "darwin": "deepseek/deepseek-v4-pro",
}


async def stream_chat(model: str, system: str, messages: list[dict]) -> AsyncIterator[str]:
    full_messages = [{"role": "system", "content": system}] + messages
    try:
        stream = await client.chat.completions.create(
            model=model,
            messages=full_messages,
            stream=True,
            max_tokens=400,
            temperature=0.7,
        )
        async for chunk in stream:
            if chunk.choices and chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content
    except Exception as e:
        yield f"[model error: {e}]"


async def complete(model: str, system: str, messages: list[dict]) -> str:
    out = []
    async for tok in stream_chat(model, system, messages):
        out.append(tok)
    return "".join(out)
