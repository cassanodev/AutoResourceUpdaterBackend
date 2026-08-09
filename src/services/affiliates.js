import { db, transaction } from "../database.js";
import { ensureUser } from "./users.js";

async function balances(userId, executor = db) {
  const [rows] = await executor.execute(
    `SELECT
       COALESCE(SUM(CASE WHEN kind IN ('earned','adjustment') THEN amount WHEN kind IN ('withdrawal','reversal') THEN -amount ELSE 0 END),0) AS availableBalance,
       COALESCE(SUM(CASE WHEN kind = 'pending' THEN amount ELSE 0 END),0) AS pendingBalance,
       COALESCE(SUM(CASE WHEN kind = 'earned' THEN amount ELSE 0 END),0) AS lifetimeEarned
     FROM affiliate_ledger WHERE affiliate_user_id = ?`, [userId]);
  return rows[0];
}

export async function affiliateFor(discordId) {
  const user = await ensureUser(discordId);
  const [accounts] = await db.execute("SELECT status FROM affiliate_accounts WHERE user_id = ? LIMIT 1", [user.id]);
  if (accounts[0]?.status !== "approved") return { allowed: false };
  const balance = await balances(user.id);
  const [referrals] = await db.execute(
    `SELECT referred.discord_id AS discordId, COALESCE(referred.discord_username,'Discord user') AS discordUsername,
            r.registered_at AS registeredAt, COALESCE(r.plan,'monthly') AS plan,
            r.commission_amount AS commission, REPLACE(r.status,'_','-') AS status,
            r.qualifies_at AS qualifiesAt
       FROM referrals r JOIN users referred ON referred.id = r.referred_user_id
      WHERE r.affiliate_user_id = ? ORDER BY r.registered_at DESC`, [user.id]);
  return { allowed: true, affiliate: { ...balance, qualifiedCount: referrals.filter((row) => row.status === "qualified").length, referralCode: user.referral_code, referrals } };
}

export async function requestWithdrawal(discordId) {
  return transaction(async (connection) => {
    const user = await ensureUser(discordId, {}, connection);
    const [accounts] = await connection.execute("SELECT status FROM affiliate_accounts WHERE user_id = ? FOR UPDATE", [user.id]);
    if (accounts[0]?.status !== "approved") { const error = new Error("Affiliate access required"); error.statusCode = 403; throw error; }
    const balance = await balances(user.id, connection);
    if (balance.availableBalance <= 0) { const error = new Error("No available balance"); error.statusCode = 409; throw error; }
    const [result] = await connection.execute("INSERT INTO withdrawal_requests (affiliate_user_id, amount) VALUES (?, ?)", [user.id, balance.availableBalance]);
    await connection.execute("INSERT INTO affiliate_ledger (affiliate_user_id, kind, amount, description) VALUES (?, 'withdrawal', ?, ?)", [user.id, balance.availableBalance, `Withdrawal request #${result.insertId}`]);
    return { success: true, withdrawalId: String(result.insertId), amount: balance.availableBalance };
  });
}
