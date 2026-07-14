export async function digestApiToken(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function generateApiTokenMaterial(id) {
  const secret = `${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
  return { token: `wm_live_${id}_${secret}`, keyPrefix: `wm_live_${id}_…` };
}
