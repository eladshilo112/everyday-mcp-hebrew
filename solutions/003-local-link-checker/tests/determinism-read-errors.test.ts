import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { nodeFileSystem, scanMarkdownLinks } from "../src/checker.js";
import type { LocalFileSystem } from "../src/checker.js";
import { withTempDirectory } from "./test-helpers.js";

test("repeated scans return byte-identical data in stable finding order", async () => {
  await withTempDirectory("link-check-determinism-", async (base) => {
    await writeFile(path.join(base, "z.md"), "[Z](missing-z.md)\n");
    await writeFile(path.join(base, "a.md"), "line\n[A](missing-a.md)\n");

    const first = await scanMarkdownLinks(base, { path: "." });
    const second = await scanMarkdownLinks(base, { path: "." });

    assert.equal(JSON.stringify(second), JSON.stringify(first));
    assert.deepEqual(first.findings.map((finding) => finding.source), ["a.md", "z.md"]);
  });
});

test("an unreadable Markdown file is reported while readable files continue", async () => {
  await withTempDirectory("link-check-read-error-", async (base) => {
    await writeFile(path.join(base, "blocked.md"), "[Hidden](missing-hidden.md)\n");
    await writeFile(path.join(base, "good.md"), "[Missing](missing.md)\n");
    const injectedFileSystem: LocalFileSystem = {
      ...nodeFileSystem,
      readFile: async (filePath, encoding) => {
        if (path.basename(filePath) === "blocked.md") {
          throw Object.assign(new Error("denied"), { code: "EACCES" });
        }
        return nodeFileSystem.readFile(filePath, encoding);
      }
    };

    const result = await scanMarkdownLinks(base, { path: "." }, injectedFileSystem);

    assert.equal(result.ok, true);
    assert.equal(result.files_scanned, 1);
    assert.equal(result.findings[0]?.source, "good.md");
    assert.deepEqual(result.read_errors, [
      {
        source: "blocked.md",
        code: "EACCES",
        message: "The Markdown file cannot be read with the current permissions."
      }
    ]);
  });
});
