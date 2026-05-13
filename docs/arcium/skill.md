---
name: Arcium
description: Use when building confidential applications on Solana that require encrypted computation, privacy-preserving smart contracts, or multi-party computation. Agents should reach for this skill when implementing MPC circuits, deploying MXEs (MPC eXecution Environments), integrating encrypted instructions with Solana programs, or handling encrypted data workflows.
metadata:
    mintlify-proj: arcium
    version: "1.0"
---

# Arcium Skill Reference

## Product summary

Arcium is a decentralized MPC (Multi-Party Computation) network integrated with Solana that enables confidential computation on encrypted data. It allows developers to build MXEs (MPC eXecution Environments)—applications that combine Solana smart contracts with encrypted business logic written in Arcis (a Rust framework). Computations execute on distributed Arx nodes using secret sharing, preserving privacy even if nodes are compromised. Key files: `Arcium.toml` (CLI config), `encrypted-ixs/` (Arcis circuits), `programs/` (Solana program). CLI: `arcium init`, `arcium build`, `arcium test`, `arcium deploy`. Primary docs: https://docs.arcium.com

## When to use

- **Building confidential DeFi**: Implement private transactions, sealed-bid auctions, or dark pools where order details remain encrypted
- **Encrypted data workflows**: Process sensitive data (healthcare, finance, supply chain) without exposing plaintext to any single party
- **Privacy-preserving smart contracts**: Add encrypted computation layers to existing Solana programs
- **Multi-party collaboration**: Enable organizations to compute on shared encrypted datasets without revealing raw data
- **Integrating MPC circuits**: When you need to invoke encrypted logic from Solana transactions and receive results via callbacks

## Quick reference

### Project structure
```
my-mxe/
+-- Arcium.toml           # CLI config (cluster offsets, localnet settings)
+-- Anchor.toml           # Solana program config
+-- encrypted-ixs/        # Arcis circuits (MPC logic)
¦   +-- add_together.rs   # Example: #[instruction] functions
+-- programs/             # Solana program (queues computations)
+-- tests/                # TypeScript integration tests
+-- build/                # Generated circuits, hashes, bytecode
```

### Essential CLI commands
| Command | Purpose |
|---------|---------|
| `arcium init <name>` | Create new MXE project |
| `arcium build` | Compile Arcis circuits + Solana program |
| `arcium test` | Run tests against localnet |
| `arcium test --cluster devnet` | Test against devnet (requires cluster offset in Arcium.toml) |
| `arcium deploy --cluster-offset 456 --recovery-set-size 4 --keypair-path ~/.config/solana/id.json --rpc-url <url>` | Deploy to devnet (offset 456) or mainnet (2026) |
| `arcium migrate-cluster <program-id> --cluster-offset <new-offset> --rpc-url <url>` | Move MXE to different cluster |

### Arcium.toml configuration
```toml
[localnet]
nodes = 2                    # Min 2 nodes for local testing
localnet_timeout_secs = 60

[clusters.devnet]
offset = 456                 # Devnet cluster offset

[clusters.mainnet]
offset = 2026                # Mainnet cluster offset
```

### Key offsets and identifiers
| Offset | Type | Example | Set by |
|--------|------|---------|--------|
| `cluster_offset` | u32 | 456 (devnet), 2026 (mainnet) | Deployment flag |
| `computation_offset` | u64 | Random per invocation | Generated in client code |
| `comp_def_offset` | u32 | `comp_def_offset("add_together")` | Macro from instruction name |

### Arcis instruction template
```rust
use arcis::*;

#[encrypted]
mod circuits {
    use arcis::*;

    #[instruction]
    pub fn my_computation(input: Enc<Shared, u64>) -> Enc<Shared, u64> {
        let value = input.to_arcis();      // Decrypt to secret shares
        let result = value * 2 + 10;       // Compute on shares
        input.owner.from_arcis(result)     // Re-encrypt for client
    }
}
```

### Solana program pattern (3 instructions per confidential operation)
```rust
const COMP_DEF_OFFSET: u32 = comp_def_offset("my_computation");

#[arcium_program]
pub mod my_mxe {
    // 1. Initialize computation definition (call once)
    pub fn init_my_computation_comp_def(ctx: Context<InitMyComputationCompDef>) -> Result<()> {
        init_comp_def(ctx.accounts, None, None)?;
        Ok(())
    }

    // 2. Queue computation with encrypted inputs
    pub fn my_computation(ctx: Context<MyComputation>, computation_offset: u64, ciphertext: [u8; 32]) -> Result<()> {
        let args = ArgBuilder::new().encrypted_u64(ciphertext).build();
        queue_computation(ctx.accounts, computation_offset, args, vec![...], 1, 0)?;
        Ok(())
    }

    // 3. Callback when MPC cluster finishes
    #[arcium_callback(encrypted_ix = "my_computation")]
    pub fn my_computation_callback(ctx: Context<MyComputationCallback>, output: SignedComputationOutputs<MyComputationOutput>) -> Result<()> {
        let result = output.verify_output(&ctx.accounts.cluster_account, &ctx.accounts.computation_account)?;
        // Handle result
        Ok(())
    }
}
```

## Decision guidance

| Scenario | Use Enc<Shared, T> | Use Enc<Mxe, T> |
|----------|-------------------|-----------------|
| Client needs to decrypt result | ? | ? |
| Only MXE should see data | ? | ? |
| Intermediate state in circuit | Either | Either |
| Sealing result for third party | ? (with re-encryption) | ? |

| Scenario | Use onchain circuit storage | Use offchain circuit storage |
|----------|---------------------------|---------------------------|
| Circuit < 1 MB | ? Simpler | ? |
| Circuit > 1 MB | ? Expensive | ? Recommended |
| Need immutability | ? | ? (requires hash verification) |
| Frequent updates | ? | ? |

