import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseCsv } from "../src/parser.js";
import type { Options } from "../src/types.js";

export const defaults: Options = { delimiter: "comma", header: true, max_findings: 200 };
export function parse(text: string, options: Partial<Options> = {}) { return parseCsv(text, { ...defaults, ...options }); }
const solution = fileURLToPath(new URL("../../", import.meta.url));
export async function fixture() {
  const root = await mkdtemp(path.join(solution, ".csv-test-"));
  return {
    root,
    async put(name: string, data: string | Uint8Array) { await writeFile(path.join(root, name), data); },
    async close() { await rm(root, { recursive: true, force: true }); }
  };
}
