export function requestIdentity(request: Request) {
  const email = request.headers.get("oai-authenticated-user-email")?.trim().toLowerCase();
  if (email) return email;
  const host = new URL(request.url).hostname;
  if (host === "localhost" || host === "127.0.0.1") return "demo@worldmodel.dev";
  return null;
}
