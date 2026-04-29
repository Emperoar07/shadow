/**
 * Push current Pyth prices to all ShadowPerp market oracles.
 * Permissionless — anyone can call this, no price_feeder keypair needed.
 *
 * Uses PythSolanaReceiver to:
 *  1. Fetch the latest VAAs from Hermes for all active pairs
 *  2. Post PriceUpdateV2 accounts on-chain
 *  3. Call updatePriceFromPyth on each ShadowPerp market with the corresponding account
 *
 * Usage:
 *   npx ts-node scripts/update-oracle-pyth.ts
 *   npx ts-node scripts/update-oracle-pyth.ts --rpc <URL>
 *   npx ts-node scripts/update-oracle-pyth.ts --once     # single update, no loop
 *   npx ts-node scripts/update-oracle-pyth.ts --loop 30  # update every 30s
 *   npx ts-node scripts/update-oracle-pyth.ts --pair SOL-USD  # single pair
 */
import * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
} from "@solana/web3.js";
import { PythSolanaReceiver } from "@pythnetwork/pyth-solana-receiver";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resolveRpcEndpoint } from "./rpc";
import { TRADING_PAIRS, type TradingPair } from "../app/src/lib/tokens";

const HERMES_ENDPOINT = "https://hermes.pyth.network";

const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_SHADOWPERP_PROGRAM_ID ||
    "34wszdEvGvyAVADY7ozpbdAvAB9zHRBTaT1YsNcpRJdo"
);
const COLLATERAL_MINT = new PublicKey(
  process.env.NEXT_PUBLIC_SHADOWPERP_COLLATERAL_MINT ||
    "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
);

function resolveWalletPath(): string {
  const env = process.env.SOLANA_WALLET;
  if (env && fs.existsSync(env)) return env;
  const def = path.join(os.homedir(), ".config", "solana", "id.json");
  if (!fs.existsSync(def)) throw new Error(`Wallet not found: ${def}`);
  return def;
}

function fetchLocalIdl(): any {
  const paths = [
    path.resolve(process.cwd(), "target", "idl", "shadowperp.json"),
    path.resolve(process.cwd(), "app", "src", "idl", "shadowperp.json"),
  ];
  const found = paths.find((p) => fs.existsSync(p));
  if (!found) throw new Error("IDL not found");
  const idl = JSON.parse(fs.readFileSync(found, "utf8"));
  idl.address = PROGRAM_ID.toBase58();
  return idl;
}

function deriveMarketPda(baseAssetMint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("market"), COLLATERAL_MINT.toBuffer(), baseAssetMint.toBuffer()],
    PROGRAM_ID
  );
  return pda;
}

async function fetchHermesVaas(feedIds: string[]): Promise<string[]> {
  const clean = feedIds.map((id) => (id.startsWith("0x") ? id.slice(2) : id));
  const params = clean.map((id) => `ids[]=${id}`).join("&");
  const url = `${HERMES_ENDPOINT}/v2/updates/price/latest?${params}&encoding=base64`;
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Hermes API error ${resp.status}: ${await resp.text()}`);
  }
  const data = (await resp.json()) as { binary?: { data?: string[] } };
  const vaas: string[] = data?.binary?.data ?? [];
  if (!vaas.length) throw new Error("No VAA data returned from Hermes");
  return vaas;
}

async function pollConfirmation(
  connection: Connection,
  sig: string,
  maxRetries = 30
): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    const status = await connection.getSignatureStatus(sig);
    const value = status?.value;
    if (
      value?.confirmationStatus === "confirmed" ||
      value?.confirmationStatus === "finalized"
    ) {
      if (value.err)
        throw new Error(`Transaction failed: ${JSON.stringify(value.err)}`);
      return;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Transaction not confirmed after ${maxRetries * 2}s`);
}

