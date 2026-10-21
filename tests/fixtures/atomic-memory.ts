/**
 * FIXTURE, not Atomic Memory: a local, in-memory stand-in for the four Atomic Memory
 * HTTP routes Jala calls, shaped after the published API reference
 * (https://docs.atomicstrata.ai/api-reference/http/atomicmemory-http-api). It keeps
 * records per `user_id`, upserts verbatim ingests by `metadata.externalId`, checks the
 * bearer key, and can be told to fail or stall so tests and demos can show what the
 * rider sees when the provider is down. Binds to 127.0.0.1 only.
 */
import { randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

export interface FixtureMemory {
  id: string;
  user_id: string;
  content: string;
  source_site: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface AtomicMemoryFixture {
  url: string;
  /** Every stored record, for assertions. */
  memories: FixtureMemory[];
  /** Requests received, method and path only (never bodies or keys). */
  requests: string[];
  /** Answer the next requests with this status instead of handling them. */
  failWith(status: number | null): void;
  /** Delay every answer, to exercise client timeouts. */
  delay(ms: number): void;
  close(): Promise<void>;
}

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

async function readBody(req: IncomingMessage): Promise<unknown> {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export async function startAtomicMemoryFixture({
  apiKey,
  port = 0,
}: {
  apiKey: string;
  port?: number;
}): Promise<AtomicMemoryFixture> {
  const memories: FixtureMemory[] = [];
  const requests: string[] = [];
  let failure: number | null = null;
  let delayMs = 0;

  async function route(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", "http://fixture");
    requests.push(`${req.method} ${url.pathname}`);
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    if (req.headers.authorization !== `Bearer ${apiKey}`)
      return json(res, 401, { error: "invalid api key" });
    if (failure) return json(res, failure, { error: "fixture failure" });

    if (req.method === "POST" && url.pathname === "/v1/memories/ingest/quick") {
      const body = await readBody(req);
      if (
        !isRecord(body) ||
        typeof body.user_id !== "string" ||
        !body.user_id ||
        typeof body.conversation !== "string" ||
        !body.conversation ||
        typeof body.source_site !== "string" ||
        !body.source_site
      )
        return json(res, 400, { error: "user_id, conversation, source_site" });
      if (body.metadata !== undefined && body.skip_extraction !== true)
        return json(res, 400, { error: "metadata needs skip_extraction" });
      const metadata = isRecord(body.metadata) ? body.metadata : {};
      const existing = memories.find(
        (m) =>
          m.user_id === body.user_id &&
          metadata.externalId !== undefined &&
          m.metadata.externalId === metadata.externalId,
      );
      if (existing) {
        existing.content = body.conversation;
        existing.metadata = metadata;
      } else {
        memories.push({
          id: randomUUID(),
          user_id: body.user_id,
          content: body.conversation,
          source_site: body.source_site,
          metadata,
          created_at: new Date().toISOString(),
        });
      }
      const id = existing?.id ?? memories[memories.length - 1].id;
      return json(res, 200, {
        episode_id: randomUUID(),
        facts_extracted: 0,
        memories_stored: existing ? 0 : 1,
        memories_updated: existing ? 1 : 0,
        memories_deleted: 0,
        memories_skipped: 0,
        stored_memory_ids: existing ? [] : [id],
        updated_memory_ids: existing ? [id] : [],
        links_created: 0,
        composites_created: 0,
      });
    }

    if (req.method === "GET" && url.pathname === "/v1/memories/list") {
      const userId = url.searchParams.get("user_id");
      if (!userId) return json(res, 400, { error: "user_id is required" });
      const limit = Number(url.searchParams.get("limit") ?? 20);
      const own = memories.filter((m) => m.user_id === userId).slice(0, limit);
      return json(res, 200, { memories: own, count: own.length });
    }

    const deleteMatch = /^\/v1\/memories\/([^/]+)$/.exec(url.pathname);
    if (req.method === "DELETE" && deleteMatch) {
      const userId = url.searchParams.get("user_id");
      if (!userId) return json(res, 400, { error: "user_id is required" });
      const index = memories.findIndex(
        (m) => m.id === deleteMatch[1] && m.user_id === userId,
      );
      if (index < 0) return json(res, 404, { error: "Memory not found" });
      memories.splice(index, 1);
      return json(res, 200, { success: true });
    }

    return json(res, 404, { error: "not found" });
  }

  const server = createServer((req, res) => {
    route(req, res).catch(() => json(res, 500, { error: "fixture crashed" }));
  });
  await new Promise<void>((resolve) =>
    server.listen(port, "127.0.0.1", resolve),
  );
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Fixture did not bind a TCP port");
  return {
    url: `http://127.0.0.1:${address.port}`,
    memories,
    requests,
    failWith: (status) => {
      failure = status;
    },
    delay: (ms) => {
      delayMs = ms;
    },
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
