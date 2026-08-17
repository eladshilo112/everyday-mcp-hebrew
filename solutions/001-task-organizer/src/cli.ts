#!/usr/bin/env node
import { formatOrganizeResult } from "./format.js";
import { organizeInputSchema } from "./schemas.js";
import { organizeTasks } from "./scheduler.js";

function argumentValue(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(
      [
        "Usage:",
        "  everyday-dayplan --text \"task one; task two\" --minutes 90 [--start 09:00] [--lang auto|he|en] [--json]",
        "  printf 'task one\\ntask two' | everyday-dayplan --minutes 90",
        ""
      ].join("\n")
    );
    return;
  }

  const rawText = argumentValue(args, "--text") ?? (process.stdin.isTTY ? "" : await readStdin());
  const minutesText = argumentValue(args, "--minutes");
  const parsed = organizeInputSchema.parse({
    raw_text: rawText,
    available_minutes: minutesText === undefined ? Number.NaN : Number(minutesText),
    start_time: argumentValue(args, "--start") ?? "09:00",
    language_hint: argumentValue(args, "--lang") ?? "auto"
  });
  const result = organizeTasks(parsed);
  process.stdout.write(args.includes("--json") ? `${JSON.stringify(result, null, 2)}\n` : `${formatOrganizeResult(result)}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`dayplan error: ${message}\n`);
  process.exitCode = 1;
});
