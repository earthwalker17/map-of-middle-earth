import { createServer, type Plugin, type ViteDevServer } from 'vite';
import { resolve } from 'node:path';

export interface FrameSinkEvent {
  name: string;
  width: number;
  height: number;
  rgba: Buffer;
}

export type FrameHandler = (ev: FrameSinkEvent) => Promise<void>;

/** Vite plugin that accepts raw RGBA frames POSTed by the page's capture API. */
function captureSink(getHandler: () => FrameHandler | null): Plugin {
  return {
    name: 'mome-capture-sink',
    configureServer(server) {
      server.middlewares.use('/__capture/frame', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        const url = new URL(req.url ?? '', 'http://x');
        const name = url.searchParams.get('name') ?? 'frame';
        const width = Number(url.searchParams.get('w'));
        const height = Number(url.searchParams.get('h'));
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          const rgba = Buffer.concat(chunks);
          const handler = getHandler();
          const done = handler ? handler({ name, width, height, rgba }) : Promise.resolve();
          done.then(
            () => {
              res.statusCode = 200;
              res.end('ok');
            },
            (e) => {
              res.statusCode = 500;
              res.end(String(e));
            },
          );
        });
      });
    },
  };
}

export interface CaptureServer {
  url: string;
  server: ViteDevServer;
  setHandler(h: FrameHandler | null): void;
  close(): Promise<void>;
}

export async function startCaptureServer(port = 5199): Promise<CaptureServer> {
  let handler: FrameHandler | null = null;
  const server = await createServer({
    configFile: resolve(process.cwd(), 'vite.config.ts'),
    plugins: [captureSink(() => handler)],
    // no HMR and no file watcher: a capture server serves one immutable checkout
    server: { port, strictPort: false, hmr: false, watch: null },
    logLevel: 'warn',
    clearScreen: false,
  });
  await server.listen();
  const addr = server.resolvedUrls?.local[0] ?? `http://localhost:${port}/`;
  return {
    url: addr.replace(/\/$/, ''),
    server,
    setHandler: (h) => (handler = h),
    close: () => server.close(),
  };
}
