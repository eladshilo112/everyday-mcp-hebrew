import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const SERVER_PATH = fileURLToPath(new URL("../src/server.js", import.meta.url));

test("lists both read-only tools and calls the organizer over stdio", async () => {
  const client = new Client({ name: "dayplan-test-client", version: "1.0.0" });
  const transport = new StdioClientTransport({ command: process.execPath, args: [SERVER_PATH] });

  try {
    await client.connect(transport);
    const listed = await client.listTools();
    assert.deepEqual(
      listed.tools.map((tool) => tool.name).sort(),
      ["dayplan_organize_tasks", "dayplan_parse_tasks"]
    );
    assert.ok(listed.tools.every((tool) => tool.annotations?.readOnlyHint === true));
    assert.ok(listed.tools.every((tool) => tool.annotations?.destructiveHint === false));

    const result = await client.callTool({
      name: "dayplan_organize_tasks",
      arguments: {
        raw_text: "urgent call today, 10 min; read, 20 min",
        available_minutes: 25,
        start_time: "10:00",
        language_hint: "en"
      }
    });
    assert.notEqual(result.isError, true);
    const structured = result.structuredContent as
      | { total_minutes_used?: number; total_minutes_remaining?: number }
      | undefined;
    assert.equal(structured?.total_minutes_used, 10);
    assert.equal(structured?.total_minutes_remaining, 15);
  } finally {
    await client.close();
  }
});

test("the MCP SDK rejects invalid input before the handler runs", async () => {
  const client = new Client({ name: "dayplan-validation-client", version: "1.0.0" });
  const transport = new StdioClientTransport({ command: process.execPath, args: [SERVER_PATH] });

  try {
    await client.connect(transport);
    const result = await client.callTool({
      name: "dayplan_organize_tasks",
      arguments: {
        raw_text: "task",
        available_minutes: 2000,
        start_time: "10:00",
        language_hint: "en"
      }
    });
    assert.equal(result.isError, true);
  } finally {
    await client.close();
  }
});
