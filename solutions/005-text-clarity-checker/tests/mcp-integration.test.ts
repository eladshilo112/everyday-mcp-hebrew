import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { MAX_INPUT_CHARACTERS } from "../src/schemas.js";

const SERVER_PATH = fileURLToPath(new URL("../src/server.js", import.meta.url));

test("real stdio MCP exposes two read-only tools and structured results", async () => {
  const client = new Client({ name: "clarity-test-client", version: "1.0.0" });
  const transport = new StdioClientTransport({ command: process.execPath, args: [SERVER_PATH] });

  try {
    await client.connect(transport);
    const listed = await client.listTools();
    assert.deepEqual(
      listed.tools.map((tool) => tool.name).sort(),
      ["check_clarity", "list_issues"]
    );
    assert.ok(listed.tools.every((tool) => tool.annotations?.readOnlyHint === true));
    assert.ok(listed.tools.every((tool) => tool.annotations?.destructiveHint === false));
    assert.ok(listed.tools.every((tool) => tool.annotations?.idempotentHint === true));
    assert.ok(listed.tools.every((tool) => tool.annotations?.openWorldHint === false));

    const clarityResponse = await client.callTool({
      name: "check_clarity",
      arguments: { text: "הודעה קצרה וברורה." }
    });
    assert.notEqual(clarityResponse.isError, true);
    const clarity = clarityResponse.structuredContent as {
      ok?: boolean;
      clarity_score?: number;
      clarity_label?: string;
      issue_count?: number;
      summary_text?: string;
    };
    assert.equal(clarity.ok, true);
    assert.equal(clarity.clarity_score, 100);
    assert.equal(clarity.clarity_label, "ברור");
    assert.equal(clarity.issue_count, 0);
    const readable = clarityResponse.content.find((item) => item.type === "text");
    assert.equal(readable?.type, "text");
    if (readable?.type === "text") {
      assert.ok(readable.text.includes(clarity.summary_text ?? "missing summary"));
      assert.ok(readable.text.includes("100"));
      assert.ok(readable.text.includes('"clarity_score": 100'));
    }

    const issuesResponse = await client.callTool({
      name: "list_issues",
      arguments: { text: "המסמך נכתב על ידי הצוות עם אופטימיזציה." }
    });
    assert.notEqual(issuesResponse.isError, true);
    const issues = issuesResponse.structuredContent as {
      ok?: boolean;
      issue_count?: number;
      issues?: Array<{ line?: number; type?: string; match?: string | null }>;
    };
    assert.equal(issues.ok, true);
    assert.equal(issues.issue_count, 2);
    assert.deepEqual(
      issues.issues?.map((issue) => [issue.line, issue.type]),
      [
        [1, "passive_voice"],
        [1, "complex_term"]
      ]
    );

    const tooLargeResponse = await client.callTool({
      name: "check_clarity",
      arguments: { text: "a".repeat(MAX_INPUT_CHARACTERS + 1) }
    });
    assert.equal(tooLargeResponse.isError, true);
    const tooLarge = tooLargeResponse.structuredContent as {
      ok?: boolean;
      error?: { code?: string } | null;
    };
    assert.equal(tooLarge.ok, false);
    assert.equal(tooLarge.error?.code, "input_too_large");

    const missingResponse = await client.callTool({
      name: "list_issues",
      arguments: { file_path: path.join(process.cwd(), "definitely-missing-clarity-input.txt") }
    });
    assert.equal(missingResponse.isError, true);
    const missing = missingResponse.structuredContent as {
      ok?: boolean;
      error?: { code?: string } | null;
    };
    assert.equal(missing.ok, false);
    assert.equal(missing.error?.code, "not_found");

    const rejected = await client.callTool({
      name: "check_clarity",
      arguments: { text: "safe", unexpected: true }
    });
    assert.equal(rejected.isError, true);
  } finally {
    await client.close();
  }
});
