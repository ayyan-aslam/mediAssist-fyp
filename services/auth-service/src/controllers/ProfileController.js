import { AppError } from '@mediassist/common';

// The API Gateway checks the token and sends the user in the x-user-* headers.
function currentUser(req) {
  const userId = Number(req.get('x-user-id'));
  const role = req.get('x-user-role');
  if (!Number.isInteger(userId) || userId <= 0 || !role) {
    throw new AppError(401, 'UNAUTHORIZED', 'The access token is missing.');
  }
  return { userId, role };
}

export class ProfileController {
  constructor({ requestValidator, profileService }) {
    this.requestValidator = requestValidator;
    this.profileService = profileService;
  }

  getMe = async (req, res) => {
    const { userId } = currentUser(req);
    res.json(await this.profileService.getProfile(userId));
  };

  updateMe = async (req, res) => {
    const { userId, role } = currentUser(req);
    const changes = this.requestValidator.validateProfileUpdate(req.body, role);
    res.json(await this.profileService.updateProfile(userId, role, changes));
  };
}
