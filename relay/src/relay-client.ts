// Re-export everything from the app's server relay-client.
// Railway deploys from repo root so this path resolves correctly.
export {
  createRelayRuntimeContext,
  summarizeRelayRuntime,
} from "../../app/src/lib/server/relay-client";

export type {
  RelayRuntimeContext,
  RelayRuntimeSummary,
} from "../../app/src/lib/server/relay-client";

export type { ShadowPerpConfig } from "../../app/src/types";
export { ShadowPerpClient } from "../../app/src/lib/client";
