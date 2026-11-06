-- ConsultationDB tables: design doc Section 4.4.4.

-- pg_trgm is already installed in public by docker/postgres/init.sql.
-- This line is for the temporary shadow database that "prisma migrate dev" creates.
CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA public;

-- CreateTable
CREATE TABLE "clinical_patient" (
    "clinical_patient_id" SERIAL NOT NULL,
    "doctor_id" INTEGER NOT NULL,
    "full_name" VARCHAR(100) NOT NULL,
    "phone" VARCHAR(15) NOT NULL,
    "email" VARCHAR(150),
    "age" SMALLINT NOT NULL,
    "gender" VARCHAR(10) NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clinical_patient_pkey" PRIMARY KEY ("clinical_patient_id")
);

-- CreateTable
CREATE TABLE "consultation" (
    "consultation_id" SERIAL NOT NULL,
    "clinical_patient_id" INTEGER NOT NULL,
    "status" VARCHAR(12) NOT NULL,
    "soap_attempt" SMALLINT NOT NULL DEFAULT 1,
    "ai_requested_at" TIMESTAMP(6),
    "failure_reason" VARCHAR(30),
    "follow_up_date" DATE,
    "started_at" TIMESTAMP(6) NOT NULL,
    "ended_at" TIMESTAMP(6),

    CONSTRAINT "consultation_pkey" PRIMARY KEY ("consultation_id")
);

-- CreateTable
CREATE TABLE "audio_part" (
    "audio_part_id" SERIAL NOT NULL,
    "consultation_id" INTEGER NOT NULL,
    "part_no" SMALLINT NOT NULL,
    "file_key" VARCHAR(255) NOT NULL,
    "duration_sec" INTEGER NOT NULL,
    "recorded_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "audio_part_pkey" PRIMARY KEY ("audio_part_id")
);

-- CreateTable
CREATE TABLE "transcript_window" (
    "window_id" SERIAL NOT NULL,
    "consultation_id" INTEGER NOT NULL,
    "window_no" SMALLINT NOT NULL,
    "transcript_text" TEXT,
    "status" VARCHAR(10) NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transcript_window_pkey" PRIMARY KEY ("window_id")
);

-- CreateTable
CREATE TABLE "soap_note" (
    "soap_note_id" SERIAL NOT NULL,
    "consultation_id" INTEGER NOT NULL,
    "subjective" TEXT,
    "objective" TEXT,
    "assessment" TEXT,
    "plan" TEXT,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "soap_note_pkey" PRIMARY KEY ("soap_note_id")
);

-- Unique rules (design doc Section 4.4.4).
-- One doctor cannot save the same phone twice. Two doctors can each save the same person.
CREATE UNIQUE INDEX "clinical_patient_doctor_id_phone_key" ON "clinical_patient"("doctor_id", "phone");
CREATE UNIQUE INDEX "audio_part_file_key_key" ON "audio_part"("file_key");
CREATE UNIQUE INDEX "audio_part_consultation_id_part_no_key" ON "audio_part"("consultation_id", "part_no");
CREATE UNIQUE INDEX "transcript_window_consultation_id_window_no_key" ON "transcript_window"("consultation_id", "window_no");
-- One consultation has at most one SOAP note.
CREATE UNIQUE INDEX "soap_note_consultation_id_key" ON "soap_note"("consultation_id");

-- Indexes on foreign key columns (design doc Section 4.9, "All tables").
-- Each one is already the first column of a unique key or of the index below, so no extra index is needed:
-- clinical_patient.doctor_id, audio_part, transcript_window and soap_note.consultation_id.

-- Search indexes (design doc Section 4.9).
-- SOAP note search by patient name or phone with partial matches (ILIKE '%text%', FR-12).
-- The operator class is in public.
CREATE INDEX "clinical_patient_full_name_trgm_idx" ON "clinical_patient" USING GIN ("full_name" public.gin_trgm_ops);
CREATE INDEX "clinical_patient_phone_trgm_idx" ON "clinical_patient" USING GIN ("phone" public.gin_trgm_ops);
-- A patient's previous SOAP notes in date order. Also serves the clinical_patient_id foreign key.
CREATE INDEX "consultation_clinical_patient_id_started_at_idx" ON "consultation"("clinical_patient_id", "started_at");

-- Allowed values (design doc Section 4.6).
ALTER TABLE "clinical_patient" ADD CONSTRAINT "clinical_patient_gender_check"
    CHECK ("gender" IN ('male', 'female', 'other'));
ALTER TABLE "clinical_patient" ADD CONSTRAINT "clinical_patient_age_check"
    CHECK ("age" BETWEEN 0 AND 120);
ALTER TABLE "consultation" ADD CONSTRAINT "consultation_status_check"
    CHECK ("status" IN ('recording', 'processing', 'completed', 'failed'));
ALTER TABLE "consultation" ADD CONSTRAINT "consultation_soap_attempt_check"
    CHECK ("soap_attempt" >= 1);
ALTER TABLE "consultation" ADD CONSTRAINT "consultation_failure_reason_check"
    CHECK ("failure_reason" IN ('TRANSCRIPTION_FAILED', 'AI_FAILED', 'AI_TIMEOUT'));
-- failure_reason is empty unless the status is failed (design doc Section 4.4.4).
ALTER TABLE "consultation" ADD CONSTRAINT "consultation_failure_reason_status_check"
    CHECK ("failure_reason" IS NULL OR "status" = 'failed');
ALTER TABLE "transcript_window" ADD CONSTRAINT "transcript_window_status_check"
    CHECK ("status" IN ('pending', 'done', 'failed'));

-- A patient with consultations cannot be deleted (RESTRICT).
-- Deleting a consultation deletes its audio parts, transcript windows and SOAP note (CASCADE).

-- AddForeignKey
ALTER TABLE "consultation" ADD CONSTRAINT "consultation_clinical_patient_id_fkey" FOREIGN KEY ("clinical_patient_id") REFERENCES "clinical_patient"("clinical_patient_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audio_part" ADD CONSTRAINT "audio_part_consultation_id_fkey" FOREIGN KEY ("consultation_id") REFERENCES "consultation"("consultation_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transcript_window" ADD CONSTRAINT "transcript_window_consultation_id_fkey" FOREIGN KEY ("consultation_id") REFERENCES "consultation"("consultation_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "soap_note" ADD CONSTRAINT "soap_note_consultation_id_fkey" FOREIGN KEY ("consultation_id") REFERENCES "consultation"("consultation_id") ON DELETE CASCADE ON UPDATE CASCADE;
