import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import {
  Transaction,
  PublicKey,
  SystemProgram,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createApproveInstruction,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import {
  RescueCipher,
  getComputationAccAddress,
  getClockAccAddress,
  getMXEAccAddress,
  getMXEPublicKey as getArciumMXEPublicKey,
  x25519,
} from "@arcium-hq/client";
function randomBytes(length: number): Uint8Array {
  const buf = new Uint8Array(length);
  if (typeof globalThis.crypto !== "undefined" && globalThis.crypto.getRandomValues) {
    globalThis.crypto.getRandomValues(buf);
  } else {
    // Node.js fallback
    const nodeCrypto = require("crypto");
    const nodeBytes = nodeCrypto.randomBytes(length);
    buf.set(nodeBytes);
  }
  return buf;
}

import {
  ShadowPerpConfig,
  OpenPositionInput,
  EncryptedPosition,
  Market,
  MarginAccount,
  PositionStatus,
  TradeSession,
  TradeSessionV2,
} from "../types";
import { isMissingAccountError } from "./account-errors";
import { confirmWithPolling } from "./arcium-errors";
import {
  extractOpenCallbackFailureMessage,
  diagnoseOpenCallbackFailure as diagnoseCallbackShared,
  normalizePositionStatus as normalizePositionStatusShared,
} from "./arcium-callback-diag";

export const DEFAULT_TRADE_SESSION_DURATION_SECONDS = 5 * 60 * 60;
const DEFAULT_POSITION_STATUS_TIMEOUT_MS = 120_000;
const DEFAULT_POSITION_STATUS_POLL_MS = 2_000;
const OPEN_POSITION_CALLBACK_DIAG_POLL_MS = 6_000;
const SOLANA_GAS_SPONSOR_PATH = "/api/sponsor-solana";
let sponsorAccessTokenProvider: null | (() => Promise<string | null>) = null;

function normalizeStatus(raw: unknown): number {
  return normalizePositionStatusShared(raw);
}

function parsePendingComputationAccount(position: unknown): PublicKey | null {
  const raw = (position as { pendingComputationAccount?: unknown } | null)?.pendingComputationAccount;
  if (!raw) return null;

  try {
    const pubkey = raw instanceof PublicKey ? raw : new PublicKey(raw as string);
    return pubkey.equals(PublicKey.default) ? null : pubkey;
  } catch {
    return null;
  }
}

type OpenPositionSubmission = {
  txSignature: string;
  positionAddress: PublicKey;
};

function normalizeEnvFlag(raw?: string): boolean {
  if (!raw) return false;
  const value = raw.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

function resolveSponsorCluster(): "devnet" | "mainnet-beta" | null {
  const explicit = process.env.NEXT_PUBLIC_SOLANA_CLUSTER?.trim().toLowerCase();
  if (explicit === "devnet") return "devnet";
  if (explicit === "mainnet-beta" || explicit === "mainnet") return "mainnet-beta";

  const rpc = process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.toLowerCase() ?? "";
  if (rpc.includes("devnet")) return "devnet";
  if (rpc.includes("mainnet")) return "mainnet-beta";
  return null;
}

function resolveSponsorPubkey(): PublicKey | null {
  const raw = process.env.NEXT_PUBLIC_SOLANA_GAS_SPONSOR_PUBKEY?.trim();
  if (!raw) return null;
  try {
    return new PublicKey(raw);
  } catch {
    return null;
  }
}

function sponsorshipEnabled(): boolean {
  return normalizeEnvFlag(process.env.NEXT_PUBLIC_SOLANA_GAS_SPONSOR_ENABLED);
}

function canUseGasSponsorship(walletMode: "embedded" | "external" | "none"): boolean {
  if (typeof window === "undefined") return false;
  if (!sponsorshipEnabled()) return false;
  // Only sponsor embedded wallets — external wallets pay their own fees.
  if (walletMode !== "embedded") return false;
  const cluster = resolveSponsorCluster();
  return cluster === "devnet" || cluster === "mainnet-beta";
}

function hasAllowedTopLevelInstructions(tx: Transaction, shadowProgramId: PublicKey): boolean {
  const allowedProgramIds = new Set([
    shadowProgramId.toBase58(),
    TOKEN_PROGRAM_ID.toBase58(),
    ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
    SystemProgram.programId.toBase58(),
    ComputeBudgetProgram.programId.toBase58(),
  ]);

  return tx.instructions.every((ix) => allowedProgramIds.has(ix.programId.toBase58()));
}

export function setSponsorAccessTokenProvider(
  provider: null | (() => Promise<string | null>)
): void {
  sponsorAccessTokenProvider = provider;
}


/**
 * ShadowPerp Client SDK
 *
 * Provides methods for interacting with the ShadowPerp protocol.
 * Handles encryption of position data using Arcium's MPC infrastructure.
 *
 * Encryption flow:
 * 1. Generate ephemeral x25519 keypair
 * 2. Fetch MXE cluster public key from on-chain account
 * 3. Derive shared secret via ECDH key exchange
 * 4. Initialize RescueCipher with shared secret
 * 5. Encrypt position parameters (size, leverage, direction, etc.)
 * 6. Submit encrypted data to Solana program
 * 7. Program queues computation to Arcium MPC network via CPI
 * 8. MPC nodes decrypt (in secret shares), compute, return results via callback
 */
export class ShadowPerpClient {
  private program: any;
  private provider: AnchorProvider;
  private config: ShadowPerpConfig;
  private walletMode: "embedded" | "external" | "none";

  // Encryption state
  private clientPrivateKey: Uint8Array | null = null;
  private clientPublicKey: Uint8Array | null = null;
  private sharedSecret: Uint8Array | null = null;
  private cipher: RescueCipher | null = null;

  constructor(
    provider: AnchorProvider,
    config: ShadowPerpConfig,
    walletMode: "embedded" | "external" | "none" = "none"
  ) {
    this.provider = provider;
    this.config = config;
    this.walletMode = walletMode;
    const idlWithAddress = {
      ...config.idl,
      address: config.programId.toBase58(),
    };
    this.program = new (Program as any)(idlWithAddress, provider);
  }

  private generateClientPrivateKey(): Uint8Array {
    const utils = x25519.utils as {
      randomSecretKey?: () => Uint8Array;
      randomPrivateKey?: () => Uint8Array;
    };
    if (utils.randomSecretKey) return utils.randomSecretKey();
    if (utils.randomPrivateKey) return utils.randomPrivateKey();
    throw new Error("x25519 key generation is unavailable in this runtime");
  }

  /**
   * Initialize encryption keys for secure communication with MXE
   *
   * Performs x25519 Diffie-Hellman key exchange with the MXE cluster
   * to derive a shared secret used for Rescue cipher encryption.
   */
  async initializeEncryption(): Promise<void> {
    // Generate ephemeral client keypair for x25519 key exchange
    this.clientPrivateKey = this.generateClientPrivateKey();
    this.clientPublicKey = x25519.getPublicKey(this.clientPrivateKey);

    // Fetch MXE cluster public key from on-chain account
    const mxePublicKey = await this.getMXEPublicKey();

    // Derive shared secret via ECDH
    this.sharedSecret = x25519.getSharedSecret(
      this.clientPrivateKey,
      mxePublicKey
    );

    // Initialize Rescue cipher with derived shared secret
    this.cipher = new RescueCipher(this.sharedSecret);
  }

  /**
   * Get MXE public key from the cluster account on-chain
   */
  private async getMXEPublicKey(): Promise<Uint8Array> {
    const mxePublicKey = await getArciumMXEPublicKey(this.provider, this.config.mxeProgramId);
    if (!mxePublicKey) {
      throw new Error("MXE public key is not set on-chain");
    }
    return mxePublicKey;
  }

  /**
   * Encrypt a u64 value using Rescue cipher
   */
  private encryptU64(value: BN | number, nonce: Uint8Array): Uint8Array {
    if (!this.cipher) {
      throw new Error("Encryption not initialized. Call initializeEncryption() first.");
    }
    const bigVal = typeof value === "number" ? BigInt(value) : BigInt(value.toString());
    const [encrypted] = this.cipher.encrypt([bigVal], nonce);
    return Uint8Array.from(encrypted);
  }

  private encryptU128(value: bigint, nonce: Uint8Array): Uint8Array {
    if (!this.cipher) throw new Error("Encryption not initialized");
    const [encrypted] = this.cipher.encrypt([value], nonce);
    return Uint8Array.from(encrypted);
  }

  private encryptU8(value: number, nonce: Uint8Array): Uint8Array {
    if (!this.cipher) throw new Error("Encryption not initialized");
    const [encrypted] = this.cipher.encrypt([BigInt(value)], nonce);
    return Uint8Array.from(encrypted);
  }

  private encryptBool(value: boolean, nonce: Uint8Array): Uint8Array {
    if (!this.cipher) throw new Error("Encryption not initialized");
    const [encrypted] = this.cipher.encrypt([BigInt(value ? 1 : 0)], nonce);
    return Uint8Array.from(encrypted);
  }

  private encryptOpenTuple(
    input: OpenPositionInput,
    nonce: Uint8Array
  ): {
    encryptedSize: Uint8Array;
    encryptedEntryPrice: Uint8Array;
    encryptedLeverage: Uint8Array;
    encryptedIsLong: Uint8Array;
    encryptedMargin: Uint8Array;
  } {
    if (!this.cipher) {
      throw new Error("Encryption not initialized. Call initializeEncryption() first.");
    }

    const encryptedTuple = this.cipher.encrypt(
      [
        BigInt(input.size.toString()),
        BigInt(input.entryPrice.toString()),
        BigInt(input.leverage),
        BigInt(input.direction === "long" ? 1 : 0),
        BigInt(input.margin.toString()),
      ],
      nonce
    ) as unknown as Uint8Array[];

    if (!Array.isArray(encryptedTuple) || encryptedTuple.length !== 5) {
      throw new Error("Unexpected encrypted tuple shape for open position");
    }

    const [
      encryptedSize,
      encryptedEntryPrice,
      encryptedLeverage,
      encryptedIsLong,
      encryptedMargin,
    ] = encryptedTuple.map((value) => Uint8Array.from(value));

    return {
      encryptedSize,
      encryptedEntryPrice,
      encryptedLeverage,
      encryptedIsLong,
      encryptedMargin,
    };
  }

  private generateNonce(): { bytes: Uint8Array; value: BN } {
    const bytes = randomBytes(16);
    const value = new BN(bytes, "le");
    return { bytes, value };
  }

  private async nextComputationOffset(): Promise<BN> {
    // Arcium expects a random 8-byte computation offset (u64).
    // Keep this fully random to avoid deterministic collisions across sessions.
    return new BN(randomBytes(8), "le");
  }

  // ============ PDA DERIVATION ============

  getMXEPda(): PublicKey {
    return getMXEAccAddress(this.config.mxeProgramId);
  }

  getMarketAddress(collateralMint: PublicKey, baseAssetMint: PublicKey): PublicKey {
    const [marketPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("market"), collateralMint.toBuffer(), baseAssetMint.toBuffer()],
      this.config.programId
    );
    return marketPda;
  }

  async getMarket(marketAddress: PublicKey): Promise<Market> {
    const account = await this.program.account.market.fetch(marketAddress);
    return account as unknown as Market;
  }

  getMarginAccountAddress(marketOrOwner: PublicKey, ownerArg?: PublicKey): PublicKey {
    const owner = ownerArg ?? marketOrOwner;
    const [marginPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("margin"), owner.toBuffer()],
      this.config.programId
    );
    return marginPda;
  }

  getSharedVaultAddress(collateralMint: PublicKey): PublicKey {
    const [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("shared_vault"), collateralMint.toBuffer()],
      this.config.programId
    );
    return vaultPda;
  }

  getSharedVaultAuthorityAddress(collateralMint: PublicKey): PublicKey {
    const [authorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("shared_vault_authority"), collateralMint.toBuffer()],
      this.config.programId
    );
    return authorityPda;
  }

  async getMarginAccount(marginAddress: PublicKey): Promise<MarginAccount> {
    const account = await this.program.account.marginAccount.fetch(marginAddress);
    return account as unknown as MarginAccount;
  }

  getPositionAddress(market: PublicKey, owner: PublicKey, index: BN): PublicKey {
    const [positionPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("position"),
        market.toBuffer(),
        owner.toBuffer(),
        index.toArrayLike(Buffer, "le", 8),
      ],
      this.config.programId
    );
    return positionPda;
  }

  getLiquidationSettlementAddress(position: PublicKey): PublicKey {
    const [settlementPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("liquidation_settlement"), position.toBuffer()],
      this.config.programId
    );
    return settlementPda;
  }

  getTradeSessionAddress(market: PublicKey, owner: PublicKey, sessionId: BN): PublicKey {
    const [sessionPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("trade_session"),
        market.toBuffer(),
        owner.toBuffer(),
        sessionId.toArrayLike(Buffer, "le", 8),
      ],
      this.config.programId
    );
    return sessionPda;
  }

  async getTradeSession(sessionAddress: PublicKey): Promise<TradeSession> {
    const account = await this.program.account.tradeSession.fetch(sessionAddress);
    return account as unknown as TradeSession;
  }

  getTradeSessionV2Address(owner: PublicKey, sessionId: BN): PublicKey {
    const [sessionPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("trade_session_v2"),
        owner.toBuffer(),
        sessionId.toArrayLike(Buffer, "le", 8),
      ],
      this.config.programId
    );
    return sessionPda;
  }

  async getTradeSessionV2(sessionAddress: PublicKey): Promise<TradeSessionV2> {
    const account = await (this.program.account as any).tradeSessionV2.fetch(sessionAddress);
    return account as unknown as TradeSessionV2;
  }

  private toU64Bn(value: BN | number): BN {
    const bn = BN.isBN(value) ? value : new BN(value);
    if (bn.isNeg()) throw new Error("u64 value must be non-negative");
    return bn;
  }

  private defaultSessionExpiryBn(): BN {
    const nowSeconds = Math.floor(Date.now() / 1000);
    return new BN(nowSeconds + DEFAULT_TRADE_SESSION_DURATION_SECONDS);
  }

  /** Returns the funding_state PDA if the account exists on-chain, otherwise null.
   *  The on-chain account is Optional — passing a non-existent address causes
   *  AccountNotInitialized (error 3012). */
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
    const sponsorFeePayer = canUseGasSponsorship(this.walletMode) ? resolveSponsorPubkey() : null;
    const feePayer = sponsorFeePayer ?? this.provider.wallet.publicKey;
    const { blockhash } = await connection.getLatestBlockhash("confirmed");

    tx.feePayer = feePayer;
    tx.recentBlockhash = blockhash;

    const signed = await this.provider.wallet.signTransaction(tx);
    if (sponsorFeePayer) {
      if (!hasAllowedTopLevelInstructions(signed, this.config.programId)) {
        throw new Error("Gas sponsorship rejected: unsupported instruction set.");
      }

      const sponsorAccessToken = sponsorAccessTokenProvider
        ? await sponsorAccessTokenProvider()
        : null;

      const response = await fetch(SOLANA_GAS_SPONSOR_PATH, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(sponsorAccessToken
            ? { Authorization: `Bearer ${sponsorAccessToken}` }
            : {}),
        },
        body: JSON.stringify({
          cluster: resolveSponsorCluster(),
          transactionBase64: Buffer.from(
            signed.serialize({ requireAllSignatures: false, verifySignatures: false })
          ).toString("base64"),
        }),
      });

      const payload = (await response.json()) as { signature?: string; error?: string };
      if (!response.ok || !payload.signature) {
        throw new Error(payload.error || "Gas sponsorship failed.");
      }
      return payload.signature;
    }

    const serialized = signed.serialize();

    let signature: string;
    try {
      // Skip preflight for external wallets — the wallet extension already
      // simulates, and running it again against the app RPC can produce false
      // "insufficient SOL" failures when nodes are slightly out of sync.
      signature = await connection.sendRawTransaction(serialized, {
        preflightCommitment: "confirmed",
        skipPreflight: this.walletMode === "external",
        maxRetries: 3,
      });
    } catch (sendErr: any) {
      const msg: string = sendErr?.message ?? "";
      // Simulation reports the tx was already confirmed on a prior attempt.
      // The signature is the first 64 bytes of the serialized signed tx (base58-encoded).
      if (msg.includes("already been processed")) {
        // Try to extract the signature from the error message first.
        const matchInMsg = msg.match(/([1-9A-HJ-NP-Za-km-z]{87,88})/);
        if (matchInMsg) {
          signature = matchInMsg[1];
          const status = await connection.getSignatureStatus(signature);
          if (status?.value?.err) {
            throw new Error(`Transaction ${signature} was already processed but failed on-chain.`);
          }
          return signature;
        }
        // No signature in the error message — re-send with skipPreflight to get the sig,
        // which will immediately confirm since the tx is already on-chain.
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

    await confirmWithPolling(connection, signature, {
      timeoutMs: 90_000,
      pollMs: 2_000,
      maxSendAttempts: 0,
    });

    return signature;
  }

  private async diagnoseOpenCallbackFailure(
    positionAddress: PublicKey,
    pendingComputationAddress: PublicKey | null
  ): Promise<string | null> {
    return diagnoseCallbackShared(
      this.provider.connection,
      positionAddress,
      pendingComputationAddress,
      this.config.clusterOffset
    );
  }

  // ============ DELEGATED SESSION ============

  async createTradeSession(
    market: PublicKey,
    sessionId: BN | number,
    relayer: PublicKey,
    maxActions: number,
    maxMarginPerAction: BN,
    expiresAt?: BN
  ): Promise<{ txSignature: string; sessionAddress: PublicKey }> {
    const owner = this.provider.wallet.publicKey;
    const sessionIdBn = this.toU64Bn(sessionId);
    const expiresAtBn = expiresAt ?? this.defaultSessionExpiryBn();
    const sessionAddress = this.getTradeSessionAddress(market, owner, sessionIdBn);

    const tx = await this.program.methods
      .createTradeSession(
        sessionIdBn,
        relayer,
        maxActions,
        maxMarginPerAction,
        expiresAtBn
      )
      .accounts({
        owner,
        market,
        session: sessionAddress,
        systemProgram: SystemProgram.programId,
      })
      .transaction();

    const txSignature = await this.sendTransactionWithPolling(tx);

    return { txSignature, sessionAddress };
  }

  async createTradeSessionV2(
    sessionId: BN | number,
    relayer: PublicKey,
    maxActions: number,
    maxMarginPerAction: BN,
    expiresAt?: BN
  ): Promise<{ txSignature: string; sessionAddress: PublicKey }> {
    const owner = this.provider.wallet.publicKey;
    const sessionIdBn = this.toU64Bn(sessionId);
    const expiresAtBn = expiresAt ?? this.defaultSessionExpiryBn();
    const sessionAddress = this.getTradeSessionV2Address(owner, sessionIdBn);

    const methods = (this.program as any).methods;
    if (!methods?.createTradeSessionV2) {
      throw new Error(
        "createTradeSessionV2 is unavailable in the loaded IDL. Rebuild/sync IDL first."
      );
    }

    const tx = await methods
      .createTradeSessionV2(
        sessionIdBn,
        relayer,
        maxActions,
        maxMarginPerAction,
        expiresAtBn
      )
      .accounts({
        owner,
        session: sessionAddress,
        systemProgram: SystemProgram.programId,
      })
      .transaction();

    const txSignature = await this.sendTransactionWithPolling(tx);
    return { txSignature, sessionAddress };
  }

  async revokeTradeSession(market: PublicKey, sessionId: BN | number): Promise<string> {
    const owner = this.provider.wallet.publicKey;
    const sessionIdBn = this.toU64Bn(sessionId);
    const sessionAddress = this.getTradeSessionAddress(market, owner, sessionIdBn);

    const tx = await this.program.methods
      .revokeTradeSession()
      .accounts({
        owner,
        market,
        session: sessionAddress,
      })
      .transaction();

    return this.sendTransactionWithPolling(tx);
  }

  async revokeTradeSessionV2(sessionId: BN | number): Promise<string> {
    const owner = this.provider.wallet.publicKey;
    const sessionIdBn = this.toU64Bn(sessionId);
    const sessionAddress = this.getTradeSessionV2Address(owner, sessionIdBn);
    const methods = (this.program as any).methods;
    if (!methods?.revokeTradeSessionV2) {
      throw new Error(
        "revokeTradeSessionV2 is unavailable in the loaded IDL. Rebuild/sync IDL first."
      );
    }

    const tx = await methods
      .revokeTradeSessionV2()
      .accounts({
        owner,
        session: sessionAddress,
      })
      .transaction();

    return this.sendTransactionWithPolling(tx);
  }

  /**
   * Owner-authorized token delegate approval for session-based collateral deposits.
   * This is the one-time token allowance grant to the relayer.
   */
  async approveCollateralDelegate(
    market: PublicKey,
    delegate: PublicKey,
    amount: BN
  ): Promise<string> {
    const owner = this.provider.wallet.publicKey;
    const marketAccount = await this.getMarket(market);
    const ownerTokenAccount = await getAssociatedTokenAddress(
      marketAccount.collateralMint,
      owner
    );

    const approveIx = createApproveInstruction(
      ownerTokenAccount,
      delegate,
      owner,
      BigInt(amount.toString())
    );
    const tx = new Transaction().add(approveIx);
    return this.sendTransactionWithPolling(tx);
  }

  // ============ COLLATERAL ============

  async depositCollateral(market: PublicKey, amount: BN): Promise<string> {
    const owner = this.provider.wallet.publicKey;
    const marketAccount = await this.getMarket(market);
    const marginAccount = this.getMarginAccountAddress(owner);
    const userTokenAccount = await getAssociatedTokenAddress(
      marketAccount.collateralMint, owner
    );
    const tx = await this.program.methods
      .depositCollateral(amount)
      .accounts({
        owner, market, marginAccount, userTokenAccount, vault: marketAccount.vault,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .transaction();
    return this.sendTransactionWithPolling(tx);
  }

  /**
   * Relayer path: deposit owner collateral under an active delegated session.
   * Requires prior SPL delegate approval from owner -> relayer.
   */
  async depositCollateralWithSession(
    market: PublicKey,
    owner: PublicKey,
    sessionId: BN | number,
    amount: BN
  ): Promise<string> {
    const relayer = this.provider.wallet.publicKey;
    const marketAccount = await this.getMarket(market);
    const marginAccount = this.getMarginAccountAddress(owner);
    const ownerTokenAccount = await getAssociatedTokenAddress(
      marketAccount.collateralMint,
      owner
    );
    const sessionAddress = this.getTradeSessionAddress(
      market,
      owner,
      this.toU64Bn(sessionId)
    );

    const methods = (this.program as any).methods;
    if (!methods?.depositCollateralWithSession) {
      throw new Error(
        "depositCollateralWithSession is unavailable in the loaded IDL. Rebuild/sync IDL first."
      );
    }

    const tx = await methods
      .depositCollateralWithSession(amount)
      .accounts({
        relayer,
        owner,
        market,
        session: sessionAddress,
        marginAccount,
        ownerTokenAccount,
        vault: marketAccount.vault,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .transaction();
    return this.sendTransactionWithPolling(tx);
  }

  async depositCollateralWithSessionV2(
    market: PublicKey,
    owner: PublicKey,
    sessionId: BN | number,
    amount: BN
  ): Promise<string> {
    const relayer = this.provider.wallet.publicKey;
    const marketAccount = await this.getMarket(market);
    const marginAccount = this.getMarginAccountAddress(owner);
    const ownerTokenAccount = await getAssociatedTokenAddress(
      marketAccount.collateralMint,
      owner
    );
    const sessionAddress = this.getTradeSessionV2Address(owner, this.toU64Bn(sessionId));

    const methods = (this.program as any).methods;
    if (!methods?.depositCollateralWithSessionV2) {
      throw new Error(
        "depositCollateralWithSessionV2 is unavailable in the loaded IDL. Rebuild/sync IDL first."
      );
    }

    const tx = await methods
      .depositCollateralWithSessionV2(amount)
      .accounts({
        relayer,
        owner,
        market,
        session: sessionAddress,
        marginAccount,
        ownerTokenAccount,
        vault: marketAccount.vault,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .transaction();
    return this.sendTransactionWithPolling(tx);
  }

  async withdrawCollateral(market: PublicKey, amount: BN): Promise<string> {
    const owner = this.provider.wallet.publicKey;
    const marketAccount = await this.getMarket(market);
    const marginAccount = this.getMarginAccountAddress(owner);
    const userTokenAccount = await getAssociatedTokenAddress(
      marketAccount.collateralMint, owner
    );
    const tx = await this.program.methods
      .withdrawCollateral(amount)
      .accounts({
        owner, market, marginAccount, userTokenAccount, vault: marketAccount.vault,
        sharedVaultAuthority: this.getSharedVaultAuthorityAddress(marketAccount.collateralMint),
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .transaction();
    return this.sendTransactionWithPolling(tx);
  }

  /**
   * Relayer path: withdraw owner collateral under an active delegated session.
   */
  async withdrawCollateralWithSession(
    market: PublicKey,
    owner: PublicKey,
    sessionId: BN | number,
    amount: BN
  ): Promise<string> {
    const relayer = this.provider.wallet.publicKey;
    const marketAccount = await this.getMarket(market);
    const marginAccount = this.getMarginAccountAddress(owner);
    const ownerTokenAccount = await getAssociatedTokenAddress(
      marketAccount.collateralMint,
      owner
    );
    const sessionAddress = this.getTradeSessionAddress(
      market,
      owner,
      this.toU64Bn(sessionId)
    );

    const tx = await this.program.methods
      .withdrawCollateralWithSession(amount)
      .accounts({
        relayer,
        owner,
        market,
        session: sessionAddress,
        marginAccount,
        ownerTokenAccount,
        vault: marketAccount.vault,
        sharedVaultAuthority: this.getSharedVaultAuthorityAddress(marketAccount.collateralMint),
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .transaction();
    return this.sendTransactionWithPolling(tx);
  }

  async withdrawCollateralWithSessionV2(
    market: PublicKey,
    owner: PublicKey,
    sessionId: BN | number,
    amount: BN
  ): Promise<string> {
    const relayer = this.provider.wallet.publicKey;
    const marketAccount = await this.getMarket(market);
    const marginAccount = this.getMarginAccountAddress(owner);
    const ownerTokenAccount = await getAssociatedTokenAddress(
      marketAccount.collateralMint,
      owner
    );
    const sessionAddress = this.getTradeSessionV2Address(owner, this.toU64Bn(sessionId));

    const methods = (this.program as any).methods;
    if (!methods?.withdrawCollateralWithSessionV2) {
      throw new Error(
        "withdrawCollateralWithSessionV2 is unavailable in the loaded IDL. Rebuild/sync IDL first."
      );
    }

    const tx = await methods
      .withdrawCollateralWithSessionV2(amount)
      .accounts({
        relayer,
        owner,
        market,
        session: sessionAddress,
        marginAccount,
        ownerTokenAccount,
        vault: marketAccount.vault,
        sharedVaultAuthority: this.getSharedVaultAuthorityAddress(marketAccount.collateralMint),
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .transaction();
    return this.sendTransactionWithPolling(tx);
  }

  // ============ POSITION OPERATIONS ============

  /**
   * Open a new encrypted position
   *
   * All position parameters are encrypted client-side using Rescue cipher
   * before being submitted. The Solana program queues the encrypted data
   * to Arcium's MPC network for validation via queue_computation CPI.
   *
   * Privacy: Size, leverage, direction, and entry price are encrypted.
   * Only the margin amount is visible on-chain after the callback.
   *
   * This method confirms the queue transaction only. Use
   * `openPositionAndFinalize(...)` when the caller needs a real `Open` state.
   */
  async openPosition(
    market: PublicKey,
    input: OpenPositionInput
  ): Promise<{ txSignature: string; positionAddress: PublicKey }> {
    if (!this.clientPublicKey || !this.cipher) {
      await this.initializeEncryption();
    }

    const owner = this.provider.wallet.publicKey;
    const marketAccount = await this.getMarket(market);
    const marginAccount = this.getMarginAccountAddress(owner);
    let marginSnapshot: MarginAccount;
    try {
      marginSnapshot = await this.getMarginAccount(marginAccount);
    } catch {
      throw new Error("Margin account not initialized. Deposit collateral first.");
    }

    // Generate nonce for encryption session
    const { bytes: nonceBytes, value: nonceBN } = this.generateNonce();

    // Encrypt the full open tuple in one batch so it matches Enc<Shared, (...)>.
    const {
      encryptedSize,
      encryptedEntryPrice,
      encryptedLeverage,
      encryptedIsLong,
      encryptedMargin,
    } = this.encryptOpenTuple(input, nonceBytes);

    const computationOffset = await this.nextComputationOffset();
    const positionAddress = this.getPositionAddress(
      market,
      owner,
      marginSnapshot.positionsOpened
    );
    const mxeAccount = this.getMXEPda();
    const compDefAccount = marketAccount.openPositionCompDef;
    if (!compDefAccount) {
      throw new Error("Market open_position comp-def is not configured on-chain.");
    }
    const computationAccount = getComputationAccAddress(
      this.config.clusterOffset,
      computationOffset
    );

    const marginModeFlag = (input.marginMode ?? "cross") === "isolated" ? 1 : 0;
    const isLong = input.direction === "long";

    const fundingStatePda = await this.resolveFundingStatePda(market);
    const [posFundingRefPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("pos-funding"), positionAddress.toBuffer()],
      this.config.programId
    );

    const tx = await this.program.methods
      .openPosition(
        Array.from(encryptedSize),
        Array.from(encryptedEntryPrice),
        Array.from(encryptedLeverage),
        Array.from(encryptedIsLong),
        Array.from(encryptedMargin),
        marginModeFlag,
        input.margin,
        isLong,
        Array.from(this.clientPublicKey!),
        nonceBN,
        computationOffset
      )
      .accounts({
        owner,
        market,
        marginAccount,
        position: positionAddress,
        fundingState: fundingStatePda,
        posFundingRef: posFundingRefPda,
        mxeAccount,
        compDefAccount,
        clusterAccount: this.config.clusterAddress,
        mempoolAccount: this.config.mempoolAccount,
        executingPool: this.config.executingPool,
        computationAccount,
        poolAccount: this.config.poolAccount,
        signPdaAccount: this.config.signPdaAccount,
        arciumProgram: this.config.arciumProgramId,
        systemProgram: SystemProgram.programId,
        clockAccount: getClockAccAddress(),
      })
      .transaction();

    const signature = await this.sendTransactionWithPolling(tx);

    return { txSignature: signature, positionAddress };
  }

  /**
   * Relayer path: open encrypted position under an owner-approved delegated session.
   * The relayer signs/pays the tx; the owner's margin/position accounts are affected.
   *
   * This method confirms the queue transaction only. Use
   * `openPositionWithSessionAndFinalize(...)` when the caller needs a real `Open` state.
   */
  async openPositionWithSession(
    market: PublicKey,
    owner: PublicKey,
    sessionId: BN | number,
    input: OpenPositionInput
  ): Promise<{ txSignature: string; positionAddress: PublicKey }> {
    if (!this.clientPublicKey || !this.cipher) {
      await this.initializeEncryption();
    }

    const relayer = this.provider.wallet.publicKey;
    const marketAccount = await this.getMarket(market);
    const marginAccount = this.getMarginAccountAddress(owner);
    const marginSnapshot = await this.getMarginAccount(marginAccount);
    const sessionAddress = this.getTradeSessionAddress(market, owner, this.toU64Bn(sessionId));

    const { bytes: nonceBytes, value: nonceBN } = this.generateNonce();
    const {
      encryptedSize,
      encryptedEntryPrice,
      encryptedLeverage,
      encryptedIsLong,
      encryptedMargin,
    } = this.encryptOpenTuple(input, nonceBytes);

    const computationOffset = await this.nextComputationOffset();
    const positionAddress = this.getPositionAddress(market, owner, marginSnapshot.positionsOpened);
    const mxeAccount = this.getMXEPda();
    const compDefAccount = marketAccount.openPositionCompDef;
    if (!compDefAccount) {
      throw new Error("Market open_position comp-def is not configured on-chain.");
    }
    const computationAccount = getComputationAccAddress(
      this.config.clusterOffset,
      computationOffset
    );

    const marginModeFlag = (input.marginMode ?? "cross") === "isolated" ? 1 : 0;
    const isLong = input.direction === "long";

    const fundingStatePda = await this.resolveFundingStatePda(market);
    const [posFundingRefPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("pos-funding"), positionAddress.toBuffer()],
      this.config.programId
    );

    const tx = await this.program.methods
      .openPositionWithSession(
        Array.from(encryptedSize),
        Array.from(encryptedEntryPrice),
        Array.from(encryptedLeverage),
        Array.from(encryptedIsLong),
        Array.from(encryptedMargin),
        marginModeFlag,
        input.margin,
        isLong,
        Array.from(this.clientPublicKey!),
        nonceBN,
        computationOffset
      )
      .accounts({
        relayer,
        owner,
        market,
        session: sessionAddress,
        marginAccount,
        position: positionAddress,
        fundingState: fundingStatePda,
        posFundingRef: posFundingRefPda,
        mxeAccount,
        compDefAccount,
        clusterAccount: this.config.clusterAddress,
        mempoolAccount: this.config.mempoolAccount,
        executingPool: this.config.executingPool,
        computationAccount,
        poolAccount: this.config.poolAccount,
        signPdaAccount: this.config.signPdaAccount,
        arciumProgram: this.config.arciumProgramId,
        systemProgram: SystemProgram.programId,
        clockAccount: getClockAccAddress(),
      })
      .transaction();

    const signature = await this.sendTransactionWithPolling(tx);

    return { txSignature: signature, positionAddress };
  }

  async openPositionWithSessionV2(
    market: PublicKey,
    owner: PublicKey,
    sessionId: BN | number,
    input: OpenPositionInput
  ): Promise<{ txSignature: string; positionAddress: PublicKey }> {
    if (!this.clientPublicKey || !this.cipher) {
      await this.initializeEncryption();
    }

    const relayer = this.provider.wallet.publicKey;
    const marketAccount = await this.getMarket(market);
    const marginAccount = this.getMarginAccountAddress(owner);
    const marginSnapshot = await this.getMarginAccount(marginAccount);
    const sessionAddress = this.getTradeSessionV2Address(owner, this.toU64Bn(sessionId));

    const { bytes: nonceBytes, value: nonceBN } = this.generateNonce();
    const {
      encryptedSize,
      encryptedEntryPrice,
      encryptedLeverage,
      encryptedIsLong,
      encryptedMargin,
    } = this.encryptOpenTuple(input, nonceBytes);

    const computationOffset = await this.nextComputationOffset();
    const positionAddress = this.getPositionAddress(market, owner, marginSnapshot.positionsOpened);
    const mxeAccount = this.getMXEPda();
    const compDefAccount = marketAccount.openPositionCompDef;
    if (!compDefAccount) {
      throw new Error("Market open_position comp-def is not configured on-chain.");
    }
    const computationAccount = getComputationAccAddress(
      this.config.clusterOffset,
      computationOffset
    );

    const marginModeFlag = (input.marginMode ?? "cross") === "isolated" ? 1 : 0;
    const isLong = input.direction === "long";
    const methods = (this.program as any).methods;
    if (!methods?.openPositionWithSessionV2) {
      throw new Error(
        "openPositionWithSessionV2 is unavailable in the loaded IDL. Rebuild/sync IDL first."
      );
    }

    const fundingStatePda = await this.resolveFundingStatePda(market);
    const [posFundingRefPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("pos-funding"), positionAddress.toBuffer()],
      this.config.programId
    );

    const tx = await methods
      .openPositionWithSessionV2(
        Array.from(encryptedSize),
        Array.from(encryptedEntryPrice),
        Array.from(encryptedLeverage),
        Array.from(encryptedIsLong),
        Array.from(encryptedMargin),
        marginModeFlag,
        input.margin,
        isLong,
        Array.from(this.clientPublicKey!),
        nonceBN,
        computationOffset
      )
      .accounts({
        relayer,
        owner,
        market,
        session: sessionAddress,
        marginAccount,
        position: positionAddress,
        fundingState: fundingStatePda,
        posFundingRef: posFundingRefPda,
        mxeAccount,
        compDefAccount,
        clusterAccount: this.config.clusterAddress,
        mempoolAccount: this.config.mempoolAccount,
        executingPool: this.config.executingPool,
        computationAccount,
        poolAccount: this.config.poolAccount,
        signPdaAccount: this.config.signPdaAccount,
        arciumProgram: this.config.arciumProgramId,
        systemProgram: SystemProgram.programId,
        clockAccount: getClockAccAddress(),
      })
      .transaction();

    const signature = await this.sendTransactionWithPolling(tx);
    return { txSignature: signature, positionAddress };
  }

  async waitForOpenPositionFinalization(
    positionAddress: PublicKey,
    options?: { timeoutMs?: number; pollMs?: number }
  ): Promise<EncryptedPosition> {
    const timeoutMs = options?.timeoutMs ?? DEFAULT_POSITION_STATUS_TIMEOUT_MS;
    const pollMs = options?.pollMs ?? DEFAULT_POSITION_STATUS_POLL_MS;
    const deadline = Date.now() + timeoutMs;
    let lastStatus: PositionStatus | null = null;
    let lastPendingComputationAddress: PublicKey | null = null;
    let nextCallbackDiagnosisAt = 0;

    while (Date.now() < deadline) {
      try {
        const position = await this.getPosition(positionAddress);
        const status = normalizeStatus(position.status) as PositionStatus;
        lastStatus = status;

        if (status === PositionStatus.Open) {
          return position;
        }

        if (status === PositionStatus.Pending) {
          const pendingComputation = parsePendingComputationAccount(position);
          if (pendingComputation) {
            lastPendingComputationAddress = pendingComputation;
          }

          if (Date.now() >= nextCallbackDiagnosisAt) {
            nextCallbackDiagnosisAt = Date.now() + OPEN_POSITION_CALLBACK_DIAG_POLL_MS;
            const callbackFailure = await this.diagnoseOpenCallbackFailure(
              positionAddress,
              lastPendingComputationAddress
            );
            if (callbackFailure) {
              throw new Error(callbackFailure);
            }
          }
        } else if (status === PositionStatus.Closed) {
          const callbackFailure = await this.diagnoseOpenCallbackFailure(
            positionAddress,
            lastPendingComputationAddress
          );
          throw new Error(
            callbackFailure ??
              `Queued on Arcium cluster ${this.config.clusterOffset}, but the position resolved to Closed instead of Open.`
          );
        } else {
          throw new Error(
            `Queued on Arcium cluster ${this.config.clusterOffset}, but the position entered unexpected status ${PositionStatus[status] ?? status}.`
          );
        }
      } catch (error: any) {
        if (!isMissingAccountError(error)) {
          throw error;
        }
      }

      const remainingMs = deadline - Date.now();
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(pollMs, Math.max(remainingMs, 0)))
      );
    }

    const callbackFailure = await this.diagnoseOpenCallbackFailure(
      positionAddress,
      lastPendingComputationAddress
    );
    if (callbackFailure) {
      throw new Error(callbackFailure);
    }

    const statusLabel =
      lastStatus === null ? "no position state observed yet" : PositionStatus[lastStatus];
    throw new Error(
      `Queued on Arcium cluster ${this.config.clusterOffset}, but no MPC callback finalized the position within ${timeoutMs / 1000}s (${statusLabel}).`
    );
  }

  async openPositionAndFinalize(
    market: PublicKey,
    input: OpenPositionInput,
    options?: { timeoutMs?: number; pollMs?: number }
  ): Promise<OpenPositionSubmission & { position: EncryptedPosition }> {
    const queued = await this.openPosition(market, input);
    const position = await this.waitForOpenPositionFinalization(queued.positionAddress, options);
    return { ...queued, position };
  }

  async openPositionWithSessionAndFinalize(
    market: PublicKey,
    owner: PublicKey,
    sessionId: BN | number,
    input: OpenPositionInput,
    options?: { timeoutMs?: number; pollMs?: number }
  ): Promise<OpenPositionSubmission & { position: EncryptedPosition }> {
    const queued = await this.openPositionWithSession(market, owner, sessionId, input);
    const position = await this.waitForOpenPositionFinalization(queued.positionAddress, options);
    return { ...queued, position };
  }

  async openPositionWithSessionV2AndFinalize(
    market: PublicKey,
    owner: PublicKey,
    sessionId: BN | number,
    input: OpenPositionInput,
    options?: { timeoutMs?: number; pollMs?: number }
  ): Promise<OpenPositionSubmission & { position: EncryptedPosition }> {
    const queued = await this.openPositionWithSessionV2(market, owner, sessionId, input);
    const position = await this.waitForOpenPositionFinalization(queued.positionAddress, options);
    return { ...queued, position };
  }

  /**
   * Close an existing position - triggers PnL computation and reveal
   */
  async closePosition(
    market: PublicKey,
    positionIndex: BN
  ): Promise<string> {
    const owner = this.provider.wallet.publicKey;
    const marketAccount = await this.getMarket(market);
    const marginAccount = this.getMarginAccountAddress(owner);
    const positionAddress = this.getPositionAddress(market, owner, positionIndex);
    const computationOffset = await this.nextComputationOffset();
    const computationAccount = getComputationAccAddress(
      this.config.clusterOffset,
      computationOffset
    );

    const tx = await this.program.methods
      .closePosition(computationOffset)
      .accounts({
        owner,
        market,
        position: positionAddress,
        marginAccount,
        mxeAccount: this.getMXEPda(),
        compDefAccount: marketAccount.closePositionCompDef,
        clusterAccount: this.config.clusterAddress,
        mempoolAccount: this.config.mempoolAccount,
        executingPool: this.config.executingPool,
        computationAccount,
        poolAccount: this.config.poolAccount,
        signPdaAccount: this.config.signPdaAccount,
        arciumProgram: this.config.arciumProgramId,
        systemProgram: SystemProgram.programId,
        clockAccount: getClockAccAddress(),
      })
      .transaction();
    return this.sendTransactionWithPolling(tx);
  }

  /**
   * Relayer path: close position under an owner-approved delegated session.
   */
  async closePositionWithSession(
    market: PublicKey,
    owner: PublicKey,
    sessionId: BN | number,
    positionIndex: BN
  ): Promise<string> {
    const relayer = this.provider.wallet.publicKey;
    const marketAccount = await this.getMarket(market);
    const marginAccount = this.getMarginAccountAddress(owner);
    const positionAddress = this.getPositionAddress(market, owner, positionIndex);
    const sessionAddress = this.getTradeSessionAddress(market, owner, this.toU64Bn(sessionId));
    const computationOffset = await this.nextComputationOffset();
    const computationAccount = getComputationAccAddress(
      this.config.clusterOffset,
      computationOffset
    );

    const tx = await this.program.methods
      .closePositionWithSession(computationOffset)
      .accounts({
        relayer,
        owner,
        market,
        session: sessionAddress,
        position: positionAddress,
        marginAccount,
        mxeAccount: this.getMXEPda(),
        compDefAccount: marketAccount.closePositionCompDef,
        clusterAccount: this.config.clusterAddress,
        mempoolAccount: this.config.mempoolAccount,
        executingPool: this.config.executingPool,
        computationAccount,
        poolAccount: this.config.poolAccount,
        signPdaAccount: this.config.signPdaAccount,
        arciumProgram: this.config.arciumProgramId,
        systemProgram: SystemProgram.programId,
        clockAccount: getClockAccAddress(),
      })
      .transaction();

    return this.sendTransactionWithPolling(tx);
  }

  async closePositionWithSessionV2(
    market: PublicKey,
    owner: PublicKey,
    sessionId: BN | number,
    positionIndex: BN
  ): Promise<string> {
    const relayer = this.provider.wallet.publicKey;
    const marketAccount = await this.getMarket(market);
    const marginAccount = this.getMarginAccountAddress(owner);
    const positionAddress = this.getPositionAddress(market, owner, positionIndex);
    const sessionAddress = this.getTradeSessionV2Address(owner, this.toU64Bn(sessionId));
    const computationOffset = await this.nextComputationOffset();
    const computationAccount = getComputationAccAddress(
      this.config.clusterOffset,
      computationOffset
    );

    const methods = (this.program as any).methods;
    if (!methods?.closePositionWithSessionV2) {
      throw new Error(
        "closePositionWithSessionV2 is unavailable in the loaded IDL. Rebuild/sync IDL first."
      );
    }

    const tx = await methods
      .closePositionWithSessionV2(computationOffset)
      .accounts({
        relayer,
        owner,
        market,
        session: sessionAddress,
        position: positionAddress,
        marginAccount,
        mxeAccount: this.getMXEPda(),
        compDefAccount: marketAccount.closePositionCompDef,
        clusterAccount: this.config.clusterAddress,
        mempoolAccount: this.config.mempoolAccount,
        executingPool: this.config.executingPool,
        computationAccount,
        poolAccount: this.config.poolAccount,
        signPdaAccount: this.config.signPdaAccount,
        arciumProgram: this.config.arciumProgramId,
        systemProgram: SystemProgram.programId,
        clockAccount: getClockAccAddress(),
      })
      .transaction();

    return this.sendTransactionWithPolling(tx);
  }

  /**
   * Check if a position can be liquidated (private health factor check)
   * Only returns boolean - health factor is NEVER revealed
   */
  async checkLiquidation(
    market: PublicKey,
    positionOwner: PublicKey,
    positionIndex: BN
  ): Promise<string> {
    const marketAccount = await this.getMarket(market);
    const positionAddress = this.getPositionAddress(market, positionOwner, positionIndex);
    const computationOffset = await this.nextComputationOffset();
    const computationAccount = getComputationAccAddress(
      this.config.clusterOffset,
      computationOffset
    );

    const tx = await this.program.methods
      .checkLiquidation(computationOffset)
      .accounts({
        liquidator: this.provider.wallet.publicKey,
        market,
        position: positionAddress,
        marginAccount: this.getMarginAccountAddress(positionOwner),
        liquidationSettlement: this.getLiquidationSettlementAddress(positionAddress),
        mxeAccount: this.getMXEPda(),
        compDefAccount: marketAccount.liquidationCompDef,
        clusterAccount: this.config.clusterAddress,
        mempoolAccount: this.config.mempoolAccount,
        executingPool: this.config.executingPool,
        computationAccount,
        poolAccount: this.config.poolAccount,
        signPdaAccount: this.config.signPdaAccount,
        arciumProgram: this.config.arciumProgramId,
        systemProgram: SystemProgram.programId,
        clockAccount: getClockAccAddress(),
      })
      .transaction();
    return this.sendTransactionWithPolling(tx);
  }

  async settleClosePosition(
    market: PublicKey,
    positionOwner: PublicKey,
    positionIndex: BN,
    ownerTokenAccount: PublicKey
  ): Promise<string> {
    const payer = this.provider.wallet.publicKey;
    const marketAccount = await this.getMarket(market);
    const positionAddress = this.getPositionAddress(market, positionOwner, positionIndex);
    const methods = (this.program as any).methods;
    if (!methods?.settleClosePosition) {
      throw new Error(
        "settleClosePosition is unavailable in the loaded IDL. Rebuild/sync IDL first."
      );
    }

    const fundingStatePda = await this.resolveFundingStatePda(market);
    const [posFundingRefPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("pos-funding"), positionAddress.toBuffer()],
      this.config.programId
    );

    const tx = await methods
      .settleClosePosition()
      .accounts({
        payer,
        position: positionAddress,
        market,
        ownerTokenAccount,
        vault: marketAccount.vault,
        sharedVaultAuthority: this.getSharedVaultAuthorityAddress(marketAccount.collateralMint),
        posFundingRef: posFundingRefPda,
        fundingState: fundingStatePda,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .transaction();

    return this.sendTransactionWithPolling(tx);
  }

  async settleLiquidation(
    market: PublicKey,
    positionOwner: PublicKey,
    positionIndex: BN,
    liquidatorTokenAccount: PublicKey
  ): Promise<string> {
    const payer = this.provider.wallet.publicKey;
    const liquidator = this.provider.wallet.publicKey;
    const marketAccount = await this.getMarket(market);
    const positionAddress = this.getPositionAddress(market, positionOwner, positionIndex);
    const methods = (this.program as any).methods;
    if (!methods?.settleLiquidation) {
      throw new Error(
        "settleLiquidation is unavailable in the loaded IDL. Rebuild/sync IDL first."
      );
    }

    const tx = await methods
      .settleLiquidation()
      .accounts({
        payer,
        liquidator,
        position: positionAddress,
        market,
        liquidationSettlement: this.getLiquidationSettlementAddress(positionAddress),
        liquidatorTokenAccount,
        vault: marketAccount.vault,
        sharedVaultAuthority: this.getSharedVaultAuthorityAddress(marketAccount.collateralMint),
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .transaction();

    return this.sendTransactionWithPolling(tx);
  }

  async waitForPositionStatus(
    positionAddress: PublicKey,
    acceptedStatuses: PositionStatus[],
    options?: { timeoutMs?: number; pollMs?: number }
  ): Promise<EncryptedPosition> {
    const timeoutMs = options?.timeoutMs ?? DEFAULT_POSITION_STATUS_TIMEOUT_MS;
    const pollMs = options?.pollMs ?? DEFAULT_POSITION_STATUS_POLL_MS;
    const deadline = Date.now() + timeoutMs;
    const accepted = new Set<number>(acceptedStatuses as number[]);
    let lastStatus: PositionStatus | null = null;

    while (Date.now() < deadline) {
      try {
        const position = await this.getPosition(positionAddress);
        const statusNum = normalizeStatus(position.status);
        lastStatus = statusNum as PositionStatus;
        if (accepted.has(statusNum)) {
          return position;
        }
      } catch (error: any) {
        if (!isMissingAccountError(error)) {
          throw error;
        }
      }

      const remainingMs = deadline - Date.now();
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(pollMs, Math.max(remainingMs, 0)))
      );
    }

    const statusLabel =
      lastStatus === null ? "no position state observed yet" : (PositionStatus[lastStatus] ?? `unknown(${lastStatus})`);
    throw new Error(
      `Position did not reach an expected settlement state within ${timeoutMs / 1000}s (${statusLabel}).`
    );
  }

  async finalizeClosePosition(
    market: PublicKey,
    positionOwner: PublicKey,
    positionIndex: BN,
    ownerTokenAccount: PublicKey,
    options?: { timeoutMs?: number; pollMs?: number }
  ): Promise<{ positionAddress: PublicKey; settleTxSignature: string | null; status: PositionStatus }> {
    const positionAddress = this.getPositionAddress(market, positionOwner, positionIndex);
    const callbackResult = await this.waitForPositionStatus(
      positionAddress,
      [PositionStatus.ClosedPendingSettlement, PositionStatus.Closed],
      options
    );
    if (callbackResult.status === PositionStatus.Closed) {
      return { positionAddress, settleTxSignature: null, status: PositionStatus.Closed };
    }

    const settleTxSignature = await this.settleClosePosition(
      market,
      positionOwner,
      positionIndex,
      ownerTokenAccount
    );
    await this.waitForPositionStatus(positionAddress, [PositionStatus.Closed], options);
    return { positionAddress, settleTxSignature, status: PositionStatus.Closed };
  }

  async finalizeLiquidation(
    market: PublicKey,
    positionOwner: PublicKey,
    positionIndex: BN,
    liquidatorTokenAccount: PublicKey,
    options?: { timeoutMs?: number; pollMs?: number }
  ): Promise<{ positionAddress: PublicKey; settleTxSignature: string | null; status: PositionStatus }> {
    const positionAddress = this.getPositionAddress(market, positionOwner, positionIndex);
    const callbackResult = await this.waitForPositionStatus(
      positionAddress,
      [PositionStatus.LiquidatedPendingSettlement, PositionStatus.Liquidated],
      options
    );
    if (callbackResult.status === PositionStatus.Liquidated) {
      return { positionAddress, settleTxSignature: null, status: PositionStatus.Liquidated };
    }

    const settleTxSignature = await this.settleLiquidation(
      market,
      positionOwner,
      positionIndex,
      liquidatorTokenAccount
    );
    await this.waitForPositionStatus(positionAddress, [PositionStatus.Liquidated], options);
    return { positionAddress, settleTxSignature, status: PositionStatus.Liquidated };
  }

  // ============ QUERY ============

  async getPosition(positionAddress: PublicKey): Promise<EncryptedPosition> {
    const account = await this.program.account.position.fetch(positionAddress);
    return account as unknown as EncryptedPosition;
  }

  async getUserPositions(market: PublicKey, owner: PublicKey): Promise<EncryptedPosition[]> {
    const accounts = await this.program.account.position.all([
      { memcmp: { offset: 8, bytes: owner.toBase58() } },
      { memcmp: { offset: 8 + 32, bytes: market.toBase58() } },
    ]);
    return accounts.map((a: any) => a.account as unknown as EncryptedPosition);
  }

  async getUserPositionAccounts(market: PublicKey, owner: PublicKey): Promise<Array<{ publicKey: PublicKey; account: EncryptedPosition }>> {
    const accounts = await this.program.account.position.all([
      { memcmp: { offset: 8, bytes: owner.toBase58() } },
      { memcmp: { offset: 8 + 32, bytes: market.toBase58() } },
    ]);
    return accounts.map((a: any) => ({
      publicKey: a.publicKey,
      account: a.account as unknown as EncryptedPosition,
    }));
  }

  async getUserPositionAccountsAcrossMarkets(
    markets: PublicKey[],
    owner: PublicKey
  ): Promise<Array<{ publicKey: PublicKey; account: EncryptedPosition }>> {
    const dedupedMarkets = Array.from(
      new Map(markets.map((market) => [market.toBase58(), market])).values()
    );
    const settled = await Promise.allSettled(
      dedupedMarkets.map((market) => this.getUserPositionAccounts(market, owner))
    );
    const seen = new Set<string>();
    const merged: Array<{ publicKey: PublicKey; account: EncryptedPosition }> = [];

    for (const result of settled) {
      if (result.status !== "fulfilled") continue;
      for (const position of result.value) {
        const address = position.publicKey.toBase58();
        if (seen.has(address)) continue;
        seen.add(address);
        merged.push(position);
      }
    }

    return merged;
  }

  async getOwnerCollateralTokenAccount(market: PublicKey): Promise<PublicKey> {
    const owner = this.provider.wallet.publicKey;
    const marketAccount = await this.getMarket(market);
    return getAssociatedTokenAddress(marketAccount.collateralMint, owner);
  }

  // ============ ORACLE ============

  /**
   * Update the on-chain oracle price. Caller must be the authorized price feeder.
   */
  async updateOraclePrice(
    market: PublicKey,
    priceFeeder: PublicKey,
    priceMicro: BN
  ): Promise<string> {
    const tx = await this.program.methods
      .updatePrice(priceMicro)
      .accounts({
        priceFeeder,
        market,
      })
      .transaction();
    return this.sendTransactionWithPolling(tx);
  }

  // ============ EVENTS ============

  onPositionOpened(callback: (event: any, slot: number) => void): number {
    return this.program.addEventListener("PositionOpened", callback);
  }

  onPositionClosed(callback: (event: any, slot: number) => void): number {
    return this.program.addEventListener("PositionClosed", callback);
  }

  onPositionLiquidated(callback: (event: any, slot: number) => void): number {
    return this.program.addEventListener("PositionLiquidated", callback);
  }

  async removeEventListener(listenerId: number): Promise<void> {
    await this.program.removeEventListener(listenerId);
  }
}
