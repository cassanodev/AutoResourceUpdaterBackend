import { config } from "../config.js";
import { db, transaction } from "../database.js";
import { ensureUser } from "./users.js";

let cachedToken = null;
async function accessToken() {
  if (!config.paypal.clientId || !config.paypal.clientSecret) throw new Error("PayPal credentials are not configured");
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.value;
  const response = await fetch(`${config.paypal.apiUrl}/v1/oauth2/token`, { method: "POST", headers: { Authorization: `Basic ${Buffer.from(`${config.paypal.clientId}:${config.paypal.clientSecret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials" });
  if (!response.ok) throw new Error("PayPal authentication failed");
  const data = await response.json(); cachedToken = { value: data.access_token, expiresAt: Date.now() + Number(data.expires_in) * 1000 }; return cachedToken.value;
}

export async function verifyWebhook(headers, event) {
  if (!config.paypal.webhookId) throw new Error("PAYPAL_WEBHOOK_ID is not configured");
  const required = ["paypal-auth-algo", "paypal-cert-url", "paypal-transmission-id", "paypal-transmission-sig", "paypal-transmission-time"];
  if (required.some((name) => !headers[name])) return false;
  const token = await accessToken();
  const response = await fetch(`${config.paypal.apiUrl}/v1/notifications/verify-webhook-signature`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ auth_algo: headers["paypal-auth-algo"], cert_url: headers["paypal-cert-url"], transmission_id: headers["paypal-transmission-id"], transmission_sig: headers["paypal-transmission-sig"], transmission_time: headers["paypal-transmission-time"], webhook_id: config.paypal.webhookId, webhook_event: event }) });
  const data = await response.json(); return response.ok && data.verification_status === "SUCCESS";
}

export async function trackCheckout(input) {
  return transaction(async (connection) => {
    const user = await ensureUser(input.discordId, {}, connection);
    if (input.kind === "subscription") {
      await connection.execute(`INSERT INTO subscriptions (user_id, provider, provider_subscription_id, plan, status, base_amount, charged_amount, discount_code, discount_percentage) VALUES (?, 'paypal', ?, 'monthly', 'pending', 9.99, ?, ?, ?) ON DUPLICATE KEY UPDATE charged_amount=VALUES(charged_amount), discount_code=VALUES(discount_code), discount_percentage=VALUES(discount_percentage)`, [user.id, input.externalId, input.amount, input.discountCode || null, input.discountPercentage || 0]);
    } else {
      const [result] = await connection.execute(`INSERT INTO subscriptions (user_id, provider, plan, status, base_amount, charged_amount, discount_code, discount_percentage) VALUES (?, 'paypal', 'lifetime', 'pending', 29.99, ?, ?, ?)`, [user.id, input.amount, input.discountCode || null, input.discountPercentage || 0]);
      await connection.execute(`INSERT INTO payments (user_id, subscription_id, provider, provider_payment_id, status, amount, currency) VALUES (?, ?, 'paypal', ?, 'created', ?, 'USD') ON DUPLICATE KEY UPDATE amount=VALUES(amount)`, [user.id, result.insertId, input.externalId, input.amount]);
    }
    return { success: true };
  });
}

const subscriptionStatuses = { "BILLING.SUBSCRIPTION.CREATED": "pending", "BILLING.SUBSCRIPTION.ACTIVATED": "active", "BILLING.SUBSCRIPTION.UPDATED": "active", "BILLING.SUBSCRIPTION.EXPIRED": "expired", "BILLING.SUBSCRIPTION.CANCELLED": "cancelled", "BILLING.SUBSCRIPTION.SUSPENDED": "suspended", "BILLING.SUBSCRIPTION.PAYMENT.FAILED": "past_due" };
export async function processWebhook(event) {
  return transaction(async (connection) => {
    const [insert] = await connection.execute(`INSERT IGNORE INTO paypal_webhook_events (paypal_event_id,event_type,resource_id,payload) VALUES (?,?,?,?)`, [event.id, event.event_type, event.resource?.id || null, JSON.stringify(event)]);
    if (!insert.affectedRows) return { duplicate: true };
    try {
      const subscriptionStatus = subscriptionStatuses[event.event_type];
      if (subscriptionStatus) {
        const subscriptionId = event.resource?.id;
        if (subscriptionId) await connection.execute(`UPDATE subscriptions SET status=?, current_period_start=COALESCE(?,current_period_start), current_period_end=COALESCE(?,current_period_end), cancelled_at=IF(?='cancelled',UTC_TIMESTAMP(3),cancelled_at) WHERE provider='paypal' AND provider_subscription_id=?`, [subscriptionStatus, event.resource?.start_time || null, event.resource?.billing_info?.next_billing_time || null, subscriptionStatus, subscriptionId]);
      } else if (event.event_type === "PAYMENT.SALE.COMPLETED") {
        const subscriptionId = event.resource?.billing_agreement_id;
        const [subs] = await connection.execute("SELECT id,user_id FROM subscriptions WHERE provider='paypal' AND provider_subscription_id=? LIMIT 1", [subscriptionId]);
        if (subs[0]) { await connection.execute("UPDATE subscriptions SET status='active', current_period_end=COALESCE(?,current_period_end) WHERE id=?", [event.resource?.billing_period?.end_time || null, subs[0].id]); await connection.execute(`INSERT INTO payments (user_id,subscription_id,provider,provider_payment_id,status,amount,currency,paid_at,raw_payload) VALUES (?,?,'paypal',?,'completed',?,?,UTC_TIMESTAMP(3),?) ON DUPLICATE KEY UPDATE status='completed',paid_at=UTC_TIMESTAMP(3),raw_payload=VALUES(raw_payload)`, [subs[0].user_id, subs[0].id, event.resource.id, event.resource.amount?.total || 0, event.resource.amount?.currency || "USD", JSON.stringify(event.resource)]); }
      } else if (event.event_type === "PAYMENT.CAPTURE.COMPLETED") {
        const orderId = event.resource?.supplementary_data?.related_ids?.order_id;
        await connection.execute(`UPDATE payments p JOIN subscriptions s ON s.id=p.subscription_id SET p.status='completed',p.paid_at=UTC_TIMESTAMP(3),p.raw_payload=?,s.status='active' WHERE p.provider='paypal' AND p.provider_payment_id=?`, [JSON.stringify(event.resource), orderId]);
      } else if (["PAYMENT.CAPTURE.REFUNDED","PAYMENT.SALE.REFUNDED"].includes(event.event_type)) {
        await connection.execute("UPDATE payments SET status='refunded',raw_payload=? WHERE provider='paypal' AND provider_payment_id=?", [JSON.stringify(event.resource), event.resource?.id]);
      }
      await connection.execute("UPDATE paypal_webhook_events SET processing_status='processed',processed_at=UTC_TIMESTAMP(3) WHERE paypal_event_id=?", [event.id]); return { processed: true };
    } catch (error) { await connection.execute("UPDATE paypal_webhook_events SET processing_status='failed',error_message=?,processed_at=UTC_TIMESTAMP(3) WHERE paypal_event_id=?", [String(error.message).slice(0, 4000), event.id]); throw error; }
  });
}
