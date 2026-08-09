import crypto from "node:crypto";
import { db } from "../database.js";
function referralCode() { return crypto.randomBytes(6).toString("base64url").toUpperCase().slice(0, 8); }
export async function ensureUser(discordId, profile = {}, executor = db) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await executor.execute(`INSERT INTO users (discord_id, discord_username, discord_avatar_url, referral_code) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE discord_username = COALESCE(VALUES(discord_username), discord_username), discord_avatar_url = COALESCE(VALUES(discord_avatar_url), discord_avatar_url)`, [String(discordId), profile.username || null, profile.avatarUrl || null, referralCode()]);
      const [rows] = await executor.execute("SELECT * FROM users WHERE discord_id = ? LIMIT 1", [String(discordId)]); return rows[0];
    } catch (error) { if (error.code !== "ER_DUP_ENTRY" || attempt === 4) throw error; }
  }
}
