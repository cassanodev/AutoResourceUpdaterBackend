import Fastify from "fastify";
import { config } from "./config.js";
import { dispatcher } from "./http.js";
import { exchangeCode, getDiscordUser, joinGuildIfConfigured } from "./discord.js";
import { createAccessToken, createState, decodeState, decodeToken } from "./security.js";
import { getResourceVersion, getResourceVersions } from "./resources.js";
import { createUpdatePlan } from "./update-plan.js";
import { platformRoutes } from "./routes/platform.js";
import { db } from "./database.js";
import { ensureUser } from "./services/users.js";

const app = Fastify({ logger: true, bodyLimit: 64 * 1024, requestTimeout: 35_000, keepAliveTimeout: 72_000, maxRequestsPerSocket: 1000 });
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

app.setErrorHandler((error, request, reply) => {
  if (error.validation) return reply.code(422).send({ detail: error.validation });
  request.log.error({ err: error }, "Unhandled request error");
  return reply.code(error.statusCode >= 400 ? error.statusCode : 500).send({ detail: error.statusCode >= 400 ? error.message : "Internal server error" });
});

app.get("/health", async () => ({ status: "ok" }));

app.get("/api/auth/discord/login", async (request, reply) => {
  const flowId = request.query?.flow_id;
  if (typeof flowId !== "string" || !uuidPattern.test(flowId)) return reply.code(422).send({ detail: "Invalid flow_id" });
  const query = new URLSearchParams({ client_id: config.discordClientId, redirect_uri: config.discordRedirectUri, response_type: "code", scope: "identify guilds.join", state: createState(flowId), prompt: "consent" });
  return reply.redirect(`https://discord.com/oauth2/authorize?${query}`);
});

