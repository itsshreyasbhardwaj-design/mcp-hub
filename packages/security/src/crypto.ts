import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from 'node:crypto';
import { HubError } from '@mcp-hub/core';

export interface EncryptedPayload {
  ciphertext: string;
  iv: string;
  authTag: string;
}

const ALGORITHM = 'aes-256-gcm';

/** AES-256-GCM. The IV is random per record and stored alongside the ciphertext. */
export function encryptSecret(plaintext: string, key: Buffer): EncryptedPayload {
  if (key.length !== 32) throw HubError.internal('Encryption key must be 32 bytes.');
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
  };
}

export function decryptSecret(payload: EncryptedPayload, key: Buffer): string {
  if (key.length !== 32) throw HubError.internal('Encryption key must be 32 bytes.');
  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(payload.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(payload.authTag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(payload.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch (err) {
    // A GCM tag mismatch means tampering or a rotated key; both are fatal.
    throw HubError.internal('Stored credential could not be decrypted.', err);
  }
}

export const API_KEY_PREFIX = 'mch_';

export interface GeneratedApiKey {
  /** Shown exactly once, at creation. */
  plaintext: string;
  /** Stored, and used for lookup. */
  hash: string;
  /** Displayed in the UI so keys can be told apart. */
  prefix: string;
}

/**
 * API keys are random 32-byte secrets. The lookup hash is scrypt with a fixed
 * salt derived from the key material itself — deterministic (so a single
 * indexed lookup works) but still expensive to brute-force offline.
 */
export function generateApiKey(): GeneratedApiKey {
  const secret = randomBytes(32).toString('base64url');
  const plaintext = `${API_KEY_PREFIX}${secret}`;
  return {
    plaintext,
    hash: hashApiKey(plaintext),
    prefix: plaintext.slice(0, 12),
  };
}

export function hashApiKey(plaintext: string): string {
  const salt = createHash('sha256').update('mcp-hub/api-key/v1').digest().subarray(0, 16);
  return scryptSync(plaintext, salt, 32, { N: 16384, r: 8, p: 1 }).toString('base64');
}

/** Constant-time comparison for any secret material. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
