import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/http";
import { resetRateLimits } from "@/lib/rate-limit";
import {
  createAtomicMemoryRidePreferences,
  memorySubject,
  type RidePreferenceStore,
} from "@/modules/ride-preferences/infrastructure/atomic-memory-ride-preferences";
import {
  startAtomicMemoryFixture,
  type AtomicMemoryFixture,
} from "../fixtures/atomic-memory";

const mocks = vi.hoisted(() => ({
  identity: vi.fn(),
  store: { current: null as RidePreferenceStore | null },
}));
vi.mock("@/modules/participants/infrastructure/browser-identity", () => ({
  requireIdentity: mocks.identity,
}));
vi.mock("@/lib/services", () => ({
  getServices: () => ({ ridePreferences: mocks.store.current }),
}));
import { DELETE, GET, PUT } from "@/app/api/ride-preferences/route";

const apiKey = "fixture-key";
const ana = "6b0b1f8e-0d55-4f0e-9a51-3d8a1b0f1a11";
const beto = "0f3c2a77-5f6e-4f1b-8f0e-7d9c6b5a4e22";
let fixture: AtomicMemoryFixture;

function request(
  method: "PUT" | "DELETE",
  body?: unknown,
  origin = "http://localhost:3000",
) {
  return new Request("http://localhost:3000/api/ride-preferences", {
    method,
    headers: { "Content-Type": "application/json", origin },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const put = (body: unknown, origin?: string) =>
  PUT(request("PUT", body, origin));
const remove = () => DELETE(request("DELETE"));
const read = async () => (await (await GET()).json()).data;
const signIn = (userId: string) => mocks.identity.mockResolvedValue({ userId });

beforeEach(async () => {
  vi.resetAllMocks();
  resetRateLimits();
  fixture = await startAtomicMemoryFixture({ apiKey });
  mocks.store.current = createAtomicMemoryRidePreferences({
    apiUrl: fixture.url,
    apiKey,
  });
  signIn(ana);
});
afterEach(() => fixture.close());

describe("saved ride preferences over HTTP", () => {
  it("is off by default: reads say disabled and writes change nothing", async () => {
    mocks.store.current = null;

    expect(await read()).toEqual({ status: "disabled" });
    expect((await put({ departInMinutes: 15 })).status).toBe(404);
    expect((await remove()).status).toBe(404);
    expect(fixture.requests).toEqual([]);
  });

  it("saves, recalls, corrects and forgets the signed-in rider's preferences", async () => {
    expect(await read()).toEqual({ status: "ready", preferences: null });

    const saved = await put({ delegatePreference: "delegate" });
    expect(saved.status).toBe(200);
    expect(saved.headers.get("cache-control")).toBe("private, no-store");
    expect(await read()).toEqual({
      status: "ready",
      preferences: { delegatePreference: "delegate" },
    });

    await put({ delegatePreference: "passenger", departInMinutes: 30 });
    expect(await read()).toEqual({
      status: "ready",
      preferences: { delegatePreference: "passenger", departInMinutes: 30 },
    });
    expect(fixture.memories).toHaveLength(1);

    expect((await remove()).status).toBe(200);
    expect(await read()).toEqual({ status: "ready", preferences: null });
  });

  it("only ever uses the session's account, never one named in the request", async () => {
    signIn(beto);
    await put({ departInMinutes: 60 });
    expect((await put({ departInMinutes: 15, userId: ana })).status).toBe(400);

    signIn(ana);
    expect(await read()).toEqual({ status: "ready", preferences: null });
    expect(fixture.memories.map((m) => m.user_id)).toEqual([
      memorySubject(beto),
    ]);
  });

  it("says plainly when the provider could not save or forget", async () => {
    await put({ departInMinutes: 15 });
    fixture.failWith(503);

    const save = await put({ departInMinutes: 30 });
    expect(save.status).toBe(503);
    expect((await save.json()).error.message).toBe(
      "No pudimos guardar tus preferencias. Inténtalo más tarde.",
    );
    expect((await remove()).status).toBe(503);
    expect(await read()).toEqual({ status: "unavailable" });

    fixture.failWith(null);
    expect(await read()).toEqual({
      status: "ready",
      preferences: { departInMinutes: 15 },
    });
  });

  it("requires sign-in, same origin and a real choice", async () => {
    mocks.identity.mockRejectedValue(
      new ApiError(401, "identity_required", "Inicia sesión"),
    );
    expect((await GET()).status).toBe(401);
    expect((await put({ departInMinutes: 15 })).status).toBe(401);
    expect((await remove()).status).toBe(401);

    signIn(ana);
    expect(
      (await put({ departInMinutes: 15 }, "https://elsewhere.test")).status,
    ).toBe(403);
    for (const body of [
      {},
      { departInMinutes: 45 },
      { delegatePreference: "driver" },
      { departInMinutes: 15, destinationLabel: "Av. Larco 123" },
    ]) {
      expect((await put(body)).status).toBe(400);
    }
    expect(fixture.requests).toEqual([]);
  });
});
