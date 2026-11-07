import { createLogger } from '@mediassist/common';
import express from 'express';
import { SignJWT } from 'jose';
import { createApp } from '../src/app.js';

export const JWT_SECRET = 'test-secret-that-is-at-least-32-characters';

export const doctor = { userId: 16, role: 'doctor', name: 'Dr. Sara Ahmed', email: 'sara@example.com' };
export const patient = { userId: 15, role: 'patient', name: 'Ali Khan', email: 'ali@example.com' };
export const admin = { userId: 1, role: 'admin', name: 'Admin', email: 'admin@example.com' };

export function signToken(payload, { secret = JWT_SECRET, expiresIn = '15m' } = {}) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(new TextEncoder().encode(secret));
}

// A fake service that sends back what it received. service tells which URL the request went to.
export function startEchoService(service) {
  const fake = express();
  fake.use(express.json());
  fake.use((req, res) => {
    res.json({ service, method: req.method, url: req.url, headers: req.headers, body: req.body });
  });
  return new Promise((resolve) => {
    const server = fake.listen(0, () => resolve(server));
  });
}

export function serviceUrl(server) {
  return `http://127.0.0.1:${server.address().port}`;
}

export function buildApp(config) {
  return createApp({
    config: {
      JWT_SECRET,
      FRONTEND_URL: 'http://localhost:3000',
      TRUST_PROXY_HOPS: 0,
      RATE_LIMIT_WINDOW_MS: 60_000,
      RATE_LIMIT_USER_MAX: 1000,
      RATE_LIMIT_PUBLIC_MAX: 1000,
      ...config,
    },
    logger: createLogger('test', 'silent'),
  });
}
