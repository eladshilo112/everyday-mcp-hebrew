import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { withTempDirectory, writeSizedFile } from "./test-helpers.js";

const SERVER_PATH = fileURLToPath(new URL("../src/server.js", import.meta.url));

test("real stdio MCP lists exact read-only tools and returns structured content from all of them", async () => {
  await withTempDirectory("disk-space-mcp-", async (rootPath) => {
    await writeSizedFile(path.join(rootPath, "small.bin"), 2);
    await writeSizedFile(path.join(rootPath, "folder", "large.bin"), 9);
    const client = new Client({ name: "disk-space-test-client", version: "1.0.0" });
    const transport = new StdioClientTransport({ command: process.execPath, args: [SERVER_PATH] });

    try {
      await client.connect(transport);
      const listed = await client.listTools();
      assert.deepEqual(
        listed.tools.map((tool) => tool.name).sort(),
        ["get_scan_summary", "list_largest_items", "scan_directory"]
      );
      assert.ok(listed.tools.every((tool) => tool.annotations?.readOnlyHint === true));
      assert.ok(listed.tools.every((tool) => tool.annotations?.destructiveHint === false));
      assert.ok(listed.tools.every((tool) => tool.annotations?.idempotentHint === true));
      assert.ok(listed.tools.every((tool) => tool.annotations?.openWorldHint === false));

      const scanResponse = await client.callTool({
        name: "scan_directory",
        arguments: { path: rootPath, exclude_patterns: [] }
      });
      assert.notEqual(scanResponse.isError, true);
      assert.ok(scanResponse.structuredContent !== undefined);
      const scan = scanResponse.structuredContent as {
        ok?: boolean;
        total_size_bytes?: number;
        file_count?: number;
        summary_text?: string;
      };
      assert.equal(scan.ok, true);
      assert.equal(scan.total_size_bytes, 11);
      assert.equal(scan.file_count, 2);
      assert.ok((scan.summary_text?.length ?? 0) > 0);

      const listResponse = await client.callTool({
        name: "list_largest_items",
        arguments: { top_n: 1, item_type: "file" }
      });
      assert.notEqual(listResponse.isError, true);
      assert.ok(listResponse.structuredContent !== undefined);
      const largest = listResponse.structuredContent as {
        ok?: boolean;
        returned_count?: number;
        items?: Array<{ path?: string; type?: string; size_bytes?: number; complete?: boolean }>;
      };
      assert.equal(largest.ok, true);
      assert.equal(largest.returned_count, 1);
      assert.equal(path.basename(largest.items?.[0]?.path ?? ""), "large.bin");
      assert.equal(largest.items?.[0]?.type, "file");
      assert.equal(largest.items?.[0]?.size_bytes, 9);
      assert.equal(largest.items?.[0]?.complete, true);

      const summaryResponse = await client.callTool({ name: "get_scan_summary", arguments: {} });
      assert.notEqual(summaryResponse.isError, true);
      assert.ok(summaryResponse.structuredContent !== undefined);
      const summary = summaryResponse.structuredContent as {
        ok?: boolean;
        total_size_bytes?: number;
        file_count?: number;
        summary_text?: string;
      };
      assert.equal(summary.ok, true);
      assert.equal(summary.total_size_bytes, scan.total_size_bytes);
      assert.equal(summary.file_count, scan.file_count);
      assert.equal(summary.summary_text, scan.summary_text);
      const readableSummary = summaryResponse.content.find((item) => item.type === "text");
      assert.equal(readableSummary?.type, "text");
      if (readableSummary?.type === "text") {
        assert.ok(readableSummary.text.includes(summary.summary_text ?? "missing summary"));
        assert.ok(readableSummary.text.includes('"total_size_bytes": 11'));
      }

      const invalidResponse = await client.callTool({
        name: "scan_directory",
        arguments: { path: path.join(rootPath, "nonexistent") }
      });
      assert.notEqual(invalidResponse.isError, true);
      assert.ok(invalidResponse.structuredContent !== undefined);
      const invalid = invalidResponse.structuredContent as {
        ok?: boolean;
        error?: { code?: string; message?: string } | null;
      };
      assert.equal(invalid.ok, false);
      assert.equal(invalid.error?.code, "not_found");
      assert.equal(typeof invalid.error?.message, "string");

      const rejected = await client.callTool({
        name: "scan_directory",
        arguments: { path: rootPath, unexpected: true }
      });
      assert.equal(rejected.isError, true);
    } finally {
      await client.close();
    }
  });
});
