// @ts-nocheck — diagnostics script (loose typing on purpose)
/**
 * CPU camera probe (no GPU, no lock): loads the baked world + TypeScript landmark stamps in Node and
 * ray-marches shots to measure framing — sky %, near-foreground %, line of sight to the subject,
 * where the proxy top lands in NDC, water share. Use it to design bookmarks / shot lists before
 * spending a render.
 *
 *   node --import tsx tools/check/cameras.ts                    all landmark bookmarks
 *   ONLY=moria-close OVR='{"moria-close":{"distanceKm":38}}' …   test overrides for one bookmark
 *   SEARCH=moria-close …                                        grid-search better framings
 *   OTHERS=mount-doom …                                         also project other places into NDC
 *   LAKES=1 …                                                   lake depth / shore-wall report + rivers near landmarks
 *   SLAB=1 [SLABOVR='{…}'] …                                    overview-shot slab framing in px
 * Reads MOME_WORLD_DIR (defaults to data/baked). Originally written by the S1 critic synthesiser.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const BAKED = process.env.MOME_WORLD_DIR ?? join(ROOT, 'data/baked');
const mod = (p: string) => pathToFileURL(join(ROOT, p)).href;
(globalThis as any).fetch = async (url: string) => {
  const rel = String(url).replace(/^\/world\//, '');
  const buf = readFileSync(join(BAKED, rel));
  return {
    ok: true,
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    json: async () => JSON.parse(buf.toString('utf8')),
  };
};

const { World } = await import(mod('src/world/World.ts'));
const { readdirSync, existsSync } = await import('node:fs');
const LANDMARKS: any[] = [];
for (const d of readdirSync(ROOT + '/src/landmarks')) {
  const f = ROOT + '/src/landmarks/' + d + '/index.ts';
  if (existsSync(f)) LANDMARKS.push((await import(pathToFileURL(f).href)).default);
}
const { landmarkStamps } = await import(mod('src/landmarks/LandmarkSystem.ts'));
const { orbitCamera } = await import(mod('src/camera/shots.ts'));
const { ProxyKit } = await import(mod('src/landmarks/kit/ProxyKit.ts'));
const { hashString } = await import(mod('src/core/rng.ts'));

const world = await World.load();
world.heights.setStamps(landmarkStamps(world, LANDMARKS));
const H = (x: number, z: number) => world.heights.sample(x, z);
// water level raster (1 km) so ray marching stays cheap
const WLg = new Float32Array(1600 * 960).fill(-99);
{
  const inside = (r: number[][], x: number, z: number) => {
    let c = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, zi] = r[i], [xj, zj] = r[j];
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
    }
    return c;
  };
  for (const l of world.lakes) {
    if (l.level === null) continue;
    const xs = l.ring.map((q: number[]) => q[0]), zs = l.ring.map((q: number[]) => q[1]);
    for (let x = Math.floor(Math.min(...xs)); x <= Math.ceil(Math.max(...xs)); x++)
      for (let z = Math.floor(Math.min(...zs)); z <= Math.ceil(Math.max(...zs)); z++)
        if (inside(l.ring, x + 0.5, z + 0.5)) WLg[(z + 480) * 1600 + (x + 800)] = l.level;
  }
}
const WL = (x: number, z: number) => { const i = Math.floor(x) + 800, j = Math.floor(z) + 480; if (i < 0 || j < 0 || i >= 1600 || j >= 960) return -99; const v = WLg[j * 1600 + i]; return v > -99 ? v : 0; };

const topCache = new Map<string, number>();
function proxyTop(def: any): number {
  if (topCache.has(def.id)) return topCache.get(def.id)!;
  const v = proxyTop0(def); topCache.set(def.id, v); return v;
}
function proxyTop0(def: any): number {
  if (!def.proxy) return 0;
  const kit = new ProxyKit(hashString(def.id), () => 0);
  def.proxy(kit);
  let top = 0;
  for (const [, geo] of kit.build()) {
    geo.computeBoundingBox();
    top = Math.max(top, geo.boundingBox.max.y);
  }
  return top * (def.scale ?? 1);
}

const overrides: Record<string, any> = JSON.parse(process.env.OVR ?? '{}');

function analyse(id: string, orbit: any, def: any | null, quiet = false, W = 48, Hh = 27) {
  const cam = orbitCamera(world, orbit);
  const [px, py, pz] = cam.position;
  const [tx, tyAim, tz] = cam.target;
  // the orbit target includes `lift`; subject heights are measured from the ground under it
  const ty = tyAim - (orbit.lift ?? 0);
  const clear = py - H(px, pz);
  // forward / right / up basis
  let fx = tx - px, fy = tyAim - py, fz = tz - pz;
  const fl = Math.hypot(fx, fy, fz); fx /= fl; fy /= fl; fz /= fl;
  let rx = -fz, rz = fx; const rl = Math.hypot(rx, rz); rx /= rl; rz /= rl; // right = f x up
  const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy; // up = r x f
  const vf = (cam.fov * Math.PI) / 180, aspect = 16 / 9;
  const tanV = Math.tan(vf / 2), tanH = tanV * aspect;
  let sky = 0, near = 0, occl = 0, wet = 0;
  const dist = orbit.distanceKm;
  for (let j = 0; j < Hh; j++)
    for (let i = 0; i < W; i++) {
      const sx = ((i + 0.5) / W) * 2 - 1, sy = 1 - ((j + 0.5) / Hh) * 2;
      let dx = fx + rx * sx * tanH + ux * sy * tanV, dy = fy + uy * sy * tanV, dz = fz + rz * sx * tanH + uz * sy * tanV;
      const dl = Math.hypot(dx, dy, dz); dx /= dl; dy /= dl; dz /= dl;
      let hit = -1;
      for (let t = 0.05; t < dist * 6; t += Math.max(0.05, t * 0.01)) {
        const x = px + dx * t, y = py + dy * t, z = pz + dz * t;
        if (Math.abs(x) > 800 || Math.abs(z) > 480) break;
        const hh = H(x, z), ww = WL(x, z); if (y < Math.max(hh, ww)) { hit = t; if (ww > hh) wet++; break; }
        if (y > 80) break;
      }
      if (hit < 0) sky++;
      else if (hit < dist * 0.6) near++;
    }
  // line of sight camera -> target ground (+ small lift) and -> proxy mid height
  const top = def ? proxyTop(def) : 0;
  const los = (h: number) => {
    let maxBlock = -Infinity;
    for (let s = 0.02; s < 0.98; s += 0.005) {
      const x = px + (tx - px) * s, z = pz + (tz - pz) * s;
      const y = py + (ty + h - py) * s;
      maxBlock = Math.max(maxBlock, H(x, z) - y);
    }
    return maxBlock; // > 0 => blocked
  };
  // vertical angle of the proxy top relative to view centre, vs half fov
  const topVec = [tx - px, ty + top - py, tz - pz];
  const tl = Math.hypot(...topVec);
  const cosA = (topVec[0] * ux + topVec[1] * uy + topVec[2] * uz) / tl;
  const topAngle = (Math.asin(cosA) * 180) / Math.PI; // angle above view axis (approx)
  const topNdcY = Math.tan((topAngle * Math.PI) / 180) / tanV;
  const proj = (x: number, y: number, z: number) => {
    const vx = x - px, vy = y - py, vz = z - pz;
    const zf = vx * fx + vy * fy + vz * fz;
    return [((vx * rx + vz * rz) / zf) / tanH, ((vx * ux + vy * uy + vz * uz) / zf) / tanV];
  };
  const others = (process.env.OTHERS ?? '').split(',').filter(Boolean).map((o) => {
    const q = world.place(o); const qd = LANDMARKS.find((d: any) => d.placeId === o);
    const g = H(q.x, q.z); const a = proj(q.x, g, q.z), b = proj(q.x, g + (qd ? proxyTop(qd) : 0), q.z);
    return `${o}: base(${a[0].toFixed(2)},${a[1].toFixed(2)}) top(${b[0].toFixed(2)},${b[1].toFixed(2)})`;
  }).join('  ');
  const m = { clear, sky: sky / (W * Hh), near: near / (W * Hh), losG: los(0.3), losM: los(top * 0.5), top, topNdcY };
  if (quiet) return m;
  console.log(
    `${id.padEnd(22)} clear ${clear.toFixed(2).padStart(6)}km  sky ${((sky / (W * Hh)) * 100).toFixed(0).padStart(3)}%  near<0.6d ${((near / (W * Hh)) * 100).toFixed(0).padStart(3)}%  LOSground ${los(0.3).toFixed(2).padStart(6)}  LOSmid ${los(top * 0.5).toFixed(2).padStart(6)}  proxyTop ${top.toFixed(1).padStart(5)}km topNdcY ${topNdcY.toFixed(2)}  groundAtTarget ${ty.toFixed(2)} water ${((wet / (W * Hh)) * 100).toFixed(0)}% ${others}`,
  );
  return m;
}

const only = process.env.ONLY?.split(',');
for (const def of LANDMARKS)
  for (const b of def.bookmarks ?? []) {
    if (only && !only.includes(b.id)) continue;
    const o = { place: def.placeId, distanceKm: b.distanceKm, elevationDeg: b.elevationDeg, azimuthDeg: b.azimuthDeg, fov: b.fov, lift: b.lift, ...(overrides[b.id] ?? {}) };
    analyse(b.id + (overrides[b.id] ? '*' : ''), o, def);
  }

if (process.env.LAKES) {
  const inside = (r: number[][], x: number, z: number) => {
    let c = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, zi] = r[i], [xj, zj] = r[j];
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
    }
    return c;
  };
  for (const l of world.lakes) {
    if (l.level === null) continue;
    const xs = l.ring.map((p: number[]) => p[0]), zs = l.ring.map((p: number[]) => p[1]);
    let n = 0, dry = 0, depthSum = 0;
    for (let x = Math.min(...xs); x < Math.max(...xs); x += 0.4)
      for (let z = Math.min(...zs); z < Math.max(...zs); z += 0.4)
        if (inside(l.ring, x, z)) { n++; const h = H(x, z); if (h > l.level - 0.01) dry++; depthSum += l.level - h; }
    // shore: points 1.5 km outside the ring (radially from centroid)
    const cx = xs.reduce((a: number, b: number) => a + b) / xs.length, cz = zs.reduce((a: number, b: number) => a + b) / zs.length;
    const walls: number[] = [];
    for (const [x, z] of l.ring) {
      const d = Math.hypot(x - cx, z - cz) || 1;
      for (const o of [1.0, 2.5]) walls.push(H(x + ((x - cx) / d) * o, z + ((z - cz) / d) * o) - l.level);
    }
    walls.sort((a, b) => a - b);
    const med = walls[Math.floor(walls.length / 2)], p90 = walls[Math.floor(walls.length * 0.9)];
    console.log(`${String(l.name).padEnd(16)} level ${l.level.toFixed(2)} cells ${n} dry ${((dry / Math.max(1, n)) * 100).toFixed(0)}% meanDepth ${(depthSum / Math.max(1, n)).toFixed(2)}  shore(+1..2.5km) above level: median ${med.toFixed(2)} p90 ${p90.toFixed(2)} max ${walls[walls.length - 1].toFixed(2)}`);
  }
  // rivers passing near landmark places
  for (const id of ['minas-tirith', 'isengard', 'minas-morgul', 'argonath', 'lake-town', 'erebor', 'rivendell', 'hobbiton', 'osgiliath']) {
    const p = world.place(id);
    let best = { d: 1e9, name: '', w: 0, h: 0 };
    for (const r of world.rivers)
      for (const [x, z] of r.points) {
        const d = Math.hypot(x - p.x, z - p.z);
        if (d < best.d) best = { d, name: r.name, w: r.widthKm, h: H(x, z) };
      }
    console.log(`${id.padEnd(14)} nearest river ${best.name} (${best.w} km wide) at ${best.d.toFixed(1)} km; ground there ${best.h.toFixed(2)}; place ground ${H(p.x, p.z).toFixed(2)} footprint ${p.footprintKm}`);
  }
}

if (process.env.SEARCH) {
  const ids = process.env.SEARCH.split(',');
  for (const def of LANDMARKS)
    for (const b of def.bookmarks ?? []) {
      if (!ids.includes(b.id)) continue;
      const top = proxyTop(def);
      const res: any[] = [];
      for (let daz = -60; daz <= 60; daz += 20)
        for (const el of [6, 10, 15, 22, 30])
          for (const dm of [1, 1.4, 1.9])
            for (const lf of [0, 0.3, 0.5]) {
              const o = { place: def.placeId, distanceKm: Math.round(b.distanceKm * dm), elevationDeg: el, azimuthDeg: (b.azimuthDeg + daz + 360) % 360, fov: b.fov, lift: +(top * lf).toFixed(1) };
              const m: any = analyse(b.id, o, def, true, 16, 9);
              // score: visible base + mid, crown in frame with headroom, some sky, little foreground
              let sc = 0;
              if (m.losG > -0.1) sc -= 3;
              if (m.losM > 0) sc -= 3;
              if (m.topNdcY > 0.9) sc -= 2 + (m.topNdcY - 0.9) * 4;
              if (m.topNdcY < 0.25) sc -= 1;
              sc -= Math.abs(m.sky - 0.2) * 4;
              sc -= m.near * 6;
              sc -= Math.abs(daz) / 120 + Math.abs(dm - 1) * 0.4; // prefer small changes
              res.push({ sc, o, m });
            }
      res.sort((a, b) => b.sc - a.sc);
      console.log('### ' + b.id + ' (current az ' + b.azimuthDeg + ' el ' + b.elevationDeg + ' d ' + b.distanceKm + ')');
      for (const r of res.slice(0, 4))
        console.log(`  score ${r.sc.toFixed(2)} az ${r.o.azimuthDeg} el ${r.o.elevationDeg} d ${r.o.distanceKm} lift ${r.o.lift} | sky ${(r.m.sky * 100).toFixed(0)}% near ${(r.m.near * 100).toFixed(0)}% losG ${r.m.losG.toFixed(2)} losM ${r.m.losM.toFixed(2)} topNdcY ${r.m.topNdcY.toFixed(2)} clear ${r.m.clear.toFixed(1)}`);
    }
}

if (process.env.RINGS) {
  for (const [id, r] of [['isengard', 7.4], ['minas-tirith', 7.6], ['minas-morgul', 2.4], ['barad-dur', 3.6], ['black-gate', 3], ['helms-deep', 2]] as [string, number][]) {
    const p = world.place(id); const g0 = H(p.x, p.z);
    let mn = 1e9, mx = -1e9, mnA = 0;
    for (let a = 0; a < 360; a += 5) {
      const d = H(p.x + Math.sin((a * Math.PI) / 180) * r, p.z - Math.cos((a * Math.PI) / 180) * r) - g0;
      if (d < mn) { mn = d; mnA = a; } mx = Math.max(mx, d);
    }
    console.log(`${id.padEnd(13)} radius ${r}: terrain relative to proxy origin  min ${mn.toFixed(2)} km (compass ${mnA}°)  max ${mx.toFixed(2)} km`);
  }
}

if (process.env.SLAB) {
  const shots = JSON.parse(readFileSync(ROOT + '/data/qa/shots.json', 'utf8')).shots;
  const ovr = JSON.parse(process.env.SLABOVR ?? '{}');
  const bottom = Number(process.env.SLABBOTTOM ?? -14);
  for (const s of shots) {
    if (!s.id.startsWith('overview')) continue;
    for (const [tag, o] of [['cur', s.camera.orbit], ...(ovr[s.id] ? [['new', { ...s.camera.orbit, ...ovr[s.id] }]] : [])] as any[]) {
      const cam = orbitCamera(world, o);
      const [px, py, pz] = cam.position, [tx, ty, tz] = cam.target;
      let fx = tx - px, fy = ty - py, fz = tz - pz; const fl = Math.hypot(fx, fy, fz); fx /= fl; fy /= fl; fz /= fl;
      let rx = -fz, rz = fx; const rl = Math.hypot(rx, rz); rx /= rl; rz /= rl;
      const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy;
      const tanV = Math.tan((cam.fov * Math.PI) / 360), tanH = tanV * 16 / 9;
      let x0 = 9, x1 = -9, y0 = 9, y1 = -9;
      for (const cx of [-800, 800]) for (const cz of [-480, 480]) for (const cy of [0, bottom]) {
        const vx = cx - px, vy = cy - py, vz = cz - pz; const zf = vx * fx + vy * fy + vz * fz;
        const X = (vx * rx + vz * rz) / zf / tanH, Y = (vx * ux + vy * uy + vz * uz) / zf / tanV;
        x0 = Math.min(x0, X); x1 = Math.max(x1, X); y0 = Math.min(y0, Y); y1 = Math.max(y1, Y);
      }
      // NDC -> px on 1600x900
      const P = (v: number, n: number) => (((v + 1) / 2) * n).toFixed(0);
      console.log(`${s.id.padEnd(18)} ${tag} ${JSON.stringify(o)}  slab px x[${P(x0, 1600)}..${P(x1, 1600)}] y(top-down)[${P(-y1, 900)}..${P(-y0, 900)}]`);
    }
  }
}
