import assert from "node:assert/strict";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { checkMarkdownFile, scanMarkdownLinks } from "../src/checker.js";
import { scanMarkdownLinksInputSchema } from "../src/schemas.js";
import { withTempDirectory } from "./test-helpers.js";

test("an input path that leaves the approved base is rejected structurally", async () => {
  await withTempDirectory("link-check-boundary-", async (root) => {
    const base = path.join(root, "approved");
    await mkdir(base);

    const result = await scanMarkdownLinks(base, { path: ".." });

    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "outside_base");
    assert.deepEqual(result.findings, []);
  });
});

test("a link that leaves the approved base is reported without inspecting it", async () => {
  await withTempDirectory("link-check-target-boundary-", async (root) => {
    const base = path.join(root, "approved");
    await mkdir(base);
    await writeFile(path.join(root, "outside.md"), "# Outside\n");
    await writeFile(path.join(base, "index.md"), "[Outside](../outside.md)\n");

    const result = await checkMarkdownFile(base, { path: "index.md" });

    assert.equal(result.findings[0]?.issue, "unauthorized_target");
  });
});

test("strict input schema rejects unknown fields", () => {
  const parsed = scanMarkdownLinksInputSchema.safeParse({ path: ".", unexpected: true });
  assert.equal(parsed.success, false);
});

test("a missing path returns a structured error", async () => {
  await withTempDirectory("link-check-no-path-", async (base) => {
    const result = await scanMarkdownLinks(base, {});
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "missing_path");
  });
});

test("checking links does not modify file content or modification time", async () => {
  await withTempDirectory("link-check-readonly-", async (base) => {
    const filePath = path.join(base, "index.md");
    const content = "[Missing](missing.md)\n";
    await writeFile(filePath, content);
    const before = await stat(filePath);

    await checkMarkdownFile(base, { path: "index.md" });

    const after = await stat(filePath);
    assert.equal(await readFile(filePath, "utf8"), content);
    assert.equal(after.mtimeMs, before.mtimeMs);
  });
});
