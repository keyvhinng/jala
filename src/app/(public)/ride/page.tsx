import type { Metadata } from "next";
import { connection } from "next/server";
import { z } from "zod";
import { RideRequest } from "@/components/sessions/ride-request";
import type { RideDraft } from "@/components/sessions/ride-form";
import { getServices } from "@/lib/services";
import { DEPARTURE_CHOICES } from "@/modules/sessions/domain/affinity";
import { readIdentity } from "@/modules/participants/infrastructure/browser-identity";
import { readRidePreferences } from "@/modules/ride-preferences/application/ride-preferences.service";

export const metadata: Metadata = { title: "Compartir un taxi" };

const coordinate = (bound: number) =>
  z.coerce.number().finite().min(-bound).max(bound);
const draftParams = z.object({
  olat: coordinate(90),
  olng: coordinate(180),
  olabel: z.string().trim().min(3).max(200),
  dlat: coordinate(90),
  dlng: coordinate(180),
  dlabel: z.string().trim().min(3).max(200),
  when: z.coerce
    .number()
    .refine((n) => (DEPARTURE_CHOICES as readonly number[]).includes(n))
    .default(0),
});

/** Whatever of the ride a link already knows: a place's meeting point, a sign-in return. */
function readDraft(raw: Record<string, string | string[] | undefined>) {
  const first = (key: string) =>
    Array.isArray(raw[key]) ? raw[key][0] : raw[key];
  const when = Number(first("when") ?? 0);
  const departInMinutes = (DEPARTURE_CHOICES as readonly number[]).includes(
    when,
  )
    ? (when as RideDraft["departInMinutes"])
    : 0;
  const origin = draftParams
    .pick({ olat: true, olng: true, olabel: true })
    .safeParse({
      olat: first("olat"),
      olng: first("olng"),
      olabel: first("olabel"),
    });
  const destination = draftParams
    .pick({ dlat: true, dlng: true, dlabel: true })
    .safeParse({
      dlat: first("dlat"),
      dlng: first("dlng"),
      dlabel: first("dlabel"),
    });
  // Text typed on the landing: each picker searches its address on arrival.
  const typedOrigin = z.string().trim().min(3).max(200).safeParse(first("oq"));
  const typed = z.string().trim().min(3).max(200).safeParse(first("dq"));
  return {
    origin: origin.success
      ? {
          point: { latitude: origin.data.olat, longitude: origin.data.olng },
          label: origin.data.olabel,
        }
      : typedOrigin.success
        ? { point: null, label: typedOrigin.data }
        : null,
    destination: destination.success
      ? {
          point: {
            latitude: destination.data.dlat,
            longitude: destination.data.dlng,
          },
          label: destination.data.dlabel,
        }
      : typed.success
        ? { point: null, label: typed.data }
        : null,
    departInMinutes,
  } satisfies RideDraft;
}

/** The room the rider is already in, and their saved preferences (never blocking). */
function forAccount(userId: string) {
  const services = getServices();
  return Promise.all([
    services.participation.activeFor(userId),
    readRidePreferences(services.ridePreferences, userId),
  ]);
}

export default async function RidePage({ searchParams }: PageProps<"/ride">) {
  await connection();
  const params = await searchParams;
  const identity = await readIdentity();
  const [active, saved] = identity
    ? await forAccount(identity.userId)
    : [null, null];
  // Saved preferences only fill what the link did not say; the form can still change them.
  const preferences = saved?.status === "ready" ? saved.preferences : null;
  const linked = readDraft(params);
  const draft: RideDraft = {
    ...linked,
    departInMinutes:
      params.when === undefined
        ? (preferences?.departInMinutes ?? linked.departInMinutes)
        : linked.departInMinutes,
    delegatePreference: preferences?.delegatePreference,
  };
  return (
    <div className="ride-page">
      <header className="page-heading">
        <h1>Comparte un taxi.</h1>
        <p>
          Dinos desde dónde sales y a dónde vas. Te ponemos en la sala de espera
          que mejor te queda, o abrimos una para que otros se sumen.
        </p>
      </header>
      <RideRequest
        authenticated={Boolean(identity)}
        initial={draft}
        active={
          active
            ? {
                sessionId: active.sessionId,
                name: active.name,
                departsAt: active.departsAt.toISOString(),
                mine: active.mine,
              }
            : null
        }
      />
    </div>
  );
}
