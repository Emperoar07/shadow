import * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import {
  RescueCipher,
  getClockAccAddress,
  getClusterAccAddress,
  getComputationAccAddress,
  getExecutingPoolAccAddress,
  getFeePoolAccAddress,
  getMXEAccAddress,
  getMXEPublicKey as getArciumMXEPublicKey,
  getMempoolAccAddress,
  x25519,
} from "@arcium-hq/client";
import BN from "bn.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resolveRpcEndpoint } from "./rpc";

const DEFAULT_PROGRAM_ID = "DBshVTiQcB76wVpS6tLuSXuECZJ6LjqPQajxhEaCyDSD";
const DEFAULT_MARKET_ACCOUNT = "AwiH92K4RxfhoHpmkiQrwZEBi1ia93x1WrK4uoEchLBJ";
const DEFAULT_ARCIUM_PROGRAM_ID = "Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ";
const DEFAULT_CLUSTER_OFFSET = 456;
const POSITION_STATUS = {
  Pending: 0,
  Open: 1,
  Closing: 2,
  Closed: 3,
  Liquidated: 4,
  ClosedPendingSettlement: 5,
  LiquidatedPendingSettlement: 6,
} as const;

function readArg(name: string): string | undefined {
  const args = process.argv.slice(2);
  const idx = args.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

function normalizeValue(raw?: string): string | undefined {
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
}

function loadEnvFile(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = normalizeValue(line.slice(idx + 1));
    if (key && value && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function resolveWallet(): Keypair {
  const walletPath =
    process.env.SOLANA_WALLET ||
    path.join(os.homedir(), ".config", "solana", "id.json");
  if (!fs.existsSync(walletPath)) {
    throw new Error(`Wallet not found: ${walletPath}`);
  }
  return Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletPath, "utf8")))
  );
}

function resolveIdlPath(): string {
  const candidates = [
    path.resolve(__dirname, "..", "target", "idl", "shadowperp.json"),
    path.resolve(__dirname, "..", "app", "src", "idl", "shadowperp.json"),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error(
      `IDL not found at ${candidates.join(" or ")}. Run anchor build first if needed.`
    );
  }
  return found;
}

function randomNonce(): Uint8Array {
  return new Uint8Array(require("crypto").randomBytes(16));
}

function randomOffset(): BN {
  return new BN(require("crypto").randomBytes(8), "le");
}

function toStatusNum(status: any): number {
  if (typeof status === "number") return status;
  const key = Object.keys(status || {})[0];
  switch ((key || "").toLowerCase()) {
    case "pending":
      return POSITION_STATUS.Pending;
    case "open":
      return POSITION_STATUS.Open;
    case "closing":
      return POSITION_STATUS.Closing;
    case "closed":
      return POSITION_STATUS.Closed;
    case "liquidated":
      return POSITION_STATUS.Liquidated;
    case "closedpendingsettlement":
      return POSITION_STATUS.ClosedPendingSettlement;
    case "liquidatedpendingsettlement":
      return POSITION_STATUS.LiquidatedPendingSettlement;
    default:
      return -1;
  }
}

function labelForStatus(status: number): string {
  const found = Object.entries(POSITION_STATUS).find(([, value]) => value === status);
  return found?.[0] ?? `unknown(${status})`;
}

function formatUi(value: bigint | number, scale: number): string {
  const numeric = typeof value === "bigint" ? Number(value) : value;
  return (numeric / scale).toFixed(6);
}

async function waitForPositionStatus(
  program: anchor.Program,
  positionAddress: PublicKey,
  acceptedStatuses: number[],
  timeoutMs: number
): Promise<any> {
  const accepted = new Set(acceptedStatuses);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const position = await (program.account as any).position.fetch(positionAddress);
      const status = toStatusNum(position.status);
      if (accepted.has(status)) {
        return position;
      }
    } catch {
      // position might not be readable immediately
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  throw new Error(
    `Position ${positionAddress.toBase58()} did not reach statuses ${acceptedStatuses
      .map(labelForStatus)
      .join(", ")} within ${timeoutMs / 1000}s`
  );
}

