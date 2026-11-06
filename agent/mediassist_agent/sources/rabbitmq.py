"""RabbitMQ mode: the way the system talks to the agent (design doc 3.4.5, 5.6, 6.3, 6.4.3 to 6.4.5).

  ai-pipeline.transcript.ready  ->  run_consultation()  ->  soap.generated  or  soap.generation.failed

  * Only connects. The Consultation Service creates the exchange and every queue at startup, so the
    queue is checked with a passive declare and never created here.
  * Prefetch 1 and manual ack: a message is acked only after its answer is published (publisher confirms).
  * If publishing fails, the message is nacked without requeue: it waits 10 s in <queue>.retry and comes
    back. The 3rd failure (counted from x-death) moves it to <queue>.dlq, like the Node services do.

    python -m mediassist_agent.run --rabbitmq
"""
from __future__ import annotations

import json
import logging
import signal
import time
import uuid
from datetime import datetime, timezone
from typing import Callable

from ..config import settings

log = logging.getLogger("mediassist_agent")

EXCHANGE = "mediassist.events"
QUEUE = "ai-pipeline.transcript.ready"
SOURCE = "ai-pipeline"
MAX_TRIES = 3
RECONNECT_SECONDS = 5
MESSAGE_MAX_CHARS = 300
PRESCRIPTION_FIELDS = ("name", "strength", "dose", "frequency", "duration", "instructions")


class BadTranscript(ValueError):
    """The transcript is empty or not text."""


# ---------------------------------------------------------------- pure mapping (no RabbitMQ)
def plan_text(plan: dict | None) -> str:
    """One line per prescribed medicine (empty fields left out), then the plan notes on their own line."""
    plan = plan or {}
    lines = []
    for item in plan.get("prescription") or []:
        parts = [str(item[f]).strip() for f in PRESCRIPTION_FIELDS if item.get(f) and str(item[f]).strip()]
        if parts:
            lines.append(", ".join(parts))
    notes = (plan.get("notes") or "").strip()
    if notes:
        lines.append(notes)
    return "\n".join(lines)


def soap_generated_data(consultation_id, attempt, response: dict) -> dict:
    """The data of soap.generated (6.4.4). aiResult is the agent's response, unchanged."""
    soap = response.get("soap") or {}
    return {
        "consultationId": consultation_id,
        "attempt": attempt,
        "subjective": soap.get("subjective") or "",
        "objective": soap.get("objective") or "",
        "assessment": soap.get("assessment") or "",
        "plan": plan_text(soap.get("plan")),
        "aiResult": response,
    }


def _caused_by(exc: BaseException, types: tuple) -> bool:
    seen = set()
    while exc is not None and id(exc) not in seen:
        if isinstance(exc, types):
            return True
        seen.add(id(exc))
        exc = exc.__cause__ or exc.__context__
    return False


def failure_reason(exc: BaseException) -> str:
    """AI_NOT_AVAILABLE, BAD_TRANSCRIPT or INTERNAL_ERROR (6.4.5)."""
    import openai

    # APITimeoutError is a subclass of APIConnectionError.
    if _caused_by(exc, (openai.APIConnectionError, openai.RateLimitError)):
        return "AI_NOT_AVAILABLE"
    if _caused_by(exc, (BadTranscript, UnicodeError)):
        return "BAD_TRANSCRIPT"
    return "INTERNAL_ERROR"


def soap_failed_data(consultation_id, attempt, exc: BaseException) -> dict:
    """The data of soap.generation.failed (6.4.5). The message is only for the logs."""
    return {
        "consultationId": consultation_id,
        "attempt": attempt,
        "reason": failure_reason(exc),
        "message": f"{type(exc).__name__}: {exc}"[:MESSAGE_MAX_CHARS],
    }


def envelope(message_type: str, data: dict) -> dict:
    """The common message shape (6.3)."""
    return {
        "messageId": str(uuid.uuid4()),
        "type": message_type,
        "version": 1,
        "source": SOURCE,
        "createdAt": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "data": data,
    }


def answer(data: dict, run: Callable[[str, str], dict]) -> tuple[str, dict]:
    """Run the graph on one transcript.ready and return (message type, data) of the answer."""
    consultation_id, attempt = data["consultationId"], data["attempt"]
    try:
        transcript = data.get("transcript")
        if not isinstance(transcript, str) or not transcript.strip():
            raise BadTranscript("The transcript is empty or not text.")
        response = run(transcript, str(consultation_id))
        return "soap.generated", soap_generated_data(consultation_id, attempt, response)
    except Exception as exc:
        log.exception("consultation %s attempt %s: run_consultation failed", consultation_id, attempt)
        return "soap.generation.failed", soap_failed_data(consultation_id, attempt, exc)


def _previous_failures(properties) -> int:
    for death in (getattr(properties, "headers", None) or {}).get("x-death") or []:
        if death.get("queue") == QUEUE and death.get("reason") == "rejected":
            return int(death.get("count", 0))
    return 0


