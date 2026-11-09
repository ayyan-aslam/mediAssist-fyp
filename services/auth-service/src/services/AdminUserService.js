import { AppError } from '@mediassist/common';

function userNotFoundError() {
  return new AppError(404, 'USER_NOT_FOUND', 'This user was not found.');
}

function serviceUnavailableError() {
  return new AppError(503, 'SERVICE_UNAVAILABLE', 'The service is not responding. Please try again.');
}

// Builds a GET /admin/users item (design doc 5.2). specialty is null for patients and admins.
function toAdminUser(user) {
  return {
    userId: user.userId,
    fullName: user.fullName,
    email: user.email,
    phone: user.phone,
    role: user.role,
    accountStatus: user.accountStatus,
    specialty: user.doctorProfile?.specialty ?? null,
    createdAt: user.createdAt.toISOString(),
  };
}

// The admin rules: list, search, suspend and activate users (design doc 5.2 and Diagram 11).
export class AdminUserService {
  constructor({ userRepository, firebaseClient, eventPublisher, logger }) {
    this.userRepository = userRepository;
    this.firebaseClient = firebaseClient;
    this.eventPublisher = eventPublisher;
    this.logger = logger;
  }

  // query comes from RequestValidator.validateAdminUserList.
  async list({ page, pageSize, ...filters }) {
    const { items, total } = await this.userRepository.findAdminPage(filters, { page, pageSize });
    return { items: items.map(toAdminUser), page, pageSize, total };
  }

  async get(userId) {
    const user = await this.userRepository.findAdminUserById(userId);
    if (!user) throw userNotFoundError();
    return toAdminUser(user);
  }

  // Names and roles for the audit log screen (GET /internal/users). Unknown IDs are left out.
  async listNames(userIds) {
    return { items: await this.userRepository.findNamesByIds(userIds) };
  }

  // Only patients and doctors can be suspended, so an admin can never suspend themself either.
  // A second call returns 409 ALREADY_SUSPENDED and changes nothing. When a step fails, the status
  // stays active and the admin can try again: the Firebase steps give the same result when repeated.
  async suspend(userId, { adminId, ipAddress }) {
    const user = await this.userRepository.findById(userId);
    if (!user) throw userNotFoundError();
    if (user.role === 'admin') {
      throw new AppError(403, 'CANNOT_SUSPEND_ADMIN', 'An admin account cannot be suspended.');
    }
    if (user.accountStatus === 'suspended') {
      throw new AppError(409, 'ALREADY_SUSPENDED', 'This account is already suspended.');
    }

    await this.#callFirebase(user, async () => {
      await this.firebaseClient.disableUser(user.firebaseUid);
      await this.firebaseClient.revokeRefreshTokens(user.firebaseUid);
    });

    const changedAt = new Date().toISOString();
    const details = `Suspended ${user.role} ${user.userId} (${user.fullName})`.slice(0, 255);
    await this.userRepository.updateStatus(userId, 'suspended', () =>
      this.#publish(userId, [
        ['user.suspended', { userId, changedAt }],
        ['audit.event', { userId: adminId, action: 'account_suspension', details, ipAddress, occurredAt: changedAt }],
      ]),
    );
    return { userId, accountStatus: 'suspended' };
  }

  // A second call returns 409 ALREADY_ACTIVE and changes nothing.
  async activate(userId) {
    const user = await this.userRepository.findById(userId);
    if (!user) throw userNotFoundError();
    if (user.accountStatus === 'active') {
      throw new AppError(409, 'ALREADY_ACTIVE', 'This account is already active.');
    }

    await this.#callFirebase(user, () => this.firebaseClient.enableUser(user.firebaseUid));

    const changedAt = new Date().toISOString();
    await this.userRepository.updateStatus(userId, 'active', () =>
      this.#publish(userId, [['user.activated', { userId, changedAt }]]),
    );
    return { userId, accountStatus: 'active' };
  }

  async #callFirebase(user, action) {
    try {
      await action();
    } catch (err) {
      this.logger.error({ err, userId: user.userId }, 'Firebase could not change the account');
      throw serviceUnavailableError();
    }
  }

  // Waits for RabbitMQ to confirm each message. Throwing here rolls back the status change.
  async #publish(userId, messages) {
    try {
      for (const [type, data] of messages) {
        await this.eventPublisher.publish(type, data);
      }
    } catch (err) {
      this.logger.error({ err, userId }, 'Could not send the account status messages');
      throw serviceUnavailableError();
    }
  }
}
