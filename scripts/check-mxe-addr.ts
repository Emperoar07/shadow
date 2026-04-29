import { getMXEAccAddress } from "@arcium-hq/client";
import { PublicKey } from "@solana/web3.js";

const pid = new PublicKey("34wszdEvGvyAVADY7ozpbdAvAB9zHRBTaT1YsNcpRJdo");
console.log("SDK MXE address:", getMXEAccAddress(pid).toBase58());

// The CLI error showed it tried to allocate 123bSDnqkixpSYpwWREQtcsm9JFnhHYzaZTjyiwrj1WE
// That's the recovery cluster account, not MXE itself
// Our MXE is at 6g8qLaEMJW1BmqWFYovRkkpbNmB2KSZopbeAp1fTamV8
