"""Settings for the MediAssist agent.

Values are read from the project's root .env (one level above agent/) and,
if present, from agent/.env. Every agent-specific setting has a default, so
the only values you must have are OPENAI_API_KEY and, for Node 1's RAG,
MEDICINE_AI_DATABASE_URL. Both already exist in the root .env.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

AGENT_DIR = Path(__file__).resolve().parent.parent  # .../mediAssist-fyp/agent
PROJECT_ROOT = AGENT_DIR.parent                      # .../mediAssist-fyp


def _load_env_files() -> None:
    try:
        from dotenv import load_dotenv
    except ImportError:  # python-dotenv not installed: rely on the real environment
        return
    from dotenv import dotenv_values

    # Priority: variables already set in the process (e.g. eval --model) > agent/.env > root .env
    already_set = set(os.environ)
    for key, value in dotenv_values(AGENT_DIR / ".env").items():
        if key not in already_set and value is not None:
            os.environ[key] = value
    load_dotenv(PROJECT_ROOT / ".env", override=False)


_load_env_files()


def _env(name: str, default: str | None = None) -> str | None:
    value = os.getenv(name)
    return value if value not in (None, "") else default


def _path(name: str, default: Path) -> Path:
    raw = _env(name)
    if not raw:
        return default
    p = Path(raw)
    return p if p.is_absolute() else (AGENT_DIR / p)


@dataclass(frozen=True)
class Settings:
    # LLM + embeddings (OpenAI)
    openai_api_key: str | None = field(default_factory=lambda: _env("OPENAI_API_KEY"))
    llm_model: str = field(default_factory=lambda: _env("AGENT_LLM_MODEL", "gpt-6-luna"))
    llm_temperature: float = field(default_factory=lambda: float(_env("AGENT_LLM_TEMPERATURE", "0")))
    embedding_model: str = field(default_factory=lambda: _env("AGENT_EMBEDDING_MODEL", "text-embedding-3-small"))
    # medicinedb uses VECTOR(768) (docker/postgres/init.sql), so embeddings are requested at 768 dims.
    embedding_dim: int = field(default_factory=lambda: int(_env("AGENT_EMBEDDING_DIM", "768")))

    # Node 1 RAG (pgvector in the medicinedb schema)
    medicine_db_url: str | None = field(default_factory=lambda: _env("MEDICINE_AI_DATABASE_URL"))
    rag_table_prefix: str = field(default_factory=lambda: _env("AGENT_RAG_TABLE_PREFIX", "agent"))
    # Dataset labels are short condition names ("Pain", "Fever", "Hypertension"); tune this during evaluation.
    rag_min_similarity: float = field(default_factory=lambda: float(_env("AGENT_RAG_MIN_SIMILARITY", "0.60")))
    rag_label_top_n: int = field(default_factory=lambda: int(_env("AGENT_RAG_LABEL_TOP_N", "5")))
    rag_label_margin: float = field(default_factory=lambda: float(_env("AGENT_RAG_LABEL_MARGIN", "0.10")))
    # Node 1 retrieves this many candidates per symptom, then the LLM review keeps the appropriate ones
    rag_candidates_per_symptom: int = field(default_factory=lambda: int(_env("AGENT_RAG_CANDIDATES_PER_SYMPTOM", "8")))
    rag_llm_review: bool = field(default_factory=lambda: _env("AGENT_RAG_LLM_REVIEW", "true").lower() == "true")
    rag_max_medicines_per_symptom: int = field(default_factory=lambda: int(_env("AGENT_RAG_MAX_MEDS_PER_SYMPTOM", "3")))

    # Fallback wrapper
    max_retries: int = field(default_factory=lambda: int(_env("AGENT_MAX_RETRIES", "2")))

    # Transcript inbox (temporary folder the agent picks transcripts up from)
    inbox_dir: Path = field(default_factory=lambda: _path("AGENT_INBOX_DIR", AGENT_DIR / "inbox"))
    outbox_dir: Path = field(default_factory=lambda: _path("AGENT_OUTBOX_DIR", AGENT_DIR / "outbox"))
    delete_processed: bool = field(default_factory=lambda: _env("AGENT_DELETE_PROCESSED", "false").lower() == "true")
    poll_seconds: float = field(default_factory=lambda: float(_env("AGENT_POLL_SECONDS", "3")))

    soap_schema_version: str = "1.0"


settings = Settings()
