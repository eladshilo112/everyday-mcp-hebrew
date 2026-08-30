import assert from "node:assert/strict";
import test from "node:test";
import {
  listLargestItemsInputSchema,
  scanDirectoryInputSchema
} from "../src/schemas.js";

test("scan input applies safe traversal and exclusion defaults", () => {
  const parsed = scanDirectoryInputSchema.parse({ path: "." });

  assert.equal(parsed.max_depth, 16);
  assert.deepEqual(parsed.exclude_patterns, [".git", "node_modules"]);
});

test("largest-items input defaults to ten items of either type", () => {
  const parsed = listLargestItemsInputSchema.parse({});

  assert.equal(parsed.top_n, 10);
  assert.equal(parsed.item_type, "all");
});

test("closed schemas reject unknown fields and invalid bounds", () => {
  assert.equal(scanDirectoryInputSchema.safeParse({ path: ".", unexpected: true }).success, false);
  assert.equal(listLargestItemsInputSchema.safeParse({ top_n: 0 }).success, false);
  assert.equal(listLargestItemsInputSchema.safeParse({ top_n: 101 }).success, false);
  assert.equal(listLargestItemsInputSchema.safeParse({ top_n: 100 }).success, true);
  assert.equal(listLargestItemsInputSchema.safeParse({ item_type: "link" }).success, false);
});
