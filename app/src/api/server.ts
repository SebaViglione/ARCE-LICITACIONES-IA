import express, { type NextFunction, type Request, type Response } from 'express';
import type http from 'node:http';
import path from 'node:path';
import { APP_ROOT, config } from '../config.js';
import { logger } from '../logger.js';
import { api, ErrorHttp } from './routes.js';

export const PUBLIC_DIR = path.join(APP_ROOT, 'public');

export function crearApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);
  app.use(express.json({ limit: '1mb' }));

  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', api);
  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'Ruta no encontrada' });
  });

  app.use(express.static(PUBLIC_DIR, { index: 'index.html', maxAge: '5m' }));

  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ErrorHttp) {
      res.status(err.status).json({ error: err.message, ...(err.detalle !== undefined ? { detalle: err.detalle } : {}) });
      return;
    }
    const e = err as { type?: string; status?: number; message?: string };
    if (e.type === 'entity.parse.failed' || e.type === 'entity.too.large') {
      res.status(e.status ?? 400).json({ error: 'Body inválido' });
      return;
    }
    logger.error({ err, metodo: req.method, url: req.originalUrl }, 'error no controlado en la API');
    res.status(500).json({ error: 'Error interno' });
  });

  return app;
}

export function iniciarServidor(): Promise<http.Server> {
  const app = crearApp();
  return new Promise((resolve, reject) => {
    const server = app.listen(config.PORT, '0.0.0.0', () => {
      logger.info({ puerto: config.PORT, url: `http://localhost:${config.PORT}` }, 'API y dashboard escuchando');
      resolve(server);
    });
    server.on('error', reject);
  });
}
