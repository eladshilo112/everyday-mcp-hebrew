import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { checkClarity, listIssues } from "../src/analyzer.js";
import { MAX_FILE_PATH_CHARACTERS, MAX_INPUT_CHARACTERS } from "../src/schemas.js";

async function withTempDirectory(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(path.join(tmpdir(), "clarity-checker-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("a valid UTF-8 file keeps its bytes, size, mtime, and mode", async () => {
  await withTempDirectory(async (directory) => {
    const filePath = path.join(directory, "message.txt");
    const content = "המסמך נכתב על ידי הצוות.";
    await writeFile(filePath, content, "utf8");
    const beforeBytes = await readFile(filePath);
    const before = await stat(filePath);

    const result = await checkClarity({ file_path: filePath });

    const afterBytes = await readFile(filePath);
    const after = await stat(filePath);
    assert.equal(result.ok, true);
    assert.equal(result.source_kind, "file");
    assert.equal(result.passive_count, 1);
    assert.deepEqual(afterBytes, beforeBytes);
    assert.equal(after.size, before.size);
    assert.equal(after.mtimeMs, before.mtimeMs);
    assert.equal(after.mode, before.mode);
  });
});

test("a missing file returns a clear structured error", async () => {
  await withTempDirectory(async (directory) => {
    const result = await listIssues({ file_path: path.join(directory, "missing.txt") });
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "not_found");
    assert.match(result.error?.message ?? "", /does not exist/u);
    assert.deepEqual(result.issues, []);
  });
});

test("invalid UTF-8 returns a structured encoding error", async () => {
  await withTempDirectory(async (directory) => {
    const filePath = path.join(directory, "invalid-utf8.txt");
    await writeFile(filePath, Buffer.from([0xc3, 0x28]));
    const result = await checkClarity({ file_path: filePath });
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "invalid_encoding");
  });
});

test("oversized direct text and oversized files are rejected in-band", async () => {
  const textResult = await checkClarity({ text: "a".repeat(MAX_INPUT_CHARACTERS + 1) });
  assert.equal(textResult.ok, false);
  assert.equal(textResult.error?.code, "input_too_large");

  await withTempDirectory(async (directory) => {
    const filePath = path.join(directory, "too-large.txt");
    await writeFile(filePath, "a".repeat(MAX_INPUT_CHARACTERS + 1), "utf8");
    const fileResult = await checkClarity({ file_path: filePath });
    assert.equal(fileResult.ok, false);
    assert.equal(fileResult.error?.code, "input_too_large");
  });
});

test("a UTF-8 byte-order mark does not consume the character limit", async () => {
  await withTempDirectory(async (directory) => {
    const filePath = path.join(directory, "bounded-bom.txt");
    await writeFile(filePath, `\uFEFF${"a".repeat(MAX_INPUT_CHARACTERS)}`, "utf8");
    const result = await checkClarity({ file_path: filePath });
    assert.equal(result.ok, true);
    assert.equal(result.character_count, MAX_INPUT_CHARACTERS);
  });
});

test("a directory is rejected as a non-file input", async () => {
  await withTempDirectory(async (directory) => {
    const result = await checkClarity({ file_path: directory });
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "not_file");
  });
});

test("an excessive file path is rejected without echoing it into the result", async () => {
  const result = await checkClarity({ file_path: "a".repeat(MAX_FILE_PATH_CHARACTERS + 1) });
  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "invalid_path");
  assert.equal(result.error?.path, null);
  assert.equal(result.source_path, null);
});
