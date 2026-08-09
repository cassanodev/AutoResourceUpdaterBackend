import { config } from "./config.js";
import { request } from "./http.js";

const API = "https://discord.com/api/v10";

export async function exchangeCode(code) {
  const body = new URLSearchParams({ client_id: config.discordClientId, client_secret: config.discordClientSecret, grant_type: "authorization_code", code, redirect_uri: config.discordRedirectUri });
  const response = await request(`${API}/oauth2/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
  if (!response.ok) throw new Error(`Discord token exchange failed (${response.status})`);
  return (await response.json()).access_token;
}

export async function getDiscordUser(accessToken) {
  const response = await request(`${API}/users/@me`, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error(`Discord user request failed (${response.status})`);
  return response.json();
}

export async function joinGuildIfConfigured(userId, accessToken) {
  if (!config.discordGuildId || !config.discordBotToken) return;
  const response = await request(`${API}/guilds/${config.discordGuildId}/members/${userId}`, {
    method: "PUT",
    headers: { authorization: `Bot ${config.discordBotToken}`, "content-type": "application/json" },
    body: JSON.stringify({ access_token: accessToken }),
  });
  // if (response.status !== 201 && response.status !== 204) throw new Error(`Discord guild join failed (${response.status})`);
}
