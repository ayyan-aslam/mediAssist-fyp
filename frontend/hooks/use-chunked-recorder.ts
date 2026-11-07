"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Records the microphone in 10-second parts (design doc Diagram 5, Part 3).
// One getUserMedia stream stays open. Every part gets its own MediaRecorder, so every part is a
// complete WebM file with its own header. (One recorder with a timeslice would give chunks where
// only the first one has the header.)
// Pause pauses the running part's MediaRecorder and its 10-second timer, so a part still holds
// 10 seconds of sound and the paused time counts neither in the parts nor on the timer.

export const PART_SECONDS = 10;
const PART_MS = PART_SECONDS * 1000;
const MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm"];
// Enough for clear speech, and small: about 40 KB per part (the upload limit is 2 MB).
const AUDIO_BITS_PER_SECOND = 32_000;
// A new MediaRecorder needs about 0.1 s before it captures sound. The finished part keeps
// recording this long after the next one starts, so no words are lost between two parts.
const OVERLAP_MS = 300;

export type RecorderStatus =
  | "idle"
  | "requesting" // waiting for the microphone permission
  | "recording"
  | "paused" // the doctor paused; the microphone stays open
  | "interrupted" // the microphone stopped (unplugged, or the permission was taken away)
  | "stopped"
  | "blocked" // the permission was refused
  | "no-microphone"
  | "mic-busy" // another app is using the microphone
  | "insecure" // the page is not on https or localhost, so the browser hides the microphone
  | "unsupported";

export interface AudioPart {
  partNo: number;
  durationSec: number;
  audio: Blob;
}

interface Options {
  // Parts already recorded before a page reload, so the numbering continues after them.
  partsBefore: number;
  // The last allowed part. When it ends, onLimitReached runs instead of starting a new part.
  maxParts: number;
  onPart: (part: AudioPart) => void;
  onLimitReached: () => void;
}

interface RunningPart {
  recorder: MediaRecorder;
  partNo: number;
  // Recorded time before the last pause, and when it last started or resumed (null while paused).
  activeMs: number;
  resumedAt: number | null;
  // Resolves when the part has been handed to onPart (true), or was empty (false).
  done: Promise<boolean>;
}

const activeMsOf = (part: RunningPart) => part.activeMs + (part.resumedAt === null ? 0 : performance.now() - part.resumedAt);

function pausePart(part: RunningPart, now: number) {
  part.recorder.pause();
  part.activeMs += now - (part.resumedAt ?? now);
  part.resumedAt = null;
}

function resumePart(part: RunningPart, now: number) {
  part.recorder.resume();
  part.resumedAt = now;
}

interface Session {
  stream: MediaStream | null;
  audioContext: AudioContext | null;
  analyser: AnalyserNode | null;
  current: RunningPart | null;
  // Parts that were told to stop (some still in their overlap time).
  ending: RunningPart[];
  timer: ReturnType<typeof setTimeout> | undefined;
  // Starts the next part; set when recording starts, used again on resume.
  nextPart: () => void;
  // When the running part's timer fires, and the time it had left when paused.
  timerDueAt: number;
  leftMs: number;
}

function pickMimeType() {
  if (typeof MediaRecorder === "undefined") return null;
  return MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? null;
}

