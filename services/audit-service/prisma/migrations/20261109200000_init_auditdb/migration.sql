-- AuditDB table: design doc Section 4.4.8. Runs as audit_owner (AUDIT_MIGRATION_DATABASE_URL).

-- CreateTable
CREATE TABLE "audit_log" (
    "log_id" BIGSERIAL NOT NULL,
    "message_id" UUID NOT NULL,
    "user_id" INTEGER NOT NULL,
    "action" VARCHAR(40) NOT NULL,
    "details" VARCHAR(255),
    "ip_address" VARCHAR(45) NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("log_id")
);

-- Unique key (design doc Section 4.4.8).
CREATE UNIQUE INDEX "audit_log_message_id_key" ON "audit_log"("message_id");

-- Admin filters by date and by user (design doc Section 4.9).
CREATE INDEX "audit_log_created_at_idx" ON "audit_log"("created_at");
CREATE INDEX "audit_log_user_id_idx" ON "audit_log"("user_id");

-- Allowed values (design doc Section 4.6).
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_action_check"
    CHECK ("action" IN ('login', 'logout', 'document_upload', 'soap_note_change', 'prescription_send', 'account_suspension'));

-- Rows can only be added (design doc 4.4.8 and 4.8). docker/postgres/init.sql already gives audit_service
-- SELECT and INSERT on new tables by default; this repeats it for this table and takes away everything else.
REVOKE ALL ON "audit_log" FROM audit_service;
GRANT SELECT, INSERT ON "audit_log" TO audit_service;
GRANT USAGE ON SEQUENCE "audit_log_log_id_seq" TO audit_service;
