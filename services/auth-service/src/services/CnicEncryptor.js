import crypto from 'node:crypto';

const IV_LENGTH = 12;
const TAG_LENGTH = 16;

// Encrypts the CNIC with AES-256-GCM, and makes an HMAC-SHA256 hash for the duplicate check.
// The two keys are separate, so the hash key cannot be used to decrypt.
export class CnicEncryptor {
  constructor({ encryptionKey, hashKey }) {
    this.encryptionKey = encryptionKey;
    this.hashKey = hashKey;
  }

  // Returns base64 of iv + auth tag + ciphertext (56 characters for a 13-digit CNIC).
  encrypt(cnic) {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    const ciphertext = Buffer.concat([cipher.update(cnic, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
  }

  decrypt(encrypted) {
    const data = Buffer.from(encrypted, 'base64');
    const iv = data.subarray(0, IV_LENGTH);
    const tag = data.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data.subarray(IV_LENGTH + TAG_LENGTH)), decipher.final()]).toString('utf8');
  }

  // 64 hex characters, the same for the same CNIC.
  hash(cnic) {
    return crypto.createHmac('sha256', this.hashKey).update(cnic).digest('hex');
  }
}
