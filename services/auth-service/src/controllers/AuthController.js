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
    res.json(await this.authService.login(firebaseToken));
  };

  refresh = async (req, res) => {
    const { refreshToken } = this.requestValidator.validateRefreshToken(req.body);
    res.json(await this.authService.refresh(refreshToken));
  };

  logout = async (req, res) => {
    const { refreshToken } = this.requestValidator.validateRefreshToken(req.body);
    await this.authService.logout(refreshToken);
    res.status(204).end();
  };
}
