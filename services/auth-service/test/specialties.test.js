import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createTestContext } from './helpers.js';

describe('GET /specialties', () => {
  it('lists all specialities', async () => {
    const { app } = createTestContext();
    const res = await request(app).get('/specialties');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      items: [
        { specialtyId: 1, name: 'General Physician' },
        { specialtyId: 3, name: 'Cardiologist' },
      ],
    });
  });
});
