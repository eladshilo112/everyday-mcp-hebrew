<div dir="rtl">

# משווה רשימות מקומי

משווים שתי רשימות טקסט ומקבלים פריטים שנמצאים רק בכל צד, פריטים משותפים וכפילויות. כל מופע שהוחזר כולל את הטקסט המקורי, הצד ומספר השורה שלו. מתאים לרשימות קניות, ציוד או שמות לדוגמה.

השרת פועל מקומית דרך MCP stdio. הכלי מקבל טקסט בגוף הבקשה בלבד. הוא אינו קורא או כותב קובצי משתמש, פונה לרשת, מפעיל פקודות, שומר מידע, אוסף טלמטריה או ניגש לחשבונות. stdout שמור להודעות MCP בלבד. תוכן הרשימות אינו נרשם ביומן. תוכנת הלקוח שקוראת לכלי מנהלת את מדיניות הפרטיות שלה בנפרד.

## הפעלה מקומית

דרוש Node.js בגרסה 20 ומעלה. מתוך תיקיית הפתרון, לאחר שהתלויות זמינות מקומית:

<div dir="ltr">

```sh
npm run check
npm run build
npm test
node dist/src/server.js
```

</div>

בהכנה ראשונה אפשר להפעיל `npm install --ignore-scripts` להתקנת התלויות המוצמדות ב־package.json. ההתקנה עשויה לדרוש גישה למאגר החבילות. פעולת השרת לאחר ההכנה אינה משתמשת ברשת. package-lock.json אינו כלול בפתרון; המאמת הקבוע של המאגר יוצר אותו ללא סקריפטי מחזור חיים. בסביבה שאוסרת התקנות יש להשתמש בתלויות שהוכנו מראש או לדווח שהרצת הבדיקות חסומה.

## חיבור לקוח MCP

מזינים את ההגדרה הבאה בקובץ תצורת MCP של הלקוח, בהתאם למבנה שהוא תומך בו. מחליפים את הנתיב הסינתטי בנתיב מוחלט להתקנה המקומית. ב־Windows אפשר לכתוב נתיבים עם `/`. אם Node אינו ב־PATH, משתמשים בנתיב המלא שלו ב־command. השרת ימתין לבקשות דרך stdin, ללא מסך אינטראקטיבי.

<div dir="ltr">

```json
{
  "mcpServers": {
    "list-difference-checker": {
      "command": "node",
      "args": ["C:/local-mcp/008-list-difference-checker/dist/src/server.js"]
    }
  }
}
```

</div>

הכלי היחיד הוא `compare_lists`. אין צורך בתיקיית עבודה, במפתח API או בחשבון. יש להפעיל את הקובץ הבנוי ישירות, כדי שפלט של מנהל חבילות לא יתערב בפרוטוקול.

## חוזה הקלט

`left` ו־`right` הם שדות טקסט חובה. `options` הוא אובייקט רשות עם שלושה שדות בוליאניים, שכולם כבויים כברירת מחדל. שדות נוספים וסוגי נתונים אחרים נדחים.

כל שורה שאינה ריקה היא פריט אחד. נתמכים LF ו־CRLF, גם באותו קלט. תווי סוף השורה אינם חלק מהטקסט המקורי. CR שאינו חלק מ־CRLF נשאר בטקסט; מפרידי Unicode אחרים אינם שוברים שורה. קלט ריק מכיל אפס שורות. סוף שורה אחרון מסיים את השורה הקיימת ואינו מוסיף שורת רפאים: `a\n` הוא שורה אחת, `\n` הוא שורה ריקה אחת, ו־`a\n\n` הוא שתי שורות.

ברירת המחדל משווה בדיוק את הטקסט. רישיות, רווחים חיצוניים ורצפי Unicode שקולים נשארים שונים. רק שורות באורך אפס נזנחות. שורה עם רווחים בלבד היא פריט תקין. פסיקים, תבליטים, מספרים ונוסחאות נשארים טקסט רגיל: `a,b`, `- apple`, `1. apple` ו־`=1+1` אינם מפוענחים. גם נתיב קובץ, כתובת אינטרנט או טקסט שנראה כמו פקודה הם פריטים רגילים.

