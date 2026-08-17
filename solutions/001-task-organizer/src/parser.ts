import type {
  DurationSource,
  Language,
  LanguageHint,
  ParseResult,
  ParsedTask,
  Warning
} from "./types.js";

export const DEFAULT_DURATION_MINUTES = 15;
export const MAX_DURATION_MINUTES = 1440;

export const URGENCY_WEIGHTS = Object.freeze({
  baseline: 10,
  urgent: 40,
  today: 25,
  tomorrow: 10,
  date: 30,
  time: 20,
  p1: 35,
  p2: 20,
  double_exclamation: 20,
  exclamation: 10
});

interface DurationMatch {
  minutes: number;
  source: DurationSource;
}

interface ScoredUrgency {
  score: number;
  signals: string[];
}

const FIXED_DURATIONS: ReadonlyArray<readonly [RegExp, number]> = [
  [/שעה\s*וחצי/iu, 90],
  [/שלושת\s*רבעי\s*שעה/iu, 45],
  [/שעתיים/iu, 120],
  [/חצי\s*שעה/iu, 30],
  [/רבע\s*שעה/iu, 15],
  [/שעה/iu, 60],
  [/\b(?:an?\s+)?hour\s+and\s+a\s+half\b/iu, 90],
  [/\bhalf\s+(?:an?\s+)?hour\b/iu, 30],
  [/\bquarter\s+(?:of\s+an?\s+)?hour\b/iu, 15],
  [/\b(?:an?\s+)?hour\b/iu, 60]
];

