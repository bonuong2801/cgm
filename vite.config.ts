import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import type { IncomingMessage, ServerResponse } from 'http';
import path from 'path';
import { Readable } from 'stream';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { handleAdminLicenses } from './api/admin/licenses.ts';
import { POST as handleAiCull } from './api/ai/cull.ts';
import { POST as handleCreateOrder } from './api/billing/create-order.ts';
import { GET as handleOrderStatus } from './api/billing/order-status.ts';
import { GET as handleBillingPlans } from './api/billing/plans.ts';
import { POST as handleRedeemLicense } from './api/billing/redeem.ts';
import { POST as handleVietQrWebhook } from './api/billing/vietqr-webhook.ts';
import { GET as handleDriveCrawl } from './api/drive/crawl.ts';
import { GET as handleDriveStream } from './api/drive/stream.ts';

function localServerlessApiPlugin(): Plugin {
  const routes: Record<string, (req: Request) => Promise<Response>> = {
    '/api/drive/crawl': handleDriveCrawl,
    '/api/drive/stream': handleDriveStream,
    '/api/ai/cull': handleAiCull,
    '/api/billing/plans': handleBillingPlans,
    '/api/billing/redeem': handleRedeemLicense,
    '/api/billing/create-order': handleCreateOrder,
    '/api/billing/order-status': handleOrderStatus,
    '/api/billing/vietqr-webhook': handleVietQrWebhook,
    '/api/admin/licenses': handleAdminLicenses,
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
