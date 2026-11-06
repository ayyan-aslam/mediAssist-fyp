"""RabbitMQ mode tests - pika's channel and run_consultation are faked (no RabbitMQ or OpenAI needed)."""
from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import MagicMock

import httpx
import openai
import pytest

from mediassist_agent.sources import rabbitmq as rmq

RESPONSE = {
    "schema_version": "1.0",
    "consultation_id": "41",
    "soap": {
        "subjective": "Sore throat for 3 days.",
        "objective": None,
        "assessment": "Likely viral throat infection.",
        "plan": {
            "notes": "Warm salt water gargles.",
            "prescription": [
                {"name": "Panadol", "strength": "500 mg", "dose": "1 tablet", "frequency": "twice a day",
                 "duration": "3 days", "instructions": None, "tag": "doctor_prescribed"},
            ],
            "for_doctor_review": [{"name": "Strepsils", "tag": "rag_suggested"}],
        },
        "medication_history": [],
    },
    "symptoms": [{"symptom": "sore throat", "mention": "gala kharab"}],
    "warnings": [],
}


def transcript_ready(consultation_id=41, attempt=2, transcript="Doctor: ki haal ae?\nPatient: gala kharab ae."):
    return json.dumps({
        "messageId": "a1b2c3d4-0003-4000-8000-000000000003", "type": "transcript.ready", "version": 1,
        "source": "consultation-service", "createdAt": "2026-10-07T09:19:04Z",
        "data": {"consultationId": consultation_id, "attempt": attempt, "patientAge": 45,
                 "patientGender": "male", "durationSec": 840, "transcript": transcript},
    }).encode("utf-8")


def deliver(consumer, body, deaths=0):
    channel = MagicMock()
    method = SimpleNamespace(delivery_tag=7)
    headers = {"x-death": [{"queue": rmq.QUEUE, "reason": "rejected", "count": deaths}]} if deaths else None
    consumer.on_message(channel, method, SimpleNamespace(headers=headers), body)
    return channel


def published(channel, n=0):
    call = channel.basic_publish.call_args_list[n].kwargs
    return call, json.loads(call["body"].decode("utf-8"))


def openai_error(cls):
    request = httpx.Request("POST", "https://api.openai.com/v1/chat/completions")
    if cls is openai.RateLimitError:
        return cls("rate limited", response=httpx.Response(429, request=request), body=None)
    return cls(request=request)


# ---------------------------------------------------------------- mapping
def test_plan_has_one_line_per_medicine_then_notes():
    plan = {
        "notes": "Warm salt water gargles.",
        "prescription": [
            {"name": "Panadol", "strength": "500 mg", "dose": "1 tablet", "frequency": "twice a day",
             "duration": "3 days", "instructions": "after meals"},
            {"name": "Augmentin", "strength": None, "dose": "", "frequency": "  ", "duration": "5 days"},
        ],
    }
    assert rmq.plan_text(plan) == (
        "Panadol, 500 mg, 1 tablet, twice a day, 3 days, after meals\n"
        "Augmentin, 5 days\n"
        "Warm salt water gargles."
    )


def test_plan_without_medicines_or_notes():
    assert rmq.plan_text({"notes": "Rest.", "prescription": []}) == "Rest."
    assert rmq.plan_text({"notes": None, "prescription": [{"name": "Panadol"}]}) == "Panadol"
    assert rmq.plan_text({"notes": None, "prescription": [{"name": None, "dose": ""}]}) == ""
    assert rmq.plan_text(None) == ""


def test_soap_generated_maps_none_to_empty_and_keeps_ai_result_unchanged():
    data = rmq.soap_generated_data(41, 2, RESPONSE)
    assert data == {
        "consultationId": 41,
        "attempt": 2,
        "subjective": "Sore throat for 3 days.",
        "objective": "",
        "assessment": "Likely viral throat infection.",
        "plan": "Panadol, 500 mg, 1 tablet, twice a day, 3 days\nWarm salt water gargles.",
        "aiResult": RESPONSE,
    }
    assert data["aiResult"] is RESPONSE


def test_soap_generated_with_empty_response():
    data = rmq.soap_generated_data(1, 1, {"soap": {"subjective": None, "objective": None, "assessment": None,
                                                   "plan": {"notes": None, "prescription": []}}})
    assert [data[k] for k in ("subjective", "objective", "assessment", "plan")] == ["", "", "", ""]


# ---------------------------------------------------------------- failure reasons
@pytest.mark.parametrize("exc, reason", [
    (openai_error(openai.APIConnectionError), "AI_NOT_AVAILABLE"),
    (openai_error(openai.APITimeoutError), "AI_NOT_AVAILABLE"),
    (openai_error(openai.RateLimitError), "AI_NOT_AVAILABLE"),
    (rmq.BadTranscript("empty"), "BAD_TRANSCRIPT"),
    (UnicodeDecodeError("utf-8", b"\xff", 0, 1, "invalid start byte"), "BAD_TRANSCRIPT"),
    (KeyError("soap_response"), "INTERNAL_ERROR"),
])
def test_failure_reason(exc, reason):
    assert rmq.failure_reason(exc) == reason


