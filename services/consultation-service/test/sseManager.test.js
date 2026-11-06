import { EventEmitter } from 'node:events';
import { createLogger } from '@mediassist/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SseManager } from '../src/services/SseManager.js';

// A small stand-in for an open SSE response and its request.
function fakeConnection() {
  const req = new EventEmitter();
  const res = {
    writableEnded: false,
    destroyed: false,
    written: [],
    writeHead: vi.fn(),
    flushHeaders: vi.fn(),
    write(chunk) {
      this.written.push(chunk);
    },
    end: vi.fn(function end() {
      this.writableEnded = true;
    }),
  };
  return { req, res };
}

describe('SseManager', () => {
  let sse;

  beforeEach(() => {
    vi.useFakeTimers();
    sse = new SseManager({ logger: createLogger('test', 'silent') });
  });

  afterEach(() => {
    sse.closeAll();
    vi.useRealTimers();
  });

  it('opens the stream with the SSE headers', () => {
    const { req, res } = fakeConnection();
    sse.connect(16, req, res);
    expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
    }));
    expect(res.flushHeaders).toHaveBeenCalled();
  });

  it('sends an event with a name and a JSON data line', () => {
    const { req, res } = fakeConnection();
    sse.connect(16, req, res);
    sse.send(16, 'soap_ready', { consultationId: 41 });
    expect(res.written).toEqual(['event: soap_ready\ndata: {"consultationId":41}\n\n']);
  });

  it('sends to every tab of the doctor and never to another doctor', () => {
    const tab1 = fakeConnection();
    const tab2 = fakeConnection();
    const other = fakeConnection();
    sse.connect(16, tab1.req, tab1.res);
    sse.connect(16, tab2.req, tab2.res);
    sse.connect(17, other.req, other.res);

    sse.send(16, 'soap_ready', { consultationId: 41 });

    expect(tab1.res.written).toHaveLength(1);
    expect(tab2.res.written).toHaveLength(1);
    expect(other.res.written).toHaveLength(0);
  });

  it('removes a connection when the app disconnects', () => {
    const { req, res } = fakeConnection();
    sse.connect(16, req, res);
    req.emit('close');
    sse.send(16, 'soap_ready', { consultationId: 41 });
    expect(res.written).toHaveLength(0);
    expect(sse.connections.size).toBe(0);
  });

  it('skips and removes a connection that is already closed', () => {
    const { req, res } = fakeConnection();
    sse.connect(16, req, res);
    res.destroyed = true;
    sse.send(16, 'soap_ready', { consultationId: 41 });
    expect(res.written).toHaveLength(0);
    expect(sse.connections.size).toBe(0);
  });

  it('does nothing when the doctor has no open connection', () => {
    expect(() => sse.send(16, 'soap_ready', { consultationId: 41 })).not.toThrow();
  });

  it('writes a keep-alive comment every 25 seconds', () => {
    const { req, res } = fakeConnection();
    sse.connect(16, req, res);
    vi.advanceTimersByTime(24_999);
    expect(res.written).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(res.written).toEqual([': keep-alive\n\n']);
    vi.advanceTimersByTime(25_000);
    expect(res.written).toHaveLength(2);
  });

  it('closes every connection on shutdown', () => {
    const tab1 = fakeConnection();
    const tab2 = fakeConnection();
    sse.connect(16, tab1.req, tab1.res);
    sse.connect(17, tab2.req, tab2.res);
    sse.closeAll();
    expect(tab1.res.end).toHaveBeenCalled();
    expect(tab2.res.end).toHaveBeenCalled();
    expect(sse.connections.size).toBe(0);
  });
});
