import "dotenv/config";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function optional(name) {
  return process.env[name]?.trim() || null;
}

function discountCodes() {
  const raw = process.env.DISCOUNT_CODES_JSON?.trim() || "{}";
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch { throw new Error("DISCOUNT_CODES_JSON must be valid JSON"); }
  return Object.freeze(Object.fromEntries(Object.entries(parsed).map(([code, percentage]) => {
    const value = Number(percentage);
    if (!/^[A-Z0-9_-]{3,32}$/i.test(code) || !Number.isFinite(value) || value <= 0 || value > 100) throw new Error(`Invalid discount configuration: ${code}`);
    return [code.trim().toUpperCase(), value];
  })));
}

export const config = Object.freeze({
  host: process.env.HOST?.trim() || "127.0.0.1",
  port: Number.parseInt(process.env.PORT || "4785", 10),
  discordClientId: required("DISCORD_CLIENT_ID"),
  discordClientSecret: required("DISCORD_CLIENT_SECRET"),
  discordRedirectUri: process.env.DISCORD_REDIRECT_URI?.trim() || "http://127.0.0.1:4785/api/auth/callback/discord",
  discordGuildId: optional("DISCORD_GUILD_ID"),
  discordBotToken: optional("DISCORD_BOT_TOKEN"),
  jwtSecret: process.env.JWT_SECRET?.trim() || required("NEXTAUTH_SECRET"),
  jwtExpiresMinutes: Number.parseInt(process.env.JWT_EXPIRES_MINUTES || "10080", 10),
  jwtIssuer: process.env.JWT_ISSUER?.trim() || "auto-resource-updater-auth",
  jwtAudience: process.env.JWT_AUDIENCE?.trim() || "auto-resource-updater-desktop",
  versionsCookie: process.env.VERSIONS_COOKIE || "",
  cfxConcurrency: Math.max(1, Number.parseInt(process.env.CFX_CONCURRENCY || "20", 10)),
  versionCacheMs: Math.max(0, Number.parseInt(process.env.VERSION_CACHE_MS || "30000", 10)),
  updateBodyLimit: Math.max(1, Number.parseInt(process.env.UPDATE_BODY_LIMIT_MB || "128", 10)) * 1024 * 1024,
  discountCodes: discountCodes(),
  mysql: Object.freeze({
    host: process.env.MYSQL_HOST?.trim() || "127.0.0.1",
    port: Number.parseInt(process.env.MYSQL_PORT || "3306", 10),
    user: process.env.MYSQL_USER?.trim() || "root",
    password: process.env.MYSQL_PASSWORD || "",
    database: process.env.MYSQL_DATABASE?.trim() || "auto_resource_updater",
    connectionLimit: Math.max(2, Number.parseInt(process.env.MYSQL_CONNECTION_LIMIT || "20", 10)),
  }),
  paypal: Object.freeze({
    apiUrl: process.env.PAYPAL_API_URL?.replace(/\/$/, "") || "https://api-m.sandbox.paypal.com",
    clientId: optional("PAYPAL_CLIENT_ID"),
    clientSecret: optional("PAYPAL_CLIENT_SECRET"),
    webhookId: optional("PAYPAL_WEBHOOK_ID"),
  }),
});
