/** Exact origin checks in production; explicitly enabled aliases for local development. */
export function isAllowedOrigin(origin: string | undefined): boolean {
  const configured = process.env.APP_ORIGIN;
  if (!origin || !configured) return false;
  if (origin === configured) return true;
  if (
    process.env.NODE_ENV !== "development" ||
    process.env.LOCAL_LOOPBACK_ALIASES !== "true"
  )
    return false;
  try {
    const actual = new URL(origin),
      expected = new URL(configured);
    const loopback = new Set(["localhost", "127.0.0.1"]);
    return (
      actual.origin === origin &&
      expected.origin === configured &&
      actual.protocol === expected.protocol &&
      actual.port === expected.port &&
      loopback.has(actual.hostname) &&
      loopback.has(expected.hostname)
    );
  } catch {
    return false;
  }
}
