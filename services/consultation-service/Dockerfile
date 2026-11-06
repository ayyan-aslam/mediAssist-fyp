# Consultation Service. Build from the repo root (docker-compose.yml does this), because the service
# needs the shared package and the root package-lock.json.
FROM node:24-slim

# OpenSSL for the Prisma schema engine (prisma migrate deploy). ffmpeg joins the audio parts of each minute.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY services/consultation-service/package.json services/consultation-service/
RUN npm ci -w shared -w services/consultation-service

COPY shared shared
COPY services/consultation-service services/consultation-service

WORKDIR /app/services/consultation-service
# prisma.config.js needs a database URL, but generate never connects, so any value works here.
RUN CONSULTATION_DATABASE_URL=postgresql://build@localhost/build npx prisma generate

EXPOSE 3002
# Applies new migrations, then starts the service.
CMD ["sh", "-c", "npx prisma migrate deploy && node src/server.js"]