app.get("/api/auth/callback/discord", async (request, reply) => {
  const { code, state } = request.query || {};
  if (typeof code !== "string" || typeof state !== "string") return reply.code(422).send({ detail: "Missing OAuth parameters" });
  let stateData;
  try { stateData = decodeState(state); }
  catch { return reply.code(400).send({ detail: "Invalid OAuth state" }); }
  try {
    const discordToken = await exchangeCode(code);
    const user = await getDiscordUser(discordToken);
    await joinGuildIfConfigured(String(user.id), discordToken);
    await ensureUser(String(user.id), {
      username: user.global_name || user.username || null,
      avatarUrl: user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=256` : null,
    });
    const token = createAccessToken(String(stateData.flow_id), user);
    const callbackUrl = `autoresourceupdater-auth://callback?${new URLSearchParams({ token, flow_id: String(stateData.flow_id) })}`;
    return reply.type("text/html; charset=utf-8").send(authCompleteHtml(callbackUrl));
  } catch (error) {
    request.log.error({ err: error }, "Discord authentication failed");
    return reply.code(502).send({ detail: "Discord authentication failed" });
  }
});

app.get("/api/auth/me", async (request, reply) => {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) return reply.code(401).send({ detail: "Missing bearer token" });
  try {
    const payload = decodeToken(authorization.slice(7));
    if (payload.typ !== "access") return reply.code(401).send({ detail: "Invalid token type" });
    return { id: String(payload.sub), discordId: String(payload.sub), name: payload.name ?? null, image: payload.image ?? null };
  } catch { return reply.code(401).send({ detail: "Invalid or expired token" }); }
});

app.get("/api/resources/getLastVersion", async (request, reply) => {
  const id = request.query?._id;
  if (typeof id !== "string") return reply.code(422).send({ detail: "Missing _id" });
  const version = await getResourceVersion(id);
  return version ? { version } : reply.code(404).send({ detail: `Recurso no encontrado (${id}).` });
});

app.post("/api/resources/getResourcesLastVersion", {
  schema: { body: { type: "object", required: ["ids"], additionalProperties: false, properties: { ids: { type: "array", maxItems: 2000, items: { type: "string", minLength: 1, maxLength: 200 } } } } },
}, async (request) => ({ resources: await getResourceVersions(request.body.ids) }));

app.post("/api/billing/validate-discount", {
  schema: { body: { type: "object", required: ["code", "plan"], additionalProperties: false, properties: { code: { type: "string", minLength: 3, maxLength: 32, pattern: "^[A-Za-z0-9_-]+$" }, plan: { enum: ["monthly", "lifetime"] } } } },
}, async (request) => {
  const code = request.body.code.trim().toUpperCase();
  const planColumn = request.body.plan === "monthly" ? "applies_monthly" : "applies_lifetime";
  let percentage = 0;
  try {
    const [rows] = await db.execute(`SELECT percentage FROM discount_codes WHERE code=? AND active=TRUE AND ${planColumn}=TRUE AND (expires_at IS NULL OR expires_at>UTC_TIMESTAMP(3)) AND (max_redemptions IS NULL OR redemption_count<max_redemptions) LIMIT 1`, [code]);
    percentage = Number(rows[0]?.percentage || 0);
  } catch (error) {
    request.log.warn({ err: error }, "MySQL discount lookup failed; using environment fallback");
    percentage = Number(config.discountCodes[code] || 0);
  }
  if (!percentage) return { valid: false, code, discountPercentage: 0 };
  return { valid: true, code, discountPercentage: percentage };
});

const updateFileSchema = { type: "object", required: ["path", "encoding", "content"], additionalProperties: false, properties: { path: { type: "string", minLength: 1, maxLength: 1000 }, encoding: { enum: ["utf8", "base64"] }, content: { type: "string" }, hash: { type: "string" } } };
app.post("/api/resources/prepareUpdate", {
  bodyLimit: config.updateBodyLimit,
  schema: { body: { type: "object", required: ["oldFiles", "newFiles"], additionalProperties: false, properties: { oldFiles: { type: "array", maxItems: 10000, items: updateFileSchema }, newFiles: { type: "array", maxItems: 10000, items: updateFileSchema }, preserveConfigs: { type: "boolean" } } } },
}, async (request) => createUpdatePlan(request.body.oldFiles, request.body.newFiles, { preserveConfigs: request.body.preserveConfigs !== false }));

await app.register(platformRoutes);

function authCompleteHtml(callbackUrl) {
  const safeUrl = JSON.stringify(callbackUrl).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Authentication Complete</title><style>*{box-sizing:border-box}body{margin:0;background:#0b0e11;color:#f8fafc;font-family:Segoe UI,Arial,sans-serif;display:grid;place-items:center;height:100vh}.card{background:#11161b;border:1px solid #ffffff14;width:420px;max-width:90%;padding:40px;border-radius:16px;text-align:center;box-shadow:0 24px 70px #0008}.icon{display:grid;place-items:center;width:64px;height:64px;margin:0 auto 22px;border-radius:50%;background:#10b98122;color:#34d399;font-size:30px}h1{font-size:24px;margin:0 0 12px}p,.status{color:#94a3b8;line-height:1.6;font-size:14px}.status{margin-top:24px;font-size:12px}</style></head><body><div class="card"><div class="icon">✓</div><h1>Authentication Complete</h1><p>Your Discord account has been successfully linked. We are opening the application automatically.</p><div class="status" id="status">You can safely close this window.</div></div><script>const callbackUrl=${safeUrl};location.href=callbackUrl;setTimeout(()=>document.getElementById("status").textContent="If nothing happened, return to the application manually.",2000)</script></body></html>`;
}

const close = async (signal) => { app.log.info({ signal }, "Shutting down"); await app.close(); await db.end(); await dispatcher.close(); process.exit(0); };
process.once("SIGINT", () => void close("SIGINT"));
process.once("SIGTERM", () => void close("SIGTERM"));

try { await app.listen({ host: config.host, port: config.port }); }
catch (error) { app.log.error(error); process.exit(1); }