| Scenario | Use localnet | Use devnet | Use mainnet |
|----------|------------|-----------|-----------|
| Development/testing | ? | ? | ? |
| Integration testing | ? | ? | ? |
| Production | ? | ? | ? |

## Workflow

### 1. Initialize and scaffold
```bash
arcium init my-confidential-app
cd my-confidential-app
```

### 2. Write Arcis circuit (encrypted-ixs/my_circuit.rs)
- Mark module with `#[encrypted]`
- Mark entry points with `#[instruction]`
- Use `Enc<Shared, T>` for client-visible data, `Enc<Mxe, T>` for MXE-only
- Call `.to_arcis()` to decrypt to secret shares, `.from_arcis()` to re-encrypt
- Avoid: `while`, `loop`, `match`, `Vec`, `String`, recursion, dynamic control flow

### 3. Create Solana program (programs/my_mxe/src/lib.rs)
- Use `#[arcium_program]` macro instead of `#[program]`
- For each confidential instruction, create three Solana instructions:
  - `init_<name>_comp_def()`: Initialize computation definition once
  - `<name>()`: Queue computation with encrypted inputs
  - `<name>_callback()`: Handle result from MPC cluster
- Use `queue_computation()` to submit work to Arcium program
- Use `verify_output()` to validate signed results

### 4. Write TypeScript tests (tests/my_test.ts)
- Generate x25519 keypair for encryption: `x25519.utils.randomSecretKey()`
- Fetch MXE public key: `getMXEPublicKeyWithRetry()`
- Derive shared secret: `x25519.getSharedSecret()`
- Encrypt inputs: `new RescueCipher(sharedSecret).encrypt(plaintext, nonce)`
- Queue computation with encrypted data
- Wait for callback: `awaitComputationFinalization()`
- Decrypt result with same cipher

### 5. Build and test locally
```bash
arcium build
arcium test
```

### 6. Deploy to devnet
```bash
arcium deploy --cluster-offset 456 --recovery-set-size 4 \
  --keypair-path ~/.config/solana/id.json \
  --rpc-url <your-devnet-rpc-url>
```

### 7. Initialize computation definitions on devnet
- Update cluster offset in Arcium.toml: `[clusters.devnet] offset = 456`
- Call `init_<name>_comp_def()` instruction once per circuit
- Verify with `arcium test --cluster devnet`

### 8. Deploy to mainnet (after devnet validation)
```bash
arcium deploy --cluster-offset 2026 --recovery-set-size 4 \
  --keypair-path ~/.config/solana/id.json \
  --rpc-url <your-mainnet-rpc-url>
```

## Common gotchas

- **RPC reliability is critical**: Default Solana RPC endpoints drop transactions. Use Helius, Triton, or QuickNode before deploying.
- **Both if/else branches execute in MPC**: When condition is secret, both paths run; the condition selects which result to keep. This is expensive—reuse comparison results.
- **Output size limit**: Computation results must fit in ~1232 bytes (single Solana transaction). Exceeding this causes `OutputTooLarge` error. Return compact results or split into multiple computations.
- **Computation lifecycle is async**: Unlike normal Solana transactions, computations queue ? execute offchain ? callback. Don't await transaction completion; use `awaitComputationFinalization()` instead.
- **Reveal and encryption placement**: `.reveal()` and `.from_arcis()` cannot appear inside conditional blocks. Extract to top level.
- **Circuit files are large**: Compiled Arcis circuits can be several MB. Use offchain storage (IPFS, S3) with `circuit_hash!` macro for production circuits.
- **Cluster offset must match**: Use same `cluster_offset` in deployment and test code. Mismatches cause PDA derivation failures.
- **Recovery set size is permanent**: Set `--recovery-set-size` during deployment; cannot change later without migration.
- **Computation definitions are one-time**: Call `init_comp_def()` once per circuit after deployment. Subsequent invocations reuse the same definition.
- **Division by zero is undefined**: If divisor could be zero from secret inputs, validate explicitly before division.
- **No Windows support**: Arcium CLI only supports Linux and macOS.

## Verification checklist

Before submitting work:

- [ ] `arcium build` completes without errors
- [ ] `arcium test` passes locally (localnet)
- [ ] Arcium.toml has correct cluster offset for target network
- [ ] All three instructions (init, queue, callback) are implemented per confidential operation
- [ ] Computation outputs fit within ~1232 bytes
- [ ] RPC URL is from reliable provider (not default Solana RPC)
- [ ] Keypair has sufficient SOL (2-5 SOL for devnet deployment)
- [ ] Offchain circuits use `circuit_hash!` macro, not placeholder hashes
- [ ] Callback authority keypair is different from node keypair (for node operators)
- [ ] `arcium test --cluster devnet` passes after deployment
- [ ] Computation definitions initialized onchain before first invocation
- [ ] No `.reveal()` or `.from_arcis()` inside conditional blocks
- [ ] No `while`, `loop`, `match`, `Vec`, `String` in Arcis code
- [ ] Divisors validated before division if dependent on secret inputs

## Resources

**Comprehensive navigation**: https://docs.arcium.com/llms.txt

**Critical documentation**:
- [Core Concepts](https://docs.arcium.com/developers/core-concepts) — MXE, Cluster, Confidential Instructions, offsets
- [Arcis Quick Reference](https://docs.arcium.com/developers/arcis/quick-reference) — Syntax, types, control flow, encryption patterns
- [Deployment Guide](https://docs.arcium.com/developers/deployment) — Cluster offsets, RPC setup, circuit storage, migration

---

> For additional documentation and navigation, see: https://docs.arcium.com/llms.txt
