import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { failureSchema, successSchema } from "../src/schemas.js";

const serverPath = fileURLToPath(new URL("../src/server.js", import.meta.url));
const guardUrl = new URL("./offline-guard.js", import.meta.url).href;

test("real MCP SDK client initializes, discovers and calls the offline stdio server", { timeout: 20000 }, async () => {
  const client = new Client({ name: "synthetic-list-test", version: "1.0.0" });
  const transport = new StdioClientTransport({ command: process.execPath, args: ["--import", guardUrl, serverPath] });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map(tool => tool.name), ["compare_lists"]);
    const tool = tools.tools[0];
    assert.deepEqual(tool?.annotations, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
    assert.ok(tool?.inputSchema);
    assert.ok(tool?.outputSchema);
    const arguments_ = { left: " תפוח \r\nאגס\r\nאגס", right: "תפוח\n🍎", options: { trim: true } };
    const response = await client.callTool({ name: "compare_lists", arguments: arguments_ });
    assert.notEqual(response.isError, true);
    const result = successSchema.parse(response.structuredContent);
    assert.deepEqual(result.shared.items.map(item => item.key), ["תפוח"]);
    assert.deepEqual(result.duplicates_left.items[0]?.occurrences.map(item => item.line), [2, 3]);
    const content = response.content.find(item => item.type === "text");
    assert.ok(content?.type === "text");
    assert.deepEqual(JSON.parse(content.text), result);
    const repeated = await client.callTool({ name: "compare_lists", arguments: arguments_ });
    assert.equal(JSON.stringify(repeated.structuredContent), JSON.stringify(result));
    const failed = await client.callTool({ name: "compare_lists", arguments: { left: "x".repeat(262145), right: "" } });
    assert.equal(failed.isError, true);
    assert.equal(failureSchema.parse(failed.structuredContent).error.code, "INPUT_TOO_LARGE");
  } finally {
    await client.close();
    await transport.close();
  }
});

function object(value: unknown): Record<string, unknown> {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}

test("raw stdio has only JSON-RPC frames, handles invalid arguments and remains usable", { timeout: 20000 }, async () => {
  const child = spawn(process.execPath, ["--import", guardUrl, serverPath], { stdio: "pipe", windowsHide: true });
  const closed = new Promise<void>(resolve => child.once("close", () => resolve()));
  let buffer = "";
  let stderr = "";
  let nextId = 0;
  let frames = 0;
  const violations: string[] = [];
  const pending = new Map<number, { resolve: (message: Record<string, unknown>) => void; reject: (reason: Error) => void }>();
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => { stderr += chunk; });
  child.on("error", (error: Error) => { for (const waiter of pending.values()) waiter.reject(error); });
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      try {
        const message = object(JSON.parse(line));
        assert.equal(message.jsonrpc, "2.0");
        assert.ok("result" in message || "error" in message || typeof message.method === "string");
        frames += 1;
        if (typeof message.id === "number") pending.get(message.id)?.resolve(message);
      } catch {
        violations.push("Nonprotocol stdout frame");
        for (const waiter of pending.values()) waiter.reject(new Error("Nonprotocol stdout frame"));
      }
      newline = buffer.indexOf("\n");
    }
  });
  function request(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    nextId += 1;
    const id = nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error("MCP request timed out")); }, 7000);
      pending.set(id, {
        resolve: message => { clearTimeout(timer); pending.delete(id); resolve(message); },
        reject: error => { clearTimeout(timer); pending.delete(id); reject(error); }
      });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }
  try {
    const initialized = object((await request("initialize", {
      protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "raw-synthetic-test", version: "1.0.0" }
    })).result);
    assert.equal(typeof initialized.protocolVersion, "string");
    assert.equal(object(initialized.serverInfo).name, "everyday_list_difference_checker_mcp");
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    const listed = object((await request("tools/list", {})).result);
    assert.ok(Array.isArray(listed.tools));
    assert.equal(listed.tools.length, 1);
    assert.equal(object(listed.tools[0]).name, "compare_lists");
    for (const arguments_ of [
      { left: 123, right: "" }, { left: "x" }, { left: "", right: "", options: { trim: "yes" } },
      { left: "", right: "", options: { case_locale: "en" } }, { left: "", right: "", file: "synthetic.txt" }
    ]) {
      const response = await request("tools/call", { name: "compare_lists", arguments: arguments_ });
      assert.ok(response.error !== undefined || object(response.result).isError === true);
    }
    const limited = object((await request("tools/call", {
      name: "compare_lists", arguments: { left: "", right: "\n".repeat(10001) }
    })).result);
    assert.equal(limited.isError, true);
    assert.equal(failureSchema.parse(limited.structuredContent).error.code, "TOO_MANY_LINES");
    const valid = object((await request("tools/call", { name: "compare_lists", arguments: { left: "__proto__\n🍎", right: "🍎" } })).result);
    assert.notEqual(valid.isError, true);
    assert.equal(successSchema.parse(valid.structuredContent).shared.total_items, 1);
  } finally {
    for (const waiter of pending.values()) waiter.reject(new Error("Test shutdown"));
    child.stdin.end();
    const killTimer = setTimeout(() => child.kill(), 1500);
    await closed;
    clearTimeout(killTimer);
  }
  assert.deepEqual(violations, []);
  assert.equal(buffer, "", "stdout must not contain a partial nonprotocol line");
  assert.equal(stderr, "", "server must not log input content or diagnostics during normal calls");
  assert.ok(frames >= 9);
});
