import * as z from "zod/v4";

export const MAX_RETURNED_ITEMS = 500;
export const MAX_FILE_BYTES = 2_000_000;
export const MAX_SNIPPET_CHARACTERS = 240;
export const inputSchema = z.object({
  directory: z.string().min(1).max(4096).describe("Absolute local directory to scan recursively. No URLs, UNC paths or symlink roots.")
}).strict();
export const issueSchema = z.enum(["missing", "empty", "generic"]);
export const findingSchema = z.object({
  file: z.string(), line: z.number().int().positive(), snippet: z.string().max(MAX_SNIPPET_CHARACTERS),
  issue_type: issueSchema
}).strict();
export const countsSchema = z.object({ missing: z.number().int().nonnegative(), empty: z.number().int().nonnegative(), generic: z.number().int().nonnegative() }).strict();
const errorSchema = z.object({ file: z.string(), code: z.string() }).strict();
const summaryShape = {
  ok: z.boolean(), complete: z.boolean(), files_scanned: z.number().int().nonnegative(),
  images_scanned: z.number().int().nonnegative(), total_findings: z.number().int().nonnegative(),
  by_issue: countsSchema,
  by_file: z.array(z.object({ file: z.string(), total: z.number().int().nonnegative(), counts: countsSchema }).strict()).max(MAX_RETURNED_ITEMS),
  files_with_findings: z.number().int().nonnegative(), files_omitted: z.number().int().nonnegative(),
  errors: z.array(errorSchema).max(MAX_RETURNED_ITEMS), errors_omitted: z.number().int().nonnegative()
};
export const reportSchema = z.object(summaryShape).strict();
export const scanSchema = z.object({ ...summaryShape,
  findings: z.array(findingSchema).max(MAX_RETURNED_ITEMS), findings_omitted: z.number().int().nonnegative()
}).strict();
export type Finding = z.infer<typeof findingSchema>;
export type Counts = z.infer<typeof countsSchema>;
export type Scan = z.infer<typeof scanSchema>;
export type Report = z.infer<typeof reportSchema>;
export const emptyCounts = (): Counts => ({ missing: 0, empty: 0, generic: 0 });
