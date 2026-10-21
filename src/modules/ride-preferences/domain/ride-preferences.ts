import { z } from "zod";
import {
  DEPARTURE_CHOICES,
  type DepartureChoice,
} from "@/modules/sessions/domain/affinity";

/**
 * What a returning rider asked Jala to remember: whether they can usually book the taxi
 * and how soon they usually leave. Never addresses or places: the exact destination is
 * only ever shared with the ride group (see docs/prd.md).
 */
const fields = z.object({
  delegatePreference: z.enum(["delegate", "passenger"]).optional(),
  departInMinutes: z
    .number()
    .refine((n): n is DepartureChoice =>
      (DEPARTURE_CHOICES as readonly number[]).includes(n),
    )
    .optional(),
});

const chosen = (p: z.infer<typeof fields>) =>
  p.delegatePreference !== undefined || p.departInMinutes !== undefined;

/** A save request: at least one preference, nothing else (no user id, no address). */
export const ridePreferencesInput = fields
  .strict()
  .refine(chosen, "Elige al menos una preferencia.");

/** What comes back from the memory provider; anything unexpected reads as "none saved". */
export const storedRidePreferences = fields.refine(chosen);

export type RidePreferences = z.infer<typeof ridePreferencesInput>;

/** What the signed-in rider sees for their saved preferences. */
export type RidePreferencesState =
  /** Not configured on this deployment: the planner works exactly as before. */
  | { status: "disabled" }
  /** The provider did not answer in time; nothing is applied. */
  | { status: "unavailable" }
  | { status: "ready"; preferences: RidePreferences | null };

const ROLE_TEXT = {
  delegate: "puede reservar el taxi en su app",
  passenger: "prefiere ir de pasajero y que otra persona reserve",
} as const;

const WHEN_TEXT: Record<DepartureChoice, string> = {
  0: "suele salir lo antes posible",
  15: "suele salir en 15 minutos",
  30: "suele salir en 30 minutos",
  60: "suele salir en 1 hora",
};

/** The one-line memory stored for the rider; the structured values travel in metadata. */
export function describeRidePreferences(preferences: RidePreferences): string {
  const parts = [
    preferences.delegatePreference && ROLE_TEXT[preferences.delegatePreference],
    preferences.departInMinutes !== undefined &&
      WHEN_TEXT[preferences.departInMinutes],
  ].filter((part): part is string => Boolean(part));
  return `Preferencia de viaje en Jala: la persona ${parts.join(" y ")}.`;
}
