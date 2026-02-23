import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";

type Cmd = "start" | "stop" | "status";

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = path.join(ROOT, ".runtime");
const PID_FILE = path.join(RUNTIME_DIR, "oracle-daemon.pid");
const LOG_FILE = path.join(RUNTIME_DIR, "oracle-daemon.log");

function ensureRuntimeDir(): void {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
}

function readPid(): number | null {
  if (!fs.existsSync(PID_FILE)) return null;
  const raw = fs.readFileSync(PID_FILE, "utf8").trim();
  const pid = Number.parseInt(raw, 10);
  return Number.isFinite(pid) && pid > 0 ? pid : null;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function status(): void {
  const pid = readPid();
  if (!pid) {
    console.log("oracle-daemon: stopped (no pid file)");
    return;
  }
  if (!isAlive(pid)) {
    console.log(`oracle-daemon: stale pid file (${pid}), process not running`);
    return;
  }
  console.log(`oracle-daemon: running (pid=${pid})`);
  console.log(`log: ${LOG_FILE}`);
}

function start(): void {
  ensureRuntimeDir();

  const existingPid = readPid();
  if (existingPid && isAlive(existingPid)) {
    console.log(`oracle-daemon: already running (pid=${existingPid})`);
    console.log(`log: ${LOG_FILE}`);
    return;
  }

  const outFd = fs.openSync(LOG_FILE, "a");
  const child = spawn(
    process.execPath,
    ["-r", "ts-node/register/transpile-only", path.join(__dirname, "price-oracle.ts")],
    {
      cwd: ROOT,
      detached: true,
      stdio: ["ignore", outFd, outFd],
      env: process.env,
    }
  );
  child.unref();
  fs.closeSync(outFd);
  fs.writeFileSync(PID_FILE, String(child.pid), "utf8");
  console.log(`oracle-daemon: started (pid=${child.pid})`);
  console.log(`log: ${LOG_FILE}`);
}

function stop(): void {
  const pid = readPid();
  if (!pid) {
    console.log("oracle-daemon: already stopped");
    return;
  }
  if (!isAlive(pid)) {
    fs.unlinkSync(PID_FILE);
    console.log(`oracle-daemon: removed stale pid file (${pid})`);
    return;
  }
  try {
    process.kill(pid);
    fs.unlinkSync(PID_FILE);
    console.log(`oracle-daemon: stopped (pid=${pid})`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`oracle-daemon: failed to stop pid ${pid}: ${msg}`);
    process.exit(1);
  }
}

function main(): void {
  const cmd = (process.argv[2] as Cmd | undefined) ?? "status";
  if (!["start", "stop", "status"].includes(cmd)) {
    console.error("Usage: npx ts-node scripts/oracle-daemon.ts <start|stop|status>");
    process.exit(1);
  }
  if (cmd === "start") return start();
  if (cmd === "stop") return stop();
  status();
}

main();

