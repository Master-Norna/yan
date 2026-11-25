import { test } from "node:test";
import assert from "node:assert/strict";
import { createTransport } from "../../server/mcp/transports.js";

test("HTTP MCP session close sends one bounded DELETE and cancels the unused response body", async t => {
  const requests = [];
  let cancelled = false;
  const body = new ReadableStream({
    cancel() {
      cancelled = true;
    }
  });
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  globalThis.fetch = async (url, options) => {
    requests.push({ url, ...options });
    return new Response(body);
  };
  const transport = createTransport({ url: "https://example.test/mcp", type: "http" }, env => env);
  transport.session = "session-1";
  transport.protocol = "2025-06-18";
  transport.close();
  transport.close();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, "DELETE");
  assert.equal(requests[0].headers["Mcp-Session-Id"], "session-1");
  assert.equal(requests[0].headers["MCP-Protocol-Version"], "2025-06-18");
  assert.ok(requests[0].signal instanceof AbortSignal);
  assert.equal(cancelled, true);
});
