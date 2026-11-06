// Plays a recorded consultation through the real API, like the Doctor App does (design doc Diagram 5):
// cuts the audio into complete 10-second WebM (Opus) parts with ffmpeg, starts a consultation,
// uploads the parts, calls stop and prints the result.
//
// Usage (PowerShell, from the repo root):
//   $env:ACCESS_TOKEN = "<doctor access token>"
//   node scripts/simulate-consultation.js <audio file> <clinicalPatientId> [--fast]
//
// GATEWAY_URL (default http://localhost:8080). --fast uploads one part per second instead of one every 10 seconds.
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const PART_SECONDS = 10;
const UPLOAD_TRIES = 3;

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function readArgs() {
  const args = process.argv.slice(2);
  const fast = args.includes('--fast');
  const [audioFile, patientArg] = args.filter((a) => a !== '--fast');
  const clinicalPatientId = Number(patientArg);
  if (!audioFile || !Number.isInteger(clinicalPatientId) || clinicalPatientId <= 0) {
    fail('usage: node scripts/simulate-consultation.js <audio file> <clinicalPatientId> [--fast]');
  }
  const accessToken = process.env.ACCESS_TOKEN;
  if (!accessToken) fail('set ACCESS_TOKEN to a doctor access token (see README).');
  const gatewayUrl = (process.env.GATEWAY_URL ?? 'http://localhost:8080').replace(/\/$/, '');
  return { audioFile, clinicalPatientId, fast, accessToken, gatewayUrl };
}

// Each part is a separate, complete WebM file (with its own header), like one MediaRecorder per part.
async function cutIntoParts(audioFile, dir) {
  await run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error',
    '-i', audioFile,
    '-vn', '-ac', '1', '-c:a', 'libopus', '-b:a', '32k',
    '-f', 'segment', '-segment_time', String(PART_SECONDS), '-reset_timestamps', '1',
    path.join(dir, 'part-%03d.webm'),
  ]);
  const files = (await readdir(dir)).filter((f) => f.endsWith('.webm')).sort();
  return Promise.all(
    files.map(async (file, i) => {
      const filePath = path.join(dir, file);
      const { stdout } = await run('ffprobe', [
        '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', filePath,
      ]);
      // Opus adds a few milliseconds of padding (10.007 s), so round to the nearest second.
      return { partNo: i + 1, filePath, durationSec: Math.max(1, Math.round(Number(stdout.trim()))) };
    }),
  );
}

function createApi(gatewayUrl, accessToken) {
  return async function api(method, urlPath, body) {
    const isForm = body instanceof FormData;
    const res = await fetch(`${gatewayUrl}/api/v1${urlPath}`, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(body && !isForm && { 'Content-Type': 'application/json' }),
      },
      body: body && !isForm ? JSON.stringify(body) : body,
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }
    return { status: res.status, body: json };
  };
}

async function uploadPart(api, consultationId, part) {
  for (let attempt = 1; ; attempt++) {
    const form = new FormData();
    form.append('partNo', String(part.partNo));
    form.append('durationSec', String(part.durationSec));
    form.append('audio', new Blob([await readFile(part.filePath)], { type: 'audio/webm' }), `${part.partNo}.webm`);
    try {
      const res = await api('POST', `/consultations/${consultationId}/audio-parts`, form);
      // 4xx will not change when sent again. 5xx and network errors are tried again.
      if (res.status < 500 || attempt === UPLOAD_TRIES) return res;
    } catch (err) {
      if (attempt === UPLOAD_TRIES) return { status: 0, body: { error: { message: err.message } } };
    }
    await sleep(1000 * attempt);
  }
}

async function main() {
  const { audioFile, clinicalPatientId, fast, accessToken, gatewayUrl } = readArgs();
  const api = createApi(gatewayUrl, accessToken);
  const dir = await mkdtemp(path.join(tmpdir(), 'mediassist-parts-'));

  try {
    const parts = await cutIntoParts(audioFile, dir);
    console.log(`Cut ${path.basename(audioFile)} into ${parts.length} parts of up to ${PART_SECONDS} seconds.`);

    const started = await api('POST', '/consultations', { clinicalPatientId });
    if (started.status !== 201) fail(`start failed (${started.status}): ${JSON.stringify(started.body)}`);
    const { consultationId } = started.body;
    console.log(`Started consultation ${consultationId}.`);

    const byNo = new Map(parts.map((p) => [p.partNo, p]));
    const intervalMs = (fast ? 1 : PART_SECONDS) * 1000;
    for (const part of parts) {
      const sentAt = Date.now();
      const res = await uploadPart(api, consultationId, part);
      console.log(`Part ${part.partNo}/${parts.length} (${part.durationSec}s): ${res.status} ${JSON.stringify(res.body)}`);
      if (res.status >= 400 && res.status < 500) fail('the upload was refused.');
      if (part.partNo < parts.length) await sleep(Math.max(0, intervalMs - (Date.now() - sentAt)));
    }

    // Like the app: on PARTS_MISSING, upload the missing parts and call stop again.
    let stopped;
    for (let attempt = 1; attempt <= UPLOAD_TRIES; attempt++) {
      stopped = await api('POST', `/consultations/${consultationId}/stop`, { totalParts: parts.length });
      const missing = stopped.body?.error?.code === 'PARTS_MISSING' ? stopped.body.error.missingParts : null;
      if (!missing) break;
      console.log(`Stop: parts missing ${missing.join(', ')}. Uploading them again.`);
      for (const partNo of missing) await uploadPart(api, consultationId, byNo.get(partNo));
    }
    console.log(`Stop: ${stopped.status} ${JSON.stringify(stopped.body)}`);

    const result = await api('GET', `/consultations/${consultationId}`);
    console.log(`Consultation ${consultationId}: ${result.status} ${JSON.stringify(result.body, null, 2)}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

main().catch((err) => fail(err.message));
