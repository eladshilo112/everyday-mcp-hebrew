import type {
  CleanupProposal,
  DuplicateGroup,
  FindDuplicatesResult,
  SuggestCleanupResult,
  ToolError
} from "./schemas.js";
import { getScanSession, hasAnyScanSession } from "./scanner.js";

const NOTICE_HE = "זוהי הצעה ידנית בלבד. הכלי לא מחק, לא העביר ולא שינה שום קובץ.";
const NOTICE_EN = "Manual proposal only. The tool did not delete, move, or modify any file.";

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function missingScanError(scanId?: string): ToolError {
  if (scanId === undefined && !hasAnyScanSession()) {
    return {
      code: "no_scan",
      message: "No successful scan is available. Call scan_directory first.",
      path: null
    };
  }
  return {
    code: "scan_not_found",
    message: "The requested scan identifier is not available in this server process.",
    path: null
  };
}

export function findDuplicates(scanId?: string): FindDuplicatesResult {
  const session = getScanSession(scanId);
  if (session === undefined) {
    return {
      ok: false,
      error: missingScanError(scanId),
      scan_id: null,
      duplicate_groups: [],
      total_groups: 0,
      total_duplicate_files: 0,
      potential_savings_bytes: 0
    };
  }

  const byHash = new Map<string, typeof session.files>();
  for (const file of session.files) {
    const bucket = byHash.get(file.sha256);
    if (bucket === undefined) {
      byHash.set(file.sha256, [file]);
    } else {
      bucket.push(file);
    }
  }

  const duplicateGroups: DuplicateGroup[] = [];
  for (const [sha256, files] of byHash) {
    if (files.length < 2) {
      continue;
    }
    const paths = files.map((file) => file.path).sort(compareText);
    const sizeBytes = files[0]?.size_bytes ?? 0;
    duplicateGroups.push({
      sha256,
      size_bytes: sizeBytes,
      paths,
      potential_savings_bytes: sizeBytes * (paths.length - 1)
    });
  }
  duplicateGroups.sort((left, right) => {
    const firstPathOrder = compareText(left.paths[0] ?? "", right.paths[0] ?? "");
    return firstPathOrder !== 0 ? firstPathOrder : compareText(left.sha256, right.sha256);
  });

  return {
    ok: true,
    error: null,
    scan_id: session.scanId,
    duplicate_groups: duplicateGroups,
    total_groups: duplicateGroups.length,
    total_duplicate_files: duplicateGroups.reduce((sum, group) => sum + group.paths.length, 0),
    potential_savings_bytes: duplicateGroups.reduce(
      (sum, group) => sum + group.potential_savings_bytes,
      0
    )
  };
}

export function suggestCleanup(scanId?: string): SuggestCleanupResult {
  const duplicates = findDuplicates(scanId);
  if (!duplicates.ok) {
    return {
      ok: false,
      error: duplicates.error,
      scan_id: null,
      proposals: [],
      total_candidates: 0,
      potential_savings_bytes: 0,
      notice_he: NOTICE_HE,
      notice_en: NOTICE_EN
    };
  }

  const proposals: CleanupProposal[] = duplicates.duplicate_groups.map((group) => ({
    sha256: group.sha256,
    size_bytes: group.size_bytes,
    keep_path: group.paths[0] ?? "",
    removal_candidates: group.paths.slice(1),
    potential_savings_bytes: group.potential_savings_bytes
  }));
  return {
    ok: true,
    error: null,
    scan_id: duplicates.scan_id,
    proposals,
    total_candidates: proposals.reduce(
      (sum, proposal) => sum + proposal.removal_candidates.length,
      0
    ),
    potential_savings_bytes: proposals.reduce(
      (sum, proposal) => sum + proposal.potential_savings_bytes,
      0
    ),
    notice_he: NOTICE_HE,
    notice_en: NOTICE_EN
  };
}
