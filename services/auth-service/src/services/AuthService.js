import { AppError } from '@mediassist/common';
import { ACCESS_TOKEN_TTL_SECONDS } from './TokenService.js';

// Field name from UserRepository.findDuplicates -> 409 error (design doc Section 5.2).
const CONFLICT_ERRORS = {
  email: ['EMAIL_TAKEN', 'This email is already registered.'],
  phone: ['PHONE_TAKEN', 'This phone number is already registered.'],
  cnic: ['CNIC_TAKEN', 'This CNIC is already registered.'],
  registrationNo: ['REGISTRATION_NO_TAKEN', 'This registration number is already registered.'],
};

function invalidFirebaseTokenError(message = 'Your login could not be verified. Please log in again.') {
  return new AppError(401, 'INVALID_FIREBASE_TOKEN', message);
}

function accountSuspendedError() {
  return new AppError(403, 'ACCOUNT_SUSPENDED', 'Your account is suspended. Please contact support.');
}

// Sign-up, login, refresh and logout logic: design doc Sections 7.3 and 7.4.
export class AuthService {
  constructor({ userRepository, firebaseClient, cnicEncryptor, tokenService, refreshTokenService, logger }) {
    this.userRepository = userRepository;
    this.firebaseClient = firebaseClient;
    this.cnicEncryptor = cnicEncryptor;
    this.tokenService = tokenService;
    this.refreshTokenService = refreshTokenService;
    this.logger = logger;
  }

  // data comes from RequestValidator.validateRegister. Returns the new userId.
  async register(data, role) {
    const { fullName, email, phone, password } = data;
    const cnicHash = role === 'doctor' ? this.cnicEncryptor.hash(data.cnic) : null;

    const taken = await this.userRepository.findDuplicates({
      email,
      phone,
      cnicHash,
      registrationNo: data.registrationNo,
    });
    if (taken.length > 0) {
      const [code, message] = CONFLICT_ERRORS[taken[0]];
      throw new AppError(409, code, message);
    }

    const profile =
      role === 'doctor'
        ? { cnicEncrypted: this.cnicEncryptor.encrypt(data.cnic), cnicHash, registrationNo: data.registrationNo }
        : {};

    const firebaseUid = await this.firebaseClient.createUser({ email, password, displayName: fullName });

    try {
      return await this.userRepository.createUserWithProfile({ firebaseUid, fullName, email, phone, role, profile });
    } catch (err) {
      this.logger.error({ err }, 'Saving the new user failed. Deleting the Firebase user.');
      // No half-made account is left: remove the Firebase user too.
      await this.firebaseClient.deleteUser(firebaseUid).catch((deleteErr) => {
        this.logger.error({ err: deleteErr, firebaseUid }, 'Deleting the Firebase user failed');
      });
      throw new AppError(500, 'SIGNUP_FAILED', 'Your account could not be created. Please try again.');
    }
  }

  async login(firebaseToken) {
    let identity;
    try {
      identity = await this.firebaseClient.verifyIdToken(firebaseToken);
    } catch (err) {
      this.logger.debug({ err }, 'Firebase token check failed');
      throw invalidFirebaseTokenError();
    }

    const user = await this.userRepository.findByFirebaseUid(identity.uid);
    if (!user) {
      throw invalidFirebaseTokenError('No account was found for this login. Please sign up first.');
    }
    if (user.accountStatus === 'suspended') {
      throw accountSuspendedError();
    }
    if (!identity.emailVerified) {
      throw new AppError(403, 'EMAIL_NOT_VERIFIED', 'Please verify your email before logging in.');
    }

    const tokens = await this.#createSession(user);
    // MAI-14: publish the audit.event "login" here.
    return {
      ...tokens,
      user: { userId: user.userId, fullName: user.fullName, email: user.email, role: user.role },
    };
  }

  async refresh(refreshToken) {
    const rotated = await this.refreshTokenService.rotate(refreshToken);
    const user = await this.userRepository.findById(rotated.userId);
    if (user.accountStatus === 'suspended') {
      await this.refreshTokenService.revoke(rotated.refreshToken);
      throw accountSuspendedError();
    }

    return {
      accessToken: await this.#createAccessToken(user),
      refreshToken: rotated.refreshToken,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    };
  }

  // Deletes only this device's refresh token.
  async logout(refreshToken) {
    await this.refreshTokenService.revoke(refreshToken);
    // MAI-14: publish the audit.event "logout" here.
  }

  #createAccessToken(user) {
    return this.tokenService.createAccessToken({
      userId: user.userId,
      role: user.role,
      name: user.fullName,
      email: user.email,
    });
  }

  async #createSession(user) {
    return {
      accessToken: await this.#createAccessToken(user),
      refreshToken: await this.refreshTokenService.create(user.userId),
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    };
  }
}
