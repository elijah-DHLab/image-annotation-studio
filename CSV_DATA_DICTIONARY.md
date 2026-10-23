# מילון נתונים ל־CSV המלא | Canonical CSV data dictionary

`knowledge.csv` הוא טבלה ארוכה בקידוד UTF-8 עם BOM, המתארת תמונת מקור אחת בלבד. כל הכותרות דו־לשוניות, עברית ואנגלית, ומופרדות בסימן `|`. ערך שמתחיל בתו העלול להתפרש כנוסחה בתוכנת גיליון מנוטרל בעת הייצוא. מערכת אוסף חיצונית יכולה לצרף קבצים רבים לפי Project ID, Image ID ו־Material ID.

## סוגי רשומה | Record types

| סוג רשומה | תפקיד |
|---|---|
| `חומר | material` | מזהה החומר והעתק מלא של המטא־דאטה המקורית |
| `תמונה | image` | שם הקובץ, סוג המדיה, ממדים ו־SHA-256 |
| `סימון | annotation` | סימון של מופע חזותי, גאומטריה, מונח, מושג והערה; Annotation ID ו־Visual occurrence ID שונים |
| `קשר | relation` | טענה בין שני מופעים חזותיים עם יחס, ראיה, בסיס וסטטוס; מזהי הסימונים נשמרים לתאימות |
| `הצעת מונח | term proposal` | רשומת תאימות מפרויקט ישן; הממשק אינו יוצר הצעות חדשות |
| `הצעת יחס | predicate proposal` | רשומת תאימות מפרויקט ישן; הממשק אינו יוצר הצעות חדשות |

## קבוצות עמודות | Column groups

| קבוצה | עמודות עיקריות | שימוש |
|---|---|---|
| זיהוי | Record type, Record ID, Project ID, Project revision | זיהוי יציב ומעקב אחר מצב הייצוא |
| חומר | Material ID, Material title, Material metadata JSON | התאמה לטבלת החומרים המקורית |
| תמונה | Image ID, filename, MIME, width, height, SHA-256, registration status, matched Material ID | אימות המקור, חיווי אם הקובץ רשום ושחזור הקואורדינטות |
| גאומטריה ומופע | Visual occurrence ID, Geometry type, normalized JSON, SVG selector, center, bounding box, polygon points | זיהוי הדבר המסוים בתמונה ושחזור הסימון |
| מושג ומונח | Term ID, Concept ID, conceptual role, concept definition, concept status, external URI, label, language, term status | קישור למרשם המושגים והמונחים ותיעוד מצבם בזמן הסימון |
| קשר | Relation ID, subject/object Annotation IDs, subject/object occurrence IDs, predicate | שחזור קשתות הרשת |
| ראיה | Evidence material ID, location, description, basis, status | provenance מחקרי והערכת הטענה |
| תיעוד | Annotator, created, modified, source spreadsheet | אחריות, זמן ומקור |

## כללי שחזור רשת | Network reconstruction rules

1. כל Visual occurrence ID יוצר צומת מופע חזותי. בקובצי CSV ישנים מזהה הסימון הוא מזהה המופע החלופי.
2. כל Term ID ו־Concept ID לא־ריקים יוצרים צמתים נפרדים; מזהים זהים מתאחדים.
3. שורת סימון יוצרת קשתות תשתית מן המופע לתמונה ולמונח, ומן המונח למושג.
4. שורת קשר יוצרת קשת מכוונת מ־Subject occurrence ID אל Object occurrence ID; היא שומרת גם Subject/Object annotation IDs כדי לטעון חבילות פרויקט קיימות. תווית הקשת היא Predicate.
5. Material ID ו־Image ID יוצרים צמתי מקור. קשת תשתית מחברת את התמונה לחומר.
6. טענה שאחד מקצותיה חסר נשארת בטבלה אך יש לסמן אותה כבעיית שלמות בעת ייבוא למערכת אחרת.

הגאומטריה נשמרת ביחס `0..1` לממדי התמונה. SvgSelector מספק ייצוג תואם W3C Web Annotation; שדות המרכז והתיבה התוחמת נוחים לניתוח טבלאי.
