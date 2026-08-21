import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { checkMarkdownFile, scanMarkdownLinks } from "../src/checker.js";
import { withTempDirectory } from "./test-helpers.js";

test("an existing file with a missing anchor is classified separately", async () => {
  await withTempDirectory("link-check-anchor-missing-", async (base) => {
    await writeFile(path.join(base, "index.md"), "[Target](target.md#missing-heading)\n");
    await writeFile(path.join(base, "target.md"), "# Existing Heading\n");

    const result = await checkMarkdownFile(base, { path: "index.md" });

    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0]?.issue, "missing_anchor");
    assert.equal(result.findings[0]?.target, "target.md#missing-heading");
  });
});

test("local and percent-encoded Hebrew anchors are recognized", async () => {
  await withTempDirectory("link-check-anchor-valid-", async (base) => {
    await writeFile(
      path.join(base, "index.md"),
      "# סיכום יומי\n[Here](#%D7%A1%D7%99%D7%9B%D7%95%D7%9D-%D7%99%D7%95%D7%9E%D7%99)\n"
    );

    const result = await checkMarkdownFile(base, { path: "index.md" });

    assert.equal(result.links_checked, 1);
    assert.deepEqual(result.findings, []);
  });
});

test("nested relative paths and reference-style links are resolved", async () => {
  await withTempDirectory("link-check-nested-", async (base) => {
    await mkdir(path.join(base, "guide", "parts"), { recursive: true });
    await writeFile(path.join(base, "shared.md"), "# Shared Topic\n");
    await writeFile(
      path.join(base, "guide", "parts", "one.md"),
      "[Shared][topic]\n\n[topic]: ../../shared.md#shared-topic\n"
    );

    const result = await scanMarkdownLinks(base, { path: "guide" });

    assert.equal(result.links_checked, 1);
    assert.deepEqual(result.findings, []);
  });
});
