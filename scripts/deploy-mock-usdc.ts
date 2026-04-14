/**
 * Deploy MockUSDC on Solana devnet.
 *
 * - Creates a new SPL token mint with 6 decimals named "Mock USDC (Shadow)"
 * - Mints 5,000,000,000 MOCKUSDC to the deployer's ATA
 * - Saves the mint address to scripts/mock-usdc.json
 *
 * Usage:
 *   npx ts-node scripts/deploy-mock-usdc.ts
 *
 * Re-run safe — skips if mock-usdc.json already has a valid on-chain mint.
 */
import * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getMint,
  TOKEN_PROGRAM_ID,
  createInitializeMintInstruction,
  createInitializeAccountInstruction,
  MINT_SIZE,
  getMinimumBalanceForRentExemptMint,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddress,
  MintLayout,
} from "@solana/spl-token";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resolveRpcEndpoint } from "./rpc";

const OUTPUT_FILE = path.resolve(process.cwd(), "scripts", "mock-usdc.json");
const DECIMALS = 6;
const TOTAL_SUPPLY = 5_000_000_000; // 5 billion MOCKUSDC

function resolveWalletPath(): string {
  const env = process.env.SOLANA_WALLET;
  if (env && fs.existsSync(env)) return env;
  const def = path.join(os.homedir(), ".config", "solana", "id.json");
  if (!fs.existsSync(def)) throw new Error(`Wallet not found at ${def}. Set SOLANA_WALLET env var.`);
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
  const payer = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletPath, "utf8")))
  );

  const connection = new Connection(rpcSelection.rpcUrl, "confirmed");

  console.log(`RPC:    ${rpcSelection.rpcUrl}`);
  console.log(`Payer:  ${payer.publicKey.toBase58()}`);

  // Check if already deployed
  if (fs.existsSync(OUTPUT_FILE)) {
    const existing = JSON.parse(fs.readFileSync(OUTPUT_FILE, "utf8"));
    if (existing.mint) {
      try {
        const mintInfo = await getMint(connection, new PublicKey(existing.mint));
        console.log(`\nMockUSDC already deployed: ${existing.mint}`);
        console.log(`Supply: ${Number(mintInfo.supply) / 10 ** DECIMALS} MOCKUSDC`);
        console.log(`\nNothing to do. Delete ${OUTPUT_FILE} to redeploy.`);
        return;
      } catch {
        console.log(`Saved mint ${existing.mint} not found on-chain — redeploying...`);
      }
    }
  }

  // Create the mint
  console.log(`\nCreating MockUSDC mint (${DECIMALS} decimals)...`);
  const mint = await createMint(
    connection,
    payer,
    payer.publicKey, // mint authority
    payer.publicKey, // freeze authority (keep so we can freeze bad actors later)
    DECIMALS
  );
  console.log(`Mint created: ${mint.toBase58()}`);

  // Create deployer ATA and mint full supply
  console.log(`Creating deployer ATA...`);
  const deployerAta = await getOrCreateAssociatedTokenAccount(
    connection,
    payer,
    mint,
    payer.publicKey
  );
  console.log(`Deployer ATA: ${deployerAta.address.toBase58()}`);

  const mintAmount = BigInt(TOTAL_SUPPLY) * BigInt(10 ** DECIMALS);
  console.log(`Minting ${TOTAL_SUPPLY.toLocaleString()} MOCKUSDC to deployer...`);
  await mintTo(
    connection,
    payer,
    mint,
    deployerAta.address,
    payer, // mint authority
    mintAmount
  );
  console.log(`Minted successfully.`);

  // Save output
  const output = {
    mint: mint.toBase58(),
    decimals: DECIMALS,
    totalSupply: TOTAL_SUPPLY,
    deployerAta: deployerAta.address.toBase58(),
    mintAuthority: payer.publicKey.toBase58(),
    deployedAt: new Date().toISOString(),
    note: "MockUSDC for ShadowPerp devnet — replace USDC collateral mint with this address",
  };
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));

  console.log(`\n✓ MockUSDC deployed successfully!`);
  console.log(`  Mint:    ${mint.toBase58()}`);
  console.log(`  Supply:  ${TOTAL_SUPPLY.toLocaleString()} MOCKUSDC`);
  console.log(`  Saved:   ${OUTPUT_FILE}`);
  console.log(`\nNext steps:`);
  console.log(`  1. Update NEXT_PUBLIC_MOCKUSDC_MINT=${mint.toBase58()} in app/.env.local`);
  console.log(`  2. Run: npx ts-node scripts/deploy-mock-usdc.ts --fund-faucet`);
  console.log(`  3. Redeploy program if collateral_mint PDA needs updating`);
}

main().catch((err) => {
  console.error("deploy-mock-usdc failed:", err);
  process.exit(1);
});
