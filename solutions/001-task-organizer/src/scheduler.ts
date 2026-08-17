import { parseTasks } from "./parser.js";
import type { OrganizeInput, OrganizeResult, ParsedTask } from "./types.js";

const URGENCY_RANK: Readonly<Record<ParsedTask["urgency"], number>> = Object.freeze({
  high: 0,
  medium: 1,
  low: 2
});

function clockToMinutes(clock: string): number {
  const [hoursText, minutesText] = clock.split(":");
  if (hoursText === undefined || minutesText === undefined) {
    throw new Error("start_time must use HH:MM");
  }
  return Number.parseInt(hoursText, 10) * 60 + Number.parseInt(minutesText, 10);
}

function formatClock(totalMinutes: number): string {
  const withinDay = totalMinutes % 1440;
  const hours = Math.floor(withinDay / 60);
  const minutes = withinDay % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function rankTasks(tasks: readonly ParsedTask[]): ParsedTask[] {
  return [...tasks].sort((left, right) => {
    const bucketDelta = URGENCY_RANK[left.urgency] - URGENCY_RANK[right.urgency];
    if (bucketDelta !== 0) {
      return bucketDelta;
    }
    const scoreDelta = right.urgency_score - left.urgency_score;
    if (scoreDelta !== 0) {
      return scoreDelta;
    }
    const durationDelta = left.estimated_minutes - right.estimated_minutes;
    if (durationDelta !== 0) {
      return durationDelta;
    }
    return left.original_index - right.original_index;
  });
}

export function organizeTasks(input: OrganizeInput): OrganizeResult {
  const parsed = parseTasks(input.raw_text, input.language_hint);
  const ranked = rankTasks(parsed.tasks);
  const schedule: OrganizeResult["schedule"] = [];
  const unscheduled: OrganizeResult["unscheduled"] = [];
  const startMinutes = clockToMinutes(input.start_time);
  let used = 0;

  for (const task of ranked) {
    if (task.estimated_minutes <= input.available_minutes - used) {
      const startOffset = used;
      const endOffset = used + task.estimated_minutes;
      const absoluteStart = startMinutes + startOffset;
      const absoluteEnd = startMinutes + endOffset;
      schedule.push({
        ...task,
        position: schedule.length + 1,
        start_offset_min: startOffset,
        end_offset_min: endOffset,
        start_time: formatClock(absoluteStart),
        end_time: formatClock(absoluteEnd),
        start_day_offset: Math.floor(absoluteStart / 1440),
        end_day_offset: Math.floor(absoluteEnd / 1440)
      });
      used = endOffset;
    } else {
      unscheduled.push({ ...task, reason: "insufficient_minutes" });
    }
  }

  return {
    language: parsed.language,
    schedule,
    unscheduled,
    total_tasks: parsed.tasks.length,
    total_minutes_available: input.available_minutes,
    total_minutes_used: used,
    total_minutes_remaining: input.available_minutes - used,
    warnings: parsed.warnings
  };
}
