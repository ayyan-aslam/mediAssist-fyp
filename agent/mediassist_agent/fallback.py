"""Fallback wrapper used by every node: validate -> retry -> degrade.

  run node -> output validated by Pydantic inside the node
     ok      -> return update, graph continues
     error   -> retries left?  yes -> run again with attempt+1 (node can use a firmer prompt)
                               no  -> return the node's EMPTY result + an error flag

A failed node never fabricates data. It returns nothing and says so, and the
SOAP response shows the doctor a warning for that section.
"""
from __future__ import annotations

import functools
import logging
import time
from typing import Any, Callable

from .config import settings

log = logging.getLogger("mediassist_agent")

NodeFn = Callable[[dict, int], dict]


def resilient_node(name: str, empty_update: dict[str, Any], max_retries: int | None = None):
    """Decorate `fn(state, attempt) -> dict` and return a LangGraph node `node(state) -> dict`."""

    def decorator(fn: NodeFn) -> Callable[[dict], dict]:
        @functools.wraps(fn)
        def node(state: dict) -> dict:
            retries = settings.max_retries if max_retries is None else max_retries
            last_error: Exception | None = None
            for attempt in range(retries + 1):
                started = time.perf_counter()
                try:
                    update = fn(state, attempt)
                    log.info("node=%s attempt=%d ok in %.2fs", name, attempt, time.perf_counter() - started)
                    return update
                except Exception as exc:  # includes pydantic.ValidationError and API errors
                    last_error = exc
                    log.warning("node=%s attempt=%d failed: %s", name, attempt, exc)
            log.error("node=%s gave up after %d attempt(s)", name, retries + 1)
            return {
                **{k: (v.copy() if isinstance(v, (list, dict)) else v) for k, v in empty_update.items()},
                "errors": [
                    {
                        "node": name,
                        "error": f"{type(last_error).__name__}: {str(last_error)[:300]}",
                        "attempts": retries + 1,
                    }
                ],
            }

        return node

    return decorator


FIRMER_INSTRUCTION = (
    "\n\nIMPORTANT: Your previous answer could not be parsed. Return ONLY data that matches the "
    "schema exactly. Use null for anything not stated. Do not add fields."
)


def firmer(prompt: str, attempt: int) -> str:
    """Append a stricter instruction on retries."""
    return prompt + FIRMER_INSTRUCTION if attempt > 0 else prompt
