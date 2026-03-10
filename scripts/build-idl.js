#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith("--")) continue;
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      args[key.slice(2)] = true;
      continue;
    }
    args[key.slice(2)] = value;
    i += 1;
  }
  return args;
}

function convertModulePaths(idl) {
  const original = JSON.stringify(idl);
  const re = /"(\w+::)+(\w+)"/g;
  let result = original;
  let match;

  while ((match = re.exec(original)) !== null) {
    const fullPath = match[0];
    const name = match[2];
    const replaced = result.replaceAll(fullPath, `"${name}"`);
    const conflict = new RegExp(`"(\\\\w+::)+${name}"`).test(replaced);
    if (!conflict) {
      result = replaced;
    }
  }

  return JSON.parse(result);
}

function sortByName(items) {
  if (!Array.isArray(items)) return [];
  return [...items].sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

function buildIdl(programPath, outPath) {
  const env = {
    ...process.env,
    ANCHOR_IDL_BUILD_NO_DOCS: process.env.ANCHOR_IDL_BUILD_NO_DOCS || "FALSE",
    ANCHOR_IDL_BUILD_RESOLUTION:
      process.env.ANCHOR_IDL_BUILD_RESOLUTION || "TRUE",
    ANCHOR_IDL_BUILD_SKIP_LINT:
      process.env.ANCHOR_IDL_BUILD_SKIP_LINT || "FALSE",
    ANCHOR_IDL_BUILD_PROGRAM_PATH: programPath,
    RUSTFLAGS: process.env.RUSTFLAGS || "--cfg procmacro2_semver_exempt -A warnings",
  };

  const result = spawnSync(
    "cargo",
    [
      "+nightly",
      "test",
      "__anchor_private_print_idl",
      "--features",
      "idl-build",
      "--",
      "--show-output",
      "--quiet",
    ],
    {
      cwd: programPath,
      env,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    }
  );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.stderr.write(result.stderr || "");
    process.stdout.write(result.stdout || "");
    throw new Error(`IDL cargo test failed with status ${result.status}`);
  }

  const stdout = result.stdout || "";
  const lines = stdout.split(/\r?\n/);

  let address = "";
  let constants = [];
  let events = [];
  let errors = [];
  let types = new Map();
  let idl = null;
  let state = { kind: "pass", lines: [] };

  const finalizeProgram = () => {
    if (!idl) return;
    idl.address = address;
    idl.constants = constants;
    idl.events = events;
    idl.errors = errors;
    const programTypes = Array.isArray(idl.types) ? idl.types : [];
    const merged = new Map(types);
    for (const ty of programTypes) {
      merged.set(ty.name, ty);
    }
    idl.types = Array.from(merged.values());
  };

  for (const line of lines) {
    switch (state.kind) {
      case "pass":
        if (line === "--- IDL begin address ---") {
          state = { kind: "address", lines: [] };
        } else if (line === "--- IDL begin const ---") {
          state = { kind: "const", lines: [] };
        } else if (line === "--- IDL begin event ---") {
          state = { kind: "event", lines: [] };
        } else if (line === "--- IDL begin errors ---") {
          state = { kind: "errors", lines: [] };
        } else if (line === "--- IDL begin program ---") {
          state = { kind: "program", lines: [] };
        } else if (
          line.startsWith("test result: ok") &&
          !line.startsWith("test result: ok. 0 passed; 0 failed; 0")
        ) {
          finalizeProgram();
        }
        break;
      case "address":
        address = line.replace(/[^a-zA-Z0-9]/g, "");
        state = { kind: "pass", lines: [] };
        break;
      case "const":
        if (line === "--- IDL end const ---") {
          constants.push(JSON.parse(state.lines.join("\n")));
          state = { kind: "pass", lines: [] };
        } else {
          state.lines.push(line);
        }
        break;
      case "event":
        if (line === "--- IDL end event ---") {
          const eventPrint = JSON.parse(state.lines.join("\n"));
          events.push(eventPrint.event);
          for (const ty of eventPrint.types || []) {
            types.set(ty.name, ty);
          }
          state = { kind: "pass", lines: [] };
        } else {
          state.lines.push(line);
        }
        break;
      case "errors":
        if (line === "--- IDL end errors ---") {
          errors = JSON.parse(state.lines.join("\n"));
          state = { kind: "pass", lines: [] };
        } else {
          state.lines.push(line);
        }
        break;
      case "program":
        if (line === "--- IDL end program ---") {
          idl = JSON.parse(state.lines.join("\n"));
          state = { kind: "pass", lines: [] };
        } else {
          state.lines.push(line);
        }
        break;
      default:
        throw new Error(`Unknown parser state: ${state.kind}`);
    }
  }

  finalizeProgram();

  if (!idl) {
    throw new Error("IDL markers were found, but the program block was not parsed");
  }

  idl = convertModulePaths(idl);
  idl.accounts = sortByName(idl.accounts);
  idl.constants = sortByName(idl.constants);
  idl.events = sortByName(idl.events);
  idl.instructions = sortByName(idl.instructions);
  idl.types = sortByName(idl.types);

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(idl, null, 2)}\n`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const programPath = path.resolve(args["program-path"] || process.cwd());
  const outPath = path.resolve(args.out || path.join(programPath, "target", "idl", "shadowperp.json"));
  buildIdl(programPath, outPath);
  console.log(`IDL written to ${outPath}`);
}

main();