סדר העיבוד קבוע:

1. `trim: true` מסיר רווחים חיצוניים לפי `String.trim()` של ECMAScript, כולל טאב ו־NBSP. רווחים פנימיים נשארים. רווח ברוחב אפס U+200B אינו מוסר.
2. `ascii_case_fold: true` ממפה רק A עד Z ל־a עד z, ללא תלות בשפה או באזור. אותיות אחרות אינן משנות רישיות.
3. `nfc: true` מפעיל נרמול Unicode מסוג NFC. אין NFKC או הסרת סימנים.
4. פריט שהמפתח שלו ריק לאחר השלבים האלה נזנח.

הסדר מכוון: `E\u0301` הופך ל־`é` כאשר קיפול ASCII ו־NFC פעילים יחד. האות המוכנה מראש `É` נשארת `É`, כי אינה אות ASCII. מפתחות מנורמלים משמשים להתאמה בלבד; הטקסט המקורי נשמר בכל מופע.

## דוגמה סינתטית

<div dir="ltr">

```json
{
  "left": " תפוח \nאגס\nאגס",
  "right": "תפוח\nבננה",
  "options": { "trim": true }
}
```

</div>

`shared` יכיל את תפוח, עם הטקסט ` תפוח ` משורה 1 בצד שמאל ו־`תפוח` משורה 1 בצד ימין. `left_only` יכיל את אגס פעם אחת כחבר ברשימה, עם שני מופעיו בשורות 2 ו־3. `right_only` יכיל את בננה משורה 2. `duplicates_left` יכיל את אגס עם שני מופעים. המונה הכולל לדיווח יהיה 7, כי שני מופעי אגס מופיעים גם בקבוצת החברות וגם בדוח הכפילויות.

## קריאת התוצאה והגבולות

תוצאה תקינה כוללת `ok: true`, את האפשרויות בפועל, ספירות קלט ושתי צורות זהות של אותו מידע: `structuredContent` של MCP ובלוק טקסט JSON. השוואת החברות מתעלמת מסדר ומכמות חזרות. דיווח הכפילויות שומר את מספר המופעים המלא.

| שדה | משמעות |
|:---|:---|
| `left_only`, `right_only`, `shared` | קבוצות חברות נפרדות לפי המפתח המנורמל |
| `duplicates_left`, `duplicates_right` | מפתחות שהופיעו לפחות פעמיים באותו צד |
| `items[].key` | מפתח ההתאמה, ללא שינוי הטקסט המקורי |
| `items[].occurrences` | מופעים עם `side`, מספר `line` החל מ־1, ו־`text` מקורי |
| `left_count`, `right_count` | מספר המופעים המלא לפריט בקבוצה, כולל מופעים שהושמטו |
| `total_items`, `returned_items`, `omitted_items` | מספר מפתחות מלא, מוחזר ומושמט בקבוצה; פריט חלקי נחשב מוחזר |
| `total_occurrences`, `returned_occurrences`, `omitted_occurrences` | ספירות מופעים מלאות בכל קבוצה ובכל פריט שהוחזר |
| `truncated` | אמת כאשר הושמט לפחות מופע אחד ברמה המתאימה |
| `inputs` | בתים, שורות, שורות שנזנחו, מופעים שנקלטו, פריטים נפרדים וקבוצות כפילות לכל צד |
| `duplicate_occurrences` | כל המופעים בקבוצות כפילות, כולל הראשון |
| `extra_occurrences` | מספר המופעים שמעבר לראשון בכל מפתח |
| `reporting` | תקציב ומספר רשומות המופעים המלא, המוחזר והמושמט בכל קבוצות הדיווח יחד |

בכל קלט מותרות עד **262,144 בתים ב־UTF-8, שהם 256 KiB**, ועד **10,000 שורות פיזיות**, כולל שורות ריקות. שני הקלטים נבדקים לפני פיצול לפריטים, נרמול או בניית המפות. המגבלות נמדדות על הטקסט המקורי, לפני הסרת רווחים. בדיקת בתים קודמת לבדיקת שורות, והצד השמאלי נבדק לפני הימני. חריגה נדחית במלואה עם `ok: false`, `isError: true`, שם הצד, הקוד, המגבלה והכמות בפועל. קודי הגבולות הם `INPUT_TOO_LARGE` ו־`TOO_MANY_LINES`. שגיאות מבנה קלט מטופלות כשגיאת MCP; הפונקציה המקומית מחזירה `INVALID_ARGUMENTS`.

