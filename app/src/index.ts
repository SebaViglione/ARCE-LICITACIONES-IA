import { config } from './config.js';
import { logger } from './logger.js';

logger.info({ puerto: config.PORT, rubro: config.RUBRO }, 'arce-licitaciones-ia (esqueleto fase 1)');
