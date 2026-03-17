/**
 * Token Encryption Store
 *
 * AES-256-GCM encryption/decryption for OAuth tokens at rest.
 * Tokens are stored as `iv:authTag:ciphertext` (hex-encoded).
 *
 * Requires `TOKEN_ENCRYPTION_KEY` env var — a 32-byte hex string (64 chars).
 * Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env } from '../config/env.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // GCM standard
const AUTH_TAG_LENGTH = 16;

/**
 * Get the encryption key from env, validating it's the correct length.
 * Reads from process.env first (allows test stubbing) then falls back to parsed env.
 */
function getKey(): Buffer {
  const keyHex = process.env.TOKEN_ENCRYPTION_KEY ?? env.TOKEN_ENCRYPTION_KEY;
  if (!keyHex) {
    throw new Error('TOKEN_ENCRYPTION_KEY is not set — cannot encrypt/decrypt tokens');
  }
  const key = Buffer.from(keyHex, 'hex');
  if (key.length !== 32) {
    throw new Error('TOKEN_ENCRYPTION_KEY must be exactly 32 bytes (64 hex chars)');
  }
  return key;
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Returns `iv:authTag:ciphertext` (all hex-encoded).
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypt a string previously encrypted with `encrypt()`.
 * Input must be in format `iv:authTag:ciphertext` (all hex-encoded).
 */
export function decrypt(encrypted: string): string {
  const key = getKey();
  const parts = encrypted.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted token format — expected iv:authTag:ciphertext');
  }

  const [ivHex, authTagHex, ciphertextHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}

/**
 * Encrypt a TokenSet's sensitive fields (access_token, refresh_token).
 * Returns a new object with encrypted values — does NOT mutate the input.
 */
export function encryptTokenSet(tokens: {
  access_token: string;
  refresh_token?: string;
  [key: string]: unknown;
}): { access_token: string; refresh_token?: string; [key: string]: unknown } {
  return {
    ...tokens,
    access_token: encrypt(tokens.access_token),
    refresh_token: tokens.refresh_token ? encrypt(tokens.refresh_token) : undefined,
  };
}

/**
 * Decrypt a TokenSet's sensitive fields (access_token, refresh_token).
 * Returns a new object with decrypted values — does NOT mutate the input.
 */
export function decryptTokenSet(tokens: {
  access_token: string;
  refresh_token?: string;
  [key: string]: unknown;
}): { access_token: string; refresh_token?: string; [key: string]: unknown } {
  return {
    ...tokens,
    access_token: decrypt(tokens.access_token),
    refresh_token: tokens.refresh_token ? decrypt(tokens.refresh_token) : undefined,
  };
}