const HOURS_PATTERN = /(\d{1,3}(?:[.,]\d+)?)\s*(?:שעות|שעה|hours?|hrs?|hr|h)(?=$|[\s,.;!?)}\]])/iu;
const MINUTES_PATTERN = /(\d{1,4})\s*(?:דקות|דקה|דק['׳]?|minutes?|mins?|min)(?=$|[\s,.;!?)}\]])/iu;

export function detectLanguage(text: string, hint: LanguageHint = "auto"): Language {
  if (hint !== "auto") {
    return hint;
  }

  const hebrewCount = (text.match(/[\u0590-\u05ff]/gu) ?? []).length;
  const latinCount = (text.match(/[A-Za-z]/gu) ?? []).length;
  return hebrewCount > latinCount ? "he" : "en";
}

export function urgencyFromScore(score: number): "high" | "medium" | "low" {
  if (score >= 60) {
    return "high";
  }
  if (score >= 30) {
    return "medium";
  }
  return "low";
}

function warningMessage(code: Warning["code"], language: Language): string {
  const messages: Record<Language, Record<Warning["code"], string>> = {
    he: {
      empty_input: "לא נמצאו משימות בטקסט.",
      duration_defaulted: `לא צוין משך, לכן הוגדרו ${DEFAULT_DURATION_MINUTES} דקות.`,
      duration_capped: `המשך שנכתב חרג מהמגבלה והוגבל ל־${MAX_DURATION_MINUTES} דקות.`
    },
    en: {
      empty_input: "No tasks were found in the text.",
      duration_defaulted: `No duration was found, so ${DEFAULT_DURATION_MINUTES} minutes were used.`,
      duration_capped: `The written duration exceeded the limit and was capped at ${MAX_DURATION_MINUTES} minutes.`
    }
  };
  return messages[language][code];
}

function splitTasks(rawText: string): string[] {
  const normalized = rawText.normalize("NFC").replace(/\r\n?/gu, "\n");
  return normalized
    .split(/\n|;|[•●▪◦☐☑]/gu)
    .map((part) =>
      part
        .replace(/^\s*(?:(?:[-*✓]+)|(?:\d{1,3}|[א-ת])[.)])\s*/u, "")
        .trim()
    )
    .filter((part) => part.length > 0);
}

function extractDuration(text: string): DurationMatch | null {
  for (const [pattern, minutes] of FIXED_DURATIONS) {
    if (pattern.test(text)) {
      return { minutes, source: "explicit" };
    }
  }

  const hours = text.match(HOURS_PATTERN);
  if (hours?.[1] !== undefined) {
    const value = Number.parseFloat(hours[1].replace(",", "."));
    if (Number.isFinite(value) && value > 0) {
      const minutes = Math.round(value * 60);
      return minutes > MAX_DURATION_MINUTES
        ? { minutes: MAX_DURATION_MINUTES, source: "capped" }
        : { minutes, source: "explicit" };
    }
  }

  const minutesMatch = text.match(MINUTES_PATTERN);
  if (minutesMatch?.[1] !== undefined) {
    const minutes = Number.parseInt(minutesMatch[1], 10);
    if (minutes > 0) {
      return minutes > MAX_DURATION_MINUTES
        ? { minutes: MAX_DURATION_MINUTES, source: "capped" }
        : { minutes, source: "explicit" };
    }
  }

  return null;
}

function scoreUrgency(text: string): ScoredUrgency {
  const lowered = text.toLocaleLowerCase("en-US");
  let score = URGENCY_WEIGHTS.baseline;
  const signals: string[] = [];

  const add = (signal: string, weight: number): void => {
    signals.push(signal);
    score += weight;
  };

  if (/דחוף|בהקדם|\b(?:urgent|asap)\b/iu.test(lowered)) {
    add("urgent", URGENCY_WEIGHTS.urgent);
  }
  if (/היום|\btoday\b/iu.test(lowered)) {
    add("today", URGENCY_WEIGHTS.today);
  }
  if (/מחר|\btomorrow\b/iu.test(lowered)) {
    add("tomorrow", URGENCY_WEIGHTS.tomorrow);
  }
  if (/\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|\d{1,2}\.\d{1,2}\.\d{2,4})\b/u.test(lowered)) {
    add("date", URGENCY_WEIGHTS.date);
  }
  if (/(?:\b(?:by)\b|עד)\s*(?:[01]?\d|2[0-3])(?::[0-5]\d)?|\b(?:[01]\d|2[0-3]):[0-5]\d\b/iu.test(lowered)) {
    add("time", URGENCY_WEIGHTS.time);
  }
  if (/\bp1\b/iu.test(lowered)) {
    add("p1", URGENCY_WEIGHTS.p1);
  } else if (/\bp2\b/iu.test(lowered)) {
    add("p2", URGENCY_WEIGHTS.p2);
  }
  if (/!!/u.test(text)) {
    add("double_exclamation", URGENCY_WEIGHTS.double_exclamation);
  } else if (/!/u.test(text)) {
    add("exclamation", URGENCY_WEIGHTS.exclamation);
  }

  return { score: Math.min(score, 100), signals };
}

export function parseTasks(rawText: string, languageHint: LanguageHint = "auto"): ParseResult {
  const language = detectLanguage(rawText, languageHint);
  const taskTexts = splitTasks(rawText);
  const warnings: Warning[] = [];

  if (taskTexts.length === 0) {
    warnings.push({ code: "empty_input", message: warningMessage("empty_input", language), task_id: null });
    return { language, tasks: [], warnings };
  }

  const tasks: ParsedTask[] = taskTexts.map((text, originalIndex) => {
    const id = `task-${String(originalIndex + 1).padStart(2, "0")}`;
    const duration = extractDuration(text);
    const scored = scoreUrgency(text);
    const durationSource: DurationSource = duration?.source ?? "default";

    if (durationSource === "default") {
      warnings.push({
        code: "duration_defaulted",
        message: warningMessage("duration_defaulted", language),
        task_id: id
      });
    } else if (durationSource === "capped") {
      warnings.push({
        code: "duration_capped",
        message: warningMessage("duration_capped", language),
        task_id: id
      });
    }

    return {
      id,
      text,
      original_index: originalIndex,
      urgency_score: scored.score,
      urgency: urgencyFromScore(scored.score),
      estimated_minutes: duration?.minutes ?? DEFAULT_DURATION_MINUTES,
      duration_source: durationSource,
      source_signals: scored.signals
    };
  });

  return { language, tasks, warnings };
}
