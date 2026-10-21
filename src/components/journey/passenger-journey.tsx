"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Circle,
  Clock3,
  Home,
  LocateFixed,
  Mail,
  MapPin,
  Shield,
  UserRound,
  Wallet,
} from "lucide-react";
import { formatSoles } from "@/modules/payments/domain/fees";
import type { GeoPoint } from "@/modules/places/domain/place";
import {
  DEPARTURE_CHOICES,
  type DepartureChoice,
} from "@/modules/sessions/domain/affinity";
import { GoogleMark } from "@/components/auth/google-mark";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { disablePush } from "@/components/sessions/push-client";
import {
  LocationPicker,
  type PickedLocation,
} from "@/components/sessions/location-picker";
import {
  clearRideDraft,
  saveRideDraft,
} from "@/components/sessions/ride-draft";
import {
  ASAP_HINT,
  DEFAULT_MAP_CENTER,
  ROLE_COPY,
  WHEN_LABELS,
} from "@/components/sessions/ride-form";
import { RideMap, type RideEnd } from "@/components/sessions/ride-map";
import { sessionApi } from "@/components/sessions/session-api";
import type {
  RidePreferences,
  RidePreferencesState,
} from "@/modules/ride-preferences/domain/ride-preferences";
import { RidePreferencesCard } from "./ride-preferences-card";

type Screen = "login" | "home" | "destination" | "trips" | "account";

/** The signed-in account, as /api/auth/me returns it. */
interface Account {
  displayName: string;
  creditBalanceMinor: number;
}

