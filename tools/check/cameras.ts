// @ts-nocheck — diagnostics CLI (loose typing on purpose)
/**
 * CPU camera probe CLI (no GPU, no lock) over tools/check/probe.ts: loads the baked world + landmark stamp
 * layer + landmark build records in Node and ray-marches shots to measure framing — sky / void (studio
 * backdrop) / edge (strata cut face) / top-of-frame void, near foreground, water, line of sight, and the
 * landmark's projected size (px at 1600×900) and visibility. Use it to design bookmarks / shot lists
 * before spending a render.
 *
 *   node --import tsx tools/check/cameras.ts                       all landmark bookmarks
 *   ONLY=moria-close OVR='{"moria-close":{"distanceKm":38}}' …      test overrides for bookmarks
 *   SEARCH=moria-close …                                           grid-search better framings
 *   OTHERS=mount-doom,barad-dur …                                  also measure these landmarks
 *   SHOTS=data/qa/shots.json | SHOTS=s1 (a set name) …              probe JSON shots / a QA set
 *   SHOT='{"id":"x","tod":12,"camera":{"orbit":{…}}}' …             probe one ad-hoc shot
 *   JSON=1 …                                                       machine-readable output
 *   LAKES=1 … · RINGS=1 … · SLAB=1 [SLABOVR='{…}'] …              lake / ring / overview-slab diagnostics
 * Reads MOME_WORLD_DIR (defaults to data/baked). Waits for free memory before loading the world.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { bookmarkShots, createProbeContext, fmtProbe, probeShot } from './probe.ts';

const ROOT = process.cwd();
const mod = (p: string) => pathToFileURL(join(ROOT, p)).href;
const { orbitCamera } = await import(mod('src/camera/shots.ts'));

const ctx = await createProbeContext();
const { world, landmarks, H } = ctx;
const asJson = !!process.env.JSON;
const results: any[] = [];
const emit = (r: any) => (asJson ? results.push(r) : console.log(fmtProbe(r)));
const others = (process.env.OTHERS ?? '').split(',').filter(Boolean);
const landmarkIds = new Set(landmarks.map((d: any) => d.id));
const subjectOfPlace = (place?: string) => (place ? landmarks.find((d: any) => d.placeId === place)?.id : undefined);

const overrides: Record<string, any> = JSON.parse(process.env.OVR ?? '{}');
const only = process.env.ONLY?.split(',');
const bms = bookmarkShots(landmarks);
const modeShots = process.env.SHOTS || process.env.SHOT;
if (!process.env.SEARCH && !modeShots && !process.env.LAKES && !process.env.RINGS && !process.env.SLAB) {
  for (const { def, shot } of bms) {
    if (only && !only.includes(shot.id)) continue;
    const ov = overrides[shot.id];
    const s = ov ? { ...shot, id: shot.id + '*', camera: { orbit: { ...shot.camera.orbit, ...ov } } } : shot;
    emit(probeShot(ctx, s, { subject: def.id, others }));
  }
}

// ------------------------------------------------------------------ JSON shots / sets / one ad-hoc shot
if (modeShots) {
  let list: any[] = [];
  if (process.env.SHOT) list = [JSON.parse(process.env.SHOT)];
  else {
    const v = process.env.SHOTS!;
    const all = [
      ...JSON.parse(readFileSync(join(ROOT, 'data/qa/shots.json'), 'utf8')).shots,
      ...(existsSync(join(ROOT, 'data/qa/shots.d'))
        ? readdirSync(join(ROOT, 'data/qa/shots.d'))
            .filter((f) => f.endsWith('.json'))
            .sort()
            .flatMap((f) => JSON.parse(readFileSync(join(ROOT, 'data/qa/shots.d', f), 'utf8')).shots)
        : []),
      ...bms.map((b) => b.shot),
    ];
    if (v.endsWith('.json')) list = JSON.parse(readFileSync(join(ROOT, v), 'utf8')).shots;
    else {
      const sets = JSON.parse(readFileSync(join(ROOT, 'data/qa/sets.json'), 'utf8')).sets;
      if (!sets[v]) throw new Error(`unknown set ${v}`);
      list = sets[v].map((id: string) => all.find((s: any) => s.id === id) ?? { id, missing: true });
    }
  }
  for (const s of list) {
    if (s.missing) {
      console.log(`${s.id.padEnd(24)} (not defined yet)`);
      continue;
    }
    const bm = bms.find((b) => b.shot.id === s.id);
    const subject = bm?.def.id ?? subjectOfPlace(s.camera?.orbit?.place);
    emit(probeShot(ctx, s, { subject, others }));
  }
}

// ------------------------------------------------------------------ search
if (process.env.SEARCH) {
  const ids = process.env.SEARCH.split(',');
  for (const { def, shot } of bms) {
    if (!ids.includes(shot.id)) continue;
    const b = shot.camera.orbit;
    const sub = ctx.subjects.get(def.id);
    const subH = sub ? sub.max[1] - sub.min[1] : 1;
    const wide = shot.id.endsWith('-wide');
    const res: any[] = [];
    for (let daz = -80; daz <= 80; daz += 20)
      for (const el of [5, 8, 12, 16, 22, 30])
        for (const dm of [0.7, 1, 1.4])
          for (const lf of [0, 0.3, 0.5]) {
            const o = { ...b, distanceKm: Math.round(b.distanceKm * dm), elevationDeg: el, azimuthDeg: (b.azimuthDeg + daz + 360) % 360, lift: +(subH * lf).toFixed(1) };
            const m = probeShot(ctx, { ...shot, camera: { orbit: o } }, { subject: def.id, grid: [24, 14] });
            const s = m.subject;
            let sc = 0;
            if (m.losGround > -0.1) sc -= 3;
            if (m.losMid > 0) sc -= 3;
            if (s) {
              if (!wide) sc -= Math.max(0, 225 - s.pxH) / 60; // hero: ≥ 25 % of frame height
              sc -= Math.max(0, s.topNdcY - 0.85) * 5; // headroom
              sc -= Math.max(0, 1 - s.visible) * 3;
              sc -= Math.abs(s.centerNdcX) * 0.8;
            }
            sc -= m.topVoid * 8 + m.void * 4 + m.edge * 2;
            sc -= Math.abs(m.sky - 0.18) * 3;
            sc -= m.near * 5;
            sc -= Math.abs(daz) / 160 + Math.abs(dm - 1) * 0.3; // prefer small changes
            res.push({ sc, o, m });
          }
    res.sort((a, b) => b.sc - a.sc);
    console.log(`### ${shot.id} (current az ${b.azimuthDeg} el ${b.elevationDeg} d ${b.distanceKm} lift ${b.lift ?? 0})`);
    for (const r of res.slice(0, 5)) console.log(`  score ${r.sc.toFixed(2)} az ${r.o.azimuthDeg} el ${r.o.elevationDeg} d ${r.o.distanceKm} lift ${r.o.lift} | ${fmtProbe({ ...r.m, id: '' })}`);
  }
}

// ------------------------------------------------------------------ lakes: depth / shore walls; rivers near landmarks
if (process.env.LAKES) {
  const inside = (r: number[][], x: number, z: number) => {
    let c = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, zi] = r[i],
        [xj, zj] = r[j];
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
    }
    return c;
  };
  for (const l of world.lakes) {
    if (l.level === null) continue;
    const xs = l.ring.map((p: number[]) => p[0]),
      zs = l.ring.map((p: number[]) => p[1]);
    let n = 0,
      dry = 0,
      depthSum = 0;
    for (let x = Math.min(...xs); x < Math.max(...xs); x += 0.4)
      for (let z = Math.min(...zs); z < Math.max(...zs); z += 0.4)
        if (inside(l.ring, x, z)) {
          n++;
          const h = H(x, z);
          if (h > l.level - 0.01) dry++;
          depthSum += l.level - h;
        }
    const cx = xs.reduce((a: number, b: number) => a + b) / xs.length,
      cz = zs.reduce((a: number, b: number) => a + b) / zs.length;
    const walls: number[] = [];
    for (const [x, z] of l.ring) {
      const d = Math.hypot(x - cx, z - cz) || 1;
      for (const o of [1.0, 2.5]) walls.push(H(x + ((x - cx) / d) * o, z + ((z - cz) / d) * o) - l.level);
    }
    walls.sort((a, b) => a - b);
    const med = walls[Math.floor(walls.length / 2)],
      p90 = walls[Math.floor(walls.length * 0.9)];
    console.log(`${String(l.name).padEnd(16)} level ${l.level.toFixed(2)} cells ${n} dry ${((dry / Math.max(1, n)) * 100).toFixed(0)}% meanDepth ${(depthSum / Math.max(1, n)).toFixed(2)}  shore(+1..2.5km) above level: median ${med.toFixed(2)} p90 ${p90.toFixed(2)} max ${walls[walls.length - 1].toFixed(2)}`);
  }
  for (const id of landmarkIds) {
    const p = world.place(landmarks.find((d: any) => d.id === id).placeId);
    let best = { d: 1e9, name: '', w: 0, h: 0 };
    for (const r of world.rivers)
      for (const [x, z] of r.points) {
        const d = Math.hypot(x - p.x, z - p.z);
        if (d < best.d) best = { d, name: r.name, w: r.widthKm, h: H(x, z) };
      }
    console.log(`${id.padEnd(14)} nearest river ${best.name} (${best.w} km wide) at ${best.d.toFixed(1)} km; ground there ${best.h.toFixed(2)}; place ground ${H(p.x, p.z).toFixed(2)} footprint ${p.footprintKm}`);
  }
}

// ------------------------------------------------------------------ rings: terrain around a landmark origin
if (process.env.RINGS) {
  for (const [id, r] of [['isengard', 7.4], ['minas-tirith', 7.6], ['minas-morgul', 2.4], ['barad-dur', 3.6], ['black-gate', 3], ['helms-deep', 2]] as [string, number][]) {
    const p = world.place(id);
    const g0 = H(p.x, p.z);
    let mn = 1e9,
      mx = -1e9,
      mnA = 0;
    for (let a = 0; a < 360; a += 5) {
      const d = H(p.x + Math.sin((a * Math.PI) / 180) * r, p.z - Math.cos((a * Math.PI) / 180) * r) - g0;
      if (d < mn) {
        mn = d;
        mnA = a;
      }
      mx = Math.max(mx, d);
    }
    console.log(`${id.padEnd(13)} radius ${r}: terrain relative to origin  min ${mn.toFixed(2)} km (compass ${mnA}°)  max ${mx.toFixed(2)} km`);
  }
}

// ------------------------------------------------------------------ slab: overview framing in px
if (process.env.SLAB) {
  const shots = JSON.parse(readFileSync(ROOT + '/data/qa/shots.json', 'utf8')).shots;
  const ovr = JSON.parse(process.env.SLABOVR ?? '{}');
  const bottom = Number(process.env.SLABBOTTOM ?? -14);
  const sp = world.spec;
  for (const s of shots) {
    if (!s.id.startsWith('overview')) continue;
    for (const [tag, o] of [['cur', s.camera.orbit], ...(ovr[s.id] ? [['new', { ...s.camera.orbit, ...ovr[s.id] }]] : [])] as any[]) {
      const cam = orbitCamera(world, o);
      const [px, py, pz] = cam.position,
        [tx, ty, tz] = cam.target;
      let fx = tx - px,
        fy = ty - py,
        fz = tz - pz;
      const fl = Math.hypot(fx, fy, fz);
      fx /= fl;
      fy /= fl;
      fz /= fl;
      let rx = -fz,
        rz = fx;
      const rl = Math.hypot(rx, rz);
      rx /= rl;
      rz /= rl;
      const ux = -rz * fy,
        uy = rz * fx - rx * fz,
        uz = rx * fy;
      const tanV = Math.tan((cam.fov * Math.PI) / 360),
        tanH = (tanV * 16) / 9;
      let x0 = 9,
        x1 = -9,
        y0 = 9,
        y1 = -9;
      for (const cx of [sp.xMin, sp.xMax])
        for (const cz of [sp.zMin, sp.zMax])
          for (const cy of [0, bottom]) {
            const vx = cx - px,
              vy = cy - py,
              vz = cz - pz;
            const zf = vx * fx + vy * fy + vz * fz;
            const X = (vx * rx + vz * rz) / zf / tanH,
              Y = (vx * ux + vy * uy + vz * uz) / zf / tanV;
            x0 = Math.min(x0, X);
            x1 = Math.max(x1, X);
            y0 = Math.min(y0, Y);
            y1 = Math.max(y1, Y);
          }
      const P = (v: number, n: number) => (((v + 1) / 2) * n).toFixed(0);
      console.log(`${s.id.padEnd(18)} ${tag} ${JSON.stringify(o)}  slab px x[${P(x0, 1600)}..${P(x1, 1600)}] y(top-down)[${P(-y1, 900)}..${P(-y0, 900)}]`);
    }
  }
}

if (asJson) console.log(JSON.stringify(results, null, 1));
