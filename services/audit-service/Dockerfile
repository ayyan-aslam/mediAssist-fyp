# Audit Service. Build from the repo root (docker-compose.yml does this), because the service
# needs the shared package and the root package-lock.json.
FROM node:24-slim

# OpenSSL for the Prisma schema engine (prisma migrate deploy).
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY services/audit-service/package.json services/audit-service/
RUN npm ci -w shared -w services/audit-service

COPY shared shared
COPY services/audit-service services/audit-service

WORKDIR /app/services/audit-service
# prisma.config.js needs a database URL, but generate never connects, so any value works here.
RUN AUDIT_MIGRATION_DATABASE_URL=postgresql://build@localhost/build npx prisma generate

EXPOSE 3005
# Applies new migrations, then starts the service.
CMD ["sh", "-c", "npx prisma migrate deploy && node src/server.js"]
