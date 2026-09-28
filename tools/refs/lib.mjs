// Shared mechanics for tools/refs/fetch.mjs and tools/refs/fetch-data.mjs.
// Node >= 22, no dependencies: global fetch, node:* only.
//
// Manifest items: { file, url, headers?, bytes, sha256, ... } with `file` relative to the project root.
// - verify: size check first, then streaming sha256.
// - download: sequential, polite (>= 1 s between requests to the same host), browser User-Agent plus
//   the item's recorded headers, redirects followed (GitHub release assets redirect to a CDN),
//   up to 3 retries with exponential backoff on 429 / 5xx / network errors, streamed to `<file>.part`
//   (never buffered in memory), sha256-verified, then renamed into place.
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36';

const HOST_DELAY_MS = 1000;
const MAX_RETRIES = 3;
const IDLE_TIMEOUT_MS = 60_000;
const PROGRESS_MIN_BYTES = 16 * 1024 * 1024;

export function parseArgs(argv, { values = [] } = {}) {
  const flags = new Set();
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new Error(`unexpected argument: ${a}`);
    const [k, inline] = a.slice(2).split('=', 2);
    if (values.includes(k)) {
      const v = inline ?? argv[++i];
      if (v === undefined) throw new Error(`--${k} needs a value`);
      opts[k] = v;
    } else flags.add(k);
  }
  return { flags, opts };
}

export async function loadManifest(relPath) {
  const json = JSON.parse(await readFile(join(ROOT, relPath), 'utf8'));
  const items = Array.isArray(json) ? json : json.items;
  if (!Array.isArray(items)) throw new Error(`${relPath}: no items array`);
  return items;
}

