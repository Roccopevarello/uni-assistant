// Encrypts secrets (AI keys, email sign-in tokens, the Blackboard feed link)
// before they are stored. The key lives only in the server's ENCRYPTION_KEY
// secret: 32 random bytes, base64. Format: "v1:<iv b64>:<ciphertext b64>".

function b64encode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function b64decode(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function importKey(keyB64: string): Promise<CryptoKey> {
  const raw = b64decode(keyB64);
  if (raw.length !== 32) throw new Error("ENCRYPTION_KEY must be 32 bytes, base64-encoded");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encrypt(plain: string, keyB64: string): Promise<string> {
  const key = await importKey(keyB64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain)));
  return `v1:${b64encode(iv)}:${b64encode(ct)}`;
}

export async function decrypt(sealed: string, keyB64: string): Promise<string> {
  const [version, ivB64, ctB64] = sealed.split(":");
  if (version !== "v1" || !ivB64 || !ctB64) throw new Error("Unknown encrypted value format");
  const key = await importKey(keyB64);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64decode(ivB64) }, key, b64decode(ctB64));
  return new TextDecoder().decode(plain);
}

/** Random URL-safe token, e.g. for the private calendar link and OAuth state. */
export function randomToken(bytes = 24): string {
  return b64encode(crypto.getRandomValues(new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sha256b64url(input: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input)));
  return b64encode(digest).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
