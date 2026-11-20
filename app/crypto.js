// Decrypts data/fragen.enc (written by scripts/build.mjs): PBKDF2-SHA256 + AES-256-GCM.

const fromB64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

/** Returns the parsed questions, or throws if the password is wrong. */
export async function decrypt(payload, password) {
  const baseKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: fromB64(payload.salt), iterations: payload.iter, hash: 'SHA-256' },
    baseKey, { name: 'AES-GCM', length: 256 }, false, ['decrypt'],
  );
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(payload.iv) }, key, fromB64(payload.ct));
  return JSON.parse(new TextDecoder().decode(plain));
}
