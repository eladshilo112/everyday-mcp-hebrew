import type { CheckClarityResult, ListIssuesResult } from "./schemas.js";

function readableResult(summary: string, structured: object): string {
  return `${summary}\n\n${JSON.stringify(structured, null, 2)}`;
}

export function formatCheckClarityResult(result: CheckClarityResult): string {
  return readableResult(result.summary_text, result);
}

export function formatListIssuesResult(result: ListIssuesResult): string {
  return readableResult(result.summary_text, result);
}
