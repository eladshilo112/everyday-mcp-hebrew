<div dir="rtl">

# אוטומציה מקומית בשעה 09:00

האוטומציה משתמשת בכניסות המקומיות של Claude Code, Codex ו־GitHub CLI. אין צורך במפתח API של מודל ואין לשמור מפתח כזה במאגר.

Claude נשאר המתכנן והבודק הראשי. רק שתי חסימות זמינות מפורשות רשאיות להפעיל את ה־fallback: תקרת ההוצאה החודשית או טוקן OAuth מקומי שפג. ה־fallback משתמש בשני סשנים נפרדים וזמניים של Codex במצב קריאה בלבד, אחד לתכנון ואחד לביקורת. היישום נשאר בסשן Codex שלישי ונפרד עם הרשאת כתיבה רק לשכפול הזמני. הדוח מתעד את `planner_backend`, את `reviewer_backend`, את `degraded_model_independence` ואת סיבת המעבר המדויקת. בדיקות Graphify, האימות הדטרמיניסטי, סריקת הסודות, הגנת הענף, CI ו־rollback נשארים חובה. כל כשל אחר של Claude נסגר בבטחה. חיבור מחדש של Claude מחזיר אותו אוטומטית לברירת המחדל.

גם חוזה הביקורת הסופית נסגר בבטחה אם מתקבלת תשובה שאינה עקבית. `approve` תקף רק כאשר `policy_ok=true`, `tests_ok=true` ואין ממצאים מהותיים. אם המבקר מחזיר `approve` יחד עם ממצאים מהותיים, הרץ רשאי לבצע ניסיון יחיד ומוגדר של סיווג מחדש, ללא כלים. הניסיון יכול להעביר הערות שאינן חוסמות אל התקציר או לדחות עם ממצאים חוסמים. הוא אינו רשאי להוסיף ממצאים, לבצע ביקורת חדשה, להיכנס ללולאה או לעקוף את השער הקיים. הדוח שומר את ההחלטה הראשונית, ההחלטה הסופית וסיבת ההכרעה המדויקת.

## דרישות

* Windows עם WSL והפצת Ubuntu
* Claude Code מחובר במנוי מקומי
* Codex CLI מחובר באמצעות ChatGPT
* `gh` מחובר בתוך WSL
* Graphify מותקן תחת `%USERPROFILE%\.local\bin\graphify.exe`
* המחשב פועל או חוזר לפעולה לאחר השעה 09:00

## בדיקת קדם

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.automation\local-daily.ps1 -PreflightOnly
```

הבדיקה קוראת את מצב ההתחברות ומאמתת גישה למאגר. היא אינה מפעילה מודלים ואינה משנה את GitHub.

## בדיקות רגרסיה מקומיות

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.automation\test-local-daily.ps1
```

הבדיקה מאמתת שקלט עברי נשלח ל־CLI כבתים מדויקים של UTF־8, שתקרת הוצאה ו־OAuth שפג מזוהים במדויק וש־fallback אינו מופעל בכשל אחר או בלי דגל קונפיגורציה מפורש.

## ריצה יבשה מלאה

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.automation\local-daily.ps1 -DryRun
```

הריצה יוצרת פתרון רק בשכפול זמני, מפעילה את כל שכבות Graphify, Claude, Codex והבדיקות, אך אינה פותחת ענף או Pull Request.

## התקנת המשימה

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.automation\install-local-task.ps1
```

המשימה `Everyday MCP Hebrew Daily` פועלת בכל יום בשעה 09:00 לפי אזור הזמן של Windows. `StartWhenAvailable` מפעיל השלמה כאשר המחשב היה כבוי. מופע שני אינו מתחיל במקביל.

## דוחות

כל ריצה נשמרת תחת:

```text
%LOCALAPPDATA%\EverydayMcpHebrew\runs\<run-id>
```

`run-report.json` כולל שלבים, מצב סופי, גודל הקשר, אומדן טוקנים מסומן כאומדן וכתובת Pull Request כאשר פורסם. קובצי stderr נשמרים מקומית ואינם מתפרסמים.

## השבתה ושחזור

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.automation\uninstall-local-task.ps1
```

הסרה זו מוחקת רק את משימת התזמון. היא אינה מוחקת פתרונות שכבר פורסמו. בעת כשל, תיקיית הריצה נשמרת לאבחון.

</div>
