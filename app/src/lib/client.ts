import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import {
  PublicKey,
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import {
  RescueCipher,
  getCompDefAccAddress,
  getCompDefAccOffset,
  getComputationAccAddress,
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
    // eslint-disable-next-line @typescript-eslint/no-require-imports
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
} from "../types";

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

  // Encryption state
  private clientPrivateKey: Uint8Array | null = null;
  private clientPublicKey: Uint8Array | null = null;
  private sharedSecret: Uint8Array | null = null;
  private cipher: RescueCipher | null = null;

  constructor(provider: AnchorProvider, config: ShadowPerpConfig) {
    this.provider = provider;
    this.config = config;
    this.program = new (Program as any)(config.idl, config.programId, provider);
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

    console.log("Arcium encryption initialized with MXE cluster");
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

  private generateNonce(): { bytes: Uint8Array; value: BN } {
    const bytes = randomBytes(16);
    const value = new BN(bytes, "le");
    return { bytes, value };
  }

  // ============ PDA DERIVATION ============

  getMXEPda(): PublicKey {
    return getMXEAccAddress(this.config.mxeProgramId);
  }

  getCompDefPda(instructionName: string): PublicKey {
    const offsetBytes = getCompDefAccOffset(instructionName);
    const offset = Buffer.from(offsetBytes).readUInt32LE(0);
    return getCompDefAccAddress(this.config.mxeProgramId, offset);
  }

  getMarketAddress(collateralMint: PublicKey): PublicKey {
    const [marketPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("market"), collateralMint.toBuffer()],
      this.config.programId
    );
    return marketPda;
  }

  async getMarket(marketAddress: PublicKey): Promise<Market> {
    const account = await this.program.account.market.fetch(marketAddress);
    return account as unknown as Market;
  }

  getMarginAccountAddress(market: PublicKey, owner: PublicKey): PublicKey {
    const [marginPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("margin"), market.toBuffer(), owner.toBuffer()],
      this.config.programId
    );
    return marginPda;
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

  // ============ COLLATERAL ============

  async depositCollateral(market: PublicKey, amount: BN): Promise<string> {
    const owner = this.provider.wallet.publicKey;
    const marketAccount = await this.getMarket(market);
    const marginAccount = this.getMarginAccountAddress(market, owner);
    const userTokenAccount = await getAssociatedTokenAddress(
      marketAccount.collateralMint, owner
    );
    const [vault] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), market.toBuffer()], this.config.programId
    );

    const tx = await this.program.methods
      .depositCollateral(amount)
      .accounts({
        owner, market, marginAccount, userTokenAccount, vault,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("Deposited collateral:", amount.toString());
    return tx;
  }

  async withdrawCollateral(market: PublicKey, amount: BN): Promise<string> {
    const owner = this.provider.wallet.publicKey;
    const marketAccount = await this.getMarket(market);
    const marginAccount = this.getMarginAccountAddress(market, owner);
    const userTokenAccount = await getAssociatedTokenAddress(
      marketAccount.collateralMint, owner
    );
    const [vault] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), market.toBuffer()], this.config.programId
    );

    const tx = await this.program.methods
      .withdrawCollateral(amount)
      .accounts({
        owner, market, marginAccount, userTokenAccount, vault,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    console.log("Withdrew collateral:", amount.toString());
    return tx;
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
    const marginAccount = this.getMarginAccountAddress(market, owner);

    // Generate nonce for encryption session
    const { bytes: nonceBytes, value: nonceBN } = this.generateNonce();

    // Encrypt all position parameters
    const encryptedSize = this.encryptU64(input.size, nonceBytes);
    const encryptedEntryPrice = this.encryptU64(input.entryPrice, nonceBytes);
    const encryptedLeverage = this.encryptU8(input.leverage, nonceBytes);
    const encryptedIsLong = this.encryptBool(input.direction === "long", nonceBytes);
    const encryptedMargin = this.encryptU64(input.margin, nonceBytes);

    // Encrypt owner pubkey as two u128 halves
    const ownerBytes = owner.toBytes();
    const ownerLo = BigInt("0x" + Buffer.from(ownerBytes.slice(0, 16)).reverse().toString("hex"));
    const ownerHi = BigInt("0x" + Buffer.from(ownerBytes.slice(16, 32)).reverse().toString("hex"));
    const encryptedOwnerLo = this.encryptU128(ownerLo, nonceBytes);
    const encryptedOwnerHi = this.encryptU128(ownerHi, nonceBytes);

    const computationOffset = new BN(randomBytes(8));
    const positionAddress = this.getPositionAddress(market, owner, marketAccount.activePositions);
    const mxeAccount = this.getMXEPda();
    const compDefAccount = this.getCompDefPda("open_position");
    const computationAccount = getComputationAccAddress(this.config.mxeProgramId, computationOffset);

    const tx = await this.program.methods
      .openPosition(
        Array.from(encryptedSize),
        Array.from(encryptedEntryPrice),
        Array.from(encryptedLeverage),
        Array.from(encryptedIsLong),
        Array.from(encryptedMargin),
        Array.from(encryptedOwnerLo),
        Array.from(encryptedOwnerHi),
        input.margin,
        Array.from(this.clientPublicKey!),
        nonceBN,
        computationOffset
      )
      .accounts({
        owner,
        market,
        marginAccount,
        position: positionAddress,
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
        clockAccount: SYSVAR_CLOCK_PUBKEY,
      })
      .rpc();

    console.log("Position opening queued for MPC");
    console.log("Position:", positionAddress.toBase58());

    return { txSignature: tx, positionAddress };
  }

  /**
   * Close an existing position - triggers PnL computation and reveal
   */
  async closePosition(
    market: PublicKey,
    positionIndex: BN,
    ownerTokenAccount: PublicKey
  ): Promise<string> {
    const owner = this.provider.wallet.publicKey;
    const marketAccount = await this.getMarket(market);
    const marginAccount = this.getMarginAccountAddress(market, owner);
    const positionAddress = this.getPositionAddress(market, owner, positionIndex);
    const computationOffset = new BN(randomBytes(8));
    const computationAccount = getComputationAccAddress(this.config.mxeProgramId, computationOffset);

    const tx = await this.program.methods
      .closePosition(computationOffset)
      .accounts({
        owner,
        market,
        position: positionAddress,
        marginAccount,
        ownerTokenAccount,
        vault: marketAccount.vault,
        mxeAccount: this.getMXEPda(),
        compDefAccount: this.getCompDefPda("close_position"),
        clusterAccount: this.config.clusterAddress,
        mempoolAccount: this.config.mempoolAccount,
        executingPool: this.config.executingPool,
        computationAccount,
        poolAccount: this.config.poolAccount,
        signPdaAccount: this.config.signPdaAccount,
        arciumProgram: this.config.arciumProgramId,
        systemProgram: SystemProgram.programId,
        clockAccount: SYSVAR_CLOCK_PUBKEY,
      })
      .rpc();

    console.log("Position close queued for MPC");
    return tx;
  }

  /**
   * Check if a position can be liquidated (private health factor check)
   * Only returns boolean - health factor is NEVER revealed
   */
  async checkLiquidation(
    market: PublicKey,
    positionOwner: PublicKey,
    positionIndex: BN,
    liquidatorTokenAccount: PublicKey
  ): Promise<string> {
    const marketAccount = await this.getMarket(market);
    const positionAddress = this.getPositionAddress(market, positionOwner, positionIndex);
    const computationOffset = new BN(randomBytes(8));
    const computationAccount = getComputationAccAddress(this.config.mxeProgramId, computationOffset);

    const tx = await this.program.methods
      .checkLiquidation(computationOffset)
      .accounts({
        liquidator: this.provider.wallet.publicKey,
        market,
        position: positionAddress,
        liquidatorTokenAccount,
        vault: marketAccount.vault,
        marginAccount: this.getMarginAccountAddress(market, positionOwner),
        mxeAccount: this.getMXEPda(),
        compDefAccount: this.getCompDefPda("check_liquidation"),
        clusterAccount: this.config.clusterAddress,
        mempoolAccount: this.config.mempoolAccount,
        executingPool: this.config.executingPool,
        computationAccount,
        poolAccount: this.config.poolAccount,
        signPdaAccount: this.config.signPdaAccount,
        arciumProgram: this.config.arciumProgramId,
        systemProgram: SystemProgram.programId,
        clockAccount: SYSVAR_CLOCK_PUBKEY,
      })
      .rpc();

    console.log("Liquidation check queued for MPC");
    return tx;
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

  async getOwnerCollateralTokenAccount(market: PublicKey): Promise<PublicKey> {
    const owner = this.provider.wallet.publicKey;
    const marketAccount = await this.getMarket(market);
    return getAssociatedTokenAddress(marketAccount.collateralMint, owner);
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
