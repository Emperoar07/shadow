/**
 * Stable trading preflight checks for ShadowPerp devnet.
 *
 * Usage:
 *   npx ts-node scripts/stable-preflight.ts
 *   npx ts-node scripts/stable-preflight.ts --max-oracle-age-seconds 300
 */

import * as anchor from "@coral-xyz/anchor";
import { getArciumProgram, getArciumProgramId } from "@arcium-hq/client";
import {
  Connection,
  Keypair,
  PublicKey,
} from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resolveRpcEndpoint } from "./rpc";

const DEFAULT_MUSDC_MINT = "DbF1Z21WCTbcx5feBB9LNkhtqRE99DZt9ENJT79prHc6";
const BPF_LOADER_UPGRADEABLE_PROGRAM_ID = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111"
);
const DEFAULT_ORACLE_MAX_AGE_SECONDS = 300;
const DEFAULT_PROGRAM_ID = "DBshVTiQcB76wVpS6tLuSXuECZJ6LjqPQajxhEaCyDSD";
const DEFAULT_MARKET = "AwiH92K4RxfhoHpmkiQrwZEBi1ia93x1WrK4uoEchLBJ";

type Check = {
  name: string;
  ok: boolean;
  detail: string;
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

function parsePublicKey(name: string, value?: string): PublicKey {
  const normalize = (raw?: string): string | undefined => {
    if (!raw) return undefined;
    let out = raw.trim();
    if (!out) return undefined;
    if (out.startsWith("<") && out.endsWith(">")) {
      out = out.slice(1, -1).trim();
    }
    if (
      (out.startsWith('"') && out.endsWith('"')) ||
      (out.startsWith("'") && out.endsWith("'"))
    ) {
      out = out.slice(1, -1).trim();
    }
    return out || undefined;
  };

  const normalized = normalize(value);
  if (!normalized) {
    throw new Error(`Missing required value: ${name}`);
  }
  try {
    return new PublicKey(normalized);
  } catch {
    throw new Error(`Invalid public key for ${name}`);
  }
}

function resolveWalletPath(): string {
  if (process.env.SOLANA_WALLET && fs.existsSync(process.env.SOLANA_WALLET)) {
    return process.env.SOLANA_WALLET;
  }
  return path.join(os.homedir(), ".config", "solana", "id.json");
}

function resolveIdlPath(): string {
  const candidates = [
    path.resolve(__dirname, "..", "target", "idl", "shadowperp.json"),
    path.resolve(__dirname, "..", "app", "src", "idl", "shadowperp.json"),
  ];
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) {
    throw new Error(
      "IDL not found at target/idl/shadowperp.json or app/src/idl/shadowperp.json."
    );
  }
  return found;
}

function pickField<T>(value: any, ...keys: string[]): T | undefined {
  for (const key of keys) {
    if (value != null && value[key] !== undefined && value[key] !== null) {
      return value[key] as T;
    }
  }
  return undefined;
}

function toNumber(value: any): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (value && typeof value.toString === "function") {
    return Number(value.toString());
  }
  return Number.NaN;
}

function isCompDefCompleted(account: any): boolean {
  const onchainCompleted =
    account?.circuitSource?.onChain?.[0]?.isCompleted ??
    account?.circuitSource?.onChain?.isCompleted ??
    account?.circuit_source?.on_chain?.[0]?.is_completed ??
    account?.circuit_source?.on_chain?.is_completed ??
    false;
  const offchainSource =
    account?.circuitSource?.offChain ??
    account?.circuit_source?.off_chain ??
    account?.circuitSource?.OffChain ??
    account?.circuit_source?.OffChain;
  return Boolean(onchainCompleted || offchainSource);
}

function formatCheck(check: Check): string {
  return `${check.ok ? "PASS" : "FAIL"}  ${check.name} - ${check.detail}`;
}

