import fs from "fs";
import os from "os";
import path from "path";
import { Program, AnchorProvider, Wallet, BN } from "@coral-xyz/anchor";
import { PublicKey, Connection, Keypair, Transaction, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import {
  ARCIUM_ADDR,
  getClusterAccAddress,
  getExecutingPoolAccAddress,
  getFeePoolAccAddress,
  getMempoolAccAddress,
  getComputationAccAddress,
  getClockAccAddress,
  getMXEAccAddress,
  getMXEPublicKey as getArciumMXEPublicKey,
  RescueCipher,
  x25519,
} from "@arcium-hq/client";
import shadowperpIdl from "./idl/shadowperp.json";

// ── Inline types ──────────────────────────────────────────────────────────────

export type ShadowPerpConfig = {
  programId: PublicKey;
  arciumProgramId: PublicKey;
  mxeProgramId: PublicKey;
  clusterOffset: number;
  clusterAddress: PublicKey;
  marketAddress: PublicKey;
  marketRegistry: Record<string, PublicKey>;
  mempoolAccount: PublicKey;
  executingPool: PublicKey;
  poolAccount: PublicKey;
  signPdaAccount: PublicKey;
  idl: any;
};

// ── Inline trading pairs ──────────────────────────────────────────────────────

const USDC_MINT = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const SOL_MINT  = new PublicKey("So11111111111111111111111111111111111111112");
const BTC_MINT  = new PublicKey("3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh");
const ETH_MINT  = new PublicKey("7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs");
const JUP_MINT  = new PublicKey("JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN");
const PYTH_MINT = new PublicKey("HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3");

const TRADING_PAIRS = [
  { label: "SOL-USD",  base: { mint: SOL_MINT } },
  { label: "BTC-USD",  base: { mint: BTC_MINT } },
  { label: "ETH-USD",  base: { mint: ETH_MINT } },
  { label: "JUP-USD",  base: { mint: JUP_MINT } },
  { label: "PYTH-USD", base: { mint: PYTH_MINT } },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

const DEFAULT_CLUSTER_OFFSET = 456;
const DEFAULT_RPC_ENDPOINT   = "https://api.devnet.solana.com";
const DEFAULT_COLLATERAL_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

type RpcTransport = { rpcUrl: string; wsUrl: string };

export type RelayRuntimeSummary = {
  programId: string;
  marketAddress: string;
  clusterOffset: number;
  rpcHost: string;
  wsHost: string;
  rpcCandidates: string[];
};

function normalize(value?: string): string | undefined {
  if (!value) return undefined;
  let out = value.trim();
  if (!out) return undefined;
  if (out.startsWith("<") && out.endsWith(">")) out = out.slice(1, -1).trim();
  if (
    (out.startsWith('"') && out.endsWith('"')) ||
    (out.startsWith("'") && out.endsWith("'"))
  ) {
    out = out.slice(1, -1).trim();
  }
  return out || undefined;
}

function parsePublicKey(name: string, fallback?: string): PublicKey {
  const raw = normalize(process.env[name]) || normalize(fallback);
  if (!raw) throw new Error(`Missing required env var: ${name}`);
  try {
    return new PublicKey(raw);
  } catch {
    throw new Error(`Invalid public key in env var: ${name}`);
  }
}

function parseRpcEndpoints(raw?: string): string[] {
  const normalized = normalize(raw);
  if (!normalized) return [];
  return normalized
    .split(/[\n,]+/)
    .map((e) => normalize(e))
    .filter((e): e is string => Boolean(e));
}

function deriveWsEndpoint(rpcEndpoint: string): string {
  try {
    const url = new URL(rpcEndpoint);
    if (url.protocol === "https:") url.protocol = "wss:";
    else if (url.protocol === "http:") url.protocol = "ws:";
    return url.toString();
  } catch {
    return rpcEndpoint.replace(/^https:/i, "wss:").replace(/^http:/i, "ws:");
  }
}

function summarizeEndpointHost(endpoint: string): string {
  try { return new URL(endpoint).host; } catch { return endpoint; }
}

function collectRpcUrls(): string[] {
  const candidates = [
    ...parseRpcEndpoints(process.env.SOLANA_RPC_URL),
    ...parseRpcEndpoints(process.env.SOLANA_RPC_URLS),
  ];
  const deduped = Array.from(new Set(candidates));
  return deduped.length > 0 ? deduped : [DEFAULT_RPC_ENDPOINT];
}

function collectWsUrls(): string[] {
  return [
    ...parseRpcEndpoints(process.env.SOLANA_WSS_URLS),
    ...parseRpcEndpoints(process.env.SOLANA_WSS_URL),
  ];
}

function collectRpcTransports(): RpcTransport[] {
  const rpcUrls = collectRpcUrls();
  const wsUrls  = collectWsUrls();
  return rpcUrls.map((rpcUrl, i) => ({
    rpcUrl,
    wsUrl: wsUrls[i] ?? deriveWsEndpoint(rpcUrl),
  }));
}

async function probeRpcUrl(url: string): Promise<void> {
  const connection = new Connection(url, "confirmed");
  await Promise.race([
    connection.getLatestBlockhash("processed"),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`RPC probe timed out for ${url}`)), 6_000)
    ),
  ]);
}

