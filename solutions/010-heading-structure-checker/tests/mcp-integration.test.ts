import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { listResult, scanResult } from "../src/schemas.js";
import { fixture } from "./helpers.js";

const server = fileURLToPath(new URL("../src/server.js", import.meta.url));
const guard = new URL("./offline-guard.js", import.meta.url).href;
test("real stdio MCP discovery, structured results, annotations and offline guard", { timeout: 60000 }, async () => {
  const f = await fixture();
  const client = new Client({ name: "heading-test", version: "1.0.0" });
  const transport = new StdioClientTransport({ command: process.execPath, args: ["--import", guard, server, "--root", f.root] });
  try {
    await f.put("a.md", "# Title\n## Section\n#### Deep");
    await client.connect(transport);
    const tools = (await client.listTools()).tools;
    assert.deepEqual(tools.map(tool => tool.name).sort(), ["list_markdown_files", "scan_heading_structure"]);
    for (const tool of tools) {
      assert.deepEqual(tool.annotations, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
      assert.ok(tool.inputSchema); assert.ok(tool.outputSchema);
    }
    const listed = await client.callTool({ name: "list_markdown_files", arguments: { directory: "." } });
    assert.deepEqual(listResult.parse(listed.structuredContent).files, ["a.md"]);
    const response = await client.callTool({ name: "scan_heading_structure", arguments: { paths: ["a.md"] } });
    const result = scanResult.parse(response.structuredContent);
    assert.equal(result.ok, true); assert.equal(result.findings[0]?.code, "SKIPPED_LEVEL");
    assert.deepEqual(result.findings[0]?.related_lines, [2]);
    const text = response.content.find(item => item.type === "text");
    assert.ok(text?.type === "text"); assert.deepEqual(JSON.parse(text.text), result);
    const rejected = await client.callTool({ name: "scan_heading_structure", arguments: { paths: ["../outside.md"] } });
    assert.equal(scanResult.parse(rejected.structuredContent).errors[0]?.code, "PATH_REJECTED");
    assert.equal(rejected.isError, true);
  } finally { await client.close(); await transport.close(); await f.close(); }
});
