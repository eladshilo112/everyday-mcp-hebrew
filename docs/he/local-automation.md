<div dir="rtl">

# אוטומציה מקומית בשעה 09:00

האוטומציה משתמשת בכניסות המקומיות של Claude Code, Codex ו־GitHub CLI. אין צורך במפתח API של מודל ואין לשמור מפתח כזה במאגר.

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
