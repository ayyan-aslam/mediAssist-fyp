"""List the OpenAI chat models your API key can use, so you can pick AGENT_LLM_MODEL.

    python -m mediassist_agent.models
"""
from __future__ import annotations

from .config import settings


def main() -> None:
    from openai import OpenAI

    client = OpenAI(api_key=settings.openai_api_key)
    ids = sorted(m.id for m in client.models.list().data)
    chat = [i for i in ids if i.startswith(("gpt-", "o1", "o3", "o4"))
            and not any(x in i for x in ("audio", "realtime", "transcribe", "tts", "image", "search", "embedding"))]
    print(f"current AGENT_LLM_MODEL = {settings.llm_model}\n")
    print("chat models available to your key:")
    for i in chat:
        print("  ", i)


if __name__ == "__main__":
    main()
