import type {
  FindDuplicatesResult,
  ScanDirectoryResult,
  SuggestCleanupResult
} from "./schemas.js";

export function formatScanResult(result: ScanDirectoryResult): string {
  if (!result.ok) {
    return `הסריקה לא בוצעה: ${result.error?.message ?? "שגיאה לא ידועה"}`;
  }
  return `הסריקה הושלמה. חושבו גיבובים עבור ${result.files.length} קבצים, ודולגו ${result.skipped.length} פריטים.`;
}

export function formatDuplicatesResult(result: FindDuplicatesResult): string {
  if (!result.ok) {
    return `לא ניתן להציג כפילויות: ${result.error?.message ?? "שגיאה לא ידועה"}`;
  }
  return `נמצאו ${result.total_groups} קבוצות כפולות ובהן ${result.total_duplicate_files} קבצים.`;
}

export function formatCleanupResult(result: SuggestCleanupResult): string {
  if (!result.ok) {
    return `לא ניתן להכין הצעת ניקוי: ${result.error?.message ?? "שגיאה לא ידועה"}`;
  }
  return `הוכנה הצעה ידנית עבור ${result.total_candidates} עותקים. ${result.notice_he}`;
}
