import * as z from "zod/v4";

export const DEFAULT_MAX_DEPTH = 16;
export const DEFAULT_EXCLUDE_PATTERNS = [".git", "node_modules"] as const;
export const MAX_TOP_N = 100;
export const MAX_RETAINED_WARNINGS = 200;

export const toolErrorCodeSchema = z.enum([
  "invalid_path",
  "not_found",
  "not_directory",
  "root_symlink",
  "permission_denied",
  "size_overflow",
  "scan_failed",
  "no_scan"
]);

export const toolErrorSchema = z
  .object({
    code: toolErrorCodeSchema,
    message: z.string(),
    path: z.string().nullable()
  })
  .strict();

export const warningCodeSchema = z.enum([
  "SYMLINK_SKIPPED",
  "CYCLE_SKIPPED",
  "PERMISSION_DENIED",
  "READ_ERROR",
  "MAX_DEPTH_REACHED",
  "OUTSIDE_ROOT_SKIPPED",
  "UNSUPPORTED_TYPE"
]);

export const scanWarningSchema = z
  .object({
    path: z.string(),
    code: warningCodeSchema,
    message: z.string()
  })
  .strict();

export const itemTypeSchema = z.enum(["all", "file", "directory"]);

export const largestItemSchema = z
  .object({
    path: z.string(),
    type: z.enum(["file", "directory"]),
    size_bytes: z.number().int().nonnegative(),
    complete: z.boolean()
  })
  .strict();

export const scanDirectoryInputSchema = z
  .object({
    path: z
      .string()
      .describe("Local directory path to inspect. Relative paths resolve from the server working directory."),
    max_depth: z
      .number()
      .int()
      .min(0)
      .max(64)
      .default(DEFAULT_MAX_DEPTH)
      .describe("Maximum subdirectory depth. Files directly in the root are at depth zero."),
    exclude_patterns: z
      .array(z.string().trim().min(1).max(128))
      .max(32)
      .default([...DEFAULT_EXCLUDE_PATTERNS])
      .describe("Case-sensitive name or relative-path glob patterns. A supplied array replaces the defaults.")
  })
  .strict();

export const listLargestItemsInputSchema = z
  .object({
    top_n: z
      .number()
      .int()
      .min(1)
      .max(MAX_TOP_N)
      .default(10)
      .describe("Number of largest retained items to return."),
    item_type: itemTypeSchema
      .default("all")
      .describe("Return files, directories, or both kinds of item.")
  })
  .strict();

export const getScanSummaryInputSchema = z.object({}).strict();

const summaryResultShape = {
  ok: z.boolean(),
  error: toolErrorSchema.nullable(),
  root_path: z.string().nullable(),
  max_depth: z.number().int().min(0).max(64),
  exclude_patterns: z.array(z.string()),
  total_size_bytes: z.number().int().nonnegative(),
  file_count: z.number().int().nonnegative(),
  folder_count: z.number().int().nonnegative(),
  excluded_count: z.number().int().nonnegative(),
  warning_count: z.number().int().nonnegative(),
  warnings_omitted: z.number().int().nonnegative(),
  warnings: z.array(scanWarningSchema),
  summary_text: z.string()
};

export const scanDirectoryResultSchema = z.object(summaryResultShape).strict();
export const getScanSummaryResultSchema = z.object(summaryResultShape).strict();

export const listLargestItemsResultSchema = z
  .object({
    ok: z.boolean(),
    error: toolErrorSchema.nullable(),
    root_path: z.string().nullable(),
    top_n: z.number().int().min(1).max(MAX_TOP_N),
    item_type: itemTypeSchema,
    items: z.array(largestItemSchema),
    returned_count: z.number().int().nonnegative(),
    summary_text: z.string()
  })
  .strict();

export type ToolError = z.infer<typeof toolErrorSchema>;
export type WarningCode = z.infer<typeof warningCodeSchema>;
export type ScanWarning = z.infer<typeof scanWarningSchema>;
export type LargestItem = z.infer<typeof largestItemSchema>;
export type ScanDirectoryInput = z.infer<typeof scanDirectoryInputSchema>;
export type ScanDirectoryResult = z.infer<typeof scanDirectoryResultSchema>;
export type ListLargestItemsInput = z.infer<typeof listLargestItemsInputSchema>;
export type ListLargestItemsResult = z.infer<typeof listLargestItemsResultSchema>;
export type GetScanSummaryResult = z.infer<typeof getScanSummaryResultSchema>;
