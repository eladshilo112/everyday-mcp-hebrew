import { z } from "zod";
export const inputSchema = z.object({
  path: z.string().min(1).max(4096).describe("Relative regular file path beneath the startup root"),
  delimiter: z.enum(["comma", "semicolon", "tab"]).default("comma"),
  header: z.boolean().default(true),
  max_findings: z.number().int().min(1).max(200).default(200)
}).strict();
export const resultSchema = z.object({
  ok: z.boolean(), complete: z.boolean(), status: z.enum(["complete", "syntax_error", "resource_limit", "error"]),
  records_completed: z.number().int().nonnegative(), data_records: z.number().int().nonnegative(),
  expected_columns: z.number().int().positive().nullable(),
  findings: z.array(z.object({ code: z.string(), record: z.number().int().nonnegative(), line: z.number().int().positive(),
    field: z.number().int().positive().optional(), expected: z.number().int().positive().optional(), actual: z.number().int().positive().optional() }).strict()).max(200),
  error: z.object({ code: z.string() }).strict().nullable()
}).strict();
