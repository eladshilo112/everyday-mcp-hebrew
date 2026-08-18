import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeFile } from "node:fs/promises";
import test from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { withTempDirectory } from "./test-helpers.js";

const SERVER_PATH = fileURLToPath(new URL("../src/server.js", import.meta.url));

test("lists all read-only tools and completes scan, grouping, and cleanup over real stdio", async () => {
  await withTempDirectory("duplicate-mcp-", async (rootPath) => {
    await writeFile(path.join(rootPath, "first.txt"), "same");
    await writeFile(path.join(rootPath, "second.txt"), "same");
    await writeFile(path.join(rootPath, "unique.txt"), "unique");

    const client = new Client({ name: "duplicate-finder-test-client", version: "1.0.0" });
    const transport = new StdioClientTransport({ command: process.execPath, args: [SERVER_PATH] });
    try {
      await client.connect(transport);
      const listed = await client.listTools();
      assert.deepEqual(
        listed.tools.map((tool) => tool.name).sort(),
        ["find_duplicates", "scan_directory", "suggest_cleanup"]
      );
      assert.ok(listed.tools.every((tool) => tool.annotations?.readOnlyHint === true));
      assert.ok(listed.tools.every((tool) => tool.annotations?.destructiveHint === false));
      assert.ok(listed.tools.every((tool) => tool.annotations?.openWorldHint === false));

      const scanResult = await client.callTool({
        name: "scan_directory",
        arguments: { path: rootPath }
      });
      assert.notEqual(scanResult.isError, true);
      const scan = scanResult.structuredContent as { ok?: boolean; scan_id?: string; files?: unknown[] };
      assert.equal(scan.ok, true);
      assert.equal(scan.files?.length, 3);
      assert.equal(typeof scan.scan_id, "string");

      const duplicateResult = await client.callTool({
        name: "find_duplicates",
        arguments: { scan_id: scan.scan_id }
      });
      assert.notEqual(duplicateResult.isError, true);
      const duplicates = duplicateResult.structuredContent as {
        total_groups?: number;
        duplicate_groups?: Array<{ paths?: string[] }>;
      };
      assert.equal(duplicates.total_groups, 1);
      assert.deepEqual(duplicates.duplicate_groups?.[0]?.paths, ["first.txt", "second.txt"]);

      const cleanupResult = await client.callTool({
        name: "suggest_cleanup",
        arguments: { scan_id: scan.scan_id }
      });
      assert.notEqual(cleanupResult.isError, true);
      const cleanup = cleanupResult.structuredContent as {
        total_candidates?: number;
        proposals?: Array<{ keep_path?: string; removal_candidates?: string[] }>;
      };
      assert.equal(cleanup.total_candidates, 1);
      assert.equal(cleanup.proposals?.[0]?.keep_path, "first.txt");
      assert.deepEqual(cleanup.proposals?.[0]?.removal_candidates, ["second.txt"]);
    } finally {
      await client.close();
    }
  });
});

test("a nonexistent path returns structuredContent over stdio instead of a stack trace", async () => {
  await withTempDirectory("duplicate-mcp-error-", async (rootPath) => {
    const client = new Client({ name: "duplicate-error-test-client", version: "1.0.0" });
    const transport = new StdioClientTransport({ command: process.execPath, args: [SERVER_PATH] });
    try {
      await client.connect(transport);
      const result = await client.callTool({
        name: "scan_directory",
        arguments: { path: path.join(rootPath, "missing") }
      });
      assert.notEqual(result.isError, true);
      const structured = result.structuredContent as {
        ok?: boolean;
        error?: { code?: string; message?: string };
      };
      assert.equal(structured.ok, false);
      assert.equal(structured.error?.code, "not_found");
      assert.doesNotMatch(structured.error?.message ?? "", /\bat\s+\S+\s*\(/u);
    } finally {
      await client.close();
    }
  });
});