async function waitForLiquidationCheckSettlement(
  program: anchor.Program,
  positionAddress: PublicKey,
  timeoutMs: number
): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const position = await (program.account as any).position.fetch(positionAddress);
    const status = toStatusNum(position.status);
    const pending = position.pendingComputationAccount?.toBase58?.() ?? "";
    if (
      pending === PublicKey.default.toBase58() &&
      (status === POSITION_STATUS.Open ||
        status === POSITION_STATUS.LiquidatedPendingSettlement ||
        status === POSITION_STATUS.Liquidated)
    ) {
      return position;
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new Error(
    `Position ${positionAddress.toBase58()} did not settle its liquidation check callback within ${timeoutMs / 1000}s`
  );
}

async function resolveFundingStatePda(
  connection: Connection,
  programId: PublicKey,
  market: PublicKey
): Promise<PublicKey | null> {
  const candidate = PublicKey.findProgramAddressSync(
    [Buffer.from("funding"), market.toBuffer()],
    programId
  )[0];
  const info = await connection.getAccountInfo(candidate);
  return info ? candidate : null;
}

async function sendTransactionWithPolling(
  provider: anchor.AnchorProvider,
  tx: anchor.web3.Transaction
): Promise<string> {
  const latestBlockhash = await provider.connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = latestBlockhash.blockhash;
  tx.feePayer = provider.wallet.publicKey;

  const signed = await provider.wallet.signTransaction(tx);
  const signature = await provider.connection.sendRawTransaction(signed.serialize(), {
    skipPreflight: false,
  });

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const statuses = await provider.connection.getSignatureStatuses([signature]);
    const status = statuses?.value?.[0];
    if (status?.err) {
      throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`);
    }
    if (
      status?.confirmationStatus === "confirmed" ||
      status?.confirmationStatus === "finalized"
    ) {
      return signature;
    }
  }

  throw new Error(
    `Transaction was not confirmed in 60 seconds. Check signature ${signature} manually.`
  );
}

function effectiveMarkPrice(market: any, nowSeconds: number): number {
  const markPrice = Number(market.markPrice ?? market.mark_price ?? 0);
  const lastMarkPriceUpdate = Number(
    market.lastMarkPriceUpdate ?? market.last_mark_price_update ?? 0
  );
  if (markPrice > 0 && lastMarkPriceUpdate > 0 && nowSeconds - lastMarkPriceUpdate < 300) {
    return markPrice;
  }
  return Number(market.oraclePrice ?? market.oracle_price ?? 0);
}

async function ensureMarginBalance(
  program: anchor.Program,
  provider: anchor.AnchorProvider,
  wallet: Keypair,
  marketPk: PublicKey,
  market: any
): Promise<{ marginPda: PublicKey; marginAccount: any; ownerTokenAccount: PublicKey }> {
  const [marginPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("margin"), wallet.publicKey.toBuffer()],
    program.programId
  );
  const ownerTokenAccount = await getAssociatedTokenAddress(
    market.collateralMint,
    wallet.publicKey
  );

  let marginAccount: any = null;
  try {
    marginAccount = await (program.account as any).marginAccount.fetch(marginPda);
  } catch {
    marginAccount = null;
  }

  const available = marginAccount
    ? Number(marginAccount.balance) - Number(marginAccount.lockedBalance ?? marginAccount.locked_balance ?? 0)
    : 0;

  if (available >= 5_000_000) {
    return { marginPda, marginAccount, ownerTokenAccount };
  }

  const depositAmount = new anchor.BN(5_000_000);
  console.log("Depositing 5 USDC collateral to ensure margin account exists...");
  const depositTx = await program.methods
    .depositCollateral(depositAmount)
    .accounts({
      owner: wallet.publicKey,
      market: marketPk,
      marginAccount: marginPda,
      userTokenAccount: ownerTokenAccount,
      vault: market.vault,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .transaction();
  await sendTransactionWithPolling(provider, depositTx);

  marginAccount = await (program.account as any).marginAccount.fetch(marginPda);
  return { marginPda, marginAccount, ownerTokenAccount };
}

async function main() {
  loadEnvFile(path.resolve(__dirname, "..", "app", ".env.local"));

  const rpcUrl =
    readArg("rpc") ||
    (await resolveRpcEndpoint({
      preferred:
        normalizeValue(process.env.SOLANA_RPC_URL) ||
        normalizeValue(process.env.NEXT_PUBLIC_SOLANA_RPC_URL),
    })).rpcUrl;

  const programId = new PublicKey(
    readArg("program") ||
      normalizeValue(process.env.NEXT_PUBLIC_SHADOWPERP_PROGRAM_ID) ||
      normalizeValue(process.env.SHADOWPERP_PROGRAM_ID) ||
      DEFAULT_PROGRAM_ID
  );
  const marketPk = new PublicKey(
    readArg("market") ||
      normalizeValue(process.env.NEXT_PUBLIC_SHADOWPERP_MARKET_ACCOUNT) ||
      normalizeValue(process.env.SHADOWPERP_MARKET) ||
      DEFAULT_MARKET_ACCOUNT
  );
  const arciumProgramId = new PublicKey(
    readArg("arcium-program") ||
      normalizeValue(process.env.NEXT_PUBLIC_ARCIUM_PROGRAM_ID) ||
      DEFAULT_ARCIUM_PROGRAM_ID
  );
  const clusterOffset = Number(
    readArg("cluster-offset") ||
      normalizeValue(process.env.NEXT_PUBLIC_ARCIUM_CLUSTER_OFFSET) ||
      DEFAULT_CLUSTER_OFFSET
  );

  const wallet = resolveWallet();
  const connection = new Connection(rpcUrl, "confirmed");
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(wallet),
    { commitment: "confirmed" }
  );
  anchor.setProvider(provider);

  const idl = JSON.parse(fs.readFileSync(resolveIdlPath(), "utf8"));
  const program = new anchor.Program(
    { ...idl, address: programId.toBase58() } as any,
    provider
  );

  const market = await (program.account as any).market.fetch(marketPk);
  const { marginPda, marginAccount, ownerTokenAccount } = await ensureMarginBalance(
    program,
    provider,
    wallet,
    marketPk,
    market
  );
  const positionIndex = new BN(marginAccount.positionsOpened.toString());
  const [positionPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("position"),
      marketPk.toBuffer(),
      wallet.publicKey.toBuffer(),
      positionIndex.toArrayLike(Buffer, "le", 8),
    ],
    programId
  );

  const clientPrivateKey = x25519.utils.randomPrivateKey
    ? x25519.utils.randomPrivateKey()
    : (x25519.utils as any).randomSecretKey();
  const clientPubKey = x25519.getPublicKey(clientPrivateKey);
  const mxePublicKey = await getArciumMXEPublicKey(provider, programId);
  const sharedSecret = x25519.getSharedSecret(clientPrivateKey, mxePublicKey!);
  const cipher = new RescueCipher(sharedSecret);
  const nonceBytes = randomNonce();
  const nonce = new BN(Buffer.from(nonceBytes), "le");

  const nowSlot = await connection.getSlot("confirmed");
  const nowBlockTime = (await connection.getBlockTime(nowSlot)) ?? Math.floor(Date.now() / 1000);
  const entryPriceRaw = BigInt(effectiveMarkPrice(market, nowBlockTime));
  const leverageRaw = BigInt(2);
  const isLongRaw = BigInt(1);
  const lockedMarginRaw = BigInt(1_000_000);
  const targetNotionalUi =
    (Number(lockedMarginRaw) / 1_000_000) * Number(leverageRaw);
  const sizeRaw = BigInt(
    Math.max(
      1,
      Math.round((targetNotionalUi * 1_000_000_000) / (Number(entryPriceRaw) / 1_000_000))
    )
  );
  const expectedInitialNotionalRaw =
    (sizeRaw * entryPriceRaw) / BigInt(1_000_000_000);
  const expectedInitialMaintenanceRaw =
    (sizeRaw *
      entryPriceRaw *
      BigInt(Number(market.liquidationThreshold ?? market.liquidation_threshold ?? 0))) /
    BigInt(10_000_000_000_000);
  console.log("Validation inputs:");
  console.log(`  entry price: $${formatUi(entryPriceRaw, 1_000_000)}`);
  console.log(`  size: ${formatUi(sizeRaw, 1_000_000_000)} base`);
  console.log(`  leverage: ${leverageRaw.toString()}x`);
  console.log(`  locked margin: $${formatUi(lockedMarginRaw, 1_000_000)}`);
  console.log(`  implied notional: $${formatUi(expectedInitialNotionalRaw, 1_000_000)}`);
  console.log(
    `  expected maintenance: $${formatUi(expectedInitialMaintenanceRaw, 1_000_000)}`
  );
  const encrypted = cipher.encrypt(
    [sizeRaw, entryPriceRaw, leverageRaw, isLongRaw, lockedMarginRaw],
    nonceBytes
  ) as unknown as Uint8Array[];
  const [encSize, encEntry, encLeverage, encIsLong, encMargin] = encrypted.map((buf) =>
    Array.from(buf)
  );

  const [posFundingRefPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("pos-funding"), positionPda.toBuffer()],
    programId
  );
  const openOffset = randomOffset();

  const openAccounts: Record<string, unknown> = {
    owner: wallet.publicKey,
    market: marketPk,
    marginAccount: marginPda,
    position: positionPda,
    fundingState: null,
    posFundingRef: posFundingRefPda,
    mxeAccount: getMXEAccAddress(programId),
    compDefAccount: market.openPositionCompDef,
    clusterAccount: getClusterAccAddress(clusterOffset),
    mempoolAccount: getMempoolAccAddress(clusterOffset),
    executingPool: getExecutingPoolAccAddress(clusterOffset),
    computationAccount: getComputationAccAddress(clusterOffset, openOffset),
    poolAccount: getFeePoolAccAddress(),
    signPdaAccount: PublicKey.findProgramAddressSync(
      [Buffer.from("ArciumSignerAccount")],
      programId
    )[0],
    arciumProgram: arciumProgramId,
    systemProgram: SystemProgram.programId,
    clockAccount: getClockAccAddress(),
  };
  console.log("Opening validation position...");
  const openTx = await program.methods
    .openPosition(
      encSize,
      encEntry,
      encLeverage,
      encIsLong,
      encMargin,
      0,
      new anchor.BN(Number(lockedMarginRaw)),
      true,
      Array.from(clientPubKey),
      nonce,
      openOffset
    )
    .accounts(openAccounts as any)
    .transaction();
  await sendTransactionWithPolling(provider, openTx);

  const opened = await waitForPositionStatus(
    program,
    positionPda,
    [POSITION_STATUS.Open],
    120_000
  );
  console.log(`Opened position ${positionPda.toBase58()} at entry ${Number(entryPriceRaw) / 1_000_000}`);

  console.log("Running liquidation check on healthy position...");
  const liqOffset = randomOffset();
  const liquidationTx = await program.methods
    .checkLiquidation(liqOffset)
    .accounts({
      liquidator: wallet.publicKey,
      market: marketPk,
      position: positionPda,
      marginAccount: marginPda,
      liquidationSettlement: PublicKey.findProgramAddressSync(
        [Buffer.from("liquidation_settlement"), positionPda.toBuffer()],
        programId
      )[0],
      mxeAccount: getMXEAccAddress(programId),
      compDefAccount: market.liquidationCompDef,
      clusterAccount: getClusterAccAddress(clusterOffset),
      mempoolAccount: getMempoolAccAddress(clusterOffset),
      executingPool: getExecutingPoolAccAddress(clusterOffset),
      computationAccount: getComputationAccAddress(clusterOffset, liqOffset),
      poolAccount: getFeePoolAccAddress(),
      signPdaAccount: PublicKey.findProgramAddressSync(
        [Buffer.from("ArciumSignerAccount")],
        programId
      )[0],
      arciumProgram: arciumProgramId,
      systemProgram: SystemProgram.programId,
      clockAccount: getClockAccAddress(),
    })
    .transaction();
  await sendTransactionWithPolling(provider, liquidationTx);

  const afterLiq = await waitForLiquidationCheckSettlement(program, positionPda, 120_000);
  const afterLiqStatus = toStatusNum(afterLiq.status);
  if (afterLiqStatus !== POSITION_STATUS.Open) {
    throw new Error(
      `Expected healthy validation position to remain Open, got ${labelForStatus(afterLiqStatus)} ` +
        `(entry=$${formatUi(entryPriceRaw, 1_000_000)}, size=${formatUi(sizeRaw, 1_000_000_000)} base, ` +
        `margin=$${formatUi(lockedMarginRaw, 1_000_000)}, expected_maintenance=$${formatUi(expectedInitialMaintenanceRaw, 1_000_000)})`
    );
  }
  console.log("Liquidation check passed: healthy position remained Open.");

  console.log("Closing validation position...");
  const closeOffset = randomOffset();
  const marketBeforeClose = await (program.account as any).market.fetch(marketPk);
  const closeSlot = await connection.getSlot("confirmed");
  const closeTime = (await connection.getBlockTime(closeSlot)) ?? Math.floor(Date.now() / 1000);
  const exitPriceRaw = BigInt(effectiveMarkPrice(marketBeforeClose, closeTime));

  const closeTx = await program.methods
    .closePosition(closeOffset)
    .accounts({
      owner: wallet.publicKey,
      market: marketPk,
      position: positionPda,
      marginAccount: marginPda,
      mxeAccount: getMXEAccAddress(programId),
      compDefAccount: marketBeforeClose.closePositionCompDef,
      clusterAccount: getClusterAccAddress(clusterOffset),
      mempoolAccount: getMempoolAccAddress(clusterOffset),
      executingPool: getExecutingPoolAccAddress(clusterOffset),
      computationAccount: getComputationAccAddress(clusterOffset, closeOffset),
      poolAccount: getFeePoolAccAddress(),
      signPdaAccount: PublicKey.findProgramAddressSync(
        [Buffer.from("ArciumSignerAccount")],
        programId
      )[0],
      arciumProgram: arciumProgramId,
      systemProgram: SystemProgram.programId,
      clockAccount: getClockAccAddress(),
    })
    .transaction();
  await sendTransactionWithPolling(provider, closeTx);

  const closedPending = await waitForPositionStatus(
    program,
    positionPda,
    [POSITION_STATUS.ClosedPendingSettlement, POSITION_STATUS.Closed],
    120_000
  );
  const closedPendingStatus = toStatusNum(closedPending.status);
  const expectedRealizedPnl = Number(
    (sizeRaw * (exitPriceRaw - entryPriceRaw) * BigInt(1)) / BigInt(1_000_000_000)
  );
  const expectedFee = Number(
    (sizeRaw * exitPriceRaw * BigInt(Number(marketBeforeClose.tradingFee))) /
      BigInt(10_000_000_000_000)
  );
  const expectedSettlement = Math.max(
    0,
    Number(lockedMarginRaw) + expectedRealizedPnl - expectedFee
  );

  if (Number(closedPending.realizedPnl) !== expectedRealizedPnl) {
    throw new Error(
      `realized_pnl mismatch: expected ${expectedRealizedPnl}, got ${closedPending.realizedPnl}`
    );
  }
  if (closedPendingStatus === POSITION_STATUS.ClosedPendingSettlement) {
    if (Number(closedPending.margin) !== expectedSettlement) {
      throw new Error(
        `settlement mismatch: expected ${expectedSettlement}, got ${closedPending.margin}`
      );
    }
  }
  console.log(
    `Close callback verified: realized_pnl=${expectedRealizedPnl}, fee=${expectedFee}, settlement=${expectedSettlement}`
  );

  const settleAccounts: Record<string, unknown> = {
    payer: wallet.publicKey,
    position: positionPda,
    positionOwner: wallet.publicKey,
    market: marketPk,
    ownerTokenAccount,
    vault: marketBeforeClose.vault,
    sharedVaultAuthority: PublicKey.findProgramAddressSync(
      [Buffer.from("shared_vault_authority"), marketBeforeClose.collateralMint.toBuffer()],
      programId
    )[0],
    posFundingRef: posFundingRefPda,
    fundingState: null,
    tokenProgram: TOKEN_PROGRAM_ID,
  };
  if (closedPendingStatus !== POSITION_STATUS.Closed) {
    const settleTx = await program.methods
      .settleClosePosition()
      .accounts(settleAccounts as any)
      .transaction();
    await sendTransactionWithPolling(provider, settleTx);
  }

  const closed = await waitForPositionStatus(
    program,
    positionPda,
    [POSITION_STATUS.Closed],
    60_000
  );
  console.log(`Final close settlement verified: status=${labelForStatus(toStatusNum(closed.status))}`);
}

main().catch((error) => {
  console.error(
    "validate-devnet-position-cycle failed:",
    error instanceof Error ? error.message : error
  );
  process.exit(1);
});
