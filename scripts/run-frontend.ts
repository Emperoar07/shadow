import fs from "fs";
import path from "path";
import { spawn } from "child_process";

function resolvePath(...parts: string[]) {
  return path.resolve(process.cwd(), ...parts);
}

function syncIdl(programName: string) {
  const source = resolvePath("target", "idl", `${programName}.json`);
  const destination = resolvePath("app", "src", "idl", `${programName}.json`);

  if (!fs.existsSync(source)) {
    throw new Error(
      `IDL not found at ${source}. Run anchor/arcium build first.`
    );
  }

  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);

  console.log(`Synced IDL: ${source} -> ${destination}`);
}

function runFrontendDev() {
  const isWindows = process.platform === "win32";
  const command = isWindows ? "pnpm.cmd" : "pnpm";
  const child = spawn(command, ["dev"], {
    cwd: resolvePath("app"),
    stdio: "inherit",
    env: process.env,
  });

  child.on("exit", (code) => {
    process.exit(code ?? 0);
  });
}

function main() {
  const args = new Set(process.argv.slice(2));
  const programName = "shadowperp";

  syncIdl(programName);

  if (args.has("--sync-only")) {
    return;
  }

  runFrontendDev();
}

main();
