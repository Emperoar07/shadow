/**
 * Verifies all markets have their comp-def fields populated and the
 * referenced comp-def accounts actually exist on-chain.
 *
 * Usage: npx ts-node scripts/verify-markets.ts
 */
import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import { resolveRpcEndpoint } from "./rpc";
import { TRADING_PAIRS } from "../app/src/lib/tokens";

const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_SHADOWPERP_PROGRAM_ID ||
    "DBshVTiQcB76wVpS6tLuSXuECZJ6LjqPQajxhEaCyDSD"
);
const COLLATERAL_MINT = new PublicKey(
  process.env.NEXT_PUBLIC_SHADOWPERP_COLLATERAL_MINT ||
    process.env.NEXT_PUBLIC_MOCKUSDC_MINT ||
    "DbF1Z21WCTbcx5feBB9LNkhtqRE99DZt9ENJT79prHc6"
);

function deriveMarketPda(base: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("market"), COLLATERAL_MINT.toBuffer(), base.toBuffer()],
    PROGRAM_ID
  );
  return pda;
}

async function main() {
  const rpcSelection = await resolveRpcEndpoint({
    preferred: process.env.NEXT_PUBLIC_SOLANA_RPC_URL,
    commitment: "confirmed",
  });
  const connection = new Connection(rpcSelection.rpcUrl, "confirmed");
  const dummy = anchor.web3.Keypair.generate();
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(dummy), {
    commitment: "confirmed",
  });

  const idlPath = [
    path.resolve(process.cwd(), "target", "idl", "shadowperp.json"),
    path.resolve(process.cwd(), "app", "src", "idl", "shadowperp.json"),
  ].find((p) => fs.existsSync(p));
  if (!idlPath) throw new Error("IDL not found");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));
  idl.address = PROGRAM_ID.toBase58();
  const program = new anchor.Program(idl, provider);

  console.log("RPC:", rpcSelection.rpcUrl);
  console.log("Program:", PROGRAM_ID.toBase58());
  console.log("Collateral:", COLLATERAL_MINT.toBase58());
  console.log("");

  for (const pair of TRADING_PAIRS) {
    const marketPda = deriveMarketPda(pair.base.mint);
    console.log(`=== ${pair.label}  ${marketPda.toBase58()} ===`);

    const info = await connection.getAccountInfo(marketPda);
    if (!info) {
      console.log("  MARKET NOT FOUND on-chain");
      continue;
    }
    console.log(`  market exists  owner=${info.owner.toBase58().slice(0, 12)}...  size=${info.data.length}`);

    let market: any;
    try {
      market = await (program.account as any).market.fetch(marketPda);
    } catch (e: any) {
      console.log(`  failed to deserialize: ${e?.message?.split("\n")[0]}`);
      continue;
    }

    const fields = [
      ["openPositionCompDef", market.openPositionCompDef ?? market.open_position_comp_def],
      ["closePositionCompDef", market.closePositionCompDef ?? market.close_position_comp_def],
      ["liquidationCompDef", market.liquidationCompDef ?? market.liquidation_comp_def],
      ["seedOpenInterestCompDef", market.seedOpenInterestCompDef ?? market.seed_open_interest_comp_def],
    ] as const;

    for (const [name, value] of fields) {
      if (!value) {
        console.log(`  ${name}: NULL/UNSET`);
        continue;
      }
      const pk = value as PublicKey;
      const isZero = pk.equals(PublicKey.default);
      if (isZero) {
        console.log(`  ${name}: ZERO ADDRESS`);
        continue;
      }
      const compDefInfo = await connection.getAccountInfo(pk);
      const status = compDefInfo
        ? `EXISTS (owner=${compDefInfo.owner.toBase58().slice(0, 12)}..., size=${compDefInfo.data.length})`
        : "POINTER SET BUT ACCOUNT MISSING (this would cause 3007)";
      console.log(`  ${name}: ${pk.toBase58().slice(0, 16)}...  ${status}`);
    }

    const cluster = market.mxeCluster ?? market.mxe_cluster;
    console.log(`  mxeCluster: ${cluster?.toBase58()?.slice(0, 16) ?? "NULL"}...`);
    const oraclePrice = market.oraclePrice ?? market.oracle_price;
    const lastUpdate = market.lastPriceUpdate ?? market.last_price_update;
    console.log(`  oraclePrice: ${oraclePrice?.toString() ?? "?"}, lastUpdate: ${lastUpdate?.toString() ?? "?"}`);
    console.log("");
  }
}

main().catch((e) => {
  console.error("verify-markets failed:", e);
  process.exit(1);
});
