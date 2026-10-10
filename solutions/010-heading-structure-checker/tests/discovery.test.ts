import assert from "node:assert/strict";
import test from "node:test";
import { discover, MAX_RETURNED_ITEMS } from "../src/files.js";
import { fixture } from "./helpers.js";

test("nonrecursive listing ignores subdirectories; recursive includes mdx and stable order", async () => {
  const f = await fixture();
  try {
    await f.put("b.md", "# B"); await f.put("a.mdx", "# A"); await f.put("nested/c.md", "# C"); await f.put("nested/x.txt", "x");
    assert.deepEqual((await discover(f.root, ".", false)).files, ["a.mdx", "b.md"]);
    assert.deepEqual((await discover(f.root, ".", true)).files, ["a.mdx", "b.md", "nested/c.md"]);
  } finally { await f.close(); }
});

test("empty directory returns a well-formed empty result", async () => {
  const f = await fixture();
  try { assert.deepEqual(await discover(f.root, ".", true), { files: [], truncated: false, errors: [] }); }
  finally { await f.close(); }
});

test("500 markdown files are capped and truncation is explicit", async () => {
  const f = await fixture();
  try {
    for (let i = 0; i < 500; i++) await f.put(`${String(i).padStart(3, "0")}.md`, "# Valid");
    const result = await discover(f.root, ".", false);
    assert.equal(result.files.length, MAX_RETURNED_ITEMS); assert.equal(result.truncated, true);
    assert.equal(result.files[0], "000.md"); assert.equal(result.files.at(-1), "199.md");
  } finally { await f.close(); }
});
