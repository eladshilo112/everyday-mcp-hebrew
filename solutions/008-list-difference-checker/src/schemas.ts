import { z } from "zod";

export const LIMITS = Object.freeze({ input_bytes: 262144, input_lines: 10000, occurrence_records: 500 });

export const optionsSchema = z.object({
  trim: z.boolean().default(false).describe("Trim outer ECMAScript whitespace first."),
  ascii_case_fold: z.boolean().default(false).describe("Map only ASCII A-Z to a-z, after trimming."),
  nfc: z.boolean().default(false).describe("Apply Unicode NFC last; no NFKC or other case conversion.")
}).strict();

export const compareInputSchema = z.object({
  left: z.string().describe("Inline text only; at most 262144 UTF-8 bytes and 10000 physical lines."),
  right: z.string().describe("Inline text only; at most 262144 UTF-8 bytes and 10000 physical lines."),
  options: optionsSchema.default({ trim: false, ascii_case_fold: false, nfc: false })
}).strict();

const count = z.number().int().nonnegative();
export const occurrenceSchema = z.object({
  side: z.enum(["left", "right"]),
  line: z.number().int().positive(),
  text: z.string()
}).strict();

export const itemSchema = z.object({
  key: z.string().min(1),
  left_count: count,
  right_count: count,
  total_occurrences: count,
  returned_occurrences: count,
  omitted_occurrences: count,
  truncated: z.boolean(),
  occurrences: z.array(occurrenceSchema).min(1).max(LIMITS.occurrence_records)
}).strict();

export const groupSchema = z.object({
  total_items: count,
  returned_items: count,
  omitted_items: count,
  total_occurrences: count,
  returned_occurrences: count,
  omitted_occurrences: count,
  truncated: z.boolean(),
  items: z.array(itemSchema).max(LIMITS.occurrence_records)
}).strict();

const inputStatsSchema = z.object({
  utf8_bytes: count,
  lines: count,
  ignored_lines: count,
  items: count.describe("Number of nonempty occurrences after the selected normalization."),
  distinct_items: count,
  duplicate_groups: count,
  duplicate_occurrences: count.describe("All occurrences in repeated groups, including their first occurrence."),
  extra_occurrences: count.describe("Occurrences beyond the first of each distinct item.")
}).strict();

export const successSchema = z.object({
  ok: z.literal(true),
  options: optionsSchema,
  inputs: z.object({ left: inputStatsSchema, right: inputStatsSchema }).strict(),
  left_only: groupSchema,
  right_only: groupSchema,
  shared: groupSchema,
  duplicates_left: groupSchema,
  duplicates_right: groupSchema,
  reporting: z.object({
    occurrence_budget: z.literal(500),
    total_occurrence_records: count,
    returned_occurrence_records: count.max(500),
    omitted_occurrence_records: count,
    truncated: z.boolean()
  }).strict()
}).strict();

export const failureSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.enum(["INVALID_ARGUMENTS", "INPUT_TOO_LARGE", "TOO_MANY_LINES"]),
    input: z.enum(["left", "right", "arguments"]),
    message: z.string(),
    limit: count.optional(),
    actual: count.optional()
  }).strict()
}).strict();

// An object root allows MCP clients to discover both success and failure results.
export const compareResultSchema = z.object({
  ok: z.boolean(),
  options: successSchema.shape.options.optional(),
  inputs: successSchema.shape.inputs.optional(),
  left_only: groupSchema.optional(),
  right_only: groupSchema.optional(),
  shared: groupSchema.optional(),
  duplicates_left: groupSchema.optional(),
  duplicates_right: groupSchema.optional(),
  reporting: successSchema.shape.reporting.optional(),
  error: failureSchema.shape.error.optional()
}).strict();

export type Options = z.infer<typeof optionsSchema>;
export type Occurrence = z.infer<typeof occurrenceSchema>;
export type Group = z.infer<typeof groupSchema>;
export type InputStats = z.infer<typeof inputStatsSchema>;
export type Success = z.infer<typeof successSchema>;
export type Failure = z.infer<typeof failureSchema>;
export type Comparison = Success | Failure;
