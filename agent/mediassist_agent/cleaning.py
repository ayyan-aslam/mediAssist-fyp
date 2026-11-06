"""Step 0: light regex (RE) cleaning of the speaker-tagged transcript.

Deliberately simple - it only tidies the text, it never removes medical content:
  * normalises line endings, strips BOM / zero-width characters
  * removes timestamps like [00:01:23], (01:23), 00:01:23 -
  * unifies speaker tags: "Dr.", "DOCTOR", "D:" -> "Doctor:";  "Pt", "PATIENT", "P:" -> "Patient:"
  * removes filler words (um, uh, hmm, erm, ah) and collapses repeated spaces/blank lines
  * joins untagged continuation lines onto the previous speaker's turn
"""
from __future__ import annotations

import re

_TIMESTAMP = re.compile(r"^\s*[\[(]?\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?[\])]?\s*[-–]?\s*")
_SPEAKER = re.compile(r"^\s*(?P<tag>[A-Za-z][A-Za-z .'_-]{0,24}?)\s*[:：]\s*(?P<text>.*)$")
_FILLERS = re.compile(r"\b(?:u+m+|u+h+|h+m+|e+r+m+|a+h+)\b[,.]?\s*", re.IGNORECASE)
_SPACES = re.compile(r"[ \t]{2,}")
_ZERO_WIDTH = re.compile(r"[​-‏﻿]")

_DOCTOR_TAGS = {"doctor", "dr", "dr.", "d", "doc", "physician"}
_PATIENT_TAGS = {"patient", "pt", "pt.", "p", "pat"}


def _normalise_speaker(tag: str) -> str:
    t = tag.strip().lower()
    if t in _DOCTOR_TAGS or t.startswith("dr ") or t.startswith("dr.") or t.startswith("doctor"):
        return "Doctor"
    if t in _PATIENT_TAGS or t.startswith("patient"):
        return "Patient"
    return tag.strip().title()  # e.g. "Attendant", "Mother"


def _clean_text(text: str) -> str:
    text = _FILLERS.sub("", text)
    text = _SPACES.sub(" ", text)
    return text.strip(" ,")


def parse_turns(raw: str) -> list[dict[str, str]]:
    raw = _ZERO_WIDTH.sub("", raw).replace("\r\n", "\n").replace("\r", "\n")
    turns: list[dict[str, str]] = []
    for line in raw.split("\n"):
        line = _TIMESTAMP.sub("", line).strip()
        if not line:
            continue
        m = _SPEAKER.match(line)
        if m:
            text = _clean_text(m.group("text"))
            speaker = _normalise_speaker(m.group("tag"))
            if turns and turns[-1]["speaker"] == speaker:
                turns[-1]["text"] = f"{turns[-1]['text']} {text}".strip()
            else:
                turns.append({"speaker": speaker, "text": text})
        else:
            text = _clean_text(line)
            if turns:
                turns[-1]["text"] = f"{turns[-1]['text']} {text}".strip()
            else:
                turns.append({"speaker": "Unknown", "text": text})
    return [t for t in turns if t["text"]]


def turns_to_text(turns: list[dict[str, str]]) -> str:
    return "\n".join(f"{t['speaker']}: {t['text']}" for t in turns)


def clean_transcript(raw: str) -> tuple[str, list[dict[str, str]]]:
    turns = parse_turns(raw)
    return turns_to_text(turns), turns
