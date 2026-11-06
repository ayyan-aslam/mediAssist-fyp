"""Temporary transcript folder the agent picks work up from.

  inbox/pending/     <- a transcript lands here (<consultation_id>.txt, optional <consultation_id>.json
                        with {"patient_id": "...", "doctor_id": "..."})
  inbox/processing/  <- the agent MOVES it here before working (atomic rename, so a file is never
                        picked twice and a half-copied file is never read - see note below)
  inbox/done/        <- finished OK   (or deleted, if AGENT_DELETE_PROCESSED=true)
  inbox/failed/      <- crashed; kept for inspection
  outbox/<consultation_id>.json  <- the SOAP response for the front end

Note for whoever writes into pending/: write to "<name>.txt.part" first, then rename to "<name>.txt".
Files ending in .part are ignored, so the agent never reads a transcript that is still being written.
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from ..config import settings


@dataclass
class Job:
    consultation_id: str
    transcript_path: Path
    meta_path: Optional[Path]
    patient_id: Optional[str] = None
    doctor_id: Optional[str] = None

    def read_transcript(self) -> str:
        return self.transcript_path.read_text(encoding="utf-8-sig", errors="replace")


class TranscriptInbox:
    def __init__(self, root: Path | None = None, outbox: Path | None = None):
        self.root = root or settings.inbox_dir
        self.outbox = outbox or settings.outbox_dir
        for sub in ("pending", "processing", "done", "failed"):
            (self.root / sub).mkdir(parents=True, exist_ok=True)
        self.outbox.mkdir(parents=True, exist_ok=True)

    def _dir(self, name: str) -> Path:
        return self.root / name

    def claim_next(self) -> Optional[Job]:
        """Atomically move the oldest pending transcript into processing/ and return it."""
        pending = sorted(self._dir("pending").glob("*.txt"), key=lambda p: p.stat().st_mtime)
        for src in pending:
            dst = self._dir("processing") / src.name
            try:
                os.replace(src, dst)  # atomic on the same drive; loser of a race gets FileNotFoundError
            except FileNotFoundError:
                continue
            meta_src = src.with_suffix(".json")
            meta_dst = None
            meta: dict = {}
            if meta_src.exists():
                meta_dst = self._dir("processing") / meta_src.name
                os.replace(meta_src, meta_dst)
                try:
                    meta = json.loads(meta_dst.read_text(encoding="utf-8"))
                except json.JSONDecodeError:
                    meta = {}
            return Job(
                consultation_id=str(meta.get("consultation_id") or src.stem),
                transcript_path=dst, meta_path=meta_dst,
                patient_id=meta.get("patient_id"), doctor_id=meta.get("doctor_id"),
            )
        return None

    def write_result(self, job: Job, response: dict) -> Path:
        out = self.outbox / f"{job.consultation_id}.json"
        tmp = out.with_suffix(".json.part")
        tmp.write_text(json.dumps(response, indent=2, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, out)
        return out

    def finish(self, job: Job, ok: bool) -> None:
        files = [p for p in (job.transcript_path, job.meta_path) if p and p.exists()]
        if ok and settings.delete_processed:
            for p in files:
                p.unlink(missing_ok=True)
            return
        target = self._dir("done" if ok else "failed")
        for p in files:
            os.replace(p, target / p.name)
