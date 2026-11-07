-- SOAP_NOTE.prescription and SOAP_NOTE.symptoms: the doctor's edited versions of the AI Pipeline's
-- prescription and symptoms (ai_result stays as it is). NULL means the doctor has not edited it, so the
-- AI version is shown. Each item keeps aiIndex, the position of the AI item it came from (or null for
-- one the doctor added), so the medicine info and the transcript line can still be shown.

-- AlterTable
ALTER TABLE "soap_note" ADD COLUMN "prescription" JSONB,
ADD COLUMN "symptoms" JSONB;
