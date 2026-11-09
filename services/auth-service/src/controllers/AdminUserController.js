import { AppError } from '@mediassist/common';

// The gateway checks the token and the admin role, and sends the admin in the x-user-* headers.
// The role is checked here again, so no other user can reach these routes.
function currentAdmin(req) {
  const userId = Number(req.get('x-user-id'));
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new AppError(401, 'UNAUTHORIZED', 'The access token is missing.');
  }
  if (req.get('x-user-role') !== 'admin') {
    throw new AppError(403, 'FORBIDDEN', 'You are not allowed to do this.');
  }
  return { adminId: userId, ipAddress: req.get('x-user-ip') ?? req.ip };
}

// Admin endpoints (design doc 5.2 and Diagram 11), and GET /internal/users for the Audit Service.
export class AdminUserController {
  constructor({ requestValidator, adminUserService }) {
    this.requestValidator = requestValidator;
    this.adminUserService = adminUserService;
  }

  list = async (req, res) => {
    currentAdmin(req);
    const query = this.requestValidator.validateAdminUserList(req.query);
    res.json(await this.adminUserService.list(query));
  };

  get = async (req, res) => {
    currentAdmin(req);
    const userId = this.requestValidator.parseUserId(req.params.userId);
    res.json(await this.adminUserService.get(userId));
  };

  suspend = async (req, res) => {
    const admin = currentAdmin(req);
    const userId = this.requestValidator.parseUserId(req.params.userId);
    res.json(await this.adminUserService.suspend(userId, admin));
  };

  activate = async (req, res) => {
    currentAdmin(req);
    const userId = this.requestValidator.parseUserId(req.params.userId);
    res.json(await this.adminUserService.activate(userId));
  };

  // Internal. The gateway does not expose /internal routes, so there is no user.
  listNames = async (req, res) => {
    const userIds = this.requestValidator.validateUserIds(req.query);
    res.json(await this.adminUserService.listNames(userIds));
  };
}