export const fmtMB = (n) => (n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function sha256File(path) {
  const h = createHash('sha256');
  for await (const chunk of createReadStream(path, { highWaterMark: 1 << 20 })) h.update(chunk);
  return h.digest('hex');
}

/** @returns {Promise<{status:'ok'|'missing'|'mismatch', detail?:string}>} */
export async function verifyItem(item) {
  const path = join(ROOT, item.file);
  let st;
  try {
    st = await stat(path);
  } catch {
    return { status: 'missing' };
  }
  if (typeof item.bytes === 'number' && st.size !== item.bytes)
    return { status: 'mismatch', detail: `size ${st.size} != ${item.bytes}` };
  if (!item.sha256) return { status: 'ok' };
  const got = await sha256File(path);
  return got === item.sha256 ? { status: 'ok' } : { status: 'mismatch', detail: `sha256 ${got.slice(0, 12)}… != ${item.sha256.slice(0, 12)}…` };
}

const lastHit = new Map();
async function politeWait(url) {
  const host = new URL(url).host;
  const wait = (lastHit.get(host) ?? 0) + HOST_DELAY_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastHit.set(host, Date.now());
}

class HttpError extends Error {
  constructor(status, statusText, retryAfter) {
    super(`HTTP ${status} ${statusText}`);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}
const retryable = (e) => !(e instanceof HttpError) || e.status === 429 || e.status >= 500;

/** Stream one URL to `<file>.part`, hashing on the fly. Returns { bytes, sha256 }. */
async function downloadOnce(item, partPath, log) {
  await politeWait(item.url);
  const ctrl = new AbortController();
  let idle = setTimeout(() => ctrl.abort(new Error('idle timeout')), IDLE_TIMEOUT_MS);
  const kick = () => {
    clearTimeout(idle);
    idle = setTimeout(() => ctrl.abort(new Error('idle timeout')), IDLE_TIMEOUT_MS);
  };
  try {
    const headers = { 'User-Agent': USER_AGENT, ...(item.headers ?? {}) };
    if (/^https:\/\/github\.com\/[^/]+\/[^/]+\/releases\/download\//.test(item.url) && !headers.Accept)
      headers.Accept = 'application/octet-stream';
    const res = await fetch(item.url, { headers, redirect: 'follow', signal: ctrl.signal });
    if (!res.ok || !res.body) {
      await res.body?.cancel().catch(() => {});
      throw new HttpError(res.status, res.statusText, res.headers.get('retry-after'));
    }
    const total = Number(res.headers.get('content-length')) || item.bytes || 0;
    const showProgress = total >= PROGRESS_MIN_BYTES;
    const h = createHash('sha256');
    let bytes = 0;
    let nextPct = 10;
    const tap = new Transform({
      transform(chunk, _enc, cb) {
        kick();
        h.update(chunk);
        bytes += chunk.length;
        if (showProgress) {
          const pct = Math.floor((bytes / total) * 100);
          if (pct >= nextPct && pct < 100) {
            log(`      ${pct}%  ${fmtMB(bytes)} / ${fmtMB(total)}`);
            nextPct = (Math.floor(pct / 10) + 1) * 10;
          }
        }
        cb(null, chunk);
      },
    });
    await mkdir(dirname(partPath), { recursive: true });
    await pipeline(Readable.fromWeb(res.body), tap, createWriteStream(partPath));
    return { bytes, sha256: h.digest('hex') };
  } finally {
    clearTimeout(idle);
  }
}

/** Download with retries; on sha match move into place. Returns { ok, detail }. */
export async function downloadItem(item, { keepMismatch = false, log = console.log } = {}) {
  const dest = join(ROOT, item.file);
  const part = dest + '.part';
  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const ra = Number(lastErr?.retryAfter);
      const backoff = Number.isFinite(ra) && ra > 0 ? Math.min(ra, 120) * 1000 : 2000 * 2 ** (attempt - 1);
      log(`    retry ${attempt}/${MAX_RETRIES} in ${Math.round(backoff / 1000)} s (${lastErr.message})`);
      await sleep(backoff);
    }
    try {
      const got = await downloadOnce(item, part, log);
      if (item.sha256 && got.sha256 !== item.sha256) {
        if (keepMismatch) {
          await rename(part, dest);
          return { ok: false, detail: `sha256 mismatch (kept, ${got.bytes} bytes, sha256 ${got.sha256})` };
        }
        await rm(part, { force: true });
        return { ok: false, detail: `sha256 mismatch (discarded, ${got.bytes} bytes, sha256 ${got.sha256})` };
      }
      await rename(part, dest);
      return { ok: true, detail: fmtMB(got.bytes) };
    } catch (e) {
      lastErr = e;
      await rm(part, { force: true }).catch(() => {});
      if (!retryable(e)) break;
    }
  }
  return { ok: false, detail: lastErr?.message ?? 'unknown error' };
}

/**
 * Verify every item; unless `check`, (re)download the missing / mismatched ones that have a url.
 * Items with url null are never fetched (noted). Returns the number of unresolved problems among
 * fetchable items (url-null items only warn).
 */
export async function syncItems(label, items, { check = false, keepMismatch = false, log = console.log } = {}) {
  const tally = { ok: 0, fetched: 0, failed: 0, missing: 0, mismatch: 0, skipped: 0 };
  const problems = [];
  const notes = [];
  log(`\n== ${label}: ${items.length} items${check ? ' (check only)' : ''}`);
  let noUrlOk = 0;
  for (const item of items) {
    const v = await verifyItem(item);
    if (v.status === 'ok') {
      tally.ok++;
      if (!item.url) noUrlOk++;
      continue;
    }
    if (!item.url) {
      tally.skipped++;
      notes.push(`${item.file}: ${v.status}${v.detail ? ` (${v.detail})` : ''} — no url, skipped${item.note ? ` (${item.note})` : ''}`);
      continue;
    }
    if (check) {
      tally[v.status]++;
      problems.push(`${item.file}: ${v.status}${v.detail ? ` (${v.detail})` : ''}`);
      continue;
    }
    log(`  fetch ${item.file}  [${v.status}${v.detail ? `: ${v.detail}` : ''}]`);
    const r = await downloadItem(item, { keepMismatch, log });
    if (r.ok) {
      tally.fetched++;
      log(`    ok (${r.detail})`);
    } else {
      tally.failed++;
      problems.push(`${item.file}: ${r.detail}  <${item.url}>`);
      log(`    FAILED: ${r.detail}`);
    }
  }
  const parts = Object.entries(tally)
    .filter(([k, n]) => n > 0 || k === 'ok')
    .map(([k, n]) => `${k} ${n}`);
  log(`-- ${label}: ${parts.join(', ')}`);
  if (noUrlOk) log(`   note: ${noUrlOk} item(s) without url (not downloadable) present and verified`);
  for (const n of notes) log(`   note: ${n}`);
  for (const p of problems) log(`   PROBLEM: ${p}`);
  return problems.length;
}
