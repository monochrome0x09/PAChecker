export const ACCESS_SESSION_COOKIE = "pachecker_session";
export const ACCESS_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

const encoder = new TextEncoder();

function signingKey(username: string, password: string) {
  return encoder.encode(`${username}\u0000${password}`);
}

function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64Url(value: string) {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function importSigningKey(username: string, password: string) {
  return crypto.subtle.importKey(
    "raw",
    signingKey(username, password),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function createAccessSession(username: string, password: string) {
  const expiresAt = Math.floor(Date.now() / 1000) + ACCESS_SESSION_MAX_AGE_SECONDS;
  const payload = `v1.${expiresAt}`;
  const key = await importSigningKey(username, password);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return `${payload}.${toBase64Url(new Uint8Array(signature))}`;
}

export async function verifyAccessSession(
  token: string | undefined,
  username: string,
  password: string,
) {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1" || !/^\d+$/.test(parts[1])) return false;

  const expiresAt = Number(parts[1]);
  const now = Math.floor(Date.now() / 1000);
  if (
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= now ||
    expiresAt > now + ACCESS_SESSION_MAX_AGE_SECONDS
  ) {
    return false;
  }

  try {
    const key = await importSigningKey(username, password);
    return await crypto.subtle.verify(
      "HMAC",
      key,
      fromBase64Url(parts[2]),
      encoder.encode(`v1.${expiresAt}`),
    );
  } catch {
    return false;
  }
}