מותרות עד **500 רשומות מופעים בכל קבוצות התוצאה יחד**, כולל מופעים שמדווחים שוב בקבוצת כפילויות. שתי צורות ההצגה ב־MCP הן אותו פלט לוגי. התקציב מוקצה בסדר `left_only`, אחריו `right_only`, אחריו `shared`, אחריו `duplicates_left` ולבסוף `duplicates_right`.

בכל קבוצה נשמר סדר ההופעה הראשונה בצד המתאים. סדר הפריטים המשותפים נקבע לפי שמאל. בתוך פריט משותף מופעי שמאל קודמים למופעי ימין; בכל צד נשמר סדר השורות. אין מיון אלפביתי. עם מיצוי התקציב, פריט יכול להיות חלקי ופריטים מאוחרים יותר יושמטו בשלמותם. כל הספירות נשארות מדויקות. לדוגמה, 300 שורות `x` בכל צד ייצרו 1,200 רשומות דיווח אפשריות, מהן יוחזרו 500 ויושמטו 700. קבוצות הכפילויות עדיין ידווחו 300 מופעים כל אחת גם כאשר מערך הפריטים שלהן ריק.

תוצאות מוגבלות אינן מעידות שמפתח שלא הוחזר חסר. בודקים את מוני ההשמטה, או משווים רשימות קצרות יותר כדי לבדוק כל מופע. חלוקה עצמאית לחלקים עלולה להחמיץ התאמות וכפילויות בין חלקים.

## בדיקות

חמישה קובצי בדיקות מכסים חברות, כפילויות, נרמול, עברית ואימוג'י, מגבלות מדויקות, דטרמיניזם ונתונים שנשארים טקסט בלבד. בדיקות האינטגרציה מפעילות תהליך שרת אמיתי, פעם עם לקוח MCP ופעם באמצעות הודעות JSON-RPC גולמיות, ובודקות אתחול, גילוי, קריאות תקינות ושגויות וניקיון stdout. תהליך הבדיקה חוסם נתיבי רשת, כתיבת קבצים והפעלת תהליכים בלתי צפויים. עשר ההערכות ב־evaluations.xml הן סינתטיות וקבועות, ונבדקות אוטומטית כחלק מהבדיקות.

לא צורף Skill, בהתאם לתוכנית. כל פרטי ההפעלה ודוגמאות הנתיבים במסמך הם מקומיים וסינתטיים.

</div>

<div dir="ltr">

# Local List Difference Checker

A deterministic TypeScript MCP stdio server for two inline text lists. Its single tool, `compare_lists`, returns left-only, right-only and shared membership plus duplicates within each side, preserving the original text and one-based line of every returned occurrence.

## Local setup and client configuration

Requires Node.js >=20 and the exact dependencies in package.json. Initial setup may use `npm install --ignore-scripts`, which can require registry access. No lockfile is supplied; the repository's fixed validator generates it without lifecycle scripts. In an offline environment, use already provisioned dependencies. Then run `npm run check`, `npm run build` and `npm test`. Start with `node dist/src/server.js`.

Use the MCP client JSON configuration above, replacing its synthetic absolute path with your local built server path. Run Node directly to avoid package-manager chatter on stdout. The server waits for MCP messages on stdin; it has no interactive prompt. No working-directory argument, account, API key or file upload is needed.

## Input and normalization

Required strings: `left`, `right`. Optional object: `options`, containing only boolean `trim`, `ascii_case_fold` and `nfc`, all defaulting to false. Extra fields and nonboolean options are rejected.

Each nonempty LF or CRLF line is one item. Mixed line endings are supported. Line terminators are excluded from original text. A bare CR or Unicode line separator is ordinary text. Empty input has zero lines. A terminal newline terminates the last line without adding a phantom line: `a\n` has one physical line, `\n` has one empty line and `a\n\n` has two lines. Empty lines still affect numbering and the input line limit.

