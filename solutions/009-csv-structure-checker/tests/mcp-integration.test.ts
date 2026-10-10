import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { resultSchema } from "../src/schemas.js";
import { fixture } from "./helpers.js";

const server = fileURLToPath(new URL("../src/server.js", import.meta.url));
const guard = new URL("./offline-guard.js", import.meta.url).href;
test("real stdio SDK initialization, discovery and invocation with network APIs disabled", { timeout: 60000 }, async () => {
  const f = await fixture();
  const client = new Client({ name: "csv-synthetic-test", version: "1.0.0" });
  const transport = new StdioClientTransport({ command: process.execPath, args: ["--import", guard, server, "--root", f.root] });
  try {
    await f.put("valid.csv", "\ufeffשם,עיר\r\nדוגמה,בדיקה\r\n");
    await client.connect(transport);
    const listing = await client.listTools();
    assert.deepEqual(listing.tools.map(t => t.name), ["check_csv_structure"]);
    assert.deepEqual(listing.tools[0]?.annotations, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
    assert.ok(listing.tools[0]?.inputSchema); assert.ok(listing.tools[0]?.outputSchema);
    const response = await client.callTool({ name: "check_csv_structure", arguments: { path: "valid.csv" } });
    const result = resultSchema.parse(response.structuredContent);
    assert.equal(result.ok, true); assert.notEqual(response.isError, true); assert.equal(result.records_completed, 2);
    const text = response.content.find(item => item.type === "text");
    assert.ok(text?.type === "text"); assert.deepEqual(JSON.parse(text.text), result);
    const again = await client.callTool({ name: "check_csv_structure", arguments: { path: "valid.csv" } });
    assert.deepEqual(again.structuredContent, result);
    for (const [name, content, code] of [["bad.csv", 'a\nx"', "BARE_QUOTE"], ["encoding.csv", Buffer.from([0xff]), "UNSUPPORTED_ENCODING"]] as const) {
      await f.put(name, content);
      const failed = await client.callTool({ name: "check_csv_structure", arguments: { path: name } });
      assert.equal(failed.isError, true); assert.equal(resultSchema.parse(failed.structuredContent).error?.code, code);
    }
    const rejected = await client.callTool({ name: "check_csv_structure", arguments: { path: "../outside.csv" } });
    assert.equal(resultSchema.parse(rejected.structuredContent).error?.code, "PATH_REJECTED");
  } finally { await client.close(); await transport.close(); await f.close(); }
});

test("raw stdout contains only MCP frames; invalid requests do not break later calls", { timeout: 60000 }, async () => {
  const f = await fixture();
  await f.put("valid.csv", "a,b\n1,2");
  const child = spawn(process.execPath, ["--import", guard, server, "--root", f.root], { stdio: "pipe", windowsHide: true });
  const closed = new Promise<void>(resolve => child.once("close", () => resolve()));
  let buffer = "", stderr = "", id = 0;
  const violations: string[] = [];
  const pending = new Map<number, { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }>();
  child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => { stderr += chunk; });
  child.on("error", error => { for (const waiter of pending.values()) waiter.reject(error); });
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    let end: number;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      try {
        const message = JSON.parse(line) as Record<string, unknown>;
        assert.equal(message.jsonrpc, "2.0");
        assert.ok("result" in message || "error" in message || "method" in message);
        if (typeof message.id === "number") pending.get(message.id)?.resolve(message);
      } catch { violations.push("Nonprotocol stdout"); }
    }
  });
  function request(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const requestId = ++id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(requestId); reject(new Error("Request timeout")); }, 15000);
      pending.set(requestId, {
        resolve(value) { clearTimeout(timer); pending.delete(requestId); resolve(value); },
        reject(error) { clearTimeout(timer); pending.delete(requestId); reject(error); }
      });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params }) + "\n");
    });
  }
  try {
    const initialized = await request("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "raw-csv-test", version: "1.0.0" } });
    assert.ok(initialized.result);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    assert.ok((await request("tools/list", {})).result);
    for (const arguments_ of [{ path: 4 }, { path: "valid.csv", delimiter: "auto" }, { path: "valid.csv", max_findings: 201 }, { path: "valid.csv", header: "yes" }, { path: "valid.csv", unknown: true }]) {
      const invalid = await request("tools/call", { name: "check_csv_structure", arguments: arguments_ });
      assert.ok(invalid.error || (invalid.result as { isError?: boolean } | undefined)?.isError);
    }
    const valid = await request("tools/call", { name: "check_csv_structure", arguments: { path: "valid.csv" } });
    assert.equal(resultSchema.parse((valid.result as { structuredContent: unknown }).structuredContent).ok, true);
  } finally {
    child.stdin.end();
    const timer = setTimeout(() => child.kill(), 1500);
    await closed; clearTimeout(timer); await f.close();
  }
  assert.deepEqual(violations, []); assert.equal(buffer, ""); assert.equal(stderr, "");
});

test("startup requires explicit root and never writes nonprotocol stdout", { timeout: 20000 }, async () => {
  const child = spawn(process.execPath, [server], { stdio: "pipe", windowsHide: true });
  let stdout = "", stderr = "";
  child.stdout.on("data", chunk => { stdout += String(chunk); });
  child.stderr.on("data", chunk => { stderr += String(chunk); });
  const code = await new Promise<number | null>((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
  assert.equal(code, 1); assert.equal(stdout, ""); assert.match(stderr, /startup failed/);
});
