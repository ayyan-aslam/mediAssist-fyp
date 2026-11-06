"""Step 0 - RE cleaning (runs once, before the parallel fan-out)."""
from __future__ import annotations

from ..cleaning import clean_transcript


def clean_node(state: dict) -> dict:
    transcript, turns = clean_transcript(state.get("raw_transcript", ""))
    if not transcript.strip():
        # An empty transcript is not something a retry can fix: stop early, clearly.
        return {"transcript": "", "turns": [], "errors": [{"node": "clean", "error": "Empty transcript", "attempts": 1}]}
    return {"transcript": transcript, "turns": turns}
