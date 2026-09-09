import type { CheckOverlapResult, FindConflictsResult, ListEventsResult } from "./schemas.js";

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function formatListEventsResult(result: ListEventsResult): string {
  return `${result.summary_text}\n\n${pretty(result)}`;
}

export function formatFindConflictsResult(result: FindConflictsResult): string {
  return `${result.summary_text}\n\n${pretty(result)}`;
}

export function formatCheckOverlapResult(result: CheckOverlapResult): string {
  return `${result.summary_text}\n\n${pretty(result)}`;
}
