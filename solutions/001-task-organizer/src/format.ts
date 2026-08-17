import type { OrganizeResult, ParseResult } from "./types.js";

function urgencyLabel(language: OrganizeResult["language"], urgency: "high" | "medium" | "low"): string {
  const labels = {
    he: { high: "גבוהה", medium: "בינונית", low: "נמוכה" },
    en: { high: "high", medium: "medium", low: "low" }
  } as const;
  return labels[language][urgency];
}

export function formatParseResult(result: ParseResult): string {
  if (result.tasks.length === 0) {
    return result.language === "he" ? "לא נמצאו משימות." : "No tasks were found.";
  }

  const heading = result.language === "he" ? "# משימות שזוהו" : "# Parsed tasks";
  const lines = result.tasks.map((task) =>
    result.language === "he"
      ? `${task.original_index + 1}. ${task.text} | ${task.estimated_minutes} דקות | דחיפות ${urgencyLabel(result.language, task.urgency)} (${task.urgency_score})`
      : `${task.original_index + 1}. ${task.text} | ${task.estimated_minutes} minutes | ${urgencyLabel(result.language, task.urgency)} urgency (${task.urgency_score})`
  );
  return [heading, "", ...lines].join("\n");
}

export function formatOrganizeResult(result: OrganizeResult): string {
  const he = result.language === "he";
  const lines: string[] = [he ? "# סדר היום שלך" : "# Your day plan", ""];

  if (result.schedule.length === 0) {
    lines.push(he ? "לא שובצה אף משימה בזמן שהוגדר." : "No task fits the available time.");
  } else {
    for (const item of result.schedule) {
      const daySuffix = item.end_day_offset > 0 ? (he ? `, יום +${item.end_day_offset}` : `, day +${item.end_day_offset}`) : "";
      lines.push(
        he
          ? `${item.position}. ${item.start_time} עד ${item.end_time}${daySuffix}, ${item.text} (${item.estimated_minutes} דקות, דחיפות ${urgencyLabel(result.language, item.urgency)})`
          : `${item.position}. ${item.start_time} to ${item.end_time}${daySuffix}, ${item.text} (${item.estimated_minutes} min, ${urgencyLabel(result.language, item.urgency)} urgency)`
      );
    }
  }

  if (result.unscheduled.length > 0) {
    lines.push("", he ? "## לא נכנס בזמן הפנוי" : "## Not scheduled");
    for (const item of result.unscheduled) {
      lines.push(he ? `* ${item.text}, חסרות דקות פנויות.` : `* ${item.text}, not enough free minutes.`);
    }
  }

  lines.push(
    "",
    he
      ? `נוצלו ${result.total_minutes_used} מתוך ${result.total_minutes_available} דקות. נותרו ${result.total_minutes_remaining} דקות.`
      : `Used ${result.total_minutes_used} of ${result.total_minutes_available} minutes. ${result.total_minutes_remaining} minutes remain.`
  );

  if (result.warnings.length > 0) {
    lines.push("", he ? "## הערות" : "## Notes");
    for (const warning of result.warnings) {
      const taskPrefix = warning.task_id === null ? "" : `${warning.task_id}: `;
      lines.push(`* ${taskPrefix}${warning.message}`);
    }
  }

  return lines.join("\n");
}
