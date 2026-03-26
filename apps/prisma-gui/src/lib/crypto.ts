/** Generate a random hex-encoded 32-byte secret (64 hex characters). */
export function generateHexSecret(): string {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Generate a random UUID v4. */
export function generateUuid(): string {
  return crypto.randomUUID();
}