async function resolveRpcTransport(): Promise<RpcTransport> {
  const candidates = collectRpcTransports();
  let lastError: string | null = null;
  for (const candidate of candidates) {
    try {
      await probeRpcUrl(candidate.rpcUrl);
      return candidate;
    } catch (error: any) {
      lastError = typeof error?.message === "string" ? error.message : String(error);
    }
  }
  throw new Error(`No healthy relay RPC endpoint found${lastError ? ` (${lastError})` : ""}`);
}

function parseKeypairFromJson(name: string, value?: string): Keypair | null {
  const normalized = normalize(value);
  if (!normalized) return null;
  try {
    const parsed = JSON.parse(normalized);
    if (!Array.isArray(parsed)) throw new Error("keypair JSON must be an array");
    return Keypair.fromSecretKey(new Uint8Array(parsed));
  } catch (error: any) {
    throw new Error(`Invalid ${name}: ${error?.message || "failed to parse keypair JSON"}`);
  }
}

function parseKeypairFromPath(filePath: string): Keypair | null {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, "utf8");
  return parseKeypairFromJson(filePath, raw);
}

function resolveRelayerKeypair(): Keypair {
  const fromEnvJson =
    parseKeypairFromJson("SHADOWPERP_RELAYER_KEYPAIR_JSON", process.env.SHADOWPERP_RELAYER_KEYPAIR_JSON) ||
    parseKeypairFromJson("SOLANA_WALLET_KEYPAIR_JSON",      process.env.SOLANA_WALLET_KEYPAIR_JSON);
  if (fromEnvJson) return fromEnvJson;

  const customPath = normalize(process.env.SHADOWPERP_RELAYER_KEYPAIR_PATH);
  if (customPath) {
    const parsed = parseKeypairFromPath(customPath);
    if (!parsed) throw new Error(`Relayer keypair file not found: ${customPath}`);
    return parsed;
  }

  const defaultPath = path.join(os.homedir(), ".config", "solana", "id.json");
  const parsedDefault = parseKeypairFromPath(defaultPath);
  if (parsedDefault) return parsedDefault;

  throw new Error(
    "Missing relayer keypair. Set SHADOWPERP_RELAYER_KEYPAIR_JSON (or SHADOWPERP_RELAYER_KEYPAIR_PATH)."
  );
}

