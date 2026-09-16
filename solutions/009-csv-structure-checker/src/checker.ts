import { readLocal, FileError } from "./files.js";
import { parseCsv } from "./parser.js";
import { inputSchema } from "./schemas.js";
import { failure, type Result } from "./types.js";

export async function checkCsv(root: string, input: unknown): Promise<Result> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return failure("INVALID_INPUT");
  try { return parseCsv(await readLocal(root, parsed.data.path), parsed.data); }
  catch (error) {
    const code = error instanceof FileError ? error.code : "READ_ERROR";
    return failure(code, code === "FILE_BYTES_LIMIT" ? "resource_limit" : "error");
  }
}
