import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

// Joins 10-second WebM parts into one mono 16 kHz MP3 with ffmpeg (design doc Diagram 6).
// Each part is a complete file, so the concat filter decodes them one after the other.
export class AudioMerger {
  // parts: Buffers in play order (the overlap part first). Returns the MP3 as a Buffer.
  async merge(parts) {
    const dir = await mkdtemp(path.join(tmpdir(), 'mediassist-merge-'));
    try {
      const inputs = [];
      for (const [i, part] of parts.entries()) {
        const file = path.join(dir, `part-${i}.webm`);
        await writeFile(file, part);
        inputs.push('-i', file);
      }
      const out = path.join(dir, 'minute.mp3');
      await run('ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-y',
        ...inputs,
        '-filter_complex', `concat=n=${parts.length}:v=0:a=1`,
        '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '64k',
        out,
      ]);
      return await readFile(out);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
