/**
 * Music cue sheet (S5): the compiled film's beats as music cues — sections of consecutive beats with the
 * same mood, per-beat intensity envelopes, and the sync points (beat hits, event channels rising past 0.5)
 * the score lands on. Written by `node --import tsx tools/check/film.ts --cues <file>`; read by tools/music.
 * Pure data (no DOM, no three.js).
 */
import { smoothstep } from './curves.ts';
import { isHold, type CompiledFilm, type CueBeat, type CueHit, type CueSection, type CueSheet, type TimelineJson } from './schema.ts';

/** tempo the score is sketched at (beats per minute; hits are snapped by the composer, not here) */
export const CUE_TEMPO_BPM = 72;
/** a hold reaches its intensity this many seconds after it starts (at most a quarter of the hold) */
const HOLD_RAMP_S = 1;

/** Time where a smoothstep-keyed channel first rises past `level` between two keys (bisection on the ease). */
function crossing(t0: number, v0: number, t1: number, v1: number, level: number): number {
  const target = (level - v0) / (v1 - v0);
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    if (smoothstep(mid) < target) lo = mid;
    else hi = mid;
  }
  return t0 + ((lo + hi) / 2) * (t1 - t0);
}

export function exportCues(film: CompiledFilm, timeline: TimelineJson): CueSheet {
  const beats = timeline.beats;
  if (beats.length !== film.beats.length) throw new Error(`cues: the film has ${film.beats.length} beats, the timeline ${beats.length}`);
  // ---- per-beat cues (a beat without music keeps the previous mood / intensity)
  const cues: CueBeat[] = [];
  let mood = 'silence';
  let level = 0;
  beats.forEach((b, i) => {
    const info = film.beats[i];
    const prev = level;
    mood = b.music?.mood ?? mood;
    level = b.music?.intensity ?? level;
    const dur = info.t1 - info.t0;
    const intensity: [number, number][] = isHold(b)
      ? [
          [info.t0, prev],
          [info.t0 + Math.min(HOLD_RAMP_S, dur / 4), level],
          [info.t1, level],
        ]
      : [
          [info.t0, prev],
          [info.t1, level],
        ];
    cues.push({ id: info.id, kind: info.kind, style: isHold(b) ? b.style : 'move', t0: info.t0, t1: info.t1, mood, intensity, place: isHold(b) ? (b.place ?? null) : null, tod: [info.tod[0], info.tod[1]] });
  });
  // ---- sections: runs of the same mood
  const sections: CueSection[] = [];
  for (const c of cues) {
    const last = sections[sections.length - 1];
    if (last && last.mood === c.mood) last.t1 = c.t1;
    else sections.push({ id: `${String(sections.length + 1).padStart(2, '0')}-${c.mood}`, t0: c.t0, t1: c.t1, mood: c.mood });
  }
  // ---- hits: the beats' own sync points, then every event channel rising past 0.5
  const beatAt = (t: number) => film.beats.find((x) => t >= x.t0 && t < x.t1) ?? film.beats[film.beats.length - 1];
  const hits: CueHit[] = [];
  beats.forEach((b, i) => {
    if (b.music?.hit) hits.push({ t: film.beats[i].t0, type: b.music.hit, beat: film.beats[i].id });
  });
  const channels = new Map<string, [number, number][]>();
  beats.forEach((b, i) => {
    for (const [ch, ks] of Object.entries(b.events ?? {})) {
      const list = channels.get(ch) ?? [];
      for (const [kt, v] of ks) list.push([film.beats[i].t0 + kt, v]);
      channels.set(ch, list);
    }
  });
  for (const [ch, ks] of channels) {
    ks.sort((a, b) => a[0] - b[0]);
    if (ks[0][1] >= 0.5) hits.push({ t: 0, type: `event:${ch}`, beat: film.beats[0].id });
    for (let k = 1; k < ks.length; k++) {
      const [t0, v0] = ks[k - 1];
      const [t1, v1] = ks[k];
      if (v0 < 0.5 && v1 >= 0.5) {
        const t = crossing(t0, v0, t1, v1, 0.5);
        hits.push({ t, type: `event:${ch}`, beat: beatAt(t).id });
      }
    }
  }
  hits.sort((a, b) => a.t - b.t || a.type.localeCompare(b.type));
  return { version: 1, film: { duration: film.duration, fps: film.fps, hash: film.hash }, tempoHint: { bpm: CUE_TEMPO_BPM }, sections, cues, hits };
}
