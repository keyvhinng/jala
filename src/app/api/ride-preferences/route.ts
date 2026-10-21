import { ApiError, assertSameOrigin, handle, ok, readJson } from "@/lib/http";
import { describeError, logger } from "@/lib/logger";
import { consume } from "@/lib/rate-limit";
import { getServices } from "@/lib/services";
import { requireIdentity } from "@/modules/participants/infrastructure/browser-identity";
import { readRidePreferences } from "@/modules/ride-preferences/application/ride-preferences.service";
import { ridePreferencesInput } from "@/modules/ride-preferences/domain/ride-preferences";

function privateResponse(data: unknown) {
  const response = ok(data);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

async function writableStore(userId: string) {
  const store = getServices().ridePreferences;
  if (!store)
    throw new ApiError(
      404,
      "ride_preferences_disabled",
      "Las preferencias guardadas no están disponibles.",
    );
  if (!(await consume(`ride-preferences:${userId}`, 10, 60_000)))
    throw new ApiError(
      429,
      "rate_limited",
      "Espera un momento antes de volver a intentarlo.",
    );
  return store;
}

/** Says plainly that nothing changed when the provider fails; never fakes success. */
function providerFailed(error: unknown, action: "save" | "clear"): never {
  logger.warn(`ride_preferences.${action}_failed`, describeError(error));
  throw new ApiError(
    503,
    "ride_preferences_unavailable",
    action === "save"
      ? "No pudimos guardar tus preferencias. Inténtalo más tarde."
      : "No pudimos borrar tus preferencias. Inténtalo más tarde.",
  );
}

/** The signed-in rider's own saved preferences; never another account's. */
export const GET = handle(async () => {
  const { userId } = await requireIdentity();
  return privateResponse(
    await readRidePreferences(getServices().ridePreferences, userId),
  );
});

export const PUT = handle(async (request: Request) => {
  assertSameOrigin(request);
  const { userId } = await requireIdentity();
  const preferences = ridePreferencesInput.parse(await readJson(request));
  const store = await writableStore(userId);
  await store.save(userId, preferences).catch((e) => providerFailed(e, "save"));
  return privateResponse({ status: "ready", preferences });
});

export const DELETE = handle(async (request: Request) => {
  assertSameOrigin(request);
  const { userId } = await requireIdentity();
  const store = await writableStore(userId);
  await store.clear(userId).catch((e) => providerFailed(e, "clear"));
  return privateResponse({ status: "ready", preferences: null });
});
