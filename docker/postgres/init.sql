-- MediAssist AI: first-start setup of the local PostgreSQL server.
-- Docker runs this file only when the postgres-data volume is empty.
-- Each service "database" is a schema in one PostgreSQL database (design doc 3.10 and 4.2.1).
-- The passwords come from environment variables set in docker-compose.yml, so none are stored here.

\getenv db_name POSTGRES_DB
\getenv auth_password AUTH_DB_PASSWORD
\getenv document_password DOCUMENT_DB_PASSWORD
\getenv chat_password CHAT_DB_PASSWORD
\getenv consultation_password CONSULTATION_DB_PASSWORD
\getenv soap_worker_password SOAP_WORKER_DB_PASSWORD
\getenv prescription_password PRESCRIPTION_DB_PASSWORD
\getenv medicine_ai_password MEDICINE_AI_DB_PASSWORD
\getenv notification_password NOTIFICATION_DB_PASSWORD
\getenv audit_password AUDIT_DB_PASSWORD
\getenv audit_owner_password AUDIT_OWNER_DB_PASSWORD

-- Only the roles below may connect. Nobody may create objects in the public schema.
REVOKE ALL ON DATABASE :"db_name" FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- One login per service.
-- CREATEDB is for local development only: Prisma "migrate dev" creates a temporary shadow database.
CREATE ROLE auth_service         LOGIN CREATEDB PASSWORD :'auth_password';
CREATE ROLE document_service     LOGIN PASSWORD :'document_password';
CREATE ROLE chat_service         LOGIN PASSWORD :'chat_password';
CREATE ROLE consultation_service LOGIN CREATEDB PASSWORD :'consultation_password';
CREATE ROLE soap_worker          LOGIN PASSWORD :'soap_worker_password';
CREATE ROLE prescription_service LOGIN CREATEDB PASSWORD :'prescription_password';
CREATE ROLE medicine_ai_service  LOGIN PASSWORD :'medicine_ai_password';
CREATE ROLE notification_service LOGIN CREATEDB PASSWORD :'notification_password';
CREATE ROLE audit_service        LOGIN PASSWORD :'audit_password';
-- Owns the AuditDB tables and runs its migrations. The Audit Service itself uses audit_service.
CREATE ROLE audit_owner          LOGIN CREATEDB PASSWORD :'audit_owner_password';

GRANT CONNECT ON DATABASE :"db_name" TO
  auth_service, document_service, chat_service, consultation_service, soap_worker,
  prescription_service, medicine_ai_service, notification_service, audit_service, audit_owner;

-- One schema per service. The owner has full rights on its own schema and no rights on the others.
CREATE SCHEMA userdb         AUTHORIZATION auth_service;
CREATE SCHEMA documentdb     AUTHORIZATION document_service;
CREATE SCHEMA chatdb         AUTHORIZATION chat_service;
CREATE SCHEMA consultationdb AUTHORIZATION consultation_service;
CREATE SCHEMA prescriptiondb AUTHORIZATION prescription_service;
CREATE SCHEMA medicinedb     AUTHORIZATION medicine_ai_service;
CREATE SCHEMA notificationdb AUTHORIZATION notification_service;
CREATE SCHEMA auditdb        AUTHORIZATION audit_owner;

-- Each login looks in its own schema first.
ALTER ROLE auth_service         SET search_path = userdb, public;
ALTER ROLE document_service     SET search_path = documentdb, public;
ALTER ROLE chat_service         SET search_path = chatdb, public;
ALTER ROLE consultation_service SET search_path = consultationdb, public;
ALTER ROLE soap_worker          SET search_path = consultationdb, public;
ALTER ROLE prescription_service SET search_path = prescriptiondb, public;
ALTER ROLE medicine_ai_service  SET search_path = medicinedb, public;
ALTER ROLE notification_service SET search_path = notificationdb, public;
ALTER ROLE audit_service        SET search_path = auditdb, public;
ALTER ROLE audit_owner          SET search_path = auditdb, public;

-- SOAP Worker shares ConsultationDB (design doc 4.2.1).
-- It can read and write the tables that the Consultation Service creates, but cannot create, drop or delete.
GRANT USAGE ON SCHEMA consultationdb TO soap_worker;
ALTER DEFAULT PRIVILEGES FOR ROLE consultation_service IN SCHEMA consultationdb
  GRANT SELECT, INSERT, UPDATE ON TABLES TO soap_worker;
ALTER DEFAULT PRIVILEGES FOR ROLE consultation_service IN SCHEMA consultationdb
  GRANT USAGE, SELECT ON SEQUENCES TO soap_worker;

-- AuditDB rows can only be added (design doc 4.4.8).
-- The Audit Service login gets only SELECT and INSERT on every table that audit_owner creates.
GRANT USAGE ON SCHEMA auditdb TO audit_service;
ALTER DEFAULT PRIVILEGES FOR ROLE audit_owner IN SCHEMA auditdb
  GRANT SELECT, INSERT ON TABLES TO audit_service;
ALTER DEFAULT PRIVILEGES FOR ROLE audit_owner IN SCHEMA auditdb
  GRANT USAGE ON SEQUENCES TO audit_service;

-- Extensions.
-- pg_trgm: trigram indexes for partial-match search on USERS and CLINICAL_PATIENT (design doc 4.9).
CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA public;
-- pgvector: the VECTOR(768) type for MEDICINE.embedding, installed only in MedicineDB.
CREATE EXTENSION IF NOT EXISTS vector SCHEMA medicinedb;