const TITLES: Partial<Record<Screen, [string, string]>> = {
  destination: ["¿A dónde vas?", ""],
  trips: ["Mis viajes", "Historial de grupos"],
  account: ["Mi cuenta", "Tu ruta, nuestro viaje."],
};
const TABS = [
  { id: "home", label: "Inicio", Icon: Home },
  { id: "trips", label: "Mis viajes", Icon: Clock3 },
  { id: "account", label: "Cuenta", Icon: UserRound },
] as const;
function greeting(hour: number) {
  if (hour < 12) return "Buenos días";
  if (hour < 19) return "Buenas tardes";
  return "Buenas noches";
}
function Avatar({ name }: { name: string }) {
  return (
    <span className="j-avatar" aria-hidden="true">
      {name[0]?.toUpperCase()}
    </span>
  );
}
function Primary({
  children,
  onClick,
  disabled = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button className="j-primary" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

/**
 * Saved choices become the planner's starting point; forgetting them resets it to the
 * usual defaults. Null when nothing could be read, so the planner stays as it is.
 */
function plannerStart(
  state: RidePreferencesState,
): { departure: DepartureChoice; delegate: boolean } | null {
  if (state.status !== "ready") return null;
  const saved: RidePreferences | null = state.preferences;
  return {
    departure: saved?.departInMinutes ?? 0,
    delegate: saved?.delegatePreference === "delegate",
  };
}

/**
 * The signed-in passenger's home: plan a route on Inicio, then search real rooms in
 * the live flow (/ride), where groups, chat and the ride itself happen. Jala only
 * serves signed-in people, so without a session this shows the sign-in choices.
 */
export function PassengerJourney({
  googleHref = null,
}: {
  /** Real Sign in with Google start URL, when Google sign-in is configured. */
  googleHref?: string | null;
}) {
  const router = useRouter();
  const [screen, setScreen] = useState<Screen>("login");
  // Undefined while checking the session; null when signed out.
  const [account, setAccount] = useState<Account | null | undefined>(undefined);
  const [origin, setOrigin] = useState<PickedLocation | null>(null);
  const [destination, setDestination] = useState<PickedLocation | null>(null);
  const [mapEnd, setMapEnd] = useState<RideEnd>("origin");
  const [mapFocus, setMapFocus] = useState<GeoPoint | null>(null);
  const [departure, setDeparture] = useState<DepartureChoice>(0);
  const plannerEdited = useRef(false);
  const [delegate, setDelegate] = useState(false);
  // Null until loaded for a signed-in account.
  const [preferences, setPreferences] = useState<RidePreferencesState | null>(
    null,
  );
  const heading = useRef<HTMLHeadingElement>(null);
  const nav = (next: Screen) => setScreen(next);

  useEffect(() => {
    heading.current?.focus();
    window.scrollTo(0, 0);
  }, [screen]);
  // A session (password or Google) goes straight to Inicio.
  useEffect(() => {
    let stale = false;
    sessionApi<Account | null>("/api/auth/me")
      .then((me) => {
        if (stale) return;
        setAccount(me);
        if (!me) return;
        setScreen((current) => (current === "login" ? "home" : current));
        // Saved preferences are optional: without them the planner keeps its defaults.
        sessionApi<RidePreferencesState>("/api/ride-preferences")
          .then((saved) => {
            if (stale) return;
            setPreferences(saved);
            const start = plannerStart(saved);
            if (!start || plannerEdited.current) return;
            setDeparture(start.departure);
            setDelegate(start.delegate);
          })
          .catch(() => {});
      })
      .catch(() => !stale && setAccount(null));
    return () => {
      stale = true;
    };
  }, []);

  function changePreferences(next: RidePreferencesState) {
    setPreferences(next);
    const start = plannerStart(next);
    if (!start) return;
    setDeparture(start.departure);
    setDelegate(start.delegate);
  }
  const savedPreferences =
    preferences?.status === "ready" ? preferences.preferences : null;

  const originName = origin?.label.split(",")[0].trim() ?? "";
  const routeReady = Boolean(
    origin?.point &&
    origin.label.trim().length >= 3 &&
    destination?.point &&
    destination.label.trim().length >= 3,
  );
  function changeOrigin(next: PickedLocation | null) {
    setOrigin(next);
    // With the start known, the next tap on the map is most likely the destination.
    if (next?.point && !origin?.point && !destination?.point)
      setMapEnd("destination");
  }
  function pickOnMap(end: RideEnd, point: GeoPoint) {
    if (end === "origin") changeOrigin({ point, label: origin?.label ?? "" });
    else setDestination({ point, label: destination?.label ?? "" });
  }
  function planTrip(
    end: RideEnd = destination?.point ? "origin" : "destination",
  ) {
    setMapEnd(origin?.point ? end : "origin");
    nav("destination");
  }
  /** Real rooms live in /ride; the route travels in this tab's storage, not the URL. */
  function searchRooms() {
    if (!routeReady) return;
    saveRideDraft({
      origin,
      destination,
      departInMinutes: departure,
      delegatePreference: delegate ? "delegate" : "passenger",
    });
    router.push("/ride");
  }
  const signOut = () => {
    nav("login");
    setAccount(null);
    setPreferences(null);
    setOrigin(null);
    setDestination(null);
    setDeparture(0);
    setDelegate(false);
    plannerEdited.current = false;
    // A route planned in this tab must not greet the next account that signs in here.
    clearRideDraft();
    // This browser must stop receiving the account's notifications; needs the session.
    void disablePush()
      .catch(() => {})
      .then(() => sessionApi("/api/auth/sign-out", {}).catch(() => {}));
  };

  const displayName = account?.displayName ?? "";
  const firstName = displayName.split(" ")[0];
  const title = TITLES[screen];
  const tabs = TABS.some((tab) => tab.id === screen);
  const back: Partial<Record<Screen, Screen>> = { destination: "home" };
  const signedIn = Boolean(account) && screen !== "login";
  // Home and login lead with the brand bar; every other screen leads with its own title.
  // On desktop the brand bar is always present and carries the tabs.
  const branded = screen === "home" || screen === "login";
  const width = branded || screen === "destination" ? "wide" : "narrow";
  const tabLinks = TABS.map(({ id, label, Icon }) => (
    <button
      key={id}
      aria-current={screen === id ? "page" : undefined}
      onClick={() => nav(id)}
    >
      <Icon size={22} aria-hidden="true" />
      <span>{label}</span>
    </button>
  ));

  return (
    <div
      className={`passenger-app ${tabs ? "j-has-tabs" : ""}`}
      data-screen={screen}
    >
      <header
        className={`j-appbar ${branded ? "" : "j-appbar-desktop-only"} ${screen === "login" ? "j-appbar-plain" : ""}`}
      >
        <div className="j-appbar-inner">
          <Link href="/" aria-label="Jala, inicio" className="j-logo">
            <Image
              src="/jala-logo.png"
              alt="jala"
              width={88}
              height={41}
              priority
            />
          </Link>
          {signedIn && (
            <>
              <nav className="j-topnav" aria-label="Principal">
                {tabLinks}
              </nav>
              <div className="j-appbar-actions">
                <NotificationBell />
                <button
                  className="j-avatar"
                  onClick={() => nav("account")}
                  aria-label="Abrir mi cuenta"
                >
                  {displayName ? (
                    displayName[0].toUpperCase()
                  ) : (
                    <UserRound size={18} aria-hidden="true" />
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      </header>
      <main id="contenido" className={`j-main j-main-${width}`}>
        {!branded && (
          <header className="j-page-header">
            {back[screen] && (
              <button
                className="j-circle"
                onClick={() => nav(back[screen]!)}
                aria-label="Volver"
              >
                <ArrowLeft size={21} />
              </button>
            )}
            <div>
              <h1 ref={heading} tabIndex={-1}>
                {title?.[0]}
              </h1>
              <p>
                {screen === "destination"
                  ? originName
                    ? `Saliendo desde ${originName}`
                    : "Elige tu punto de partida y tu destino"
                  : title?.[1]}
              </p>
            </div>
          </header>
        )}
        <div className={`j-content j-screen-${screen}`}>
          {screen === "login" && (
            <>
              <section className="j-col-main">
                <p className="j-eyebrow">
                  <i /> COMPARTE EL REGRESO
                </p>
                <h1 className="j-hero-title" ref={heading} tabIndex={-1}>
                  Sal en grupo.
                  <br />
                  <em>Llega a tu puerta.</em>
                </h1>
                <p className="j-intro">
                  Te juntamos con personas que salen cerca de ti y van hacia tu
                  zona. Cada quien paga su tramo.
                </p>
              </section>
              <section
                className="j-col-side j-login-card"
                aria-busy={account === undefined}
              >
                <h2>Ingresa a tu cuenta</h2>
                {/* Nothing to choose until the session check answers. */}
                {account === null && (
                  <>
                    {googleHref && (
                      <a className="j-secondary" href={googleHref}>
                        <GoogleMark /> Continuar con Google
                      </a>
                    )}
                    <Link className="j-secondary" href="/sign-in?next=%2F">
                      <Mail size={21} /> Continuar con correo
                    </Link>
                    <p className="j-login-hint">
                      ¿Primera vez?{" "}
                      <Link href="/sign-up?next=%2F">Crea tu cuenta</Link>
                    </p>
                  </>
                )}
              </section>
            </>
          )}

          {screen === "home" && (
            <>
              <section className="j-col-main">
                <p className="j-eyebrow">
                  <i /> COMPARTE EL REGRESO
                </p>
                <h1 className="j-home-title" ref={heading} tabIndex={-1}>
                  {greeting(new Date().getHours())}
                  {firstName ? `, ${firstName}` : ""}.
                  <br />
                  <em>¿Volvemos juntos?</em>
                </h1>
                <p className="j-intro">
                  Comparte un taxi con personas que salen cerca de ti y van
                  hacia tu zona. Cada quien llega a su puerta y paga su tramo.
                </p>
                <div className="j-search-card">
                  <div>
                    <div className="j-origin-label">
                      <strong>
                        <Circle size={10} aria-hidden="true" /> Punto de partida
                      </strong>
                      <button onClick={() => planTrip("origin")}>
                        <LocateFixed size={16} /> Usar mi ubicación
                      </button>
                    </div>
                    <button
                      className="j-origin-preview"
                      onClick={() => planTrip("origin")}
                    >
                      {origin?.label || "¿Desde dónde sales?"}
                    </button>
                  </div>
                  <div>
                    <button
                      className="j-destination-preview"
                      onClick={() => planTrip("destination")}
                    >
                      <span>
                        <MapPin size={17} /> ¿A dónde vas?
                      </span>
                      <strong>
                        {destination?.label || "Distrito, calle o lugar"}
                      </strong>
                    </button>
                    <Primary onClick={() => planTrip()}>
                      Buscar compañeros de viaje <ArrowRight size={21} />
                    </Primary>
                  </div>
                </div>
                <p className="j-privacy">
                  <Shield size={18} /> Tu destino exacto solo se comparte con tu
                  grupo de viaje.
                </p>
              </section>
              <section className="j-col-side">
                <div className="j-section-heading">
                  <div>
                    <p className="j-eyebrow">AHORA MISMO</p>
                    <h2>Salas de espera cerca</h2>
                  </div>
                  <Link href="/ride">
                    Crear sala <ArrowUpRight size={14} aria-hidden="true" />
                  </Link>
                </div>
                <Link href="/ride" className="j-room-card">
                  <span>
                    <strong>Encuentra personas hacia tu zona</strong>
                    <small>Explora las salas abiertas o crea la tuya.</small>
                  </span>
                  <ArrowRight size={20} />
                </Link>
              </section>
            </>
          )}

          {screen === "destination" && (
            <form
              className="j-trip"
              onSubmit={(e) => {
                e.preventDefault();
                searchRooms();
              }}
            >
              <div className="j-trip-fields">
                <LocationPicker
                  id="j-origin"
                  end="origin"
                  value={origin}
                  onChange={changeOrigin}
                  onActivate={() => setMapEnd("origin")}
                  onFocusPoint={setMapFocus}
                />
                <LocationPicker
                  id="j-destination"
                  end="destination"
                  value={destination}
                  onChange={setDestination}
                  onActivate={() => setMapEnd("destination")}
                  onFocusPoint={setMapFocus}
                />
              </div>
              <div className="j-trip-map">
                <div
                  className="map-mode"
                  role="group"
                  aria-label="Al tocar el mapa marcas"
                >
                  <span aria-hidden="true">Tocar el mapa marca</span>
                  {(["origin", "destination"] as const).map((end) => (
                    <button
                      key={end}
                      type="button"
                      aria-pressed={mapEnd === end}
                      onClick={() => setMapEnd(end)}
                    >
                      {end === "origin" ? "Partida" : "Destino"}
                    </button>
                  ))}
                </div>
                <RideMap
                  center={origin?.point ?? DEFAULT_MAP_CENTER}
                  origin={origin?.point ?? null}
                  destination={destination?.point ?? null}
                  active={mapEnd}
                  focus={mapFocus}
                  onPick={pickOnMap}
                />
              </div>
              <div className="j-trip-details">
                {savedPreferences && (
                  <p className="j-saved-prefs">
                    Empezamos con tus preferencias guardadas.{" "}
                    <button type="button" onClick={() => nav("account")}>
                      Cambiarlas
                    </button>
                  </p>
                )}
                <fieldset className="j-options">
                  <legend>¿Cuándo sales?</legend>
                  <div>
                    {DEPARTURE_CHOICES.map((n) => (
                      <button
                        type="button"
                        key={n}
                        aria-pressed={departure === n}
                        onClick={() => {
                          plannerEdited.current = true;
                          setDeparture(n);
                        }}
                      >
                        {WHEN_LABELS[n]}
                      </button>
                    ))}
                  </div>
                  {departure === 0 && (
                    <p className="j-options-hint">{ASAP_HINT}</p>
                  )}
                </fieldset>
                <fieldset className="j-options j-role-options">
                  <legend>¿Puedes reservar el taxi?</legend>
                  <div>
                    <button
                      type="button"
                      aria-pressed={!delegate}
                      onClick={() => {
                        plannerEdited.current = true;
                        setDelegate(false);
                      }}
                    >
                      <strong>{ROLE_COPY.passenger.title}</strong>
                      <small>{ROLE_COPY.passenger.detail}</small>
                    </button>
                    <button
                      type="button"
                      aria-pressed={delegate}
                      onClick={() => {
                        plannerEdited.current = true;
                        setDelegate(true);
                      }}
                    >
                      <strong>{ROLE_COPY.delegate.title}</strong>
                      <small>{ROLE_COPY.delegate.detail}</small>
                    </button>
                  </div>
                </fieldset>
                <Primary disabled={!routeReady}>
                  Buscar grupo <ArrowRight size={20} />
                </Primary>
              </div>
            </form>
          )}

          {screen === "trips" && (
            <div className="j-empty">
              <Clock3 size={32} aria-hidden="true" />
              <h2>Aún no tienes viajes</h2>
              <p>
                Cuando termines un viaje con tu grupo, aparecerá aquí con las
                personas, la ruta y tu parte.
              </p>
              <Primary onClick={() => planTrip()}>
                Planear un viaje <ArrowRight size={20} />
              </Primary>
            </div>
          )}

          {screen === "account" && (
            <>
              <div className="j-account">
                <Avatar name={displayName || "?"} />
                <h2>{displayName}</h2>
                {account && (
                  <p className="j-balance">
                    <Wallet size={17} aria-hidden="true" />
                    Saldo: {formatSoles(account.creditBalanceMinor)}
                  </p>
                )}
              </div>
              {preferences && preferences.status !== "disabled" && (
                <RidePreferencesCard
                  state={preferences}
                  onChange={changePreferences}
                />
              )}
              <button className="j-secondary" onClick={signOut}>
                Cerrar sesión
              </button>
            </>
          )}
        </div>
      </main>
      {tabs && (
        <nav className="j-bottom-nav" aria-label="Principal">
          {tabLinks}
        </nav>
      )}
    </div>
  );
}
