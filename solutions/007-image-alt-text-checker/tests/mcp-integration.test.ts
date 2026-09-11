import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { reportSchema, scanSchema } from "../src/schemas.js";
import { fixture } from "./helpers.js";

test("real stdio MCP discovery, both tools, output schemas, errors and offline guard", { timeout: 20000 }, async () => {
  const f = await fixture({ "a.md": '![](https://example.invalid/image.png)\n<img alt="photo">' });
  const client = new Client({ name: "alt-test", version: "1.0.0" });
  const transport = new StdioClientTransport({ command: process.execPath, args: [
    "--import", new URL("./offline-guard.js", import.meta.url).href,
    fileURLToPath(new URL("../src/server.js", import.meta.url))
  ] });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map(t => t.name).sort(), ["get_alt_text_report", "scan_alt_text"]);
    for (const tool of listed.tools) {
      assert.deepEqual(tool.annotations, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
      assert.ok(tool.inputSchema); assert.ok(tool.outputSchema);
    }
    const response = await client.callTool({ name: "scan_alt_text", arguments: { directory: f.directory } });
    assert.notEqual(response.isError, true);
    const scan = scanSchema.parse(response.structuredContent);
    assert.equal(scan.total_findings, 2); assert.equal(scan.by_issue.missing, 1);
    const text = response.content.find(c => c.type === "text");
    assert.ok(text?.type === "text"); assert.deepEqual(JSON.parse(text.text), scan);
    const second = await client.callTool({ name: "scan_alt_text", arguments: { directory: f.directory } });
    assert.equal(JSON.stringify(second.structuredContent), JSON.stringify(scan));
    const report = reportSchema.parse((await client.callTool({ name: "get_alt_text_report", arguments: { directory: f.directory } })).structuredContent);
    assert.deepEqual(report.by_issue, scan.by_issue); assert.deepEqual(report.by_file, scan.by_file);
    const failed = await client.callTool({ name: "scan_alt_text", arguments: { directory: "//server/share" } });
    assert.equal(failed.isError, true); assert.equal(scanSchema.parse(failed.structuredContent).errors[0]?.code, "NON_LOCAL_PATH");
  } finally { await client.close(); await transport.close(); await f.cleanup(); }
});
