import "dotenv/config";

const webOrigin = process.env.WEB_ORIGIN ?? "http://127.0.0.1:5173";

/**
 * "localhost" and "127.0.0.1" are different CORS origins even though they point at the
 * same dev machine, and browsers block the mismatch with an opaque "Failed to fetch".
 * Accept both spellings of the configured origin so local dev works either way, without
 * widening what's accepted beyond the one host/port the operator configured.
 */
function withLocalhostAlias(origin: string): string[] {
  try {
    const url = new URL(origin);
    if (url.hostname === "127.0.0.1") return [origin, origin.replace("127.0.0.1", "localhost")];
    if (url.hostname === "localhost") return [origin, origin.replace("localhost", "127.0.0.1")];
    return [origin];
  } catch {
    return [origin];
  }
}

export const config = {
  databaseUrl: process.env.DATABASE_URL ?? "postgresql://golden:golden@127.0.0.1:5432/golden_casino",
  jwtSecret: process.env.JWT_SECRET ?? "development-only-secret-change-before-production",
  port: Number(process.env.API_PORT ?? 5100),
  webOrigin,
  webOrigins: withLocalhostAlias(webOrigin),
};

if (process.env.NODE_ENV === "production" && config.jwtSecret.startsWith("development")) {
  throw new Error("JWT_SECRET must be configured in production");
}

