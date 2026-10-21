import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createAtomicMemoryRidePreferences,
  memorySubject,
  RIDE_PREFERENCES_EXTERNAL_ID,
  RidePreferenceStoreError,
} from "@/modules/ride-preferences/infrastructure/atomic-memory-ride-preferences";
import { readRidePreferences } from "@/modules/ride-preferences/application/ride-preferences.service";
import {
  startAtomicMemoryFixture,
  type AtomicMemoryFixture,
} from "../fixtures/atomic-memory";

const apiKey = "fixture-key";
const ana = "6b0b1f8e-0d55-4f0e-9a51-3d8a1b0f1a11";
const beto = "0f3c2a77-5f6e-4f1b-8f0e-7d9c6b5a4e22";
let fixture: AtomicMemoryFixture;

function store(options: { readTimeoutMs?: number; key?: string } = {}) {
  return createAtomicMemoryRidePreferences({
    apiUrl: `${fixture.url}/`,
    apiKey: options.key ?? apiKey,
    readTimeoutMs: options.readTimeoutMs,
  });
}

beforeEach(async () => {
  fixture = await startAtomicMemoryFixture({ apiKey });
});
afterEach(() => fixture.close());

describe("Atomic Memory ride preferences", () => {
  it("saves one verbatim, user-scoped record and reads it back", async () => {
    await store().save(ana, { delegatePreference: "delegate" });

    expect(fixture.memories).toEqual([
      expect.objectContaining({
        user_id: memorySubject(ana),
        source_site: "jala",
        content:
          "Preferencia de viaje en Jala: la persona puede reservar el taxi en su app.",
        metadata: {
          externalId: RIDE_PREFERENCES_EXTERNAL_ID,
          ridePreferences: { delegatePreference: "delegate" },
        },
      }),
    ]);
    expect(await store().read(ana)).toEqual({
      delegatePreference: "delegate",
    });
  });

  it("corrects the saved record in place instead of adding another", async () => {
    await store().save(ana, { delegatePreference: "delegate" });
    await store().save(ana, {
      delegatePreference: "passenger",
      departInMinutes: 15,
    });

    expect(fixture.memories).toHaveLength(1);
    expect(await store().read(ana)).toEqual({
      delegatePreference: "passenger",
      departInMinutes: 15,
    });
  });

  it("keeps each account's preferences to itself", async () => {
    await store().save(ana, { departInMinutes: 30 });

    expect(await store().read(beto)).toBeNull();
    await store().clear(beto);
    expect(await store().read(ana)).toEqual({ departInMinutes: 30 });
  });

  it("forgets the preferences, and forgetting twice is fine", async () => {
    await store().save(ana, { departInMinutes: 60 });
    await store().clear(ana);
    await store().clear(ana);

    expect(fixture.memories).toEqual([]);
    expect(await store().read(ana)).toBeNull();
  });

  it("ignores records it did not write", async () => {
    fixture.memories.push({
      id: "11111111-1111-4111-8111-111111111111",
      user_id: memorySubject(ana),
      content: "Something else",
      source_site: "jala",
      metadata: {
        externalId: RIDE_PREFERENCES_EXTERNAL_ID,
        ridePreferences: { departInMinutes: 45 },
      },
      created_at: new Date().toISOString(),
    });

    expect(await store().read(ana)).toBeNull();
  });

  it("reports provider failures instead of pretending they worked", async () => {
    fixture.failWith(503);

    await expect(store().read(ana)).rejects.toBeInstanceOf(
      RidePreferenceStoreError,
    );
    await expect(
      store().save(ana, { departInMinutes: 15 }),
    ).rejects.toBeInstanceOf(RidePreferenceStoreError);
    await expect(store().clear(ana)).rejects.toBeInstanceOf(
      RidePreferenceStoreError,
    );
    await expect(store({ key: "wrong" }).read(ana)).rejects.toBeInstanceOf(
      RidePreferenceStoreError,
    );
  });

  it("gives up on a slow provider within the read budget", async () => {
    fixture.delay(500);
    const started = performance.now();

    await expect(store({ readTimeoutMs: 50 }).read(ana)).rejects.toBeInstanceOf(
      RidePreferenceStoreError,
    );
    expect(performance.now() - started).toBeLessThan(400);
  });
});

describe("provider acknowledgement", () => {
  it("accepts a confirmed Cloud 201 and rejects empty success receipts", async () => {
    const client = (body: unknown, status = 200) =>
      createAtomicMemoryRidePreferences({
        apiUrl: fixture.url,
        apiKey,
        fetch: async () => Response.json(body, { status }),
      });
    await expect(
      client(
        { stored_memory_ids: ["saved"], updated_memory_ids: [] },
        201,
      ).save(ana, { departInMinutes: 15 }),
    ).resolves.toBeUndefined();
    await expect(
      client({ stored_memory_ids: [], updated_memory_ids: [] }).save(ana, {
        departInMinutes: 15,
      }),
    ).rejects.toBeInstanceOf(RidePreferenceStoreError);
    await expect(
      client({ ok: true }).save(ana, { departInMinutes: 15 }),
    ).rejects.toBeInstanceOf(RidePreferenceStoreError);
  });
  it("does not claim deletion when a 200 response has no confirmation", async () => {
    const client = createAtomicMemoryRidePreferences({
      apiUrl: fixture.url,
      apiKey,
      fetch: async (_url, init) => {
        if (init?.method === "GET")
          return Response.json({
            memories: [
              {
                id: "note",
                metadata: { externalId: RIDE_PREFERENCES_EXTERNAL_ID },
              },
            ],
          });
        return Response.json({ success: false });
      },
    });
    await expect(client.clear(ana)).rejects.toBeInstanceOf(
      RidePreferenceStoreError,
    );
  });
  it("rejects plaintext remote credentials and prevents redirects", async () => {
    expect(() =>
      createAtomicMemoryRidePreferences({
        apiUrl: "http://public.example",
        apiKey,
      }),
    ).toThrow(RidePreferenceStoreError);
    expect(() =>
      createAtomicMemoryRidePreferences({
        apiUrl: "https://user:pass@example.com",
        apiKey,
      }),
    ).toThrow(RidePreferenceStoreError);
    const client = createAtomicMemoryRidePreferences({
      apiUrl: fixture.url,
      apiKey,
      fetch: async (_url, init) => {
        expect(init?.redirect).toBe("error");
        return Response.json({ memories: [] });
      },
    });
    expect(await client.read(ana)).toBeNull();
  });
});

describe("readRidePreferences", () => {
  it("is disabled without configuration", async () => {
    expect(await readRidePreferences(null, ana)).toEqual({
      status: "disabled",
    });
  });

  it("never throws: a failing provider reads as unavailable", async () => {
    fixture.failWith(500);
    expect(await readRidePreferences(store(), ana)).toEqual({
      status: "unavailable",
    });
  });

  it("returns the saved preferences, or none", async () => {
    expect(await readRidePreferences(store(), ana)).toEqual({
      status: "ready",
      preferences: null,
    });
    await store().save(ana, { departInMinutes: 0 });
    expect(await readRidePreferences(store(), ana)).toEqual({
      status: "ready",
      preferences: { departInMinutes: 0 },
    });
  });
});
