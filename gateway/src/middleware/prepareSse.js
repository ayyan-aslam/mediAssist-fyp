// Runs after the token check on SSE routes (design doc Section 5.1.4).
// Removes ?token= so it never reaches the service or the logs.
// The stream stays open for a long time, so it has no timeout and must not be compressed or buffered.
export function prepareSse(req, res, next) {
  req.url = removeTokenParam(req.url);
  req.originalUrl = removeTokenParam(req.originalUrl);
  req.socket.setTimeout(0);
  delete req.headers['accept-encoding'];
  next();
}

function removeTokenParam(url) {
  const [path, query] = url.split('?');
  const params = new URLSearchParams(query);
  params.delete('token');
  const rest = params.toString();
  return rest ? `${path}?${rest}` : path;
}
