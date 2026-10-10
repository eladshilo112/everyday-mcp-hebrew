import { z } from "zod";

export const listInput = z.object({ directory: z.string().min(1).max(4096).default("."), recursive: z.boolean().default(false) }).strict();
export const scanInput = z.object({ paths: z.array(z.string().min(1).max(4096)).min(1).max(200).optional(), directory: z.string().min(1).max(4096).optional(), recursive: z.boolean().default(false) }).strict();
const error = z.object({ path: z.string(), code: z.string() }).strict();
const finding = z.object({ file: z.string(), line: z.number().int().positive(), code: z.enum(["SKIPPED_LEVEL", "MISSING_H1", "MULTIPLE_H1", "EMPTY_HEADING", "DUPLICATE_HEADING"]), level: z.number().int().min(1).max(6).nullable(), related_lines: z.array(z.number().int().positive()).max(200), text: z.string().max(160).optional() }).strict();
export const listResult = z.object({ ok: z.boolean(), files: z.array(z.string()).max(200), truncated: z.boolean(), errors: z.array(error).max(200) }).strict();
export const scanResult = z.object({ ok: z.boolean(), files_scanned: z.number().int().nonnegative(), files: z.array(z.object({ file: z.string(), h1_count: z.number().int().nonnegative(), h1_lines: z.array(z.number().int().positive()).max(200), finding_count: z.number().int().nonnegative() }).strict()).max(200), findings: z.array(finding).max(200), truncated: z.boolean(), skipped: z.array(error).max(200), errors: z.array(error).max(200) }).strict();
