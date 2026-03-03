import nacl from 'tweetnacl';
import { encodeBase64, decodeBase64 } from 'tweetnacl-util';

/**
 * Handles ephemeral X25519 key generation and NaCl box encryption
 * for agent-to-agent communication.
 *
 * Each session gets a fresh keypair. Keys never persist beyond the session.
 * The discovery service only sees encrypted blobs it cannot decrypt.
 */
export class CryptoService {
  private keyPair: nacl.BoxKeyPair | null = null;

  /**
   * Generate a new ephemeral X25519 keypair for this session.
   */
  generateKeyPair(): { publicKey: string; secretKey: Uint8Array } {
    this.keyPair = nacl.box.keyPair();
    return {
      publicKey: encodeBase64(this.keyPair.publicKey),
      secretKey: this.keyPair.secretKey,
    };
  }

  /**
   * Get the current session's public key as base64.
   */
  getPublicKey(): string {
    if (!this.keyPair) {
      throw new Error('No keypair generated. Call generateKeyPair() first.');
    }
    return encodeBase64(this.keyPair.publicKey);
  }

  /**
   * Encrypt a message for a specific recipient using their public key.
   * Uses NaCl box (X25519 + XSalsa20 + Poly1305).
   *
   * Returns a base64 string containing: nonce + ciphertext.
   */
  encrypt(plaintext: string, recipientPublicKey: string): string {
    if (!this.keyPair) {
      throw new Error('No keypair generated. Call generateKeyPair() first.');
    }

    const messageBytes = new TextEncoder().encode(plaintext);
    const nonce = nacl.randomBytes(nacl.box.nonceLength);
    const recipientPk = decodeBase64(recipientPublicKey);

    const encrypted = nacl.box(
      messageBytes,
      nonce,
      recipientPk,
      this.keyPair.secretKey,
    );

    if (!encrypted) {
      throw new Error('Encryption failed');
    }

    // Concatenate nonce + ciphertext for transport
    const combined = new Uint8Array(nonce.length + encrypted.length);
    combined.set(nonce);
    combined.set(encrypted, nonce.length);

    return encodeBase64(combined);
  }

  /**
   * Decrypt a message from a specific sender using their public key.
   * Expects the input to be base64(nonce + ciphertext).
   */
  decrypt(encryptedBase64: string, senderPublicKey: string): string {
    if (!this.keyPair) {
      throw new Error('No keypair generated. Call generateKeyPair() first.');
    }

    const combined = decodeBase64(encryptedBase64);
    const nonce = combined.slice(0, nacl.box.nonceLength);
    const ciphertext = combined.slice(nacl.box.nonceLength);
    const senderPk = decodeBase64(senderPublicKey);

    const decrypted = nacl.box.open(
      ciphertext,
      nonce,
      senderPk,
      this.keyPair.secretKey,
    );

    if (!decrypted) {
      throw new Error('Decryption failed — invalid key or tampered message');
    }

    return new TextDecoder().decode(decrypted);
  }
}
