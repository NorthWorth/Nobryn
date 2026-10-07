/**
 * Integration adapter boundary.
 *
 * External systems (simulated today, real later) sit behind adapters that
 * translate their payloads into Nobryn's normalized event model. The domain
 * only ever sees NormalizedEvent — it never depends on a specific supplier,
 * warehouse, logistics provider or ERP implementation.
 *
 *   EXTERNAL SYSTEM -> INTEGRATION ADAPTER -> EVENT INGESTION -> NORMALIZATION
 *   -> VALIDATION -> DOMAIN EVENT / CLAIM -> VERIFICATION -> RECONCILIATION
 *   -> STATE MACHINE -> EXCEPTION / COMPLETION
 */
import type { ExternalEventType } from "../domain.js";

/** An event in Nobryn's normalized shape, ready for ingestion. */
export interface NormalizedEvent {
  type: ExternalEventType;
  source: string;
  /** Stable identifier of the original event where available (idempotency). */
  eventId?: string;
  /** Quantity claimed by the event, where the source reports one. */
  reportedQuantity?: number;
}

/**
 * A source of external events. Real integrations implement the same contract
 * the simulator implements today: translate raw input into a NormalizedEvent.
 */
export interface IntegrationAdapter {
  key: string;
  label: string;
  simulated: boolean;
  /** Translate raw input into the normalized model; throws ApiError when the
   * payload cannot be produced by this source. */
  normalize(input: unknown): NormalizedEvent;
}