Defaults perform exact, case-sensitive comparison, without trimming or Unicode normalization. Whitespace-only lines remain items. Commas, Markdown bullets, numbers, formulas, paths, URLs and shell-looking text are inert whole-line strings. Safe `Map` keys include `__proto__` and `constructor`.

Options always run in this order:

1. **trim:** ECMAScript `String.trim()` removes outer whitespace, including tabs and NBSP, but preserves inner spaces and U+200B.
2. **ascii_case_fold:** Map only ASCII A-Z to a-z, independent of locale. No other characters change case.
3. **nfc:** Apply Unicode NFC, without NFKC or accent removal.
4. Discard items whose matching key is empty after those steps.

For example, `" apple "` matches `"apple"` only with trimming; `"APPLE"` matches `"apple"` with ASCII folding; `"e\u0301"` matches `"é"` with NFC. With ASCII folding then NFC, `"E\u0301"` becomes `"é"`, while precomposed `"É"` remains uppercase. Only matching keys are normalized. Occurrence text is always original.

## Results, ordering and limits

Membership ignores order and multiplicity; duplicates retain occurrence counts. `left_only`, `right_only`, `shared`, `duplicates_left` and `duplicates_right` each contain `items` plus exact total, returned and omitted item/occurrence counts and a `truncated` flag. Each item contains `key`, `left_count`, `right_count`, its total/returned/omitted occurrence counts, a `truncated` flag and `occurrences` with `{side, line, text}`. A partly returned item counts as returned, not omitted.

`inputs.left` and `inputs.right` contain `utf8_bytes`, physical `lines`, `ignored_lines`, retained occurrence count `items`, `distinct_items`, `duplicate_groups`, `duplicate_occurrences` (including the first occurrence in every repeated group), and `extra_occurrences` (all occurrences beyond the first per distinct key).

Both raw inputs must pass **262144 UTF-8 bytes (256 KiB) and 10000 physical lines each** before splitting, normalization or indexing. Blank lines count; trimming cannot bypass the byte limit. Left is checked before right, and bytes before lines. Limit errors reject the request without partial comparison and return `ok: false`, MCP `isError: true`, and an `error` containing `code`, `input`, `message`, `limit` and `actual`. Codes are `INPUT_TOO_LARGE` and `TOO_MANY_LINES`. Invalid argument shapes receive an MCP error; the pure function uses `INVALID_ARGUMENTS`.

The **500 returned occurrence record budget** applies to all five groups together, allocating in this fixed order: left-only, right-only, shared, left duplicates, right duplicates. A reference repeated in a duplicate group consumes another record. Keys are ordered by first occurrence within the relevant side; shared keys follow left order. Occurrences follow original line order, with all left references before right references in shared entries. No locale sorting is used.

At the boundary an entry can be partial, and later keys or entire groups may be omitted. Group totals remain exact even when no keys fit. `reporting` contains `occurrence_budget`, `total_occurrence_records`, `returned_occurrence_records`, `omitted_occurrence_records` and `truncated`. For 300 `x` lines on each side, totals are 1200 possible records, 500 returned and 700 omitted, with both duplicate groups still reporting 300 total occurrences. A missing returned key in a truncated result is not evidence of absence. Naive independent chunking can miss cross-chunk matches and duplicates.

Successful MCP results expose the same logical JSON in `structuredContent` and a text content block. The budget applies to the logical result's occurrence arrays. Repeated identical calls produce identical results, with no timestamps, randomness or retained state.

## Privacy and verification

The tool performs no application filesystem reads or writes, network requests, telemetry, persistent storage, command execution or account access. Normal runtime module loading reads the installed application code. Tool inputs are never treated as executable instructions or filenames. stdout is reserved for MCP protocol messages and input content is never logged. The caller's own data-handling policy is separate.

Five test files include real SDK-client and raw JSON-RPC stdio subprocess tests, invalid argument recovery, output schema validation, protocol-only stdout, and guarded execution that blocks network requests, filesystem mutations and unexpected subprocesses. Ten stable synthetic XML evaluations are exercised by the test suite. Test-only code reads that checked-in fixture. No optional skill is included (`include_skill: false`).

</div>
