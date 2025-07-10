import winston from 'winston';
import { join } from 'path';

const { combine, timestamp, json, printf, colorize, errors } = winston.format;

// Custom format for development
const devFormat = printf(({ level, message, timestamp, service, ...metadata }) => {
  let msg = `${timestamp} [${service}] ${level}: ${message}`;
  if (Object.keys(metadata).length > 0) {
    msg += ` ${JSON.stringify(metadata)}`;
  }
  return msg;
});

// Create logger factory
export function createLogger(service = 'honeygraph') {
  const isDevelopment = process.env.NODE_ENV !== 'production';

  const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    defaultMeta: { service },
    format: combine(
      errors({ stack: true }),
      timestamp(),
      isDevelopment ? colorize() : json()
    ),
    transports: [
      // Console transport
      new winston.transports.Console({
        format: isDevelopment ? devFormat : json()
      })
    ]
  });

  // Add file transport in production
  if (!isDevelopment) {
    logger.add(new winston.transports.File({
      filename: join(process.cwd(), 'logs', 'error.log'),
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }));

    logger.add(new winston.transports.File({
      filename: join(process.cwd(), 'logs', 'combined.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }));
  }

  return logger;
}