function buildRelayConfig(programId: PublicKey): ShadowPerpConfig {
  const collateralMint = parsePublicKey("SHADOWPERP_COLLATERAL_MINT", DEFAULT_COLLATERAL_MINT);
  const marketRegistry: Record<string, PublicKey> = {};
  for (const pair of TRADING_PAIRS) {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("market"), collateralMint.toBuffer(), pair.base.mint.toBuffer()],
      programId
    );
    marketRegistry[pair.label] = pda;
  }

  const clusterOffsetRaw = normalize(process.env.ARCIUM_CLUSTER_OFFSET);
  const clusterOffset = clusterOffsetRaw ? Number.parseInt(clusterOffsetRaw, 10) : DEFAULT_CLUSTER_OFFSET;
  if (!Number.isFinite(clusterOffset) || clusterOffset < 0) throw new Error("Invalid ARCIUM_CLUSTER_OFFSET");

  const arciumProgramId = parsePublicKey("ARCIUM_PROGRAM_ID", ARCIUM_ADDR);
  const mxeProgramId    = parsePublicKey("ARCIUM_MXE_PROGRAM_ID", programId.toBase58());
  const signPdaAccount  = PublicKey.findProgramAddressSync([Buffer.from("ArciumSignerAccount")], mxeProgramId)[0];

  return {
    programId,
    arciumProgramId,
    mxeProgramId,
    clusterOffset,
    clusterAddress: parsePublicKey("ARCIUM_CLUSTER_ACCOUNT", getClusterAccAddress(clusterOffset).toBase58()),
    marketAddress:  parsePublicKey("SHADOWPERP_MARKET_ACCOUNT", marketRegistry["SOL-USD"]!.toBase58()),
    marketRegistry,
    mempoolAccount: getMempoolAccAddress(clusterOffset),
    executingPool:  getExecutingPoolAccAddress(clusterOffset),
    poolAccount:    getFeePoolAccAddress(),
    signPdaAccount,
    idl: shadowperpIdl,
  };
}

// ── Inline ShadowPerpClient (relay-only subset) ───────────────────────────────

class RelayShadowPerpClient {
  private program: Program;
  private provider: AnchorProvider;
  private config: ShadowPerpConfig;
  private clientPublicKey: Uint8Array | null = null;
  private cipher: RescueCipher | null = null;

  constructor(provider: AnchorProvider, config: ShadowPerpConfig) {
    this.provider = provider;
    this.config   = config;
    this.program  = new Program(config.idl as any, provider);
  }

  private toU64Bn(value: BN | number): BN {
    const bn = BN.isBN(value) ? value : new BN(value);
    if (bn.isNeg()) throw new Error("u64 value must be non-negative");
    return bn;
  }

  private getMXEPda(): PublicKey {
    return getMXEAccAddress(this.config.programId);
  }

