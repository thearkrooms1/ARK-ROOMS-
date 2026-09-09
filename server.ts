import path from 'path';
import express from 'express';
import type { Request, Response } from 'express';
import {
  createApp,
  getSupabaseCredentials,
  getServerSupabase,
  createUserSupabaseClient,
} from './api/index';

const PORT = 3000;

export async function startServer() {
  const app = createApp({ isVercel: false, serveStatic: true });

  const publicPath = path.join(process.cwd(), 'public');
  app.use(express.static(publicPath));

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`TheArkRooms server running at http://0.0.0.0:${PORT}`);
  });
  return app;
}

if (!process.env.VERCEL && !process.env.NOW_REGION) {
  startServer().catch((err) => {
    console.error('[FATAL SERVER START ERROR]:', err);
  });
}

export { createApp, getSupabaseCredentials, getServerSupabase, createUserSupabaseClient };
export default createApp;