def test_failure_reason_follows_the_cause():
    try:
        try:
            raise openai_error(openai.APITimeoutError)
        except openai.APITimeoutError as inner:
            raise RuntimeError("node failed") from inner
    except RuntimeError as outer:
        assert rmq.failure_reason(outer) == "AI_NOT_AVAILABLE"


def test_failed_message_is_short():
    data = rmq.soap_failed_data(41, 2, RuntimeError("x" * 1000))
    assert data["reason"] == "INTERNAL_ERROR"
    assert len(data["message"]) == 300


# ---------------------------------------------------------------- consumer
def test_success_publishes_soap_generated_then_acks():
    run = MagicMock(return_value=RESPONSE)
    channel = deliver(rmq.TranscriptConsumer(url="amqp://x", run=run), transcript_ready(consultation_id=41, attempt=2))

    run.assert_called_once_with("Doctor: ki haal ae?\nPatient: gala kharab ae.", "41")
    call, message = published(channel)
    assert call["exchange"] == "mediassist.events"
    assert call["routing_key"] == "soap.generated"
    assert call["mandatory"] is True
    assert call["properties"].delivery_mode == 2
    assert call["properties"].content_type == "application/json"
    assert message["type"] == "soap.generated"
    assert message["version"] == 1
    assert message["source"] == "ai-pipeline"
    assert message["createdAt"].endswith("Z")
    assert len(message["messageId"]) == 36
    assert message["data"]["consultationId"] == 41
    assert message["data"]["attempt"] == 2
    assert message["data"]["aiResult"] == RESPONSE
    channel.basic_ack.assert_called_once_with(delivery_tag=7)
    channel.basic_nack.assert_not_called()


@pytest.mark.parametrize("exc, reason", [
    (openai_error(openai.RateLimitError), "AI_NOT_AVAILABLE"),
    (ValueError("boom"), "INTERNAL_ERROR"),
])
def test_run_error_publishes_soap_generation_failed(exc, reason):
    run = MagicMock(side_effect=exc)
    channel = deliver(rmq.TranscriptConsumer(url="amqp://x", run=run), transcript_ready(consultation_id=9, attempt=3))

    call, message = published(channel)
    assert call["routing_key"] == "soap.generation.failed"
    assert message["data"]["consultationId"] == 9
    assert message["data"]["attempt"] == 3
    assert message["data"]["reason"] == reason
    assert message["data"]["message"]
    channel.basic_ack.assert_called_once_with(delivery_tag=7)


@pytest.mark.parametrize("transcript", ["", "   \n", None])
def test_empty_transcript_is_bad_transcript(transcript):
    run = MagicMock()
    channel = deliver(rmq.TranscriptConsumer(url="amqp://x", run=run), transcript_ready(transcript=transcript))

    run.assert_not_called()
    _, message = published(channel)
    assert message["type"] == "soap.generation.failed"
    assert message["data"]["reason"] == "BAD_TRANSCRIPT"
    assert message["data"]["attempt"] == 2


def test_publish_failure_nacks_without_requeue():
    consumer = rmq.TranscriptConsumer(url="amqp://x", run=MagicMock(return_value=RESPONSE))
    channel = MagicMock()
    channel.basic_publish.side_effect = RuntimeError("no confirm")
    consumer.on_message(channel, SimpleNamespace(delivery_tag=7), SimpleNamespace(headers=None), transcript_ready())

    channel.basic_nack.assert_called_once_with(delivery_tag=7, requeue=False)
    channel.basic_ack.assert_not_called()


def test_third_failure_moves_the_message_to_the_dlq():
    consumer = rmq.TranscriptConsumer(url="amqp://x", run=MagicMock(return_value=RESPONSE))
    body = transcript_ready()
    channel = MagicMock()
    channel.basic_publish.side_effect = [RuntimeError("no confirm"), None]
    headers = {"x-death": [{"queue": rmq.QUEUE, "reason": "rejected", "count": 2}]}
    consumer.on_message(channel, SimpleNamespace(delivery_tag=7), SimpleNamespace(headers=headers), body)

    dlq = channel.basic_publish.call_args_list[1].kwargs
    assert dlq["exchange"] == ""
    assert dlq["routing_key"] == "ai-pipeline.transcript.ready.dlq"
    assert dlq["body"] == body
    channel.basic_ack.assert_called_once_with(delivery_tag=7)
    channel.basic_nack.assert_not_called()


def test_unreadable_message_is_nacked():
    run = MagicMock()
    channel = deliver(rmq.TranscriptConsumer(url="amqp://x", run=run), b"not json")

    run.assert_not_called()
    channel.basic_publish.assert_not_called()
    channel.basic_nack.assert_called_once_with(delivery_tag=7, requeue=False)
