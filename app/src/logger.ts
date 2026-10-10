import { createRequire } from 'node:module';
import pino from 'pino';
import { config } from './config.js';

// pino-pretty es devDependency: solo se usa si está instalado (no en la imagen de producción).
function hayPinoPretty(): boolean {
  try {
    createRequire(import.meta.url).resolve('pino-pretty');
    return true;
  } catch {
    return false;
  }
}

export const logger = pino({
  level: config.LOG_LEVEL,
  ...(config.LOG_PRETTY && hayPinoPretty()
    ? { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' } } }
    : {}),
});

export type Logger = typeof logger;
