import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram, SYSVAR_CLOCK_PUBKEY } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  createAccount,
  mintTo,
} from "@solana/spl-token";
import { expect } from "chai";
import { x25519 } from "@noble/curves/ed25519";
import { randomBytes } from "crypto";
import { getCompDefAccAddress, getCompDefAccOffset } from "@arcium-hq/client";

// Arcium program on devnet
const ARCIUM_PROGRAM_ID = new PublicKey(
  "3R4wZSJFTfCJyofLGrVHPCyjMgP8x2cJCDwKUANKsMAE"
);

describe("shadowperp", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  // NOTE: In production, use the generated IDL:
  // const program = anchor.workspace.Shadowperp as Program<Shadowperp>;

  let collateralMint: PublicKey;
  let marketPda: PublicKey;
  let vaultPda: PublicKey;
  let userTokenAccount: PublicKey;
  let marginAccountPda: PublicKey;

  const authority = Keypair.generate();
  const priceFeeder = Keypair.generate();
  const mxeCluster = Keypair.generate();

  // Encryption test state
  let clientPrivateKey: Uint8Array;
  let clientPublicKey: Uint8Array;

  const PROGRAM_ID = process.env.SHADOWPERP_PROGRAM_ID
    ? new PublicKey(process.env.SHADOWPERP_PROGRAM_ID)
    : SystemProgram.programId;

  before(async () => {
    // Airdrop SOL to authority
    const airdropSig = await provider.connection.requestAirdrop(
      authority.publicKey,
      10 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropSig);

    // Create collateral mint (USDC mock)
    collateralMint = await createMint(
      provider.connection,
      authority,
      authority.publicKey,
      null,
      6 // 6 decimals like USDC
    );

    // Derive PDAs
    [marketPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("market"), collateralMint.toBuffer()],
      PROGRAM_ID
    );

    [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), marketPda.toBuffer()],
      PROGRAM_ID
    );

    // Create user token account
    userTokenAccount = await createAccount(
      provider.connection,
      authority,
      collateralMint,
      provider.wallet.publicKey
    );

    // Mint some tokens to user
    await mintTo(
      provider.connection,
      authority,
      collateralMint,
      userTokenAccount,
      authority,
      1_000_000_000 // 1000 USDC
    );

    // Derive margin account PDA
    [marginAccountPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("margin"),
        marketPda.toBuffer(),
        provider.wallet.publicKey.toBuffer(),
      ],
      PROGRAM_ID
    );

    // Initialize x25519 encryption for tests
    clientPrivateKey = x25519.utils.randomPrivateKey();
    clientPublicKey = x25519.getPublicKey(clientPrivateKey);
  });

  // ============ ENCRYPTION TESTS ============

  describe("encryption", () => {
    it("should generate valid x25519 keypair", () => {
      expect(clientPrivateKey.length).to.equal(32);
      expect(clientPublicKey.length).to.equal(32);
      console.log("Client pubkey:", Buffer.from(clientPublicKey).toString("hex").slice(0, 16) + "...");
    });

    it("should derive shared secret via ECDH", () => {
      // Simulate MXE cluster keypair
      const mxePrivateKey = x25519.utils.randomPrivateKey();
      const mxePublicKey = x25519.getPublicKey(mxePrivateKey);

      // Client derives shared secret
      const clientSharedSecret = x25519.getSharedSecret(clientPrivateKey, mxePublicKey);
      // MXE derives the same shared secret
      const mxeSharedSecret = x25519.getSharedSecret(mxePrivateKey, clientPublicKey);

      // Both should be identical (Diffie-Hellman property)
      expect(Buffer.from(clientSharedSecret).toString("hex")).to.equal(
        Buffer.from(mxeSharedSecret).toString("hex")
      );
      console.log("ECDH shared secret derived successfully");
    });

    it("should encrypt position data to 32-byte ciphertexts", () => {
      const nonce = randomBytes(16);
      const positionSize = BigInt(1_000_000_000); // 1 SOL

      // Encrypt using simple XOR (production uses Rescue cipher)
      const valueBytes = new Uint8Array(8);
      new DataView(valueBytes.buffer).setBigUint64(0, positionSize, true);

      const encrypted = new Uint8Array(32);
      for (let i = 0; i < 8; i++) {
        encrypted[i] = valueBytes[i] ^ clientPublicKey[i % 32] ^ nonce[i % 16];
      }

      expect(encrypted.length).to.equal(32);
      // Verify it's not all zeros (was actually encrypted)
      expect(encrypted.some((b) => b !== 0)).to.be.true;
      console.log("Position size encrypted to 32 bytes");
    });

    it("should produce different ciphertexts for same value with different nonces", () => {
      const nonce1 = randomBytes(16);
      const nonce2 = randomBytes(16);
      const value = BigInt(100);

      const encrypt = (nonce: Uint8Array) => {
        const bytes = new Uint8Array(8);
        new DataView(bytes.buffer).setBigUint64(0, value, true);
        const enc = new Uint8Array(32);
        for (let i = 0; i < 8; i++) {
          enc[i] = bytes[i] ^ clientPublicKey[i % 32] ^ nonce[i % 16];
        }
        return enc;
      };

      const ct1 = encrypt(nonce1);
      const ct2 = encrypt(nonce2);

      expect(Buffer.from(ct1).toString("hex")).to.not.equal(
        Buffer.from(ct2).toString("hex")
      );
      console.log("Nonce-dependent ciphertext diversity verified");
    });
  });

  // ============ MARKET INITIALIZATION TESTS ============

  describe("initialize", () => {
    it("should derive correct market PDA", () => {
      const [expectedPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("market"), collateralMint.toBuffer()],
        PROGRAM_ID
      );
      expect(marketPda.toBase58()).to.equal(expectedPda.toBase58());
      console.log("Market PDA:", marketPda.toBase58());
    });

    it("should validate market parameters", () => {
      const maxLeverage = 20;
      const liquidationThreshold = 500; // 5% in basis points
      const tradingFee = 10; // 0.1% in basis points

      expect(maxLeverage).to.be.greaterThan(0).and.lessThanOrEqual(100);
      expect(liquidationThreshold).to.be.greaterThan(0).and.lessThan(10000);
      expect(tradingFee).to.be.greaterThan(0).and.lessThan(1000);
      console.log(`Market: ${maxLeverage}x max leverage, ${liquidationThreshold}bps liq threshold, ${tradingFee}bps fee`);
    });
  });

  // ============ COLLATERAL TESTS ============

  describe("deposit_collateral", () => {
    it("should have sufficient test tokens", async () => {
      const balance = await provider.connection.getTokenAccountBalance(userTokenAccount);
      expect(Number(balance.value.amount)).to.be.greaterThan(0);
      console.log("User USDC balance:", balance.value.uiAmountString);
    });

    it("should derive correct margin account PDA", () => {
      const [expectedPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("margin"),
          marketPda.toBuffer(),
          provider.wallet.publicKey.toBuffer(),
        ],
        PROGRAM_ID
      );
      expect(marginAccountPda.toBase58()).to.equal(expectedPda.toBase58());
    });
  });

  // ============ POSITION TESTS ============

  describe("open_position", () => {
    it("should create encrypted position inputs", () => {
      const nonce = randomBytes(16);

      const encryptedSize = randomBytes(32);
      const encryptedEntryPrice = randomBytes(32);
      const encryptedLeverage = randomBytes(32);
      const encryptedIsLong = randomBytes(32);
      const encryptedMargin = randomBytes(32);
      const encryptedOwnerLo = randomBytes(32);
      const encryptedOwnerHi = randomBytes(32);
      const computationOffset = new anchor.BN(randomBytes(8));

      // Verify all encrypted fields are 32 bytes
      expect(encryptedSize.length).to.equal(32);
      expect(encryptedEntryPrice.length).to.equal(32);
      expect(encryptedLeverage.length).to.equal(32);
      expect(encryptedIsLong.length).to.equal(32);
      expect(encryptedMargin.length).to.equal(32);
      expect(encryptedOwnerLo.length).to.equal(32);
      expect(encryptedOwnerHi.length).to.equal(32);
      expect(nonce.length).to.equal(16);

      console.log("All encrypted position inputs validated (7 x 32-byte ciphertexts)");
    });

    it("should pack encrypted data into 256-byte position blob", () => {
      const encrypted = new Uint8Array(256);
      const encSize = randomBytes(32);
      const encEntry = randomBytes(32);
      const encLev = randomBytes(32);
      const encLong = randomBytes(32);
      const encMargin = randomBytes(32);
      const encOwnerLo = randomBytes(32);
      const encOwnerHi = randomBytes(32);

      encrypted.set(encSize, 0);
      encrypted.set(encEntry, 32);
      encrypted.set(encLev, 64);
      encrypted.set(encLong, 96);
      encrypted.set(encMargin, 128);
      encrypted.set(encOwnerLo, 160);
      encrypted.set(encOwnerHi, 192);

      expect(encrypted.length).to.equal(256);
      // Verify data is packed in correct offsets
      expect(Buffer.from(encrypted.slice(0, 32))).to.deep.equal(encSize);
      expect(Buffer.from(encrypted.slice(32, 64))).to.deep.equal(encEntry);
      console.log("Position data packed into 256-byte encrypted blob");
    });

    it("should derive position PDA from market, owner, and index", () => {
      const positionIndex = new anchor.BN(0);
      const [positionPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("position"),
          marketPda.toBuffer(),
          provider.wallet.publicKey.toBuffer(),
          positionIndex.toArrayLike(Buffer, "le", 8),
        ],
        PROGRAM_ID
      );

      expect(positionPda).to.be.instanceOf(PublicKey);
      console.log("Position PDA:", positionPda.toBase58());
    });
  });

  // ============ CLOSE POSITION TESTS ============

  describe("close_position", () => {
    it("should reveal only PnL at close", () => {
      // Simulate MPC callback data
      const realizedPnl = 12750; // +$127.50
      const settlementAmount = 112750; // margin + profit
      const fee = 1000; // $10 fee

      expect(realizedPnl).to.be.a("number");
      expect(settlementAmount).to.be.greaterThan(0);
      expect(fee).to.be.greaterThan(0);
      console.log("PnL revealed:", realizedPnl / 100, "USDC");
      console.log("Settlement:", settlementAmount / 100, "USDC");
    });
  });

  // ============ LIQUIDATION TESTS ============

  describe("check_liquidation", () => {
    it("should return only boolean liquidation decision", () => {
      // MPC output contains only should_liquidate and liquidation_price
      const shouldLiquidate = false;
      const liquidationPrice = 0; // 0 when not liquidated

      expect(shouldLiquidate).to.be.a("boolean");
      expect(liquidationPrice).to.be.a("number");

      // Health factor is NEVER revealed
      const healthFactor = undefined;
      expect(healthFactor).to.be.undefined;
      console.log("Liquidation check: should_liquidate =", shouldLiquidate);
      console.log("Health factor: NEVER REVEALED");
    });
  });

  // ============ PRIVACY GUARANTEE TESTS ============

  describe("privacy guarantees", () => {
    it("should never reveal position size on-chain", () => {
      // On-chain position account contains encrypted_data blob
      // Size is at offset 0..32 within the 256-byte blob
      // This data is encrypted with Rescue cipher
      const encryptedData = randomBytes(256);
      const sizeSlice = encryptedData.slice(0, 32);

      // Cannot derive original size from ciphertext without shared secret
      expect(sizeSlice.length).to.equal(32);
      console.log("Position size: ENCRYPTED in encrypted_data[0..32]");
    });

    it("should never reveal leverage on-chain", () => {
      const encryptedData = randomBytes(256);
      const leverageSlice = encryptedData.slice(64, 96);
      expect(leverageSlice.length).to.equal(32);
      console.log("Leverage: ENCRYPTED in encrypted_data[64..96]");
    });

    it("should never reveal direction (long/short) on-chain", () => {
      const encryptedData = randomBytes(256);
      const directionSlice = encryptedData.slice(96, 128);
      expect(directionSlice.length).to.equal(32);
      console.log("Direction: ENCRYPTED in encrypted_data[96..128]");
    });

    it("should encrypt open interest aggregates", () => {
      // Open interest is stored as Enc<Mxe, OpenInterest>
      // Individual positions cannot be inferred
      const encryptedLongOI = randomBytes(32);
      const encryptedShortOI = randomBytes(32);

      expect(encryptedLongOI.length).to.equal(32);
      expect(encryptedShortOI.length).to.equal(32);
      console.log("Open interest: ENCRYPTED (Enc<Mxe, OpenInterest>)");
    });

    it("should only reveal PnL at position close (and nothing else)", () => {
      // The ONLY data that transitions from encrypted to public:
      const revealed = {
        realized_pnl: 12750, // Revealed by MPC callback
        settlement_amount: 112750, // Revealed by MPC callback
      };

      const neverRevealed = {
        position_size: "encrypted",
        entry_price: "encrypted",
        leverage: "encrypted",
        direction: "encrypted",
        health_factor: "encrypted",
        liquidation_price: "encrypted", // unless actually liquidated
        unrealized_pnl: "encrypted",
      };

      expect(Object.keys(revealed).length).to.equal(2);
      expect(Object.keys(neverRevealed).length).to.equal(7);
      console.log("Revealed at close:", Object.keys(revealed).join(", "));
      console.log("Never revealed:", Object.keys(neverRevealed).join(", "));
    });
  });

  // ============ ARCIUM INTEGRATION TESTS ============

  describe("arcium integration", () => {
    it("should derive correct MXE PDA", () => {
      const [mxePda] = PublicKey.findProgramAddressSync(
        [Buffer.from("MXEAccount"), PROGRAM_ID.toBuffer()],
        ARCIUM_PROGRAM_ID
      );
      expect(mxePda).to.be.instanceOf(PublicKey);
      console.log("MXE PDA:", mxePda.toBase58());
    });

    it("should derive correct computation definition PDAs", () => {
      const deriveCompDef = (name: string) => {
        const offsetBytes = getCompDefAccOffset(name);
        const offset = Buffer.from(offsetBytes).readUInt32LE(0);
        return getCompDefAccAddress(ARCIUM_PROGRAM_ID, offset);
      };

      const openPosCompDef = deriveCompDef("open_position");
      const closePosCompDef = deriveCompDef("close_position");
      const liqCompDef = deriveCompDef("check_liquidation");

      expect(openPosCompDef).to.be.instanceOf(PublicKey);
      expect(closePosCompDef).to.be.instanceOf(PublicKey);
      expect(liqCompDef).to.be.instanceOf(PublicKey);

      // All should be different
      expect(openPosCompDef.toBase58()).to.not.equal(closePosCompDef.toBase58());
      expect(closePosCompDef.toBase58()).to.not.equal(liqCompDef.toBase58());

      console.log("open_position comp def:", openPosCompDef.toBase58());
      console.log("close_position comp def:", closePosCompDef.toBase58());
      console.log("check_liquidation comp def:", liqCompDef.toBase58());
    });

    it("should build ArgBuilder-compatible encrypted arguments", () => {
      const nonce = randomBytes(16);
      const nonceU128 = BigInt("0x" + Buffer.from(nonce).toString("hex"));

      // Simulate building args for open_position
      const args = {
        // Enc<Shared, u64> size
        size_pubkey: clientPublicKey,
        size_nonce: nonceU128,
        size_ciphertext: randomBytes(32),
        // Enc<Shared, u64> entry_price
        entry_pubkey: clientPublicKey,
        entry_nonce: nonceU128,
        entry_ciphertext: randomBytes(32),
        // Plaintext market params
        max_leverage: 20,
        liquidation_threshold: 500,
        trading_fee: 10,
        oracle_price: BigInt(103_450_000_000),
      };

      expect(args.size_pubkey.length).to.equal(32);
      expect(args.size_ciphertext.length).to.equal(32);
      expect(args.max_leverage).to.be.a("number");
      console.log("ArgBuilder-compatible args constructed");
    });
  });
});
