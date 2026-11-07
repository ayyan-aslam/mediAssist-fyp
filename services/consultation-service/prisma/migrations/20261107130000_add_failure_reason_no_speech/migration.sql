-- CONSULTATION.failure_reason NO_SPEECH: the transcript was empty (silence or a very short recording), so
-- nothing is sent to the AI Pipeline and the doctor is asked to record again.
ALTER TABLE "consultation" DROP CONSTRAINT "consultation_failure_reason_check";
ALTER TABLE "consultation" ADD CONSTRAINT "consultation_failure_reason_check"
    CHECK ("failure_reason" IN ('TRANSCRIPTION_FAILED', 'AI_FAILED', 'AI_TIMEOUT', 'NO_SPEECH'));
