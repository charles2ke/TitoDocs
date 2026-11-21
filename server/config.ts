import { resolve } from 'node:path';

const flag = (name: string, fallback: boolean): boolean => {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
};

export interface Config {
  port: number;
  host: string;
  dataDir: string;
  production: boolean;
  /** Mark cookies `Secure` (enable when served over HTTPS). */
  secureCookies: boolean;
  allowRegistration: boolean;
  /** Extra origins allowed to make state-changing requests / open collaboration sockets. */
  allowedOrigins: string[];
  trustProxy: boolean;
  maxUploadBytes: number;
  sessionDays: number;
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const production = process.env.NODE_ENV === 'production' || process.argv.includes('--production');
  return {
    port: Number(process.env.PORT ?? 3000),
    host: process.env.HOST ?? '0.0.0.0',
    dataDir: resolve(process.env.DATA_DIR ?? 'data'),
    production,
    secureCookies: flag('SECURE_COOKIES', false),
    allowRegistration: flag('ALLOW_REGISTRATION', true),
    allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    trustProxy: flag('TRUST_PROXY', false),
    maxUploadBytes: Number(process.env.MAX_UPLOAD_MB ?? 10) * 1024 * 1024,
    sessionDays: 30,
    ...overrides,
  };
}
