"use client";

import { useState } from "react";
import {
  DEPARTURE_CHOICES,
  type DepartureChoice,
} from "@/modules/sessions/domain/affinity";
import type {
  RidePreferences,
  RidePreferencesState,
} from "@/modules/ride-preferences/domain/ride-preferences";
import { ROLE_COPY, WHEN_LABELS } from "@/components/sessions/ride-form";
import { sessionApi } from "@/components/sessions/session-api";

type Role = NonNullable<RidePreferences["delegatePreference"]>;
const ROLES: readonly Role[] = ["passenger", "delegate"];

/**
 * Lets a returning rider choose what Inicio should start with. Shown only when saved
 * preferences are configured; says plainly when a save or delete did not happen.
 */
export function RidePreferencesCard({
  state,
  onChange,
}: {
  state: Exclude<RidePreferencesState, { status: "disabled" }>;
  onChange: (next: RidePreferencesState) => void;
}) {
  const saved = state.status === "ready" ? state.preferences : null;
  const [role, setRole] = useState<Role | undefined>(saved?.delegatePreference);
  const [when, setWhen] = useState<DepartureChoice | undefined>(
    saved?.departInMinutes,
  );
  const [pending, setPending] = useState<"PUT" | "DELETE" | null>(null);
  const busy = pending !== null;
  const [message, setMessage] = useState(
    state.status === "unavailable"
      ? "No pudimos cargar tus preferencias ahora. Puedes planear tu viaje igual."
      : "",
  );
  const chosen = role !== undefined || when !== undefined;
  const unchanged =
    role === saved?.delegatePreference && when === saved?.departInMinutes;

  async function send(method: "PUT" | "DELETE") {
    setPending(method);
    setMessage("");
    try {
      const body: RidePreferences | undefined =
        method === "PUT"
          ? { delegatePreference: role, departInMinutes: when }
          : undefined;
      const next = await sessionApi<RidePreferencesState>(
        "/api/ride-preferences",
        body,
        undefined,
        method,
      );
      onChange(next);
      if (method === "DELETE") {
        setRole(undefined);
        setWhen(undefined);
      }
      setMessage(
        method === "PUT"
          ? "Guardado. Inicio empezará con estas opciones."
          : "Listo, olvidamos tus preferencias.",
      );
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : "No se pudo completar la acción.",
      );
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="j-prefs" aria-labelledby="j-prefs-title">
      <h2 id="j-prefs-title">Preferencias de viaje</h2>
      <p className="j-prefs-intro">
        Elige con qué empieza Inicio cuando planeas un viaje. Siempre puedes
        cambiarlo antes de buscar grupo.
      </p>
      <fieldset className="j-options j-role-options">
        <legend>¿Sueles poder reservar el taxi?</legend>
        <div>
          {ROLES.map((r) => (
            <button
              type="button"
              key={r}
              aria-pressed={role === r}
              onClick={() => setRole(role === r ? undefined : r)}
            >
              <strong>{ROLE_COPY[r].title}</strong>
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="j-options">
        <legend>¿Cuándo sueles salir?</legend>
        <div>
          {DEPARTURE_CHOICES.map((n) => (
            <button
              type="button"
              key={n}
              aria-pressed={when === n}
              onClick={() => setWhen(when === n ? undefined : n)}
            >
              {WHEN_LABELS[n]}
            </button>
          ))}
        </div>
      </fieldset>
      <p className="j-options-hint">
        Solo guardamos estas dos opciones, para tu cuenta, en Atomic Memory.
        Nunca tus direcciones.
      </p>
      <button
        className="j-primary"
        disabled={busy || !chosen || unchanged}
        onClick={() => send("PUT")}
      >
        {pending === "PUT" ? "Guardando…" : "Guardar preferencias"}
      </button>
      {saved && (
        <button
          className="j-secondary"
          disabled={busy}
          onClick={() => send("DELETE")}
        >
          {pending === "DELETE" ? "Olvidando…" : "Olvidar mis preferencias"}
        </button>
      )}
      <p className="j-prefs-status" role="status">
        {message}
      </p>
    </section>
  );
}
