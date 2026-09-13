import assert from "node:assert/strict";
import { compareLists } from "../src/checker.js";
import { successSchema, type Success } from "../src/schemas.js";

export function compare(raw: unknown): Success {
  const result = compareLists(raw);
  assert.equal(result.ok, true);
  return successSchema.parse(result);
}

export function snapshot(raw: unknown): Record<string, unknown> {
  const result = compareLists(raw);
  if (!result.ok) return { error: result.error.code, input: result.error.input };
  return {
    left_only: result.left_only.items.map(item => item.key),
    right_only: result.right_only.items.map(item => item.key),
    shared: result.shared.items.map(item => item.key),
    duplicates_left: result.duplicates_left.items.map(item => [item.key, item.total_occurrences]),
    duplicates_right: result.duplicates_right.items.map(item => [item.key, item.total_occurrences]),
    input_items: [result.inputs.left.items, result.inputs.right.items],
    records: [result.reporting.total_occurrence_records, result.reporting.returned_occurrence_records,
      result.reporting.omitted_occurrence_records],
    truncated: result.reporting.truncated
  };
}