async function main(): Promise<void> {
  loadEnvFile(path.resolve(__dirname, "..", "app", ".env.local"));

  const rpcSelection = await resolveRpcEndpoint({
    preferred:
      process.env.SOLANA_RPC_URL || process.env.NEXT_PUBLIC_SOLANA_RPC_URL,
    commitment: "confirmed",
  });
  const rpcUrl = rpcSelection.rpcUrl;
  const programId = parsePublicKey(
    "NEXT_PUBLIC_SHADOWPERP_PROGRAM_ID",
    process.env.SHADOWPERP_PROGRAM_ID ||
      process.env.NEXT_PUBLIC_SHADOWPERP_PROGRAM_ID ||
      DEFAULT_PROGRAM_ID
  );
  const marketPk = parsePublicKey(
    "NEXT_PUBLIC_SHADOWPERP_MARKET_ACCOUNT",
    process.env.SHADOWPERP_MARKET ||
      process.env.NEXT_PUBLIC_SHADOWPERP_MARKET_ACCOUNT ||
      DEFAULT_MARKET
  );
  const expectedCollateralMint = parsePublicKey(
    "NEXT_PUBLIC_MOCKUSDC_MINT",
    process.env.NEXT_PUBLIC_MOCKUSDC_MINT ||
      process.env.NEXT_PUBLIC_SHADOWPERP_COLLATERAL_MINT ||
      DEFAULT_MUSDC_MINT
  );
  const arciumProgramId = parsePublicKey(
    "NEXT_PUBLIC_ARCIUM_PROGRAM_ID",
    process.env.NEXT_PUBLIC_ARCIUM_PROGRAM_ID || getArciumProgramId().toBase58()
  );
  const maxOracleAgeSeconds = Number.parseInt(
    readArg("max-oracle-age-seconds") || `${DEFAULT_ORACLE_MAX_AGE_SECONDS}`,
    10
  );
  if (!Number.isFinite(maxOracleAgeSeconds) || maxOracleAgeSeconds < 1) {
    throw new Error("Invalid --max-oracle-age-seconds");
  }

  const checks: Check[] = [];
  const connection = new Connection(rpcUrl, "confirmed");

  await connection.getLatestBlockhash();
  checks.push({
    name: "RPC",
    ok: true,
    detail: rpcUrl,
  });

  const programInfo = await connection.getAccountInfo(programId);
  checks.push({
    name: "Program account exists",
    ok: programInfo !== null,
    detail: programId.toBase58(),
  });
  if (!programInfo) {
    throw new Error(checks.map(formatCheck).join("\n"));
  }

  const ownerMatches = programInfo.owner.equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID);
  checks.push({
    name: "Program executable + owner",
    ok: Boolean(programInfo.executable) && ownerMatches,
    detail: `executable=${programInfo.executable}, owner=${programInfo.owner.toBase58()}`,
  });

  const marketInfo = await connection.getAccountInfo(marketPk);
  checks.push({
    name: "Market account exists",
    ok: marketInfo !== null,
    detail: marketPk.toBase58(),
  });
  checks.push({
    name: "Market owner",
    ok: Boolean(marketInfo?.owner.equals(programId)),
    detail: marketInfo ? marketInfo.owner.toBase58() : "missing",
  });
  if (!marketInfo) {
    throw new Error(checks.map(formatCheck).join("\n"));
  }

  const walletPath = resolveWalletPath();
  const wallet = fs.existsSync(walletPath)
    ? Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync(walletPath, "utf8"))))
    : null;
  if (wallet) {
    checks.push({
      name: "Operator wallet",
      ok: true,
      detail: `${wallet.publicKey.toBase58()} (${walletPath})`,
    });
  } else {
    checks.push({
      name: "Operator wallet",
      ok: true,
      detail: `not found at ${walletPath}; skipping operator-only checks`,
    });
  }

  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(wallet ?? Keypair.generate()), {
    commitment: "confirmed",
  });
  const idl = JSON.parse(fs.readFileSync(resolveIdlPath(), "utf8"));
  idl.address = programId.toBase58();
  const program = new anchor.Program(idl as anchor.Idl, provider);

  const market = await (program.account as any).market.fetch(marketPk);

  const openCompDef = pickField<PublicKey>(
    market,
    "openPositionCompDef",
    "open_position_comp_def"
  );
  const closeCompDef = pickField<PublicKey>(
    market,
    "closePositionCompDef",
    "close_position_comp_def"
  );
  const liquidationCompDef = pickField<PublicKey>(
    market,
    "liquidationCompDef",
    "liquidation_comp_def"
  );
  const compDefs = [
    { label: "open_position", key: openCompDef },
    { label: "close_position", key: closeCompDef },
    { label: "check_liquidation_v5", key: liquidationCompDef },
  ];

  const arciumProgram = getArciumProgram(provider);
  for (const comp of compDefs) {
    const exists = comp.key instanceof PublicKey;
    checks.push({
      name: `Comp-def pointer (${comp.label})`,
      ok: exists,
      detail: exists ? comp.key!.toBase58() : "missing",
    });
    if (!exists) continue;

    const info = await connection.getAccountInfo(comp.key!);
    checks.push({
      name: `Comp-def account exists (${comp.label})`,
      ok: info !== null,
      detail: comp.key!.toBase58(),
    });
    checks.push({
      name: `Comp-def owner (${comp.label})`,
      ok: Boolean(info?.owner.equals(arciumProgramId)),
      detail: info ? info.owner.toBase58() : "missing",
    });
    if (!info) continue;

    const compDefState = await (arciumProgram.account as any).computationDefinitionAccount.fetch(
      comp.key!
    );
    checks.push({
      name: `Comp-def finalized (${comp.label})`,
      ok: isCompDefCompleted(compDefState),
      detail: isCompDefCompleted(compDefState) ? "completed" : "pending",
    });
  }

  const oraclePriceRaw = toNumber(pickField<any>(market, "oraclePrice", "oracle_price"));
  const lastPriceUpdate = toNumber(
    pickField<any>(market, "lastPriceUpdate", "last_price_update")
  );
  const slot = await connection.getSlot("confirmed");
  const chainTime = await connection.getBlockTime(slot);
  const nowSeconds = Number.isFinite(chainTime)
    ? (chainTime as number)
    : Math.floor(Date.now() / 1000);
  const age = nowSeconds - lastPriceUpdate;
  checks.push({
    name: "Oracle price set",
    ok: Number.isFinite(oraclePriceRaw) && oraclePriceRaw > 0,
    detail: Number.isFinite(oraclePriceRaw)
      ? `$${(oraclePriceRaw / 1_000_000).toFixed(4)}`
      : "invalid",
  });
  checks.push({
    name: "Oracle freshness",
    ok: Number.isFinite(age) && age >= 0 && age <= maxOracleAgeSeconds,
    detail: `age=${age}s (max ${maxOracleAgeSeconds}s)`,
  });

  const priceFeeder = pickField<PublicKey>(market, "priceFeeder", "price_feeder");
  if (priceFeeder) {
    const feederBalanceSol =
      (await connection.getBalance(priceFeeder, "confirmed")) / anchor.web3.LAMPORTS_PER_SOL;
    checks.push({
      name: "Price feeder SOL balance",
      ok: feederBalanceSol >= 0.05,
      detail: `${feederBalanceSol.toFixed(4)} SOL (${priceFeeder.toBase58()})`,
    });
  }

  const collateralMint = pickField<PublicKey>(market, "collateralMint", "collateral_mint");
  if (collateralMint && wallet) {
    const expected = collateralMint.equals(expectedCollateralMint);
    checks.push({
      name: "Collateral mint",
      ok: expected,
      detail: `${collateralMint.toBase58()}${expected ? " (mUSDC)" : ` (expected ${expectedCollateralMint.toBase58()})`}`,
    });

    const ownerAta = getAssociatedTokenAddressSync(collateralMint, wallet.publicKey);
    const ownerAtaInfo = await connection.getParsedAccountInfo(ownerAta, "confirmed");
    if (ownerAtaInfo.value) {
      const bal = await connection.getTokenAccountBalance(ownerAta, "confirmed");
      checks.push({
        name: "Operator mUSDC balance",
        ok: true,
        detail: `${bal.value.uiAmountString ?? "0"} mUSDC in ${ownerAta.toBase58()}`,
      });
    } else {
      checks.push({
        name: "Operator mUSDC balance",
        ok: false,
        detail: `ATA missing (${ownerAta.toBase58()})`,
      });
    }
  } else if (collateralMint) {
    checks.push({
      name: "Operator mUSDC balance",
      ok: true,
      detail: "skipped (operator wallet unavailable in this environment)",
    });
  }

  console.log("ShadowPerp Stable Preflight");
  console.log(`Program: ${programId.toBase58()}`);
  console.log(`Market:  ${marketPk.toBase58()}`);
  console.log(`RPC:     ${rpcUrl}`);
  console.log("");
  for (const check of checks) {
    console.log(formatCheck(check));
  }

  const failures = checks.filter((c) => !c.ok);
  if (failures.length > 0) {
    console.error(`\nPreflight failed: ${failures.length} check(s) failed.`);
    process.exit(1);
  }

  console.log("\nPreflight passed: trading stack is in stable-ready state.");
}

main().catch((error) => {
  console.error("stable-preflight failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
