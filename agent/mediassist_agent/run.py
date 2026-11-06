"""Command line entry point.

  python -m mediassist_agent.run --file samples/sample_consultation_01.txt   # one file, print JSON
  python -m mediassist_agent.run --once                                      # process everything in inbox/pending
  python -m mediassist_agent.run --watch                                     # keep polling inbox/pending
  python -m mediassist_agent.run --rabbitmq                                  # the system: read transcript.ready
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from pathlib import Path

from .config import settings
from .sources.inbox import TranscriptInbox

log = logging.getLogger("mediassist_agent")


def _process_job(inbox: TranscriptInbox, job) -> bool:
    from .graph import run_consultation

    log.info("processing consultation %s", job.consultation_id)
    try:
        response = run_consultation(job.read_transcript(), job.consultation_id, job.patient_id, job.doctor_id)
        out = inbox.write_result(job, response)
        inbox.finish(job, ok=True)
        log.info("done -> %s (%d warning(s))", out, len(response.get("warnings", [])))
        return True
    except Exception:
        log.exception("consultation %s failed", job.consultation_id)
        inbox.finish(job, ok=False)
        return False


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    ap = argparse.ArgumentParser(description="MediAssist LangGraph agent")
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--file", type=Path, help="Run one transcript file and print the SOAP JSON")
    g.add_argument("--once", action="store_true", help="Process all transcripts in inbox/pending, then exit")
    g.add_argument("--watch", action="store_true", help="Keep polling inbox/pending")
    g.add_argument("--rabbitmq", action="store_true", help="Read transcript.ready from RabbitMQ and answer it")
    ap.add_argument("--consultation-id", default=None)
    a = ap.parse_args(argv)

    if a.rabbitmq:
        from .sources.rabbitmq import TranscriptConsumer

        TranscriptConsumer().start()
        return 0

    if a.file:
        from .graph import run_consultation

        response = run_consultation(a.file.read_text(encoding="utf-8-sig"), a.consultation_id or a.file.stem)
        print(json.dumps(response, indent=2, ensure_ascii=False))
        return 0

    inbox = TranscriptInbox()
    log.info("inbox: %s", inbox.root / "pending")
    while True:
        job = inbox.claim_next()
        if job:
            _process_job(inbox, job)
            continue
        if a.once:
            return 0
        time.sleep(settings.poll_seconds)


if __name__ == "__main__":
    sys.exit(main())
