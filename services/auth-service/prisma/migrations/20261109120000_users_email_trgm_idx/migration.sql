-- Admin search by part of the email (GET /admin/users?search=). Trigram indexes make ILIKE '%text%' fast.

-- CreateIndex
CREATE INDEX "users_email_trgm_idx" ON "users" USING GIN ("email" public.gin_trgm_ops);
