// Removes every x-user-* header sent by the client, so nobody can fake the user.
// The gateway adds its own x-user-* headers later, when it forwards the request.
export function stripUserHeaders(req, res, next) {
  for (const name of Object.keys(req.headers)) {
    if (name.startsWith('x-user-')) {
      delete req.headers[name];
    }
  }
  next();
}
