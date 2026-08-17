<div dir="rtl">

# תרומה למאגר

המאגר מקבל פתרונות קטנים ושימושיים לבעיה יומיומית ברורה. כל תרומה חייבת להיות מקומית, בטוחה, ניתנת לבדיקה ומתאימה לאדם ממוצע.

## דרישות לפתרון

* בעיה נפוצה והבטחה מדויקת
* תיעוד עברי ראשון בתוך `<div dir="rtl">`
* שרת MCP תקני בתקשורת stdio עם קלט, פלט ותוכן מובנה
* הערות MCP מדויקות לקריאה בלבד, אי הרסנות והיעדר עולם פתוח
* ללא רשת, טלמטריה, סודות, כתיבה, רכישות, מחיקות או פעולות נסתרות
* לפחות ארבעה קובצי בדיקה, כולל אינטגרציית MCP אמיתית
* `evaluations.xml` עם עשרה תרחישים יציבים
* `metadata.json` עם קטגוריה מאושרת ומאפייני בטיחות מדויקים
* Skill אופציונלי תחת `skill/SKILL.md`, רק כאשר הוא משפר שימוש חוזר

## מבנה מחייב

```text
solutions/NNN-slug/
├── README.md
├── metadata.json
├── package.json
├── package-lock.json
├── tsconfig.json
├── evaluations.xml
├── src/
├── tests/
└── skill/SKILL.md        optional
```

גרסאות התלויות חייבות להתאים בדיוק לרשימה בתוך `scripts/validate_solution.py`. אין סקריפטי התקנה, הורדות צד שלישי או פקודות מעטפת נסתרות.

הקטגוריה חייבת להופיע ברשימת ההרשאה של `.automation/content-policy.json`. אין להשתמש בחומר אישי, פרטי, משפחתי, עסקי או בחומרים של לקוחות.

## בדיקה לפני Pull Request

```bash
python scripts/validate_catalog.py
python -m unittest discover -s tests -v
python scripts/validate_solution.py solutions/NNN-slug --install --audit
python scripts/scan_secrets.py solutions/NNN-slug
python scripts/validate_topic_policy.py solutions/NNN-slug --category files
```

החליפו את `files` בקטגוריה המתאימה. Pull Request שלא עובר את כל השערים לא ימוזג.

באוטומציה היומית Claude מתכנן וסוקר, Codex מממש, ו־Graphify מספק הקשר ממוקד. המודלים אינם מורשים לבצע Git או GitHub. שחזור מתבצע באמצעות `git revert`, ללא force push ל־`main`.

</div>
