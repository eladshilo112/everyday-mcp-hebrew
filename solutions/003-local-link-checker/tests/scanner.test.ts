import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { scanMarkdownLinks } from "../src/checker.js";
import { withTempDirectory } from "./test-helpers.js";

test("a directory with two valid relative links has no findings", async () => {
  await withTempDirectory("link-check-valid-", async (base) => {
    await mkdir(path.join(base, "docs"));
    await writeFile(path.join(base, "index.md"), "[Notes](notes.md)\n[Docs](docs/)\n");
    await writeFile(path.join(base, "notes.md"), "# Notes\n");
    await writeFile(path.join(base, "docs", "README.md"), "# Docs\n");

    const result = await scanMarkdownLinks(base, { path: "." });

    assert.equal(result.ok, true);
    assert.equal(result.links_checked, 2);
    assert.equal(result.findings.length, 0);
  });
});

test("a missing relative file reports source, line, target, and issue", async () => {
  await withTempDirectory("link-check-missing-", async (base) => {
    await writeFile(path.join(base, "index.md"), "intro\n[Missing](docs/missing.md)\n");

    const result = await scanMarkdownLinks(base, { path: "." });

    assert.deepEqual(result.findings, [
      {
        source: "index.md",
        line: 2,
        target: "docs/missing.md",
        issue: "missing_target",
        suggestion: "בדקו את הנתיב היחסי או עדכנו את שם היעד."
      }
    ]);
  });
});

test("HTTP and other protocol links are skipped without local resolution", async () => {
  await withTempDirectory("link-check-external-", async (base) => {
    await writeFile(
      path.join(base, "index.md"),
      "[Web](https://example.invalid/a)\n[Mail](mailto:test@example.invalid)\n"
    );

    const result = await scanMarkdownLinks(base, { path: "." });

    assert.equal(result.links_checked, 0);
    assert.equal(result.external_links_skipped, 2);
    assert.deepEqual(result.findings, []);
  });
});

test("percent-encoded spaces resolve to an existing local file", async () => {
  await withTempDirectory("link-check-space-", async (base) => {
    await writeFile(path.join(base, "index.md"), "[Quarterly](Quarterly%20Notes.md)\n");
    await writeFile(path.join(base, "Quarterly Notes.md"), "# Quarterly Notes\n");

    const result = await scanMarkdownLinks(base, { path: "." });

    assert.equal(result.links_checked, 1);
    assert.deepEqual(result.findings, []);
  });
});
