/**
 * Starts the local Atomic Memory FIXTURE (tests/fixtures/atomic-memory.ts) for demos and
 * manual checks of saved ride preferences without a real Atomic Memory project:
 * `bun run demo:memory-fixture` (add `--fail` to answer every call with 503).
 * Point the app at it with ATOMICMEMORY_API_URL=http://127.0.0.1:<port> and the same
 * ATOMICMEMORY_API_KEY. Records live in this process only and vanish when it stops.
 */
import { startAtomicMemoryFixture } from "../tests/fixtures/atomic-memory";

const apiKey = process.env.ATOMICMEMORY_API_KEY;
if (!apiKey) throw new Error("ATOMICMEMORY_API_KEY is required");
const port = Number(process.env.ATOMICMEMORY_FIXTURE_PORT ?? 17351);

const fixture = await startAtomicMemoryFixture({ apiKey, port });
if (process.argv.includes("--fail")) fixture.failWith(503);
console.log(
  `Atomic Memory FIXTURE (not the real service) on ${fixture.url}` +
    (process.argv.includes("--fail") ? ", answering every call with 503" : ""),
);
