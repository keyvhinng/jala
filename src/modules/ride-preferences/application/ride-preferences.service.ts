import { describeError, logger } from "@/lib/logger";
import type { RidePreferencesState } from "@/modules/ride-preferences/domain/ride-preferences";
import type { RidePreferenceStore } from "@/modules/ride-preferences/infrastructure/atomic-memory-ride-preferences";

/**
 * The signed-in rider's saved preferences. Never throws: a slow or failing provider
 * reads as "unavailable", so planning a ride never depends on it.
 */
export async function readRidePreferences(
  store: RidePreferenceStore | null,
  userId: string,
): Promise<RidePreferencesState> {
  if (!store) return { status: "disabled" };
  try {
    return { status: "ready", preferences: await store.read(userId) };
  } catch (error) {
    logger.warn("ride_preferences.read_failed", describeError(error));
    return { status: "unavailable" };
  }
}
