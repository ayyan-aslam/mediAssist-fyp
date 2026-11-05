"""Anti-hallucination checks: everything an LLM extracts must be traceable to the transcript.

This is plain code (no LLM), run after every extraction:
  * source_text  - the quote the LLM gives must really occur in the transcript (fuzzy, to allow for
                   small punctuation/spacing differences)
  * names        - a medicine name must appear in the transcript (spelling-tolerant)
  * numbers      - every number in a dose / strength / frequency / duration must appear in the transcript
                   ("five" and "5" count as the same). Ungrounded fields are set to null, never guessed.
Items that fail are removed and reported as warnings so the doctor can see what was rejected.
"""
from __future__ import annotations

import difflib
import re

_NUMBER_WORDS = {
    "zero": "0", "one": "1", "two": "2", "three": "3", "four": "4", "five": "5", "six": "6", "seven": "7",
    "eight": "8", "nine": "9", "ten": "10", "eleven": "11", "twelve": "12", "fifteen": "15", "twenty": "20",
    "thirty": "30", "half": "0.5",
    # Roman Urdu ("do" = 2 is left out on purpose: it is also an English word)
    "ek": "1", "aik": "1", "teen": "3", "char": "4", "chaar": "4", "panch": "5", "paanch": "5",
    "chhe": "6", "che": "6", "saat": "7", "aath": "8", "nau": "9", "das": "10", "aadha": "0.5",
}
# frequencies are kept apart from counts: "twice" / "two times" -> "2x", never plain "2"
_FREQ_WORDS = {"once": "1x", "twice": "2x", "thrice": "3x"}


def normalise(text: str | None) -> str:
    t = (text or "").lower()
    t = re.sub(r"\b(doctor|patient|attendant|unknown)\s*:", " ", t)  # speaker tags
    t = re.sub(r"[^a-z0-9. ]", " ", t)
    words = [_FREQ_WORDS.get(w, _NUMBER_WORDS.get(w, w)) for w in t.split()]
    t = " ".join(w.strip(".") for w in words if w.strip("."))
    # "3 times a day" / "teen dafa" / "2 bar" -> "3x a day" (a frequency, not a count)
    return re.sub(r"\b(\d+) (?:times?|dafa|daffa|baar|bar|martaba)\b", r"\1x", t)


def numbers(text: str | None) -> set[str]:
    """Number tokens: '500', '1', '2x' (a frequency)."""
    return set(re.findall(r"\b\d+(?:\.\d+)?x?\b", normalise(text)))


class Transcript:
    def __init__(self, text: str):
        self.text = text
        self.norm = normalise(text)
        self.tokens = set(self.norm.split())
        self.numbers = numbers(text)
        self.lines = [ln for ln in text.splitlines() if ln.strip()]

    def context(self, name: str | None, quote: str | None = None) -> str:
        """The transcript lines that talk about `name` plus the 3 lines after each (where the doctor often
        completes the instruction after a question), plus the quote if it is real."""
        parts = []
        if quote and self.has_quote(quote):
            parts.append(quote)
        words = [w for w in normalise(name).split() if not re.fullmatch(r"[\d.]+x?|mg|ml|mcg|g", w)]
        for i, line in enumerate(self.lines):
            toks = set(normalise(line).split())
            if words and all(w in toks or difflib.get_close_matches(w, toks, n=1, cutoff=0.85) for w in words):
                parts.extend(self.lines[i:i + 4])  # + up to 3 following lines (e.g. "For how long?" -> answer)
        return "\n".join(parts)

    def numbers_in_context(self, value: str | None, name: str | None, quote: str | None = None) -> bool:
        """Every number in `value` must appear in the lines about this medicine/item."""
        need = numbers(value)
        return not need or need <= numbers(self.context(name, quote))

    def has_quote(self, quote: str | None, min_ratio: float = 0.85) -> bool:
        """True if (almost all of) the quote occurs in the transcript."""
        q = normalise(quote)
        if not q:
            return False
        if q in self.norm:
            return True
        q_tokens = q.split()
        found = sum(1 for w in q_tokens if w in self.tokens or self._close(w))
        return found / len(q_tokens) >= min_ratio

    def has_name(self, name: str | None) -> bool:
        """True if every word of the name (ignoring dosage numbers/units) occurs in the transcript."""
        words = [w for w in normalise(name).split() if not re.fullmatch(r"[\d.]+|mg|ml|mcg|g|tab|tablet", w)]
        return bool(words) and all(w in self.tokens or self._close(w) for w in words)

    def has_numbers(self, text: str | None) -> bool:
        return numbers(text) <= self.numbers

    def _close(self, word: str) -> bool:
        return len(word) > 3 and bool(difflib.get_close_matches(word, self.tokens, n=1, cutoff=0.85))


def warning(node: str, message: str) -> dict:
    return {"node": node, "error": message, "attempts": 1, "kind": "verification"}
