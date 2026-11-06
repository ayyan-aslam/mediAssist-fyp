import { execFile, execFileSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { AudioMerger } from '../src/services/AudioMerger.js';

const run = promisify(execFile);

function hasFfmpeg() {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// A complete stereo 48 kHz WebM (Opus) file of the given length, like one part from the Doctor App.
async function webmPart(seconds, frequency) {
  const out = path.join(tmpdir(), `mediassist-test-part-${process.pid}-${frequency}.webm`);
  await run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `sine=frequency=${frequency}:duration=${seconds}:sample_rate=48000`,
    '-ac', '2', '-c:a', 'libopus', out,
  ]);
  return readFile(out);
}

const mergeDirs = async () => (await readdir(tmpdir())).filter((name) => name.startsWith('mediassist-merge-'));

// Uses the real ffmpeg. Skipped when ffmpeg is not on the PATH.
describe.skipIf(!hasFfmpeg())('AudioMerger', () => {
  it('joins complete WebM parts into one mono 16 kHz MP3 and deletes its temp files', async () => {
    const parts = [await webmPart(2, 440), await webmPart(3, 660)];
    const before = await mergeDirs();

    const mp3 = await new AudioMerger().merge(parts);

    const out = path.join(tmpdir(), `mediassist-test-merged-${process.pid}.mp3`);
    await import('node:fs/promises').then((fs) => fs.writeFile(out, mp3));
    const { stdout } = await run('ffprobe', [
      '-v', 'error', '-show_entries', 'stream=codec_name,channels,sample_rate:format=duration', '-of', 'json', out,
    ]);
    const info = JSON.parse(stdout);
    expect(info.streams[0]).toMatchObject({ codec_name: 'mp3', channels: 1, sample_rate: '16000' });
    expect(Number(info.format.duration)).toBeCloseTo(5, 0);
    expect(await mergeDirs()).toEqual(before);
  });

  it('deletes its temp files when ffmpeg fails', async () => {
    const before = await mergeDirs();

    await expect(new AudioMerger().merge([Buffer.from('not audio')])).rejects.toThrow();

    expect(await mergeDirs()).toEqual(before);
  });
});
