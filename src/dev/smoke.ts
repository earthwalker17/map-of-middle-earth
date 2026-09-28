/**
 * Smoke test for the rendering foundation (run via `pnpm shots --smoke`):
 *  1. real WebGPU hardware adapter (no WebGL / software fallback)
 *  2. HDR render target → post → RGBA8 readback returns non-black pixels
 *  3. reversed depth resolves two nearly coplanar surfaces ~5000 units away
 *  4. a Float32 DataTexture is sampled in the vertex stage (displacement) with linear filtering
 */
import {
  DataTexture,
  DirectionalLight,
  FloatType,
  HemisphereLight,
  LinearFilter,
  Mesh,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
  PlaneGeometry,
  RedFormat,
} from 'three/webgpu';
import { positionLocal, texture, uv, vec3 } from 'three/tsl';
import { Engine } from '../core/Engine.ts';
import { StaticTimeline } from '../core/Timeline.ts';

export interface SmokeReport {
  backend: string;
  vendor: string;
  architecture: string;
  isFallback: boolean;
  readbackNonBlack: boolean;
  meanLuma: number;
  reversedDepthOk: boolean;
  displacementOk: boolean;
  errors: string[];
}

export async function runSmoke(canvas: HTMLCanvasElement): Promise<SmokeReport> {
  const errors: string[] = [];
  const W = 640;
  const H = 360;
  const engine = await Engine.create({ canvas, width: W, height: H, quality: 'review', capture: true });
  const scene = engine.scene;
  scene.add(new HemisphereLight(0xbfd6ea, 0x3e4f2b, 1.2));
  const sun = new DirectionalLight(0xffe4c0, 2.5);
  sun.position.set(1, 2, 1);
  scene.add(sun);

  // (3) two huge planes facing the camera, 0.3 units apart at ~5000 units: red in front of blue
  const far = 5000;
  const red = new Mesh(new PlaneGeometry(20000, 20000), new MeshBasicNodeMaterial({ color: 0xff2020 }));
  red.position.set(0, 0, -far);
  const blue = new Mesh(new PlaneGeometry(20000, 20000), new MeshBasicNodeMaterial({ color: 0x2020ff }));
  blue.position.set(0, 0, -far - 0.3);
  scene.add(blue, red);

  // (4) displaced plane: height from a float texture (left half 0, right half lifted far out of view)
  const N = 64;
  const data = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) data[y * N + x] = x >= N / 2 ? 20000 : 0;
  const tex = new DataTexture(data, N, N, RedFormat, FloatType);
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.needsUpdate = true;
  const geo = new PlaneGeometry(200, 200, 64, 64);
  geo.rotateX(-Math.PI / 2);
  const mat = new MeshStandardNodeMaterial({ color: 0x7fa043, roughness: 0.9 });
  const h = texture(tex, uv()).r;
  mat.positionNode = positionLocal.add(vec3(0, h, 0));
  const ground = new Mesh(geo, mat);
  ground.position.set(0, -60, -150);
  scene.add(ground);

  const timeline = new StaticTimeline({
    id: 'smoke',
    camera: { position: [0, 0, 0], target: [0, -0.35, -1], fov: 50 },
    tod: 12,
  });
  engine.setSize(W, H);
  engine.renderAccumulated((i) => timeline.evaluate(i * 0), 1);
  const px = await engine.post.readPixels();

  const at = (x: number, y: number) => {
    const i = (y * W + x) * 4;
    return [px[i], px[i + 1], px[i + 2]] as const;
  };
  let sum = 0;
  for (let i = 0; i < px.length; i += 4) sum += px[i] + px[i + 1] + px[i + 2];
  const meanLuma = sum / (px.length / 4) / 3;

  // background band near the top centre shows the far planes
  const [r, , b] = at(W >> 1, 20);
  const reversedDepthOk = r > b + 40; // AgX desaturates pure red → pinkish; blue would be b >> r
  // left half of the ground stays in view (green); the displaced right half is lifted out of view
  const leftLow = at(Math.round(W * 0.3), Math.round(H * 0.85));
  const rightLow = at(Math.round(W * 0.7), Math.round(H * 0.85));
  const isGroundish = (c: readonly [number, number, number]) => c[1] > c[0] && c[1] > c[2];
  const displacementOk = isGroundish(leftLow) && !isGroundish(rightLow);
  if (!reversedDepthOk) errors.push(`reversed depth: expected red at top centre, got rgb(${at(W >> 1, 20).join(',')})`);
  if (!displacementOk) errors.push(`displacement: left=${leftLow.join(',')} right=${rightLow.join(',')}`);

  // send the image to the sink for visual inspection
  await fetch(`/__capture/frame?name=smoke&w=${W}&h=${H}`, { method: 'POST', body: px as BodyInit }).catch(() => {});

  return {
    backend: engine.gpu.backend,
    vendor: engine.gpu.vendor,
    architecture: engine.gpu.architecture,
    isFallback: engine.gpu.isFallback,
    readbackNonBlack: meanLuma > 5,
    meanLuma,
    reversedDepthOk,
    displacementOk,
    errors,
  };
}
