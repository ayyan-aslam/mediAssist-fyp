-- NotificationDB tables: design doc Section 4.4.7.

-- CreateTable
CREATE TABLE "prescription_delivery" (
    "delivery_id" SERIAL NOT NULL,
    "message_id" UUID NOT NULL,
    "prescription_id" INTEGER NOT NULL,
    "channel" VARCHAR(10) NOT NULL,
    "recipient" VARCHAR(150) NOT NULL,
    "status" VARCHAR(10) NOT NULL,
    "error_message" VARCHAR(255),
    "attempted_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "prescription_delivery_pkey" PRIMARY KEY ("delivery_id")
);

-- CreateTable
CREATE TABLE "follow_up_change" (
    "consultation_id" INTEGER NOT NULL,
    "follow_up_date" DATE,
    "doctor_name" VARCHAR(100) NOT NULL,
    "patient_name" VARCHAR(100) NOT NULL,
    "changed_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "follow_up_change_pkey" PRIMARY KEY ("consultation_id")
);

-- CreateTable
CREATE TABLE "follow_up_reminder" (
    "reminder_id" SERIAL NOT NULL,
    "consultation_id" INTEGER NOT NULL,
    "recipient_type" VARCHAR(10) NOT NULL,
    "recipient_email" VARCHAR(150) NOT NULL,
    "scheduled_at" TIMESTAMP(6) NOT NULL,
    "status" VARCHAR(10) NOT NULL,
    "sent_at" TIMESTAMP(6),

    CONSTRAINT "follow_up_reminder_pkey" PRIMARY KEY ("reminder_id")
);

-- Unique keys (design doc Section 4.4.7).
CREATE UNIQUE INDEX "prescription_delivery_message_id_key" ON "prescription_delivery"("message_id");

-- Foreign key columns, and finding the reminders that are due (design doc Section 4.9).
CREATE INDEX "prescription_delivery_prescription_id_idx" ON "prescription_delivery"("prescription_id");
CREATE INDEX "follow_up_reminder_consultation_id_idx" ON "follow_up_reminder"("consultation_id");
CREATE INDEX "follow_up_reminder_status_scheduled_at_idx" ON "follow_up_reminder"("status", "scheduled_at");

-- Allowed values (design doc Section 4.6). Only email is sent for now.
ALTER TABLE "prescription_delivery" ADD CONSTRAINT "prescription_delivery_channel_check"
    CHECK ("channel" IN ('email'));
ALTER TABLE "prescription_delivery" ADD CONSTRAINT "prescription_delivery_status_check"
    CHECK ("status" IN ('sent', 'failed'));
ALTER TABLE "follow_up_reminder" ADD CONSTRAINT "follow_up_reminder_recipient_type_check"
    CHECK ("recipient_type" IN ('patient', 'doctor'));
ALTER TABLE "follow_up_reminder" ADD CONSTRAINT "follow_up_reminder_status_check"
    CHECK ("status" IN ('pending', 'sent', 'failed'));

-- Every reminder belongs to the last follow-up change of its consultation. Change rows are never deleted.
ALTER TABLE "follow_up_reminder" ADD CONSTRAINT "follow_up_reminder_consultation_id_fkey" FOREIGN KEY ("consultation_id") REFERENCES "follow_up_change"("consultation_id") ON DELETE RESTRICT ON UPDATE CASCADE;
