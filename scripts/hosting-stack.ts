import { spawn, spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

type Command = "start" | "stop" | "status" | "restart";

type ProcessState = {
  pid: number;
  logFile: string;
  startedAt: string;
};

type HostingState = {
  app?: ProcessState;
  oracle?: ProcessState;
};

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = path.join(ROOT, ".runtime");
const STATE_FILE = path.join(RUNTIME_DIR, "hosting-stack.json");
const APP_LOG = path.join(RUNTIME_DIR, "app-dev.log");
const ORACLE_LOG = path.join(RUNTIME_DIR, "oracle-daemon.log");

function ensureRuntimeDir(): void {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
}

function readState(): HostingState {
  if (!fs.existsSync(STATE_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as HostingState;
  } catch {
    return {};
  }
}

function writeState(state: HostingState): void {
  ensureRuntimeDir();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function stopPidTree(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return true;
  if (!isAlive(pid)) return true;

  if (process.platform === "win32") {
    const killed = spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
    });
    return killed.status === 0;
  }

  try {
    process.kill(-pid, "SIGTERM");
    return true;
  } catch {
    try {
      process.kill(pid, "SIGTERM");
      return true;
    } catch {
      return false;
    }
  }
}

function startDetached(
  command: string,
  args: string[],
  logFile: string,
  cwd: string
): ProcessState {
  ensureRuntimeDir();
  const outFd = fs.openSync(logFile, "a");
  const child = spawn(command, args, {
    cwd,
    env: process.env,
    detached: true,
    stdio: ["ignore", outFd, outFd],
    windowsHide: true,
  });
  child.unref();
  fs.closeSync(outFd);
  return {
    pid: child.pid ?? -1,
    logFile,
    startedAt: new Date().toISOString(),
  };
}

function cleanupState(state: HostingState): HostingState {
  const next = { ...state };
  if (next.app && !isAlive(next.app.pid)) delete next.app;
  if (next.oracle && !isAlive(next.oracle.pid)) delete next.oracle;
  return next;
}

function start(): void {
  let state = cleanupState(readState());

  if (!state.oracle) {
    state.oracle = startDetached(
      process.execPath,
      ["-r", "ts-node/register/transpile-only", path.join(__dirname, "price-oracle.ts")],
      ORACLE_LOG,
      ROOT
    );
    console.log(`oracle: started (pid=${state.oracle.pid})`);
  } else {
    console.log(`oracle: already running (pid=${state.oracle.pid})`);
  }

  if (!state.app) {
    const appPort = process.env.HOSTING_APP_PORT?.trim() || "3000";
    const nextBin = path.join(ROOT, "app", "node_modules", "next", "dist", "bin", "next");
    const appCommand = process.execPath;
    const appArgs = fs.existsSync(nextBin)
      ? [nextBin, "dev", "--hostname", "0.0.0.0", "--port", appPort]
      : [path.join(__dirname, "run-frontend.ts")];
    state.app = startDetached(
      appCommand,
      appArgs,
      APP_LOG,
      fs.existsSync(nextBin) ? path.join(ROOT, "app") : ROOT
    );
    console.log(`app: started (pid=${state.app.pid}, port=${appPort})`);
  } else {
    console.log(`app: already running (pid=${state.app.pid})`);
  }

  writeState(state);
  console.log(`state: ${STATE_FILE}`);
  console.log(`logs:  ${ORACLE_LOG}`);
  console.log(`logs:  ${APP_LOG}`);
}

function stop(): void {
  const state = readState();
  let changed = false;

  if (state.app) {
    const ok = stopPidTree(state.app.pid);
    console.log(ok ? `app: stopped (pid=${state.app.pid})` : `app: failed to stop pid=${state.app.pid}`);
    if (ok) {
      delete state.app;
      changed = true;
    }
  } else {
    console.log("app: already stopped");
  }

  if (state.oracle) {
    const ok = stopPidTree(state.oracle.pid);
    console.log(
      ok ? `oracle: stopped (pid=${state.oracle.pid})` : `oracle: failed to stop pid=${state.oracle.pid}`
    );
    if (ok) {
      delete state.oracle;
      changed = true;
    }
  } else {
    console.log("oracle: already stopped");
  }

  if (!state.app && !state.oracle) {
    if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
  } else if (changed) {
    writeState(state);
  }
}

function status(): void {
  const state = cleanupState(readState());
  writeState(state);

  if (!state.app && !state.oracle) {
    if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
    console.log("hosting: stopped");
    return;
  }

  if (state.app) {
    console.log(`app: running (pid=${state.app.pid}) log=${state.app.logFile}`);
  } else {
    console.log("app: stopped");
  }
  if (state.oracle) {
    console.log(`oracle: running (pid=${state.oracle.pid}) log=${state.oracle.logFile}`);
  } else {
    console.log("oracle: stopped");
  }
}

function main(): void {
  const command = (process.argv[2] as Command | undefined) ?? "status";
  if (!["start", "stop", "status", "restart"].includes(command)) {
    console.error("Usage: npx ts-node scripts/hosting-stack.ts <start|stop|status|restart>");
    process.exit(1);
  }

  if (command === "start") return start();
  if (command === "stop") return stop();
  if (command === "restart") {
    stop();
    return start();
  }
  return status();
}

main();
