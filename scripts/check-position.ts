import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

const POSITION_STATUS = {
  0: "Pending",
  1: "Open",
  2: "Closing",
  3: "Closed",
  4: "Liquidated",
  5: "ClosedPendingSettlement",
  6: "LiquidatedPendingSettlement",
};

async function check(positionPk: PublicKey, label: string) {
  const rpcUrl = "https://devnet.helius-rpc.com/?api-key=b077c7fc-8625-488f-93fd-1daf8de886c1";
  const connection = new Connection(rpcUrl, "confirmed");
  const programId = new PublicKey("5Va2JgK2M2kwkoPdwX4RTjfaqwAXgd5hHSWEP5QS848T");

  const idlPath = path.resolve(__dirname, "..", "target", "idl", "shadowperp.json");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
  
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(anchor.web3.Keypair.generate()),
    { commitment: "confirmed" }
  );
  
  const program = new anchor.Program(
    { ...idl, address: programId.toBase58() } as any,
    provider
  );

  try {
    const position = await (program.account as any).position.fetch(positionPk);
    const statusObj = position.status;
    const statusStr = Object.keys(statusObj || {})[0];
    console.log(`[${label}] Position Status:`, statusStr);
    console.log(`[${label}] Pending computation account:`, position.pendingComputationAccount?.toBase58());
  } catch (err: any) {
    console.error(`[${label}] Failed to fetch position:`, err.message);
  }
}

async function main() {
  await check(new PublicKey("FTLzGK7enerizMYKfkNWsaz28As8ZjwHWuC81wF8PF6P"), "Pos New");
}

main();