# ---------------------------------------------------------------- RabbitMQ
class TranscriptConsumer:
    def __init__(self, url: str | None = None, run: Callable[[str, str], dict] | None = None):
        self.url = url or settings.rabbitmq_url
        self._run = run
        self._connection = None

    def run_consultation(self, transcript: str, consultation_id: str) -> dict:
        if self._run is None:
            from ..graph import run_consultation

            self._run = run_consultation
        return self._run(transcript, consultation_id)

    def on_message(self, channel, method, properties, body: bytes) -> None:
        started = time.perf_counter()
        try:
            data = json.loads(body.decode("utf-8"))["data"]
            consultation_id, attempt = data["consultationId"], data["attempt"]
        except Exception:
            log.exception("transcript.ready could not be read")
            self._fail(channel, method, properties, body, "transcript.ready could not be read")
            return

        log.info("consultation %s attempt %s: transcript.ready received", consultation_id, attempt)
        message_type, answer_data = answer(data, self.run_consultation)
        try:
            self.publish(channel, message_type, answer_data)
        except Exception as exc:
            log.exception("consultation %s attempt %s: could not publish %s", consultation_id, attempt, message_type)
            self._fail(channel, method, properties, body, str(exc))
            return
        channel.basic_ack(delivery_tag=method.delivery_tag)
        log.info("consultation %s attempt %s: sent %s in %.1fs", consultation_id, attempt, message_type,
                 time.perf_counter() - started)

    def publish(self, channel, message_type: str, data: dict) -> None:
        """Persistent JSON with the type as routing key. Raises if RabbitMQ does not confirm it."""
        import pika

        message = envelope(message_type, data)
        channel.basic_publish(
            exchange=EXCHANGE,
            routing_key=message_type,
            body=json.dumps(message, ensure_ascii=False, default=str).encode("utf-8"),
            properties=pika.BasicProperties(
                content_type="application/json", content_encoding="utf-8", delivery_mode=2,
                message_id=message["messageId"], type=message_type, app_id=SOURCE,
            ),
            mandatory=True,
        )

    def _fail(self, channel, method, properties, body: bytes, error: str) -> None:
        tries = _previous_failures(properties) + 1
        if tries < MAX_TRIES:
            log.warning("message failed (try %d), it will be tried again in 10 seconds", tries)
            channel.basic_nack(delivery_tag=method.delivery_tag, requeue=False)
            return
        import pika

        log.error("message failed %d times, moving it to %s.dlq", tries, QUEUE)
        headers = dict(getattr(properties, "headers", None) or {}, **{"last-error": error[:MESSAGE_MAX_CHARS]})
        channel.basic_publish(
            exchange="", routing_key=f"{QUEUE}.dlq", body=body,
            properties=pika.BasicProperties(
                content_type=getattr(properties, "content_type", None) or "application/json",
                delivery_mode=2, message_id=getattr(properties, "message_id", None),
                type=getattr(properties, "type", None), headers=headers,
            ),
        )
        channel.basic_ack(delivery_tag=method.delivery_tag)

    def _consume_once(self) -> None:
        import pika

        params = pika.URLParameters(self.url)
        params.heartbeat = 600  # a long run never drops the connection
        params.blocked_connection_timeout = 300
        self._connection = pika.BlockingConnection(params)
        channel = self._connection.channel()
        channel.queue_declare(queue=QUEUE, passive=True)  # fails if the Consultation Service has not created it
        channel.confirm_delivery()
        channel.basic_qos(prefetch_count=1)
        channel.basic_consume(queue=QUEUE, on_message_callback=self.on_message, auto_ack=False)
        log.info("waiting for %s", QUEUE)
        channel.start_consuming()

    def start(self) -> None:
        """Consume until Ctrl+C (or SIGTERM). Reconnects when RabbitMQ or the queue is not there yet."""
        import pika

        if not self.url:
            raise RuntimeError("RABBITMQ_URL is not set (root .env).")
        # pika logs every connect step (and an "error" for each address it tries); connection errors are logged below.
        logging.getLogger("pika").setLevel(logging.CRITICAL)
        signal.signal(signal.SIGTERM, _raise_keyboard_interrupt)
        try:
            while True:
                try:
                    self._consume_once()
                except (pika.exceptions.AMQPConnectionError, pika.exceptions.AMQPChannelError) as exc:
                    log.warning("RabbitMQ not available (%s), trying again in %ds", exc, RECONNECT_SECONDS)
                    self._close()
                    time.sleep(RECONNECT_SECONDS)
        except KeyboardInterrupt:
            log.info("stopping")
        finally:
            self._close()

    def _close(self) -> None:
        if self._connection is not None and self._connection.is_open:
            try:
                self._connection.close()
            except Exception:
                pass
        self._connection = None


def _raise_keyboard_interrupt(*_):
    raise KeyboardInterrupt
