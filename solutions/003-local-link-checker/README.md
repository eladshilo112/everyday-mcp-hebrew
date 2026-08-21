<div dir="rtl">

# 003, בודק קישורים מקומיים

בודק קישורים יחסיים במסמכי Markdown לפני שיתוף או פרסום. השרת פועל מקומית באמצעות stdio, קורא בלבד את התיקייה שאושרה בעת ההפעלה, ואינו פונה לרשת גם כאשר המסמך מכיל קישור חיצוני.

## שורה תחתונה

מקבלים דוח מסודר של קבצים חסרים, עוגנים חסרים, יעדים לא תקינים וקישורים שמנסים לצאת מתיקיית הבסיס. התוצאות ממוינות תמיד לפי קובץ מקור, מספר שורה ויעד.

## שני הכלים

### `scan_markdown_links`

סורק תיקייה ותיקיות משנה. נבדקים קובצי `.md` ו־`.markdown` בלבד.

קלט:

```json
{
  "path": "docs"
}
```

### `check_markdown_file`

בודק קובץ Markdown יחיד.

קלט:

```json
{
  "path": "docs/README.md"
}
```

שני הכלים מחזירים גם טקסט קריא וגם `structuredContent` מלא.

## מה נבדק

* קישורים יחסיים לקבצים ולתיקיות.
* קישורים לעוגנים באותו קובץ או בקובץ Markdown אחר.
* שמות קבצים עם רווחים באמצעות קידוד אחוזים, למשל `Quarterly%20Notes.md`.
* קישורים מקוננים וקישורי reference של Markdown.
* קישורי `http`,‏ `https`,‏ `mailto` וכל פרוטוקול חיצוני אחר נספרים כקישורים שדולגו. הם אינם נפתחים ואינם נשלחים לרשת.

## התקנה ובנייה

נדרש Node.js בגרסה 20 ומעלה.

```bash
npm install --ignore-scripts
npm run check
npm run build
npm test
```

החבילה משתמשת רק בגרסאות התלויות המקובעות ב־`package.json`. אין סקריפטים בזמן התקנה ואין `package-lock.json` במקור.

## הפעלה

חובה לאשר תיקיית בסיס מפורשת בעת ההפעלה:

```bash
npm start -- --base-dir "C:\Users\me\Documents\notes"
```

נתיב יחסי בכל קריאת כלי נפתר מתוך תיקיית הבסיס הזאת. נתיב ישיר או קישור סמלי שנפתר מחוץ לבסיס נדחה.

## חיבור ל־Claude Code

לאחר `npm run build`:

```bash
claude mcp add local-link-checker -- node "C:\path\to\003-local-link-checker\dist\src\server.js" --base-dir "C:\Users\me\Documents\notes"
```

## חיבור ל־Codex או ללקוח MCP אחר

הגדירו שרת stdio עם הפקודה `node` ועם הארגומנטים הבאים:

```json
{
  "command": "node",
  "args": [
    "C:\\path\\to\\003-local-link-checker\\dist\\src\\server.js",
    "--base-dir",
    "C:\\Users\\me\\Documents\\notes"
  ]
}
```

## דוגמת פלט מובנה

```json
{
  "ok": true,
  "error": null,
  "base_path": "C:\\Users\\me\\Documents\\notes",
  "requested_path": "docs",
  "files_scanned": 3,
  "links_checked": 7,
  "external_links_skipped": 1,
  "findings": [
    {
      "source": "docs/index.md",
      "line": 12,
      "target": "missing.md",
      "issue": "missing_target",
      "suggestion": "בדקו את הנתיב היחסי או עדכנו את שם היעד."
    }
  ],
  "read_errors": []
}
```

קודי הממצאים הם `missing_target`,‏ `missing_anchor`,‏ `unauthorized_target` ו־`invalid_target`. שגיאות של נתיב הכלי מוחזרות באובייקט `error` מובנה, למשל `missing_path`,‏ `not_found` או `outside_base`.

## פרטיות ובטיחות

* אין חשבון, מפתח API, טלמטריה או פעילות רשת.
* אין כתיבה, תיקון אוטומטי, שינוי שם, מחיקה או הזזה של קבצים.
* הסריקה אינה עוקבת אחרי קישורים סמליים בתיקיות.
* הצעות התיקון הן מידע בלבד. המשתמש מחליט אם לשנות קישור.
* שגיאת קריאה בקובץ אחד מדווחת ואינה עוצרת את שאר הסריקה.

## מגבלות ידועות

המחלץ מתמקד בקישורי Markdown רגילים ובקישורי reference. קישורים שנוצרים בזמן ריצה, תחביר של תוספים ייחודיים או עוגנים שמיוצרים באמצעות מנוע אתר פרטי עשויים לדרוש בדיקה ידנית.

## פקודות שימושיות

```bash
npm run check
npm run build
npm test
npm start -- --base-dir "C:\path\to\approved-folder"
```

</div>

## English quick start

Build with `npm run build`, then start the stdio server with `npm start -- --base-dir <approved-directory>`. Call `scan_markdown_links` for a directory or `check_markdown_file` for one Markdown file. The server is deterministic, offline, read-only, and refuses paths that resolve outside the approved base directory.
