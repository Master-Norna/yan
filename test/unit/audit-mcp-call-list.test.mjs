import test from "node:test";
import assert from "node:assert/strict";
import { McpClient } from "../../server/mcp/client.js";

test("MCP calls validate the refreshed tool list before sending", async () => {
  const client = new McpClient({ name: "mock", config: {}, version: "test", toolEnv: env => env });
  let lists = 0,
    calls = 0;
  client.tools = [{ name: "removed" }];
  client.toolsChanged = true;
  client.listTools = async () => {
    lists++;
    return [{ name: "current" }];
  };
  client.request = async () => {
    calls++;
    return {};
  };
  await assert.rejects(client.call("removed", {}), error => error.toolsChanged === true);
  assert.equal(lists, 1);
  assert.equal(calls, 0);
  await client.call("current", {});
  assert.equal(lists, 2);
  assert.equal(calls, 1);
  assert.equal(client.toolsChanged, true, "the page still needs to receive the updated list");
});
