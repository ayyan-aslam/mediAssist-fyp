// The doctor's live updates (design doc 3.7 and 5.5 GET /consultations/events).
// Keeps the open SSE connections of each doctor; a doctor may have several tabs open.
export class SseManager {
  constructor({ logger, keepAliveMs = 25_000 }) {
    this.logger = logger;
    this.connections = new Map();
    // A comment line keeps proxies and the browser from closing an idle stream.
    this.keepAlive = setInterval(() => this.#writeAll(': keep-alive\n\n'), keepAliveMs);
    this.keepAlive.unref();
  }

  connect(doctorId, req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();

    if (!this.connections.has(doctorId)) this.connections.set(doctorId, new Set());
    this.connections.get(doctorId).add(res);
    this.logger.info({ doctorId }, 'Doctor connected to live updates');

    req.on('close', () => this.#remove(doctorId, res));
  }

  // event: soap_ready or consultation_failed. Nothing happens if the doctor has no open connection;
  // the app reads the consultation again when it connects.
  send(doctorId, event, data) {
    const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of this.connections.get(doctorId) ?? []) {
      this.#write(doctorId, res, message);
    }
  }

  // On shutdown, so the HTTP server does not wait for the open streams.
  closeAll() {
    clearInterval(this.keepAlive);
    for (const set of this.connections.values()) {
      for (const res of set) res.end();
    }
    this.connections.clear();
  }

  #writeAll(message) {
    for (const [doctorId, set] of this.connections) {
      for (const res of set) this.#write(doctorId, res, message);
    }
  }

  #write(doctorId, res, message) {
    if (res.writableEnded || res.destroyed) {
      this.#remove(doctorId, res);
      return;
    }
    res.write(message);
  }

  #remove(doctorId, res) {
    const set = this.connections.get(doctorId);
    if (!set?.delete(res)) return;
    if (set.size === 0) this.connections.delete(doctorId);
    this.logger.info({ doctorId }, 'Doctor disconnected from live updates');
  }
}
