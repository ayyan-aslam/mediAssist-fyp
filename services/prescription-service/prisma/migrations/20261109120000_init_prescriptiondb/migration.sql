-- PrescriptionDB tables: design doc Section 4.4.5.

-- CreateTable
CREATE TABLE "prescription" (
    "prescription_id" SERIAL NOT NULL,
    "consultation_id" INTEGER NOT NULL,
    "doctor_id" INTEGER NOT NULL,
    "status" VARCHAR(10) NOT NULL,
    "patient_name" VARCHAR(150) NOT NULL,
    "notes" TEXT,
    "pdf_key" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prescription_pkey" PRIMARY KEY ("prescription_id")
);

-- CreateTable
CREATE TABLE "prescription_item" (
    "item_id" SERIAL NOT NULL,
    "prescription_id" INTEGER NOT NULL,
    "position" SMALLINT NOT NULL,
    "medicine_name" VARCHAR(200) NOT NULL,
    "generic_name" VARCHAR(200),
    "dose" VARCHAR(100),
    "frequency" VARCHAR(100),
    "duration" VARCHAR(100),
    "instructions" VARCHAR(500),
    "source" VARCHAR(20) NOT NULL,
    "reference_info" JSONB,

    CONSTRAINT "prescription_item_pkey" PRIMARY KEY ("item_id")
);

-- CreateTable
CREATE TABLE "prescription_send" (
    "send_id" SERIAL NOT NULL,
    "prescription_id" INTEGER NOT NULL,
    "message_id" UUID NOT NULL,
    "channel" VARCHAR(10) NOT NULL,
    "recipient" VARCHAR(150) NOT NULL,
    "status" VARCHAR(10) NOT NULL,
    "error_message" VARCHAR(255),
    "requested_at" TIMESTAMP(6) NOT NULL,
    "completed_at" TIMESTAMP(6),

    CONSTRAINT "prescription_send_pkey" PRIMARY KEY ("send_id")
);

-- Unique keys (design doc Section 4.4.5).
CREATE UNIQUE INDEX "prescription_consultation_id_key" ON "prescription"("consultation_id");
CREATE UNIQUE INDEX "prescription_send_message_id_key" ON "prescription_send"("message_id");

-- Foreign key columns (design doc Section 4.9).
CREATE INDEX "prescription_doctor_id_idx" ON "prescription"("doctor_id");
CREATE INDEX "prescription_item_prescription_id_idx" ON "prescription_item"("prescription_id");
CREATE INDEX "prescription_send_prescription_id_idx" ON "prescription_send"("prescription_id");

-- Allowed values (design doc Section 4.6).
ALTER TABLE "prescription" ADD CONSTRAINT "prescription_status_check"
    CHECK ("status" IN ('final'));
ALTER TABLE "prescription_item" ADD CONSTRAINT "prescription_item_source_check"
    CHECK ("source" IN ('doctor_prescribed', 'ai_accepted', 'doctor_added'));
ALTER TABLE "prescription_send" ADD CONSTRAINT "prescription_send_channel_check"
    CHECK ("channel" IN ('email'));
ALTER TABLE "prescription_send" ADD CONSTRAINT "prescription_send_status_check"
    CHECK ("status" IN ('sending', 'sent', 'failed'));

-- The lines go with their prescription (ON DELETE CASCADE). A prescription that was sent cannot be deleted.
ALTER TABLE "prescription_item" ADD CONSTRAINT "prescription_item_prescription_id_fkey" FOREIGN KEY ("prescription_id") REFERENCES "prescription"("prescription_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "prescription_send" ADD CONSTRAINT "prescription_send_prescription_id_fkey" FOREIGN KEY ("prescription_id") REFERENCES "prescription"("prescription_id") ON DELETE RESTRICT ON UPDATE CASCADE;
