/**
 * ffmpeg helpers for the film renderer (S5): one encoder process per chunk fed raw RGBA frames through stdin
 * (drain backpressure), ffprobe frame counts, concat (stream copy) and the audio mux. ffmpeg / ffprobe come
 * from PATH (8.x full build) or MOME_FFMPEG / MOME_FFPROBE.
 *
 * Colour: the captured bytes are sRGB-encoded (the post pass encodes them); they are tagged and converted as
 * BT.709 video (limited range), the usual delivery convention for sRGB-graded renders.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createWriteStream, writeFileSync } from 'node:fs';

export const FFMPEG = process.env.MOME_FFMPEG ?? 'ffmpeg';
export const FFPROBE = process.env.MOME_FFPROBE ?? 'ffprobe';

export type Codec = 'x264' | 'prores' | 'ffv1';

export interface EncodeOpts {
  width: number;
  height: number;
  fps: number;
  codec: Codec;
  /** x264 CRF (default 14) */
  crf?: number;
  /** x264 preset (default medium) */
  preset?: string;
  /** x264 keyframe interval, frames (default 2 s) */
  gop?: number;
}

export const CODEC_EXT: Record<Codec, string> = { x264: 'mkv', prores: 'mov', ffv1: 'mkv' };

const BT709 = ['-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv'];
// convert, then tag the frames themselves (the encoder writes the VUI from the frame properties)
const TO_YUV = (fmt: string) => ['-vf', `scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int,format=${fmt},setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv`];

/** encoder arguments for one chunk (input: raw RGBA on stdin) */
export function encodeArgs(o: EncodeOpts, out: string): string[] {
  const input = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${o.width}x${o.height}`, '-framerate', String(o.fps), '-i', 'pipe:0'];
  if (o.codec === 'x264')
    return [...input, ...TO_YUV('yuv420p'), '-c:v', 'libx264', '-preset', o.preset ?? 'medium', '-crf', String(o.crf ?? 14), '-profile:v', 'high', '-g', String(o.gop ?? o.fps * 2), '-bf', '2', ...BT709, out];
  if (o.codec === 'prores') return [...input, ...TO_YUV('yuv422p10le'), '-c:v', 'prores_ks', '-profile:v', '3', '-vendor', 'apl0', ...BT709, out];
  return [...input, '-c:v', 'ffv1', '-level', '3', '-g', '1', '-slices', '16', '-slicecrc', '1', '-pix_fmt', 'bgr0', '-color_primaries', 'bt709', '-color_trc', 'iec61966-2-1', '-colorspace', 'rgb', out];
}

/** One chunk's encoder: write frames in order, then finish (ffmpeg must exit 0). */
export class ChunkEncoder {
  private readonly proc: ChildProcess;
  private exited: Promise<number>;
  private failed: Error | null = null;
  frames = 0;

  constructor(
    readonly opts: EncodeOpts,
    readonly out: string,
    logFile: string,
  ) {
    this.proc = spawn(FFMPEG, encodeArgs(opts, out), { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
    const log = createWriteStream(logFile);
    this.proc.stderr!.pipe(log);
    this.exited = new Promise((resolve) => this.proc.on('close', (code) => resolve(code ?? -1)));
    this.proc.on('error', (e) => (this.failed = e));
    this.proc.stdin!.on('error', (e) => (this.failed = e));
  }

  async write(rgba: Buffer): Promise<void> {
    if (this.failed) throw this.failed;
    const expect = this.opts.width * this.opts.height * 4;
    if (rgba.length !== expect) throw new Error(`frame size ${rgba.length} ≠ ${expect} (${this.opts.width}×${this.opts.height})`);
    if (!this.proc.stdin!.write(rgba)) await once(this.proc.stdin!, 'drain');
    this.frames++;
  }

  async finish(): Promise<void> {
    this.proc.stdin!.end();
    const code = await this.exited;
    if (this.failed) throw this.failed;
    if (code !== 0) throw new Error(`ffmpeg exited ${code} for ${this.out}`);
  }

  abort(): void {
    try {
      this.proc.stdin!.destroy();
      this.proc.kill();
    } catch {
      /* already gone */
    }
  }
}

/** decoded frame count of a video file (null if unreadable) */
export function probeFrames(file: string): number | null {
  const r = spawnSync(FFPROBE, ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', file], { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) return null;
  const n = Number(r.stdout.trim());
  return Number.isFinite(n) ? n : null;
}

/** media duration in seconds (null if unreadable) */
export function probeDuration(file: string): number | null {
  const r = spawnSync(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8', windowsHide: true });
  const n = Number(r.stdout.trim());
  return r.status === 0 && Number.isFinite(n) ? n : null;
}

function run(args: string[], what: string): void {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`ffmpeg ${what} failed (${r.status}): ${r.stderr.slice(-2000)}`);
}

/** concatenate same-format chunk files by stream copy */
export function concatChunks(files: string[], listFile: string, out: string): void {
  writeFileSync(listFile, files.map((f) => `file '${f.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n') + '\n');
  run(['-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', out], 'concat');
}

export interface DeliverOpts {
  /** re-encode the video (mezzanine → H.264 delivery) instead of stream-copying it */
  reencode?: boolean;
  crf?: number;
  preset?: string;
  fps: number;
  /** exact output length, s */
  duration?: number;
}

/** MP4 for viewing / delivery: the video (copied or re-encoded to H.264) + optional audio (AAC 320k, 48 kHz) */
export function deliver(video: string, audio: string | null, out: string, o: DeliverOpts): void {
  const args = ['-i', video, ...(audio ? ['-i', audio] : []), '-map', '0:v:0', ...(audio ? ['-map', '1:a:0'] : [])];
  if (o.reencode) args.push(...TO_YUV('yuv420p'), '-c:v', 'libx264', '-preset', o.preset ?? 'slow', '-crf', String(o.crf ?? 16), '-profile:v', 'high', '-g', String(o.fps * 2), '-bf', '2', ...BT709);
  else args.push('-c:v', 'copy');
  if (audio) args.push('-c:a', 'aac', '-b:a', '320k', '-ar', '48000');
  if (o.duration !== undefined) args.push('-t', o.duration.toFixed(3));
  args.push('-movflags', '+faststart', out);
  run(args, 'deliver');
}
