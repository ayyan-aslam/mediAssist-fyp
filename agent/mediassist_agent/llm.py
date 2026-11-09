"""OpenAI chat model + embeddings (imported lazily so tests run without the SDK)."""
from __future__ import annotations

import logging
from functools import lru_cache
from typing import Type, TypeVar

from pydantic import BaseModel

from .config import settings

T = TypeVar("T", bound=BaseModel)
log = logging.getLogger("mediassist_agent")


_NO_TEMPERATURE: set[str] = set()  # models that rejected a temperature setting at runtime


def _required(value: str | None, name: str) -> str:
    if not value:
        raise RuntimeError(f"{name} is not set. Set it in agent/.env (copy agent/.env.example).")
    return value


@lru_cache(maxsize=4)
def chat_model(send_temperature: bool = True):
    from langchain_openai import ChatOpenAI

    if not settings.openai_api_key:
        raise RuntimeError("OPENAI_API_KEY is not set (root .env).")
    _required(settings.llm_model, "AGENT_LLM_MODEL")
    kwargs = {}
    # Low temperature = deterministic, conservative extraction. Some reasoning models (gpt-5.x / o-series)
    # only accept their default; if the API rejects it we fall back automatically (see extract()).
    if send_temperature:
        kwargs["temperature"] = settings.llm_temperature
    return ChatOpenAI(model=settings.llm_model, api_key=settings.openai_api_key, timeout=120, **kwargs)


@lru_cache(maxsize=1)
def embeddings_model():
    from langchain_openai import OpenAIEmbeddings

    if not settings.openai_api_key:
        raise RuntimeError("OPENAI_API_KEY is not set (root .env).")
    return OpenAIEmbeddings(
        model=_required(settings.embedding_model, "AGENT_EMBEDDING_MODEL"),
        dimensions=settings.embedding_dim,
        api_key=settings.openai_api_key,
    )


def extract(schema: Type[T], system_prompt: str, transcript: str) -> T:
    """Run one structured-extraction call and return a validated Pydantic object.

    function_calling (non-strict) is used because our schemas have Optional
    fields; Pydantic validates the result, and a failure triggers the fallback retry.
    """
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": f"CONSULTATION TRANSCRIPT:\n\n{transcript}"},
    ]
    use_temp = settings.llm_model not in _NO_TEMPERATURE
    try:
        result = chat_model(use_temp).with_structured_output(schema, method="function_calling").invoke(messages)
    except Exception as exc:
        if not use_temp or "temperature" not in str(exc).lower():
            raise
        log.warning("model %s does not accept temperature=%s - using its default", settings.llm_model,
                    settings.llm_temperature)
        _NO_TEMPERATURE.add(settings.llm_model)
        result = chat_model(False).with_structured_output(schema, method="function_calling").invoke(messages)
    if result is None:
        raise ValueError(f"LLM returned no {schema.__name__}")
    return result if isinstance(result, schema) else schema.model_validate(result)


def embed(texts: list[str]) -> list[list[float]]:
    return embeddings_model().embed_documents(texts)
