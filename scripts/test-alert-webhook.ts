import * as fs from "fs";
import * as path from "path";
import * as http from "http";
import * as https from "https";

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
          "User-Agent": "shadowperp-alert-test/1.0",
        },
      },
      (res) => {
        let response = "";
        res.on("data", (chunk) => {
          response += chunk.toString();
        });
        res.on("end", () => {
          if ((res.statusCode ?? 500) >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${response.slice(0, 500)}`));
            return;
          }
          resolve();
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(10_000, () => req.destroy(new Error("Alert request timed out")));
    req.write(body);
    req.end();
  });
}

async function main(): Promise<void> {
  loadEnvFile(path.resolve(__dirname, "..", "app", ".env.local"));
  const webhook = process.env.ORACLE_ALERT_WEBHOOK_URL?.trim();
  if (!webhook) {
    throw new Error(
      "ORACLE_ALERT_WEBHOOK_URL is not set. Add it to app/.env.local (or process env) and retry."
    );
  }

  const payload = {
    time: new Date().toISOString(),
    level: "info",
    component: "shadowperp-oracle",
    key: "manual-test",
    message: "Manual oracle alert webhook test",
    context: {
      source: "scripts/test-alert-webhook.ts",
      environment: process.env.NODE_ENV ?? "development",
    },
  };

  await postJson(webhook, payload);
  console.log("Alert webhook test sent successfully.");
}

main().catch((error) => {
  const msg = error instanceof Error ? error.message : String(error);
  console.error(`alert test failed: ${msg}`);
  process.exit(1);
});

