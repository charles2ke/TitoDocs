import { createHash, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;

function scryptAsync(password: string, salt: Buffer, keyLength: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, KEY_LENGTH, SCRYPT_PARAMS);
  const { N, r, p } = SCRYPT_PARAMS;
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, N, r, p, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const actual = await scryptAsync(password, Buffer.from(salt, 'base64url'), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** URL-safe random identifier (128 bits by default). */
export const newId = (bytes = 16): string => randomBytes(bytes).toString('base64url');

export const newSessionToken = (): string => randomBytes(32).toString('base64url');

export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

const USER_COLORS = [
  '#e8590c', '#d6336c', '#ae3ec9', '#7048e8', '#4263eb', '#1c7ed6',
  '#1098ad', '#0ca678', '#37b24d', '#74b816', '#f59f00', '#f76707',
];

export const randomColor = (): string => USER_COLORS[randomBytes(1)[0] % USER_COLORS.length];