  private getMarginAccountAddress(owner: PublicKey): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("margin"), owner.toBuffer()],
      this.config.programId
    );
    return pda;
  }

  getTradeSessionAddress(market: PublicKey, owner: PublicKey, sessionId: BN): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("trade_session"), market.toBuffer(), owner.toBuffer(), sessionId.toArrayLike(Buffer, "le", 8)],
      this.config.programId
    );
    return pda;
  }

  async getTradeSession(sessionAddress: PublicKey): Promise<any> {
    return (this.program.account as any).tradeSession.fetch(sessionAddress);
  }

  getTradeSessionV2Address(owner: PublicKey, sessionId: BN): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("trade_session_v2"), owner.toBuffer(), sessionId.toArrayLike(Buffer, "le", 8)],
      this.config.programId
    );
    return pda;
  }

  async getTradeSessionV2(sessionAddress: PublicKey): Promise<any> {
    return (this.program.account as any).tradeSessionV2.fetch(sessionAddress);
  }

  private async getMarket(market: PublicKey): Promise<any> {
    return (this.program.account as any).market.fetch(market);
  }

  private async resolveFundingStatePda(market: PublicKey): Promise<PublicKey | null> {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("funding"), market.toBuffer()],
      this.config.programId
    );
    const info = await this.provider.connection.getAccountInfo(pda);
    return info ? pda : null;
  }

  private async sendTransactionWithPolling(tx: Transaction): Promise<string> {
    const connection = this.provider.connection;
    const feePayer   = this.provider.wallet.publicKey;
    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    tx.feePayer = feePayer;
    tx.recentBlockhash = blockhash;

    const signed     = await this.provider.wallet.signTransaction(tx);
    const serialized = signed.serialize();

    let signature: string;
    try {
      signature = await connection.sendRawTransaction(serialized, {
        preflightCommitment: "confirmed",
        skipPreflight: false,
        maxRetries: 3,
      });
    } catch (sendErr: any) {
      const msg: string = sendErr?.message ?? "";
      if (msg.includes("already been processed")) {
        const matchInMsg = msg.match(/([1-9A-HJ-NP-Za-km-z]{87,88})/);
        if (matchInMsg) {
          signature = matchInMsg[1];
          const status = await connection.getSignatureStatus(signature);
          if (status?.value?.err) {
            throw new Error(`Transaction ${signature} was already processed but failed on-chain.`);
          }
          return signature;
        }
        try {
          signature = await connection.sendRawTransaction(serialized, {
            preflightCommitment: "confirmed",
            skipPreflight: true,
            maxRetries: 0,
          });
          return signature;
        } catch {
          throw sendErr;
        }
      }
      throw sendErr;
    }

    // Poll for confirmation
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      const status = await connection.getSignatureStatus(signature);
      const conf   = status?.value?.confirmationStatus;
      if (conf === "confirmed" || conf === "finalized") return signature;
      if (status?.value?.err) throw new Error(`Transaction failed: ${JSON.stringify(status.value.err)}`);
      await new Promise(r => setTimeout(r, 2_000));
    }
    return signature;
  }

  async depositCollateralWithSession(market: PublicKey, owner: PublicKey, sessionId: BN | number, amount: BN): Promise<string> {
    const relayer        = this.provider.wallet.publicKey;
    const marketAccount  = await this.getMarket(market);
    const marginAccount  = this.getMarginAccountAddress(owner);
    const ownerTokenAccount = await getAssociatedTokenAddress(marketAccount.collateralMint, owner);
    const sessionAddress = this.getTradeSessionAddress(market, owner, this.toU64Bn(sessionId));
    const methods = (this.program as any).methods;
    if (!methods?.depositCollateralWithSession) throw new Error("depositCollateralWithSession is unavailable in the loaded IDL.");
    const tx = await methods.depositCollateralWithSession(amount).accounts({
      relayer, owner, market, session: sessionAddress, marginAccount,
      ownerTokenAccount, vault: marketAccount.vault,
      tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
    }).transaction();
    return this.sendTransactionWithPolling(tx);
  }

  async depositCollateralWithSessionV2(market: PublicKey, owner: PublicKey, sessionId: BN | number, amount: BN): Promise<string> {
    const relayer        = this.provider.wallet.publicKey;
    const marketAccount  = await this.getMarket(market);
    const marginAccount  = this.getMarginAccountAddress(owner);
    const ownerTokenAccount = await getAssociatedTokenAddress(marketAccount.collateralMint, owner);
    const sessionAddress = this.getTradeSessionV2Address(owner, this.toU64Bn(sessionId));
    const methods = (this.program as any).methods;
    if (!methods?.depositCollateralWithSessionV2) throw new Error("depositCollateralWithSessionV2 is unavailable in the loaded IDL.");
    const tx = await methods.depositCollateralWithSessionV2(amount).accounts({
      relayer, owner, market, session: sessionAddress, marginAccount,
      ownerTokenAccount, vault: marketAccount.vault,
      tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
    }).transaction();
    return this.sendTransactionWithPolling(tx);
  }

  async withdrawCollateralWithSession(market: PublicKey, owner: PublicKey, sessionId: BN | number, amount: BN): Promise<string> {
    const relayer        = this.provider.wallet.publicKey;
    const marketAccount  = await this.getMarket(market);
    const marginAccount  = this.getMarginAccountAddress(owner);
    const ownerTokenAccount = await getAssociatedTokenAddress(marketAccount.collateralMint, owner);
    const sessionAddress = this.getTradeSessionAddress(market, owner, this.toU64Bn(sessionId));
    const [sharedVaultAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from("shared_vault_authority"), marketAccount.collateralMint.toBuffer()],
      this.config.programId
    );
    const tx = await (this.program as any).methods.withdrawCollateralWithSession(amount).accounts({
      relayer, owner, market, session: sessionAddress, marginAccount,
      ownerTokenAccount, vault: marketAccount.vault, sharedVaultAuthority,
      tokenProgram: TOKEN_PROGRAM_ID,
    }).transaction();
    return this.sendTransactionWithPolling(tx);
  }

  async withdrawCollateralWithSessionV2(market: PublicKey, owner: PublicKey, sessionId: BN | number, amount: BN): Promise<string> {
    const relayer        = this.provider.wallet.publicKey;
    const marketAccount  = await this.getMarket(market);
    const marginAccount  = this.getMarginAccountAddress(owner);
    const ownerTokenAccount = await getAssociatedTokenAddress(marketAccount.collateralMint, owner);
    const sessionAddress = this.getTradeSessionV2Address(owner, this.toU64Bn(sessionId));
    const [sharedVaultAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from("shared_vault_authority"), marketAccount.collateralMint.toBuffer()],
      this.config.programId
    );
    const methods = (this.program as any).methods;
    if (!methods?.withdrawCollateralWithSessionV2) throw new Error("withdrawCollateralWithSessionV2 is unavailable in the loaded IDL.");
    const tx = await methods.withdrawCollateralWithSessionV2(amount).accounts({
      relayer, owner, market, session: sessionAddress, marginAccount,
      ownerTokenAccount, vault: marketAccount.vault, sharedVaultAuthority,
      tokenProgram: TOKEN_PROGRAM_ID,
    }).transaction();
    return this.sendTransactionWithPolling(tx);
  }

  private async initializeEncryption(): Promise<void> {
    const mxePublicKey = await getArciumMXEPublicKey(this.provider, this.config.programId);
    if (!mxePublicKey) throw new Error("Failed to fetch MXE public key");
    const privateKey = x25519.utils.randomSecretKey();
    this.clientPublicKey = x25519.getPublicKey(privateKey);
    const sharedSecret   = x25519.getSharedSecret(privateKey, mxePublicKey);
    this.cipher = new RescueCipher(sharedSecret);
  }

  private generateNonce(): { bytes: Uint8Array; value: BN } {
    const bytes = new Uint8Array(16);
    if (typeof globalThis.crypto !== "undefined" && globalThis.crypto.getRandomValues) {
      globalThis.crypto.getRandomValues(bytes);
    } else {
      const nodeCrypto = require("crypto") as typeof import("crypto");
      bytes.set(nodeCrypto.randomBytes(16));
    }
    let value = BigInt(0);
    for (let i = 15; i >= 0; i--) value = (value << BigInt(8)) | BigInt(bytes[i]);
    return { bytes, value: new BN(value.toString()) };
  }

  private async nextComputationOffset(): Promise<BN> {
    const bytes = new Uint8Array(8);
    if (typeof globalThis.crypto !== "undefined" && globalThis.crypto.getRandomValues) {
      globalThis.crypto.getRandomValues(bytes);
    } else {
      const nodeCrypto = require("crypto") as typeof import("crypto");
      bytes.set(nodeCrypto.randomBytes(8));
    }
    return new BN(Buffer.from(bytes), "le");
  }

  private getPositionAddress(market: PublicKey, owner: PublicKey, index: number): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("position"), market.toBuffer(), owner.toBuffer(), new BN(index).toArrayLike(Buffer, "le", 8)],
      this.config.programId
    );
    return pda;
  }

  private async getMarginAccount(marginAccount: PublicKey): Promise<any> {
    return (this.program.account as any).marginAccount.fetch(marginAccount);
  }

  async openPositionWithSessionV2(
    market: PublicKey,
    owner: PublicKey,
    sessionId: BN | number,
    input: { direction: string; margin: BN; leverage: number; entryPrice: BN; marginMode?: string; size?: BN }
  ): Promise<{ txSignature: string; positionAddress: PublicKey }> {
    if (!this.clientPublicKey || !this.cipher) await this.initializeEncryption();

    const relayer        = this.provider.wallet.publicKey;
    const marketAccount  = await this.getMarket(market);
    const marginAccount  = this.getMarginAccountAddress(owner);
    const marginSnapshot = await this.getMarginAccount(marginAccount);
    const sessionAddress = this.getTradeSessionV2Address(owner, this.toU64Bn(sessionId));

    const { bytes: nonceBytes, value: nonceBN } = this.generateNonce();

    const size       = input.size ?? input.margin;
    const entryPrice = input.entryPrice;
    const leverage   = input.leverage;
    const isLong     = input.direction === "long";
    const margin     = input.margin;

    const encryptedTuple = this.cipher!.encrypt(
      [BigInt(size.toString()), BigInt(entryPrice.toString()), BigInt(leverage), BigInt(isLong ? 1 : 0), BigInt(margin.toString())],
      nonceBytes
    ) as unknown as Uint8Array[];

    const [encryptedSize, encryptedEntryPrice, encryptedLeverage, encryptedIsLong, encryptedMargin] = encryptedTuple;

    const computationOffset = await this.nextComputationOffset();
    const positionAddress   = this.getPositionAddress(market, owner, marginSnapshot.positionsOpened);
    const mxeAccount        = this.getMXEPda();
    const compDefAccount    = marketAccount.openPositionCompDef;
    if (!compDefAccount) throw new Error("Market open_position comp-def is not configured on-chain.");

    const computationAccount = getComputationAccAddress(this.config.clusterOffset, computationOffset);
    const marginModeFlag     = (input.marginMode ?? "cross") === "isolated" ? 1 : 0;

    const methods = (this.program as any).methods;
    if (!methods?.openPositionWithSessionV2) throw new Error("openPositionWithSessionV2 is unavailable in the loaded IDL.");

    const fundingStatePda = await this.resolveFundingStatePda(market);
    const [posFundingRefPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("pos-funding"), positionAddress.toBuffer()],
      this.config.programId
    );

    const tx = await methods.openPositionWithSessionV2(
      Array.from(encryptedSize), Array.from(encryptedEntryPrice), Array.from(encryptedLeverage),
      Array.from(encryptedIsLong), Array.from(encryptedMargin),
      marginModeFlag, margin, isLong, Array.from(this.clientPublicKey!), nonceBN, computationOffset
    ).accounts({
      relayer, owner, market, session: sessionAddress, marginAccount,
      position: positionAddress, fundingState: fundingStatePda,
      posFundingRef: posFundingRefPda, mxeAccount, compDefAccount,
      clusterAccount: this.config.clusterAddress, mempoolAccount: this.config.mempoolAccount,
      executingPool: this.config.executingPool, computationAccount,
      poolAccount: this.config.poolAccount, signPdaAccount: this.config.signPdaAccount,
      arciumProgram: this.config.arciumProgramId, systemProgram: SystemProgram.programId,
      clockAccount: getClockAccAddress(),
    }).transaction();

    const signature = await this.sendTransactionWithPolling(tx);
    return { txSignature: signature, positionAddress };
  }
}

