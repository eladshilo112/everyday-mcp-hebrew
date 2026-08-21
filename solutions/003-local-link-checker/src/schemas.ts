import * as z from "zod/v4";

export const errorCodeSchema = z.enum([
  "missing_path",
  "invalid_path",
  "not_found",
  "outside_base",
  "not_directory",
  "not_file",
  "not_markdown",
  "permission_denied",
  "read_error"
]);

export const toolErrorSchema = z
  .object({
    code: errorCodeSchema,
    message: z.string(),
    path: z.string().nullable()
  })
  .strict();

export const issueSchema = z.enum([
  "missing_target",
  "missing_anchor",
  "unauthorized_target",
  "invalid_target"
]);

export const findingSchema = z
  .object({
    source: z.string(),
    line: z.number().int().positive(),
    target: z.string(),
    issue: issueSchema,
    suggestion: z.string()
  })
  .strict();

export const readErrorSchema = z
  .object({
    source: z.string(),
    code: z.string(),
    message: z.string()
  })
  .strict();

const pathInputShape = {
  path: z
    .string()
    .optional()
    .describe("Local path inside the base directory approved with --base-dir when the server started.")
};

export const scanMarkdownLinksInputSchema = z.object(pathInputShape).strict();
export const checkMarkdownFileInputSchema = z.object(pathInputShape).strict();

const resultShape = {
  ok: z.boolean(),
  error: toolErrorSchema.nullable(),
  base_path: z.string(),
  requested_path: z.string().nullable(),
  files_scanned: z.number().int().nonnegative(),
  links_checked: z.number().int().nonnegative(),
  external_links_skipped: z.number().int().nonnegative(),
  findings: z.array(findingSchema),
  read_errors: z.array(readErrorSchema)
};

export const scanMarkdownLinksResultSchema = z.object(resultShape).strict();
export const checkMarkdownFileResultSchema = z.object(resultShape).strict();

export type ToolError = z.infer<typeof toolErrorSchema>;
export type LinkIssue = z.infer<typeof issueSchema>;
export type Finding = z.infer<typeof findingSchema>;
export type ReadError = z.infer<typeof readErrorSchema>;
export type ScanMarkdownLinksInput = z.infer<typeof scanMarkdownLinksInputSchema>;
export type CheckMarkdownFileInput = z.infer<typeof checkMarkdownFileInputSchema>;
export type ScanMarkdownLinksResult = z.infer<typeof scanMarkdownLinksResultSchema>;
export type CheckMarkdownFileResult = z.infer<typeof checkMarkdownFileResultSchema>;
export type LinkCheckResult = ScanMarkdownLinksResult;
