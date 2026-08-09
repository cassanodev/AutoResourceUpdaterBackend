import semver from "semver";
import { config } from "./config.js";
import { request } from "./http.js";
import { RESOURCE_IDS } from "./resource-ids.js";

const cache = new Map();
const inFlight = new Map();
let active = 0;
const waiting = [];

async function withLimit(operation) {
  if (active >= config.cfxConcurrency)
    await new Promise((resolve) => waiting.push(resolve));
  active += 1;
  try {
    return await operation();
  } finally {
    active -= 1;
    waiting.shift()?.();
  }
}

function latestVersion(versions) {
  let latest = null;
  for (const entry of versions) {
    if (!entry || typeof entry.version !== "string") continue;
    const parsed =
      semver.parse(entry.version, { loose: true }) ||
      semver.coerce(entry.version);
    if (parsed && (!latest || semver.gt(parsed, latest.parsed)))
      latest = { parsed, value: entry.version };
  }
  return latest?.value ?? null;
}

async function fetchVersion(resourceName) {
  const assetId = RESOURCE_IDS[resourceName];
  if (!assetId) return null;

  const cached = cache.get(resourceName);
  if (cached && cached.expiresAt > Date.now()) return cached.version;
  if (inFlight.has(resourceName)) return inFlight.get(resourceName);

  const operation = withLimit(async () => {
    const response = await request(
      `https://portal-api.cfx.re/v1/asset-grants/${assetId}`,
      {
        headers: config.versionsCookie ? { Cookie: config.versionsCookie } : {},
      },
      30_000,
    );

    if (!response.ok) return null;

    const data = await response.json();

    const version = latestVersion(data?.asset?.versions || []);
    if (version)
      cache.set(resourceName, {
        version,
        expiresAt: Date.now() + config.versionCacheMs,
      });

    return version;
  })
    .catch(() => null)
    .finally(() => inFlight.delete(resourceName));
  inFlight.set(resourceName, operation);
  return operation;
}

export async function getResourceVersion(resourceName) {
  return fetchVersion(resourceName);
}

export async function getResourceVersions(ids) {
  const uniqueResults = new Map();
  await Promise.all(
    [...new Set(ids)].map(async (id) =>
      uniqueResults.set(id, await fetchVersion(id)),
    ),
  );
  return ids.map((id) => {
    const version = uniqueResults.get(id) ?? null;
    return { id, version, success: version !== null };
  });
}