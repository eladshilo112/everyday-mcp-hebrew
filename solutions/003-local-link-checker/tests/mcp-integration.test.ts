import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { withTempDirectory } from "./test-helpers.js";

const SERVER_PATH = fileURLToPath(new URL("../src/server.js", import.meta.url));

test("lists annotated tools and checks links through a real stdio MCP connection", async () => {
  await withTempDirectory("link-check-mcp-", async (base) => {
    await writeFile(path.join(base, "index.md"), "[Good](good.md)\n[Missing](missing.md)\n");
    await writeFile(path.join(base, "good.md"), "# Good\n");
    const client = new Client({ name: "local-link-checker-test-client", version: "1.0.0" });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [SERVER_PATH, "--base-dir", base]
    });
    try {
      await client.connect(transport);
      const listed = await client.listTools();
      assert.deepEqual(
        listed.tools.map((tool) => tool.name).sort(),
        ["check_markdown_file", "scan_markdown_links"]
      );
      assert.ok(listed.tools.every((tool) => tool.annotations?.readOnlyHint === true));
      assert.ok(listed.tools.every((tool) => tool.annotations?.destructiveHint === false));
      assert.ok(listed.tools.every((tool) => tool.annotations?.openWorldHint === false));

      const response = await client.callTool({
        name: "scan_markdown_links",
        arguments: { path: "." }
      });
      assert.notEqual(response.isError, true);
      const structured = response.structuredContent as {
        ok?: boolean;
        findings?: Array<{ source?: string; issue?: string }>;
      };
      assert.equal(structured.ok, true);
      assert.deepEqual(structured.findings, [
        { source: "index.md", line: 2, target: "missing.md", issue: "missing_target", suggestion: "בדקו את הנתיב היחסי או עדכנו את שם היעד." }
      ]);
    } finally {
      await client.close();
    }
  });
});

test("missing path is structured and an unknown field is rejected by MCP schema validation", async () => {
  await withTempDirectory("link-check-mcp-errors-", async (base) => {
    const client = new Client({ name: "local-link-checker-error-client", version: "1.0.0" });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [SERVER_PATH, "--base-dir", base]
    });
    try {
      await client.connect(transport);
      const missing = await client.callTool({ name: "scan_markdown_links", arguments: {} });
      assert.notEqual(missing.isError, true);
      const structured = missing.structuredContent as { ok?: boolean; error?: { code?: string } };
      assert.equal(structured.ok, false);
      assert.equal(structured.error?.code, "missing_path");

      const unknown = await client.callTool({
        name: "scan_markdown_links",
        arguments: { path: ".", unexpected: true }
      });
      assert.equal(unknown.isError, true);
    } finally {
      await client.close();
    }
  });
});
