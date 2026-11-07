import { AppError } from '@mediassist/common';
import { patientNotFoundError } from '../errors.js';

function phoneAlreadySavedError() {
  return new AppError(409, 'PHONE_ALREADY_SAVED', 'You have already saved a patient with this phone number.');
}

const isUniqueViolation = (err) => err?.code === 'P2002';

// The clinic patient object (design doc Section 5.5).
export function toPatient(row) {
  return {
    clinicalPatientId: row.clinicalPatientId,
    fullName: row.fullName,
    phone: row.phone,
    email: row.email,
    age: row.age,
    gender: row.gender,
    createdAt: row.createdAt.toISOString(),
  };
}

// Adds, finds and edits clinic patients. A doctor sees only his own patients:
// another doctor's patient is reported as not found (404), never as forbidden.
export class PatientService {
  constructor({ patientRepository }) {
    this.patientRepository = patientRepository;
  }

  async create(doctorId, data) {
    try {
      return toPatient(await this.patientRepository.insert(doctorId, data));
    } catch (err) {
      if (isUniqueViolation(err)) throw phoneAlreadySavedError();
      throw err;
    }
  }

  async findByPhone(doctorId, phone) {
    const row = await this.patientRepository.findByDoctorAndPhone(doctorId, phone);
    return row ? { found: true, patient: toPatient(row) } : { found: false, patient: null };
  }

  // The patients list (paged, design doc 5.1.2), newest first, optionally filtered by name or phone.
  async list(doctorId, { q, page, pageSize }) {
    const { rows, total } = await this.patientRepository.list(doctorId, q, { page, pageSize });
    return { items: rows.map(toPatient), page, pageSize, total };
  }

  async getById(doctorId, clinicalPatientId) {
    const row = await this.patientRepository.findByDoctorAndId(doctorId, clinicalPatientId);
    if (!row) throw patientNotFoundError();
    return toPatient(row);
  }

  async update(doctorId, clinicalPatientId, changes) {
    let updated;
    try {
      updated = await this.patientRepository.update(doctorId, clinicalPatientId, changes);
    } catch (err) {
      if (isUniqueViolation(err)) throw phoneAlreadySavedError();
      throw err;
    }
    if (!updated) throw patientNotFoundError();
    return this.getById(doctorId, clinicalPatientId);
  }
}
