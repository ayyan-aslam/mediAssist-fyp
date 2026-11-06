import { AppError } from '@mediassist/common';
import { takenField } from '../repositories/UserRepository.js';

function userNotFoundError() {
  return new AppError(404, 'USER_NOT_FOUND', 'Your account was not found. Please log in again.');
}

function phoneTakenError() {
  return new AppError(409, 'PHONE_TAKEN', 'This phone number is already registered.');
}

// Builds the GET /users/me response (design doc Section 5.2). The CNIC is never sent back.
function toProfile(user) {
  const profile = {
    userId: user.userId,
    fullName: user.fullName,
    email: user.email,
    phone: user.phone,
    role: user.role,
  };
  if (user.role === 'patient') {
    profile.dateOfBirth = user.patientProfile?.dateOfBirth?.toISOString().slice(0, 10) ?? null;
    profile.gender = user.patientProfile?.gender ?? null;
  }
  if (user.role === 'doctor') {
    profile.registrationNo = user.doctorProfile.registrationNo;
    profile.specialty = user.doctorProfile.specialty ?? null;
  }
  return profile;
}

// The user's own profile: GET and PATCH /users/me.
export class ProfileService {
  constructor({ userRepository, specialtyRepository }) {
    this.userRepository = userRepository;
    this.specialtyRepository = specialtyRepository;
  }

  async getProfile(userId) {
    const user = await this.userRepository.findProfileById(userId);
    if (!user) {
      throw userNotFoundError();
    }
    return toProfile(user);
  }

  // changes comes from RequestValidator.validateProfileUpdate. Returns the updated profile.
  async updateProfile(userId, role, changes) {
    const { fullName, phone, ...profile } = changes;

    if (!(await this.userRepository.findById(userId))) {
      throw userNotFoundError();
    }
    if (phone) {
      const owner = await this.userRepository.findByPhone(phone);
      if (owner && owner.userId !== userId) throw phoneTakenError();
    }
    if (profile.specialtyId && !(await this.specialtyRepository.findById(profile.specialtyId))) {
      throw new AppError(400, 'VALIDATION_ERROR', 'specialtyId: this speciality does not exist.');
    }

    try {
      await this.userRepository.updateProfile(userId, role, { fullName, phone, profile });
    } catch (err) {
      // Another user saved the same phone at the same moment, after the check above.
      if (takenField(err) === 'phone') throw phoneTakenError();
      throw err;
    }
    return this.getProfile(userId);
  }
}
