import { z } from "zod";
import {
  describeRidePreferences,
  storedRidePreferences,
  type RidePreferences,
} from "@/modules/ride-preferences/domain/ride-preferences";

/** Port for a rider's saved preferences. Every call is for the signed-in account only. */
export interface RidePreferenceStore {
  read(userId: string): Promise<RidePreferences | null>;
  save(userId: string, preferences: RidePreferences): Promise<void>;
  clear(userId: string): Promise<void>;
}

export class RidePreferenceStoreError extends Error {
  override name = "RidePreferenceStoreError";
}

/** One verbatim record per rider; re-ingesting the same id updates it in place. */
export const RIDE_PREFERENCES_EXTERNAL_ID = "jala-ride-preferences";
const SOURCE_SITE = "jala";
// Reads sit in front of the planner, so they give up quickly; the planner then
// simply starts without saved defaults.
const READ_TIMEOUT_MS = 1_500;
const WRITE_TIMEOUT_MS = 4_000;
const LIST_LIMIT = 20;

/**
 * Atomic Memory subject for a Jala account. Built only from the session's user id, so
 * one rider can never read or overwrite another's preferences.
 */
export function memorySubject(userId: string) {
  return `jala-user:${userId}`;
}

const listResponse = z.object({
  memories: z.array(
    z.object({
      id: z.string().min(1),
      metadata: z.record(z.string(), z.unknown()).nullish(),
    }),
  ),
});
const ingestResponse = z.object({
  stored_memory_ids: z.array(z.string().min(1)),
  updated_memory_ids: z.array(z.string().min(1)),
});

export interface AtomicMemoryOptions {
  /** e.g. https://api.atomicstrata.ai, or a local Core. */
  apiUrl: string;
  /** Project API key. Server-side only: it never reaches the browser. */
  apiKey: string;
  fetch?: typeof fetch;
  readTimeoutMs?: number;
  writeTimeoutMs?: number;
}

/**
 * RidePreferenceStore on the Atomic Memory HTTP API (user-scoped, no thread, agent or
 * namespace): verbatim `POST /v1/memories/ingest/quick` with `metadata.externalId`,
 * `GET /v1/memories/list` and `DELETE /v1/memories/:id`.
 */
export function createAtomicMemoryRidePreferences(
  options: AtomicMemoryOptions,
): RidePreferenceStore {
  const url = new URL(options.apiUrl);
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))
  )
    throw new RidePreferenceStoreError(
      "Atomic Memory requires HTTPS or a loopback fixture",
    );
  const baseUrl = options.apiUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
  const doFetch = options.fetch ?? fetch;
  const readTimeoutMs = options.readTimeoutMs ?? READ_TIMEOUT_MS;
  const writeTimeoutMs = options.writeTimeoutMs ?? WRITE_TIMEOUT_MS;

  async function call(
    path: string,
    init: { method: string; body?: unknown; timeoutMs: number },
  ): Promise<{ status: number; body: unknown }> {
    try {
      const response = await doFetch(`${baseUrl}/v1/memories${path}`, {
        method: init.method,
        redirect: "error",
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          ...(init.body !== undefined && {
            "Content-Type": "application/json",
          }),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        cache: "no-store",
        signal: AbortSignal.timeout(init.timeoutMs),
      });
      const body: unknown = await response.json().catch(() => null);
      return { status: response.status, body };
    } catch (cause) {
      throw new RidePreferenceStoreError("Atomic Memory request failed", {
        cause,
      });
    }
  }

  /** The rider's preference records (normally one). */
  async function records(userId: string, timeoutMs: number) {
    const query = new URLSearchParams({
      user_id: memorySubject(userId),
      limit: String(LIST_LIMIT),
      offset: "0",
    });
    const { status, body } = await call(`/list?${query}`, {
      method: "GET",
      timeoutMs,
    });
    const parsed = listResponse.safeParse(body);
    if (status !== 200 || !parsed.success)
      throw new RidePreferenceStoreError(
        `Atomic Memory list failed (${status})`,
      );
    return parsed.data.memories.filter(
      (memory) => memory.metadata?.externalId === RIDE_PREFERENCES_EXTERNAL_ID,
    );
  }

  return {
    async read(userId) {
      const [record] = await records(userId, readTimeoutMs);
      const stored = storedRidePreferences.safeParse(
        record?.metadata?.ridePreferences,
      );
      return stored.success ? stored.data : null;
    },
    async save(userId, preferences) {
      const { status, body } = await call("/ingest/quick", {
        method: "POST",
        timeoutMs: writeTimeoutMs,
        body: {
          user_id: memorySubject(userId),
          conversation: describeRidePreferences(preferences),
          source_site: SOURCE_SITE,
          skip_extraction: true,
          content_class: "summary",
          metadata: {
            externalId: RIDE_PREFERENCES_EXTERNAL_ID,
            ridePreferences: preferences,
          },
        },
      });
      const receipt = ingestResponse.safeParse(body);
      if (
        (status !== 200 && status !== 201) ||
        !receipt.success ||
        receipt.data.stored_memory_ids.length +
          receipt.data.updated_memory_ids.length ===
          0
      )
        throw new RidePreferenceStoreError(
          `Atomic Memory ingest was not confirmed (${status})`,
        );
    },
    async clear(userId) {
      for (const record of await records(userId, writeTimeoutMs)) {
        const query = new URLSearchParams({ user_id: memorySubject(userId) });
        const { status, body } = await call(
          `/${encodeURIComponent(record.id)}?${query}`,
          { method: "DELETE", timeoutMs: writeTimeoutMs },
        );
        // Already gone counts as forgotten.
        if (
          status !== 404 &&
          (status < 200 ||
            status > 299 ||
            !z.object({ success: z.literal(true) }).safeParse(body).success)
        )
          throw new RidePreferenceStoreError(
            `Atomic Memory delete failed (${status})`,
          );
      }
    },
  };
}
