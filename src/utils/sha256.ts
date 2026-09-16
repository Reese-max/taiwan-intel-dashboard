export async function computeSha256Hex(data: string | ArrayBuffer): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    return "";
  }
  const buffer = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
