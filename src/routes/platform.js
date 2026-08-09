import { db } from "../database.js";
import { accountFor, createMockDeposit, startFreeTrial } from "../services/accounts.js";
import { affiliateFor, requestWithdrawal } from "../services/affiliates.js";
import { processWebhook, trackCheckout, verifyWebhook } from "../services/paypal.js";

const discordBody = { type: "object", required: ["discordId"], properties: { discordId: { type: "string", minLength: 5, maxLength: 32 }, discordUsername: { type: "string", maxLength: 100 }, discordAvatarUrl: { type: "string", maxLength: 500 } } };
export async function platformRoutes(app) {
  app.post("/api/accounts/get", { schema: { body: discordBody } }, async (request) => accountFor(request.body.discordId, { username: request.body.discordUsername, avatarUrl: request.body.discordAvatarUrl }));
  app.post("/api/trials/start", { schema: { body: discordBody } }, async (request) => startFreeTrial(request.body.discordId));
  app.post("/api/affiliates/get", { schema: { body: discordBody } }, async (request) => affiliateFor(request.body.discordId));
  app.post("/api/affiliates/withdraw", { schema: { body: discordBody } }, async (request) => requestWithdrawal(request.body.discordId));
  app.post("/api/crypto/deposits", {
    schema: { body: { type: "object", required: ["discordId", "asset", "plan", "amount"], properties: {
      discordId: { type: "string" }, asset: { enum: ["USDT", "BTC"] },
      plan: { enum: ["monthly", "lifetime"] }, amount: { type: "number", exclusiveMinimum: 0 },
      discountCode: { type: "string", maxLength: 32 },
    } } },
  }, async (request) => createMockDeposit(request.body));
  app.post("/api/billing/paypal/checkouts", {
    schema: { body: { type: "object", required: ["discordId", "externalId", "kind", "amount"], properties: {
      discordId: { type: "string" }, externalId: { type: "string" },
      kind: { enum: ["order", "subscription"] }, amount: { type: "number" },
      discountCode: { type: "string" }, discountPercentage: { type: "number" },
    } } },
  }, async (request) => trackCheckout(request.body));
  app.post("/api/paypal/webhooks", async (request, reply) => { if (!(await verifyWebhook(request.headers, request.body))) return reply.code(400).send({ error: "Invalid PayPal signature" }); return processWebhook(request.body); });
  app.get("/api/system/database", async () => { await db.query("SELECT 1"); return { status: "ok" }; });
}
