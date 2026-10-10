import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const solution = fileURLToPath(new URL("../../", import.meta.url));
export async function fixture() {
  const root = await mkdtemp(path.join(solution, ".heading-test-"));
  return {
    root,
    async put(name: string, data: string | Uint8Array) {
      const target = path.join(root, name);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, data);
    },
    async close() { await rm(root, { recursive: true, force: true }); }
  };
}