// ── Runtime context ───────────────────────────────────────────────────────────

export type RelayRuntimeContext = {
  client: RelayShadowPerpClient;
  config: ShadowPerpConfig;
  relayer: Keypair;
  rpcUrl: string;
  wsUrl: string;
};

export function summarizeRelayRuntime(ctx: RelayRuntimeContext): RelayRuntimeSummary {
  return {
    programId:     ctx.config.programId.toBase58(),
    marketAddress: ctx.config.marketAddress.toBase58(),
    clusterOffset: ctx.config.clusterOffset,
    rpcHost:       summarizeEndpointHost(ctx.rpcUrl),
    wsHost:        summarizeEndpointHost(ctx.wsUrl),
    rpcCandidates: collectRpcUrls().map(summarizeEndpointHost),
  };
}

let _cachedContext: RelayRuntimeContext | undefined;

export async function createRelayRuntimeContext(): Promise<RelayRuntimeContext> {
  if (_cachedContext) return _cachedContext;
  const programId = parsePublicKey(
    "SHADOWPERP_PROGRAM_ID",
    typeof shadowperpIdl.address === "string" ? shadowperpIdl.address : undefined
  );
  const config = buildRelayConfig(programId);
  const { rpcUrl, wsUrl } = await resolveRpcTransport();
  const relayer  = resolveRelayerKeypair();
  const provider = new AnchorProvider(
    new Connection(rpcUrl, { commitment: "confirmed", wsEndpoint: wsUrl }),
    new Wallet(relayer),
    { commitment: "confirmed" }
  );
  _cachedContext = {
    client: new RelayShadowPerpClient(provider, config),
    config,
    relayer,
    rpcUrl,
    wsUrl,
  };
  return _cachedContext;
}
