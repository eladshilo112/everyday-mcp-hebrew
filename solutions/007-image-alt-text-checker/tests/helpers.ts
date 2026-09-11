import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
// All test artifacts stay inside this solution, including subprocess fixtures.
const solution = fileURLToPath(new URL("../../", import.meta.url));
export async function fixture(files: Record<string, string | Buffer> = {}): Promise<{ directory: string; cleanup: () => Promise<void> }> {
  const directory = await mkdtemp(path.join(solution, ".alt-test-"));
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(directory, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  return { directory, cleanup: async () => {
    const rel = path.relative(solution, directory);
    if (path.isAbsolute(rel) || rel.startsWith("..") || !path.basename(directory).startsWith(".alt-test-")) throw new Error("Unsafe cleanup target");
    await rm(directory, { recursive: true, force: true });
  } };
}
