import { z } from "zod";

/** Blank values count as unset so an empty Google secret does not break the rest of the app. */
function blankToUndefined(value: unknown) {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  ROUTING_BASE_URL: z.string().url().default("https://router.project-osrm.org"),
  RESEND_API_KEY: z.string().min(1).optional(),
  MAIL_FROM: z.string().min(1).default("Jala <jala@jala.oak4.xyz>"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  // Web Push (VAPID). Without both keys, notifications are only logged.
  VAPID_PUBLIC_KEY: z.string().min(1).optional(),
  VAPID_PRIVATE_KEY: z.string().min(1).optional(),
  VAPID_SUBJECT: z.string().min(1).default("mailto:jala@jala.oak4.xyz"),
  /** Web OAuth client in the Google Cloud project. Both are required to show the button. */
  GOOGLE_CLIENT_ID: z.preprocess(
    blankToUndefined,
    z.string().min(1).optional(),
  ),
  GOOGLE_CLIENT_SECRET: z.preprocess(
    blankToUndefined,
    z.string().min(1).optional(),
  ),
  /** Atomic Memory API and project key. Both are required to offer saved ride preferences. */
  ATOMICMEMORY_API_URL: z.preprocess(
    blankToUndefined,
    z.string().url().optional(),
  ),
  ATOMICMEMORY_API_KEY: z.preprocess(
    blankToUndefined,
    z.string().min(1).optional(),
  ),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/** Validates process.env lazily so `next build` doesn't need a database URL. */
export function getEnv(): Env {
  if (!cached) {
    const parsed = envSchema.safeParse(process.env);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      throw new Error(`Invalid environment variables: ${issues}`);
    }
    cached = parsed.data;
  }
  return cached;
}

/** Present only when both Google OAuth values are set. Does not require the rest of the env. */
export function readGoogleAuth(): {
  clientId: string;
  clientSecret: string;
} | null {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export function googleRedirectUri(appUrl: string): string {
  return new URL("/api/auth/google/callback", appUrl).href;
}
