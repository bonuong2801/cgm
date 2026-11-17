import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import type { IncomingMessage, ServerResponse } from 'http';
import path from 'path';
import { Readable } from 'stream';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { POST as handleAiCull } from './api/ai/cull.ts';
import { GET as handleDriveCrawl } from './api/drive/crawl.ts';
import { GET as handleDriveStream } from './api/drive/stream.ts';

/**
 * Bridges Vite's local Node HTTP server directly to our Web-Standard `/api/*` handlers
 * so `npm run dev` runs both Frontend and Backend in a single process with zero Express bloat.
 */
function localServerlessApiPlugin(): Plugin {
  const routes: Record<string, (req: Request) => Promise<Response>> = {
    '/api/drive/crawl': handleDriveCrawl,
    '/api/drive/stream': handleDriveStream,
    '/api/ai/cull': handleAiCull,
  };

  return {
    name: 'cgm-local-serverless-api',
    configureServer(server) {
      server.middlewares.use(
        async (req: IncomingMessage, res: ServerResponse, next) => {
          const rawUrl = req.url || '';
          const pathname = rawUrl.split('?')[0];
          const handler = routes[pathname];
          if (!handler) {
            next();
            return;
          }

          try {
            const host = req.headers.host || 'localhost:3000';
            const fullUrl = `http://${host}${rawUrl}`;
            const headers = new Headers();
            for (const [k, v] of Object.entries(req.headers)) {
              if (Array.isArray(v)) headers.set(k, v.join(', '));
              else if (typeof v === 'string') headers.set(k, v);
            }

            const controller = new AbortController();
            res.on('close', () => {
              if (!res.writableEnded) controller.abort();
            });

            const method = req.method || 'GET';
            const hasBody = method !== 'GET' && method !== 'HEAD';
            const webReq = new Request(fullUrl, {
              method,
              headers,
              body: hasBody ? (Readable.toWeb(req) as any) : undefined,
              signal: controller.signal,
              // @ts-expect-error Node 24 fetch streaming request duplex flag
              duplex: hasBody ? 'half' : undefined,
            });

            const webRes = await handler(webReq);
            res.statusCode = webRes.status;
            webRes.headers.forEach((val, key) => {
              res.setHeader(key, val);
            });

            if (webRes.body) {
              const nodeStream = Readable.fromWeb(webRes.body as any);
              nodeStream.on('error', () => res.end());
              nodeStream.pipe(res);
            } else {
              res.end();
            }
          } catch (err: any) {
            if (!res.headersSent) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.end(
                JSON.stringify({
                  error: err?.message || 'Lỗi máy chủ nội bộ (/api).',
                })
              );
            } else {
              res.end();
            }
          }
        }
      );
    },
  };
}

export default defineConfig(({ mode }) => {
  // Populate process.env from .env files in dev so /api handlers read GOOGLE_API_KEY & GEMINI_API_KEY
  const env = loadEnv(mode, process.cwd(), '');
  for (const [k, v] of Object.entries(env)) {
    if (process.env[k] === undefined) {
      process.env[k] = v;
    }
  }

  return {
    plugins: [localServerlessApiPlugin(), react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
