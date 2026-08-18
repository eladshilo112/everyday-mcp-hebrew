import * as z from "zod/v4";

export const DEFAULT_MAX_DEPTH = 16;
export const DEFAULT_MAX_FILES = 10_000;
export const DEFAULT_MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024;

export const errorCodeSchema = z.enum([
  "invalid_path",
  "not_found",
  "not_directory",
  "root_symlink",
  "permission_denied",
  "limit_exceeded",
  "scan_failed",
  "no_scan",
  "scan_not_found"
]);

export const toolErrorSchema = z
  .object({
    code: errorCodeSchema,
    message: z.string(),
    path: z.string().nullable()
  })
  .strict();

export const scanLimitsSchema = z
  .object({
    max_depth: z.number().int().min(0).max(64),
    max_files: z.number().int().min(1).max(10_000),
    max_file_size_bytes: z.number().int().min(1).max(1024 * 1024 * 1024)
  })
  .strict();

export const scannedFileSchema = z
  .object({
    path: z.string(),
    size_bytes: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u)
  })
  .strict();

export const skippedReasonSchema = z.enum([
  "symlink",
  "too_large",
  "max_depth",
  "unsupported_type",
  "read_error",
  "changed_during_scan"
]);

export const skippedEntrySchema = z
  .object({
    path: z.string(),
    reason: skippedReasonSchema
  })
  .strict();

export const duplicateGroupSchema = z
  .object({
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    size_bytes: z.number().int().nonnegative(),
    paths: z.array(z.string()).min(2),
    potential_savings_bytes: z.number().int().nonnegative()
  })
  .strict();

export const cleanupProposalSchema = z
  .object({
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    size_bytes: z.number().int().nonnegative(),
    keep_path: z.string(),
    removal_candidates: z.array(z.string()).min(1),
    potential_savings_bytes: z.number().int().nonnegative()
  })
  .strict();

export const scanDirectoryInputSchema = z
  .object({
    path: z
      .string()
      .min(1)
      .describe("Local directory path to inspect. Relative paths resolve from the server working directory."),
    max_depth: z
      .number()
      .int()
      .min(0)
      .max(64)
      .default(DEFAULT_MAX_DEPTH)
      .describe("Maximum subdirectory depth. Files directly in the root are at depth zero."),
    max_files: z
      .number()
      .int()
      .min(1)
      .max(10_000)
      .default(DEFAULT_MAX_FILES)
      .describe("Maximum number of regular files encountered before the scan stops with a clear error."),
    max_file_size_bytes: z
      .number()
      .int()
      .min(1)
      .max(1024 * 1024 * 1024)
      .default(DEFAULT_MAX_FILE_SIZE_BYTES)
      .describe("Files larger than this byte cap are reported as skipped and are not hashed.")
  })
  .strict();

export const scanDirectoryResultSchema = z
  .object({
    ok: z.boolean(),
    error: toolErrorSchema.nullable(),
    scan_id: z.string().nullable(),
    root_path: z.string().nullable(),
    limits: scanLimitsSchema,
    files: z.array(scannedFileSchema),
    skipped: z.array(skippedEntrySchema)
  })
  .strict();

export const scanReferenceInputSchema = z
  .object({
    scan_id: z
      .string()
      .min(1)
      .optional()
      .describe("Optional scan identifier from scan_directory. If omitted, the latest successful scan is used.")
  })
  .strict();

export const findDuplicatesResultSchema = z
  .object({
    ok: z.boolean(),
    error: toolErrorSchema.nullable(),
    scan_id: z.string().nullable(),
    duplicate_groups: z.array(duplicateGroupSchema),
    total_groups: z.number().int().nonnegative(),
    total_duplicate_files: z.number().int().nonnegative(),
    potential_savings_bytes: z.number().int().nonnegative()
  })
  .strict();

export const suggestCleanupResultSchema = z
  .object({
    ok: z.boolean(),
    error: toolErrorSchema.nullable(),
    scan_id: z.string().nullable(),
    proposals: z.array(cleanupProposalSchema),
    total_candidates: z.number().int().nonnegative(),
    potential_savings_bytes: z.number().int().nonnegative(),
    notice_he: z.string(),
    notice_en: z.string()
  })
  .strict();

export type ToolError = z.infer<typeof toolErrorSchema>;
export type ScanLimits = z.infer<typeof scanLimitsSchema>;
export type ScannedFile = z.infer<typeof scannedFileSchema>;
export type SkippedEntry = z.infer<typeof skippedEntrySchema>;
export type ScanDirectoryInput = z.infer<typeof scanDirectoryInputSchema>;
export type ScanDirectoryResult = z.infer<typeof scanDirectoryResultSchema>;
export type DuplicateGroup = z.infer<typeof duplicateGroupSchema>;
export type FindDuplicatesResult = z.infer<typeof findDuplicatesResultSchema>;
export type CleanupProposal = z.infer<typeof cleanupProposalSchema>;
export type SuggestCleanupResult = z.infer<typeof suggestCleanupResultSchema>;
