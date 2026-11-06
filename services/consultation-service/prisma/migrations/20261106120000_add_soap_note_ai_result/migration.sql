-- SOAP_NOTE.ai_result (design doc Section 4.4.4): the AI Pipeline's full result (aiResult in soap.generated).
-- Saved as it is and never changed by the doctor's edits. Phase 2 builds the draft prescription from it.

-- AlterTable
ALTER TABLE "soap_note" ADD COLUMN "ai_result" JSONB;
