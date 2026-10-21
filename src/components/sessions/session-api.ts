const DEFAULT_TIMEOUT_MS = 45_000;

export async function sessionApi<T>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
  method: "GET" | "POST" | "PUT" | "DELETE" = body === undefined
    ? "GET"
    : "POST",
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers:
        body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      // Never hang forever on a bad connection. Generous enough for a matching round,
      // which checks several road routes.
      signal: signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
  } catch (e) {
    throw new SessionRequestError(
      0,
      e instanceof DOMException && e.name === "TimeoutError"
        ? "La conexión está muy lenta. Inténtalo de nuevo."
        : "No hay conexión. Revisa tu internet e inténtalo de nuevo.",
    );
  }
  // Error bodies are written in Spanish by the server; anything else gets a safe default.
  const result = await response.json().catch(() => null);
  if (!response.ok)
    throw new SessionRequestError(
      response.status,
      typeof result?.error?.message === "string"
        ? result.error.message
        : "No se pudo completar la acción. Intenta de nuevo.",
    );
  return result.data as T;
}
export class SessionRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
