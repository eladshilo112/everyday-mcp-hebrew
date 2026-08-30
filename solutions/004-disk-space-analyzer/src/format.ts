import type { ListLargestItemsResult, ScanDirectoryResult } from "./schemas.js";

export function formatSummaryResult(result: ScanDirectoryResult): string {
  return `${result.summary_text}\n\n${JSON.stringify(result, null, 2)}`;
}

export function formatLargestItemsResult(result: ListLargestItemsResult): string {
  return `${result.summary_text}\n\n${JSON.stringify(result, null, 2)}`;
}
