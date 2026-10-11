-- UserDB tables: design doc Section 4.4.1.

-- pg_trgm is already installed in public by docker/postgres/init.sql.
-- This line is for the temporary shadow database that "prisma migrate dev" creates.
CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA public;

-- CreateTable
CREATE TABLE "users" (
    "user_id" SERIAL NOT NULL,
    "firebase_uid" VARCHAR(128) NOT NULL,
    "full_name" VARCHAR(100) NOT NULL,
    "email" VARCHAR(150) NOT NULL,
    "phone" VARCHAR(15),
    "role" VARCHAR(10) NOT NULL,
    "account_status" VARCHAR(10) NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "patient_profile" (
    "user_id" INTEGER NOT NULL,
    "date_of_birth" DATE,
    "gender" VARCHAR(10),

    CONSTRAINT "patient_profile_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "doctor_profile" (
    "user_id" INTEGER NOT NULL,
    "cnic_encrypted" VARCHAR(255) NOT NULL,
    "cnic_hash" CHAR(64) NOT NULL,
    "registration_no" VARCHAR(30) NOT NULL,
    "specialty_id" INTEGER,

    CONSTRAINT "doctor_profile_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "specialty" (
    "specialty_id" SERIAL NOT NULL,
    "name" VARCHAR(60) NOT NULL,

    CONSTRAINT "specialty_pkey" PRIMARY KEY ("specialty_id")
);

-- CreateTable
CREATE TABLE "refresh_token" (
    "token_id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMP(6) NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_token_pkey" PRIMARY KEY ("token_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_firebase_uid_key" ON "users"("firebase_uid");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "doctor_profile_cnic_hash_key" ON "doctor_profile"("cnic_hash");

-- CreateIndex
CREATE UNIQUE INDEX "doctor_profile_registration_no_key" ON "doctor_profile"("registration_no");

-- CreateIndex
CREATE UNIQUE INDEX "specialty_name_key" ON "specialty"("name");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_token_token_hash_key" ON "refresh_token"("token_hash");

-- Indexes on foreign key columns (design doc Section 4.9, "All tables").
-- doctor_profile.user_id and patient_profile.user_id are primary keys, so they are indexed already.
CREATE INDEX "doctor_profile_specialty_id_idx" ON "doctor_profile"("specialty_id");
CREATE INDEX "refresh_token_user_id_idx" ON "refresh_token"("user_id");

-- Search and clean-up indexes (design doc Section 4.9).
-- Admin search by name or phone with partial matches (ILIKE '%text%', FR-16). The operator class is in public.
-- phone needs no plain index: its unique key already creates one.
CREATE INDEX "users_full_name_trgm_idx" ON "users" USING GIN ("full_name" public.gin_trgm_ops);
CREATE INDEX "users_phone_trgm_idx" ON "users" USING GIN ("phone" public.gin_trgm_ops);
-- Daily clean-up of expired refresh tokens.
CREATE INDEX "refresh_token_expires_at_idx" ON "refresh_token"("expires_at");

-- Allowed values (design doc Section 4.6).
ALTER TABLE "users" ADD CONSTRAINT "users_role_check"
    CHECK ("role" IN ('patient', 'doctor', 'admin'));
ALTER TABLE "users" ADD CONSTRAINT "users_account_status_check"
    CHECK ("account_status" IN ('active', 'suspended'));
ALTER TABLE "patient_profile" ADD CONSTRAINT "patient_profile_gender_check"
    CHECK ("gender" IN ('male', 'female', 'other'));

-- Foreign keys to users use ON DELETE CASCADE. The app never deletes users (admins suspend them),
-- but cascade keeps manual clean-up and tests simple.

-- AddForeignKey
ALTER TABLE "patient_profile" ADD CONSTRAINT "patient_profile_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_profile" ADD CONSTRAINT "doctor_profile_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_profile" ADD CONSTRAINT "doctor_profile_specialty_id_fkey" FOREIGN KEY ("specialty_id") REFERENCES "specialty"("specialty_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_token" ADD CONSTRAINT "refresh_token_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;
