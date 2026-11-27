import test from "node:test";
import assert from "node:assert/strict";
import openai from "../../server/model/openai.js";
import anthropic from "../../server/model/anthropic.js";

test("provider endpoints preserve query parameters outside the pathname", () => {
  assert.equal(
    openai.url({ baseUrl: "https://example.test/gateway/v1?api-version=2026" }),
    "https://example.test/gateway/v1/chat/completions?api-version=2026"
  );
  assert.equal(openai.url({ baseUrl: "https://example.test/v1/chat/completions?key=x" }), "https://example.test/v1/chat/completions?key=x");
  assert.equal(
    anthropic.anthropicEndpoint("https://example.test/gateway/v1/messages?key=x"),
    "https://example.test/gateway/v1/messages?key=x"
  );
  assert.equal(
    anthropic.anthropicEndpoint("https://example.test/gateway/v1?key=x", "/v1/models"),
    "https://example.test/gateway/v1/models?key=x"
  );
});
