#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { approveBaseDirectory, checkMarkdownFile, scanMarkdownLinks } from "./checker.js";
import {
  checkMarkdownFileInputSchema,
  checkMarkdownFileResultSchema,
  scanMarkdownLinksInputSchema,
  scanMarkdownLinksResultSchema
} from "./schemas.js";
import type { LinkCheckResult } from "./schemas.js";

function formatResult(result: LinkCheckResult): string {
  if (!result.ok) {
    return `הבדיקה לא בוצעה: ${result.error?.message ?? "שגיאה מובנית"}\n\n${JSON.stringify(result, null, 2)}`;
  }
  return [
    `נסרקו ${result.files_scanned} קובצי Markdown ונבדקו ${result.links_checked} קישורים מקומיים.`,
    `נמצאו ${result.findings.length} ממצאים ו־${result.read_errors.length} שגיאות קריאה.`,
    "",
    JSON.stringify(result, null, 2)
  ].join("\n");
}

export function createServer(approvedBaseDirectory: string): McpServer {
  const server = new McpServer(
    { name: "everyday_local_link_checker_mcp", version: "1.0.0" },
    {
      instructions:
        "Check Markdown links only inside the base directory explicitly approved with --base-dir at launch. Both tools are deterministic, local, offline, and read-only. They never edit files, follow scan-directory symlinks, contact link targets over a network, use telemetry, or retain scan state. External protocols are counted and skipped. Findings are advisory."
    }
  );

  server.registerTool(
    "scan_markdown_links",
    {
      title: "Scan local Markdown links",
      description:
        "Recursively read Markdown files in a directory inside the approved base, check relative file and heading-anchor targets, and return stable findings. External protocols are skipped without network requests. The tool is read-only and never creates, edits, renames, or deletes files.",
      inputSchema: scanMarkdownLinksInputSchema,
      outputSchema: scanMarkdownLinksResultSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (input) => {
      const output = await scanMarkdownLinks(approvedBaseDirectory, input);
      return {
        content: [{ type: "text", text: formatResult(output) }],
        structuredContent: output
      };
    }
  );

  server.registerTool(
    "check_markdown_file",
    {
      title: "Check one local Markdown file",
      description:
        "Read one Markdown file inside the approved base and check its relative file and heading-anchor targets. External protocols are skipped without network requests. The tool is deterministic, read-only, and never creates, edits, renames, or deletes files.",
      inputSchema: checkMarkdownFileInputSchema,
      outputSchema: checkMarkdownFileResultSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (input) => {
      const output = await checkMarkdownFile(approvedBaseDirectory, input);
      return {
        content: [{ type: "text", text: formatResult(output) }],
        structuredContent: output
      };
    }
  );

  return server;
}

export function parseBaseDirectoryArgument(argumentsList: string[]): string {
  if (argumentsList.length !== 2 || argumentsList[0] !== "--base-dir") {
    throw new Error("Usage: local-link-checker --base-dir <approved-local-directory>");
  }
  const baseDirectory = argumentsList[1];
  if (baseDirectory === undefined) {
    throw new Error("A value for --base-dir is required.");
  }
  return baseDirectory;
}

async function main(): Promise<void> {
  const requestedBaseDirectory = parseBaseDirectoryArgument(process.argv.slice(2));
  const approvedBaseDirectory = await approveBaseDirectory(requestedBaseDirectory);
  await serveStdio(() => createServer(approvedBaseDirectory));
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && fileURLToPath(import.meta.url) === path.resolve(invokedPath)) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Server startup failed.";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
