import jwt from "jsonwebtoken";
import { config } from "./config.js";

const commonSignOptions = { algorithm: "HS256", issuer: config.jwtIssuer, audience: config.jwtAudience };

export function createState(flowId) {
  return jwt.sign({ typ: "oauth-state", flow_id: flowId }, config.jwtSecret, { ...commonSignOptions, expiresIn: "5m" });
}

export function decodeToken(token) {
  return jwt.verify(token, config.jwtSecret, { algorithms: ["HS256"], issuer: config.jwtIssuer, audience: config.jwtAudience });
}

export function decodeState(token) {
  const payload = decodeToken(token);
  if (payload.typ !== "oauth-state" || !payload.flow_id) {
    const error = new Error("Invalid OAuth state"); error.statusCode = 400; throw error;
  }
  return payload;
}

export function createAccessToken(flowId, user) {
  const discordId = String(user.id);
  const image = user.avatar ? `https://cdn.discordapp.com/avatars/${discordId}/${user.avatar}.png?size=256` : null;
  return jwt.sign({ typ: "access", sub: discordId, flow_id: flowId, name: user.global_name || user.username || null, image }, config.jwtSecret, {
    ...commonSignOptions,
    expiresIn: config.jwtExpiresMinutes * 60,
  });
}
