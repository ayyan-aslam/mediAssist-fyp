// The API Gateway sends the client IP on every route, and the user ID on protected routes.
function clientIp(req) {
  return req.get('x-user-ip') ?? req.ip;
}

export class AuthController {
  constructor({ requestValidator, authService }) {
    this.requestValidator = requestValidator;
    this.authService = authService;
  }

  // One handler for every sign-up form: register('doctor'), and later register('patient').
  register = (role) => async (req, res) => {
    const data = this.requestValidator.validateRegister(req.body, role);
    const userId = await this.authService.register(data, role);
    res.status(201).json({ userId, message: 'Account created. Please verify your email before logging in.' });
  };

  login = async (req, res) => {
    const { firebaseToken } = this.requestValidator.validateLogin(req.body);
    res.json(await this.authService.login(firebaseToken, clientIp(req)));
  };

  refresh = async (req, res) => {
    const { refreshToken } = this.requestValidator.validateRefreshToken(req.body);
    res.json(await this.authService.refresh(refreshToken));
  };

  logout = async (req, res) => {
    const { refreshToken } = this.requestValidator.validateRefreshToken(req.body);
    const userId = Number(req.get('x-user-id')) || null;
    await this.authService.logout(refreshToken, { userId, ipAddress: clientIp(req) });
    res.status(204).end();
  };
}
