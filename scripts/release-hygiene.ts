import { execSync } from "child_process";

type StatusEntry = {
  code: string;
  path: string;
};

const TEMP_PATTERNS: RegExp[] = [
  /^\.tmp_/,
  /^app\/\.next_bak_/,
  /^app\/node_modules_bak_/,
  /^build\//,
  /^node-v\d+/,
  /^pnpm-\d+.*\.tgz$/,
  /^\.runtime\//,
];

function parseStatus(): StatusEntry[] {
  const out = execSync("git status --porcelain=v1 --untracked-files=all", {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return out
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => ({
      code: line.slice(0, 2),
      path: line.slice(3),
    }));
}

function isTemp(path: string): boolean {
  return TEMP_PATTERNS.some((re) => re.test(path));
}

function main(): void {
  const strict = process.argv.includes("--strict");
  const entries = parseStatus();

  const modified = entries.filter((e) => !e.code.includes("?"));
  const untracked = entries.filter((e) => e.code.includes("?"));
  const temp = entries.filter((e) => isTemp(e.path));

  console.log("Release Hygiene Report");
  console.log(`- Modified tracked files: ${modified.length}`);
  console.log(`- Untracked files: ${untracked.length}`);
  console.log(`- Temp/backup artifacts: ${temp.length}`);

  if (temp.length > 0) {
    console.log("\nTemp/backup artifacts detected:");
    for (const e of temp) console.log(`  - ${e.path}`);
  }

  if (modified.length > 0) {
    console.log("\nTracked changes (top 20):");
    for (const e of modified.slice(0, 20)) console.log(`  - [${e.code}] ${e.path}`);
  }

  if (untracked.length > 0) {
    console.log("\nUntracked files (top 20):");
    for (const e of untracked.slice(0, 20)) console.log(`  - ${e.path}`);
  }

  console.log("\nSuggested commit buckets:");
  console.log("1) oracle/runtime ops scripts + env docs");
  console.log("2) ui updates (market/trading/orderbook components)");
  console.log("3) on-chain program + circuit changes");
  console.log("4) docs/runbooks (DEV_NOTES + architecture docs)");

  if (strict && (modified.length > 0 || untracked.length > 0)) {
    console.error("\nrelease-hygiene strict mode failed: worktree is not clean.");
    process.exit(1);
  }
}

main();

