/**
 * Relay watchdog: fast health check for /api/relay/session with webhook paging on failure.
 *
 * Usage:
 *   npx ts-node scripts/relay-watchdog.ts
 *   npx ts-node scripts/relay-watchdog.ts --base-url http://localhost:3000 --timeout-ms 8000
 */

import * as fs from "fs";
import * as path from "path";
import * as http from "http";
import * as https from "https";

type RelayStatusResponse = {
  ok?: boolean;
  available?: boolean;
  relayer?: string;
  market?: string;
  rpcUrl?: string;
  error?: string;
};

function readArg(name: string): string | undefined {
  const args = process.argv.slice(2);
  const key = `--${name}`;
  const index = args.indexOf(key);
  if (index < 0 || index + 1 >= args.length) return undefined;
  return args[index + 1];
}

function loadEnvFile(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const sep = line.indexOf("=");
    if (sep <= 0) continue;
    const key = line.slice(0, sep).trim();
    const value = line.slice(sep + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

function normalizeUrl(raw?: string): string | null {
  if (!raw) return null;
  let value = raw.trim();
  if (!value) return null;
  if (value.startsWith("<") && value.endsWith(">")) {
    value = value.slice(1, -1).trim();
  }
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1).trim();
  }
  return value || null;
}

async function postJson(urlStr: string, payload: Record<string, unknown>): Promise<void> {
  const body = JSON.stringify(payload);
  const url = new URL(urlStr);
  const isHttps = url.protocol === "https:";
  const client = isHttps ? https : http;

  await new Promise<void>((resolve, reject) => {
    const req = client.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          "User-Agent": "shadowperp-relay-watchdog/1.0",
        },
      },
      (res) => {
        let response = "";
        res.on("data", (chunk) => {
          response += chunk.toString();
        });
        res.on("end", () => {
          if ((res.statusCode ?? 500) >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${response.slice(0, 300)}`));
            return;
          }
          resolve();
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(10_000, () => req.destroy(new Error("webhook request timed out")));
    req.write(body);
    req.end();
  });
}

async function main(): Promise<void> {
  loadEnvFile(path.resolve(__dirname, "..", "app", ".env.local"));

  const timeoutMs = Number.parseInt(readArg("timeout-ms") || "8000", 10);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1000) {
    throw new Error("Invalid --timeout-ms (minimum 1000)");
  }

  const baseUrl =
    normalizeUrl(readArg("base-url")) ||
    normalizeUrl(process.env.RELAY_WATCHDOG_BASE_URL) ||
    normalizeUrl(process.env.NEXT_PUBLIC_APP_URL) ||
    "http://localhost:3000";
  if (!baseUrl) {
    throw new Error("Unable to resolve relay watchdog base URL.");
  }

  const endpoint = new URL("/api/relay/session", baseUrl).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let responseStatus = 0;
  let payload: RelayStatusResponse | null = null;
  let errorMessage: string | null = null;
  const startedAt = Date.now();

  try {
    const response = await fetch(endpoint, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    responseStatus = response.status;
    payload = (await response.json().catch(() => null)) as RelayStatusResponse | null;
  } catch (error: any) {
    errorMessage =
      typeof error?.message === "string" ? error.message : "relay health request failed";
  } finally {
    clearTimeout(timer);
  }

  const latencyMs = Date.now() - startedAt;
  const healthy =
    !errorMessage &&
    responseStatus === 200 &&
    payload?.ok === true &&
    payload?.available === true &&
    typeof payload?.relayer === "string" &&
    typeof payload?.market === "string";

  if (healthy) {
    console.log("Relay Watchdog PASS");
    console.log(`Endpoint: ${endpoint}`);
    console.log(`Latency:  ${latencyMs}ms`);
    console.log(`Relayer:  ${payload?.relayer}`);
    console.log(`Market:   ${payload?.market}`);
    console.log(`RPC:      ${payload?.rpcUrl ?? "unknown"}`);
    return;
  }

  const reason =
    errorMessage ||
    payload?.error ||
    `Unhealthy relay response (status ${responseStatus || "n/a"})`;

  console.error("Relay Watchdog FAIL");
  console.error(`Endpoint: ${endpoint}`);
  console.error(`Latency:  ${latencyMs}ms`);
  console.error(`Reason:   ${reason}`);

  const webhook =
    normalizeUrl(readArg("webhook-url")) ||
    normalizeUrl(process.env.RELAY_ALERT_WEBHOOK_URL) ||
    normalizeUrl(process.env.ORACLE_ALERT_WEBHOOK_URL);

  if (webhook) {
    try {
      await postJson(webhook, {
        time: new Date().toISOString(),
        level: "error",
        component: "shadowperp-relay",
        key: "relay-session-unhealthy",
        message: "Relay watchdog detected /api/relay/session unhealthy",
        context: {
          endpoint,
          status: responseStatus || null,
          latencyMs,
          reason,
          payload,
        },
      });
      console.error("Alert sent to webhook.");
    } catch (webhookError: any) {
      const webhookMsg =
        typeof webhookError?.message === "string"
          ? webhookError.message
          : "failed to send webhook alert";
      console.error(`Alert delivery failed: ${webhookMsg}`);
    }
  } else {
    console.error(
      "No RELAY_ALERT_WEBHOOK_URL/ORACLE_ALERT_WEBHOOK_URL configured; skipping alert delivery."
    );
  }

  process.exit(1);
}

main().catch((error) => {
  const msg = error instanceof Error ? error.message : String(error);
  console.error(`relay-watchdog failed: ${msg}`);
  process.exit(1);
});

