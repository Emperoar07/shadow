/**
 * Create placeholder SPL token mints on devnet for tokens whose mainnet mints
 * don't exist on devnet. These are used purely as PDA seeds for market accounts.
 *
 * Outputs a JSON file with the created mint addresses for use in init-markets.ts
 * and tokens.ts updates.
 *
 * Safe to re-run — skips mints that are already created.
 *
 * Usage:
 *   npx ts-node scripts/create-devnet-mints.ts
 */
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { createMint, getMint } from "@solana/spl-token";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resolveRpcEndpoint } from "./rpc";

// Tokens whose mainnet mints don't exist on devnet — need placeholders
// Symbol -> { decimals, mainnetMint }
const MISSING_DEVNET_MINTS: Record<string, { decimals: number; mainnetMint: string }> = {
  WIF:    { decimals: 6,  mainnetMint: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm" },
  JUP:    { decimals: 6,  mainnetMint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN" },
  BTC:    { decimals: 8,  mainnetMint: "3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh" },
  ETH:    { decimals: 8,  mainnetMint: "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs" },
  PYTH:   { decimals: 6,  mainnetMint: "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3" },
  RAY:    { decimals: 6,  mainnetMint: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R" },
  ORCA:   { decimals: 6,  mainnetMint: "orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE" },
  W:      { decimals: 6,  mainnetMint: "85VBFQZC9TZkfaptBWjvUw7YbZjy52A6mjtPGjstQAmQ" },
  JTO:    { decimals: 9,  mainnetMint: "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL" },
  RENDER: { decimals: 8,  mainnetMint: "rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof" },
};

const OUTPUT_FILE = path.resolve(process.cwd(), "scripts", "devnet-mints.json");

function resolveWalletPath(): string {
  const env = process.env.SOLANA_WALLET;
  if (env && fs.existsSync(env)) return env;
  const def = path.join(os.homedir(), ".config", "solana", "id.json");
  if (!fs.existsSync(def)) throw new Error(`Wallet not found: ${def}`);
  return def;
}

async function main() {
  const rpcArg =
    process.argv.find((a) => a.startsWith("--rpc="))?.split("=")[1] ||
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL;

  const rpcSelection = await resolveRpcEndpoint({
    preferred: rpcArg,
    commitment: "confirmed",
  });

  const walletPath = resolveWalletPath();
  const walletKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletPath, "utf8")))
  );
  const connection = new Connection(rpcSelection.rpcUrl, "confirmed");

  console.log(`RPC:    ${rpcSelection.rpcUrl}`);
  console.log(`Wallet: ${walletKeypair.publicKey.toBase58()}`);

  // Load existing devnet mints if any
  let existing: Record<string, string> = {};
  if (fs.existsSync(OUTPUT_FILE)) {
    existing = JSON.parse(fs.readFileSync(OUTPUT_FILE, "utf8"));
    console.log(`\nLoaded ${Object.keys(existing).length} existing devnet mint(s) from ${OUTPUT_FILE}`);
  }

  const result: Record<string, string> = { ...existing };

  for (const [symbol, { decimals }] of Object.entries(MISSING_DEVNET_MINTS)) {
    if (result[symbol]) {
      // Verify it still exists on-chain
      try {
        await getMint(connection, new PublicKey(result[symbol]));
        console.log(`[${symbol}] already exists: ${result[symbol]}`);
        continue;
      } catch {
        console.log(`[${symbol}] saved mint not found on-chain, recreating...`);
        delete result[symbol];
      }
    }

    process.stdout.write(`[${symbol}] creating mint (${decimals} decimals)... `);
    try {
      const mint = await createMint(
        connection,
        walletKeypair,
        walletKeypair.publicKey, // mint authority
        null,                    // freeze authority
        decimals
      );
      result[symbol] = mint.toBase58();
      console.log(mint.toBase58());
    } catch (err: any) {
      console.error(`FAILED: ${err?.message?.split("\n")[0]}`);
    }
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(result, null, 2));
  console.log(`\nSaved to ${OUTPUT_FILE}`);
  console.log("\nDevnet mint addresses:");
  for (const [sym, addr] of Object.entries(result)) {
    console.log(`  ${sym.padEnd(8)} ${addr}`);
  }
  console.log("\nNext: update app/src/lib/tokens.ts with these addresses, then run init-markets.ts");
}

main().catch((err) => {
  console.error("create-devnet-mints failed:", err);
  process.exit(1);
});