async function updateAll(
  program: anchor.Program,
  connection: Connection,
  wallet: anchor.Wallet,
  walletKeypair: Keypair,
  activePairs: TradingPair[]
): Promise<void> {
  // Filter to pairs whose market account exists on-chain
  const existingPairs: TradingPair[] = [];
  for (const pair of activePairs) {
    const pda = deriveMarketPda(pair.base.mint);
    const info = await connection.getAccountInfo(pda);
    if (info !== null) {
      existingPairs.push(pair);
    } else {
      console.log(`  [${pair.label}] market not initialized yet — skipping`);
    }
  }

  if (existingPairs.length === 0) {
    console.log("No initialized markets found. Run init-markets.ts first.");
    return;
  }

  console.log(`Updating ${existingPairs.length} market(s) via Pyth...`);

  // Process each pair independently to avoid feed ID mismatches in batched txs
  for (const pair of existingPairs) {
    process.stdout.write(`  [${pair.label}] `);
    try {
      const vaas = await fetchHermesVaas([pair.pythFeedId]);

      const pythReceiver = new PythSolanaReceiver({ connection, wallet });
      const txBuilder = pythReceiver.newTransactionBuilder({
        closeUpdateAccounts: true,
      });

      await txBuilder.addPostPriceUpdates(vaas);

      await txBuilder.addPriceConsumerInstructions(
        async (getPriceUpdateAccount) => {
          const priceUpdate = getPriceUpdateAccount(pair.pythFeedId);
          const marketPda = deriveMarketPda(pair.base.mint);
          const ix = await (program.methods as any)
            .updatePriceFromPyth()
            .accounts({ market: marketPda, priceUpdate })
            .instruction();
          return [{ instruction: ix, signers: [] }];
        }
      );

      const txs = await txBuilder.buildVersionedTransactions({
        computeUnitPriceMicroLamports: 50_000,
        tightComputeBudget: false,
      });

      for (const { tx, signers } of txs) {
        tx.sign([walletKeypair, ...signers]);
        const sig = await connection.sendRawTransaction(tx.serialize(), {
          skipPreflight: false,
        });
        await pollConfirmation(connection, sig);
      }
      console.log("ok");
    } catch (err: any) {
      console.log(`FAILED: ${String(err?.message || err).split("\n")[0]}`);
    }
  }

  console.log("Current prices:");
  for (const pair of existingPairs) {
    try {
      const marketPda = deriveMarketPda(pair.base.mint);
      const market = await (program.account as any).market.fetch(marketPda);
      const raw = market.oraclePrice?.toNumber?.() ?? Number(market.oracle_price);
      const price = (raw / 1_000_000).toFixed(6);
      console.log(`  ${pair.label.padEnd(12)} $${price}`);
    } catch {
      // non-critical
    }
  }
}

async function main() {
  const rpcArg =
    process.argv.find((a) => a.startsWith("--rpc="))?.split("=")[1] ||
    process.argv[process.argv.indexOf("--rpc") + 1] ||
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL;

  const once = process.argv.includes("--once");
  const loopIdx = process.argv.indexOf("--loop");
  const intervalSec =
    loopIdx !== -1 ? parseInt(process.argv[loopIdx + 1], 10) || 30 : 30;

  // Optional --pair filter: e.g. --pair SOL-USD
  const pairFilter = process.argv.find((a) => a.startsWith("--pair="))?.split("=")[1] ||
    (process.argv.includes("--pair") ? process.argv[process.argv.indexOf("--pair") + 1] : undefined);

  const activePairs = pairFilter
    ? TRADING_PAIRS.filter((p) => p.label === pairFilter)
    : TRADING_PAIRS;

  if (activePairs.length === 0) {
    console.error(`No pair matching --pair=${pairFilter}`);
    process.exit(1);
  }

  const rpcSelection = await resolveRpcEndpoint({
    preferred: rpcArg,
    commitment: "confirmed",
  });

  const walletPath = resolveWalletPath();
  const walletKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletPath, "utf8")))
  );
  const connection = new Connection(rpcSelection.rpcUrl, "confirmed");
  const wallet = new anchor.Wallet(walletKeypair);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  const idl = fetchLocalIdl();
  const program = new anchor.Program(idl as anchor.Idl, provider);

  console.log(`RPC:     ${rpcSelection.rpcUrl}`);
  console.log(`Wallet:  ${walletKeypair.publicKey.toBase58()}`);
  console.log(`Pairs:   ${activePairs.map((p) => p.label).join(", ")}`);

  if (once) {
    await updateAll(program, connection, wallet, walletKeypair, activePairs);
    return;
  }

  console.log(`\nRunning in loop mode (every ${intervalSec}s). Ctrl+C to stop.\n`);
  while (true) {
    try {
      await updateAll(program, connection, wallet, walletKeypair, activePairs);
    } catch (err: any) {
      console.error(
        `[${new Date().toISOString()}] Update failed: ${String(
          err?.message || err
        ).split("\n")[0]}`
      );
    }
    await new Promise((r) => setTimeout(r, intervalSec * 1000));
  }
}

main().catch((err) => {
  console.error("update-oracle-pyth failed:", err);
  process.exit(1);
});
