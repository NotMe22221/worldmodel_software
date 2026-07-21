export function safeReturnPath(value: string | null | undefined, fallback = "/dashboard") {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  try {
    const base = new URL("https://worldmodel.invalid");
    const target = new URL(value, base);
    if (target.origin !== base.origin || !target.pathname.startsWith("/")) return fallback;
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return fallback;
  }
}