export function useChunkedRecorder({ partsBefore, maxParts, onPart, onLimitReached }: Options) {
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [elapsedSec, setElapsedSec] = useState(partsBefore * PART_SECONDS);

  const sessionRef = useRef<Session | null>(null);
  const lastPartNoRef = useRef(partsBefore);
  // Recorded time of this page before the last pause, and when recording last started or resumed.
  const recordedBeforeMsRef = useRef(0);
  const recordingSinceRef = useRef(0);
  const levelBufferRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  // The latest callbacks, so the timers never call an old one.
  const callbacks = useRef({ onPart, onLimitReached });
  useEffect(() => {
    callbacks.current = { onPart, onLimitReached };
  });

  const startPart = useCallback((session: Session, stream: MediaStream, mimeType: string): RunningPart => {
    const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: AUDIO_BITS_PER_SECOND });
    const partNo = ++lastPartNoRef.current;
    const chunks: Blob[] = [];
    const part = { recorder, partNo, activeMs: 0, resumedAt: performance.now() } as RunningPart;

    part.done = new Promise<boolean>((resolve) => {
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onstop = () => {
        const audio = new Blob(chunks, { type: recorder.mimeType || mimeType });
        // The session is gone when the page was left: the part is dropped.
        if (audio.size === 0 || sessionRef.current !== session) return resolve(false);
        // Only the recorded time counts, not the time the part was paused.
        const durationSec = Math.round(activeMsOf(part) / 10) / 100;
        part.resumedAt = null;
        callbacks.current.onPart({ partNo, durationSec, audio });
        resolve(true);
      };
    });

    recorder.start();
    return part;
  }, []);

  // Ends a part, now or after `delayMs`. Resolves when it has been handed to onPart.
  const endPart = (session: Session, part: RunningPart, delayMs = 0) => {
    const stopRecorder = () => {
      if (part.recorder.state !== "inactive") part.recorder.stop();
    };
    session.ending.push(part);
    if (delayMs > 0) setTimeout(stopRecorder, delayMs);
    else stopRecorder();
    return part.done;
  };

  // Frees the microphone and the audio graph. The running part (if any) must be ended first.
  const release = (session: Session) => {
    clearTimeout(session.timer);
    session.stream?.getTracks().forEach((track) => track.stop());
    void session.audioContext?.close().catch(() => {});
  };

  const start = useCallback(async () => {
    if (sessionRef.current) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus(window.isSecureContext ? "unsupported" : "insecure");
      return;
    }
    const mimeType = pickMimeType();
    if (!mimeType) {
      setStatus("unsupported");
      return;
    }

    const session: Session = {
      stream: null,
      audioContext: null,
      analyser: null,
      current: null,
      ending: [],
      timer: undefined,
      nextPart: () => {},
      timerDueAt: 0,
      leftMs: 0,
    };
    sessionRef.current = session;
    setStatus("requesting");

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
    } catch (err) {
      if (sessionRef.current === session) sessionRef.current = null;
      const name = err instanceof DOMException ? err.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") setStatus("blocked");
      else if (name === "NotFoundError" || name === "OverconstrainedError") setStatus("no-microphone");
      else setStatus("mic-busy");
      return;
    }
    session.stream = stream;
    // The page was left while the browser asked for the permission.
    if (sessionRef.current !== session) {
      release(session);
      return;
    }

    // Sound level for the screen. A failure here never stops the recording.
    try {
      const audioContext = new AudioContext();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      audioContext.createMediaStreamSource(stream).connect(analyser);
      session.audioContext = audioContext;
      session.analyser = analyser;
      levelBufferRef.current = new Uint8Array(analyser.fftSize);
      void audioContext.resume().catch(() => {});
    } catch {
      // No sound level.
    }

    const [track] = stream.getAudioTracks();
    track.onended = () => {
      if (sessionRef.current !== session || !session.current) return;
      clearTimeout(session.timer);
      const last = session.current;
      session.current = null;
      void endPart(session, last);
      setStatus("interrupted");
    };

    // Every 10 seconds of recording: start the next part, then end the finished one.
    const schedule = (ms: number) => {
      session.timerDueAt = performance.now() + ms;
      session.timer = setTimeout(session.nextPart, ms);
    };
    session.nextPart = () => {
      if (sessionRef.current !== session || !session.current) return;
      if (session.current.partNo >= maxParts) {
        callbacks.current.onLimitReached();
        return;
      }
      const finished = session.current;
      session.current = startPart(session, stream, mimeType);
      void endPart(session, finished, OVERLAP_MS);
      schedule(PART_MS);
    };

    recordedBeforeMsRef.current = 0;
    recordingSinceRef.current = performance.now();
    session.current = startPart(session, stream, mimeType);
    schedule(PART_MS);
    setStatus("recording");
  }, [maxParts, startPart]);

  const elapsedNow = useCallback(
    (recording: boolean) =>
      partsBefore * PART_SECONDS +
      (recordedBeforeMsRef.current + (recording ? performance.now() - recordingSinceRef.current : 0)) / 1000,
    [partsBefore],
  );

  // Pauses the running part and its timer. The microphone stays open, so resuming is instant.
  const pause = useCallback(() => {
    const session = sessionRef.current;
    if (!session || !session.current || session.current.recorder.state !== "recording") return;
    const now = performance.now();
    clearTimeout(session.timer);
    session.leftMs = Math.max(0, session.timerDueAt - now);
    // A finished part still in its overlap time ends now, so it holds no paused sound.
    for (const ending of session.ending) {
      if (ending.recorder.state !== "inactive") ending.recorder.stop();
    }
    pausePart(session.current, now);
    recordedBeforeMsRef.current += now - recordingSinceRef.current;
    setElapsedSec(elapsedNow(false));
    setStatus("paused");
  }, [elapsedNow]);

  const resume = useCallback(() => {
    const session = sessionRef.current;
    if (!session || !session.current || session.current.recorder.state !== "paused") return;
    const now = performance.now();
    resumePart(session.current, now);
    recordingSinceRef.current = now;
    session.timerDueAt = now + session.leftMs;
    session.timer = setTimeout(session.nextPart, session.leftMs);
    setStatus("recording");
  }, []);

  // Ends the last part with its real length and frees the microphone.
  // Resolves with the total number of parts, for POST /stop.
  const stop = useCallback(async () => {
    const session = sessionRef.current;
    if (!session) return lastPartNoRef.current;
    clearTimeout(session.timer);
    // A part still in its overlap time ends now.
    for (const part of session.ending) {
      if (part.recorder.state !== "inactive") part.recorder.stop();
    }
    const last = session.current;
    session.current = null;
    if (last) {
      const sent = await endPart(session, last);
      // A last part with no sound data at all is not sent, so it is not counted either.
      if (!sent && lastPartNoRef.current === last.partNo) lastPartNoRef.current -= 1;
    }
    await Promise.all(session.ending.map((part) => part.done));
    release(session);
    sessionRef.current = null;
    setStatus("stopped");
    return lastPartNoRef.current;
  }, []);

  // Discard: frees the microphone and drops the running part instead of handing it to onPart.
  const cancel = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    // Cleared first, so the parts that stop below are dropped (see onstop).
    sessionRef.current = null;
    clearTimeout(session.timer);
    for (const part of [...session.ending, ...(session.current ? [session.current] : [])]) {
      if (part.recorder.state !== "inactive") part.recorder.stop();
    }
    session.current = null;
    release(session);
    setStatus("stopped");
  }, []);

  // Sound level from 0 to 1, read by the animation on every frame.
  const getLevel = useCallback(() => {
    const analyser = sessionRef.current?.analyser;
    const buffer = levelBufferRef.current;
    if (!analyser || !buffer) return 0;
    analyser.getByteTimeDomainData(buffer);
    let sum = 0;
    for (const value of buffer) {
      const sample = (value - 128) / 128;
      sum += sample * sample;
    }
    return Math.min(1, Math.sqrt(sum / buffer.length) * 4);
  }, []);

  // Running timer. Parts recorded before a reload count too; paused time does not.
  useEffect(() => {
    if (status !== "recording") return;
    const tick = () => setElapsedSec(elapsedNow(true));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [status, elapsedNow]);

  // Leaving the page frees the microphone. Parts that are not uploaded yet are lost
  // (the page warns before it is left).
  useEffect(
    () => () => {
      const session = sessionRef.current;
      if (!session) return;
      sessionRef.current = null;
      if (session.current) void endPart(session, session.current);
      release(session);
    },
    [],
  );

  return { status, elapsedSec, start, stop, pause, resume, cancel, getLevel };
}
