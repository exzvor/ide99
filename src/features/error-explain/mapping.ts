/**
 * — Plain-English (EN+RU) explanations for ~100 most common
 * PostgreSQL SQLSTATE codes.
 *
 * Source: https://www.postgresql.org/docs/current/errcodes-appendix.html
 *
 * Each entry covers:
 * - `en` / `ru` — short user-facing explanation (1-3 sentences).
 * - `suggestedFix` (optional) — concrete next step the user can take.
 * - `pattern` (optional) — regex against the error message text, used by
 * [`lookup`] when the SQLSTATE is unavailable (older backend paths,
 * migration generic errors, etc.).
 *
 * Lookup priority: SQLSTATE exact match → SQLSTATE class prefix (first 2
 * chars) → `pattern` regex match → `null`.
 *
 * Curated list — covers >90% of real-world PG application errors (data
 * exception 22xxx, integrity 23xxx, transaction 25xxx, auth 28xxx, txn
 * rollback 40xxx, syntax/access 42xxx, resource 53xxx, limit 54xxx,
 * operator intervention 57xxx, system 58xxx, internal XX0xx, FDW HV0xx,
 * connection 08xxx, feature 0Axxx, config F0xxx).
 */

export interface ErrorEntry {
  /** Five-character SQLSTATE (exact, e.g. "23505"). */
  code: string;
  /** Short EN explanation. */
  en: string;
  /** Short RU explanation. */
  ru: string;
  /** Optional concrete fix. EN+RU; same shape as the explanation. */
  suggestedFix?: { en: string; ru: string };
  /** Optional regex against the error message (case-insensitive). */
  pattern?: RegExp;
}

/** Class-level fallback (first 2 chars of SQLSTATE) — used when the exact
 * code isn't in the table. Less specific than the per-code entries. */
export interface ErrorClassEntry {
  /** Two-character SQLSTATE class prefix (e.g. "22"). */
  classCode: string;
  en: string;
  ru: string;
}

// ---------- Per-code entries ----------

export const ERROR_ENTRIES: ErrorEntry[] = [
  // ---------- 08xxx — Connection Exception ----------
  {
    code: "08000",
    en: "Database connection failure.",
    ru: "Ошибка подключения к базе данных.",
    suggestedFix: {
      en: "Check that the host, port and credentials are correct in Settings → Connections.",
      ru: "Проверьте host, port и учётные данные в Settings → Подключения.",
    },
  },
  {
    code: "08001",
    en: "The client could not establish a connection to the server.",
    ru: "Клиент не смог установить соединение с сервером.",
    suggestedFix: {
      en: "Check network reachability, firewall rules and that PostgreSQL is listening on the configured port.",
      ru: "Проверьте сетевую доступность, настройки firewall и что PostgreSQL слушает указанный порт.",
    },
  },
  {
    code: "08003",
    en: "The connection is no longer open.",
    ru: "Соединение больше не открыто.",
    suggestedFix: {
      en: "Reconnect from the connections panel and rerun the query.",
      ru: "Переподключитесь из панели подключений и выполните запрос заново.",
    },
  },
  {
    code: "08006",
    en: "Connection failure during the operation. The server may have closed the connection or the network dropped.",
    ru: "Соединение оборвалось во время операции. Возможно сервер закрыл соединение или потерялась сеть.",
    suggestedFix: {
      en: "Reconnect and rerun. Check server logs for crashes or `idle_in_transaction_session_timeout` triggers.",
      ru: "Переподключитесь и повторите запрос. Проверьте серверные логи на crash или срабатывание `idle_in_transaction_session_timeout`.",
    },
  },
  {
    code: "08P01",
    en: "Protocol violation between the client and the PostgreSQL server.",
    ru: "Нарушение протокола между клиентом и PostgreSQL-сервером.",
    suggestedFix: {
      en: "Reconnect. If reproducible, the client and server versions may be incompatible.",
      ru: "Переподключитесь. При воспроизводимости — клиент и сервер могут быть несовместимы по версии.",
    },
  },

  // ---------- 0Axxx — Feature Not Supported ----------
  {
    code: "0A000",
    en: "The requested feature is not supported by this PostgreSQL build.",
    ru: "Запрошенная возможность не поддерживается этой сборкой PostgreSQL.",
    suggestedFix: {
      en: "Check whether a required extension is installed (`CREATE EXTENSION …`) or whether the feature is gated by a `pg_settings` flag.",
      ru: "Проверьте, нужно ли установить расширение (`CREATE EXTENSION …`) или разрешить функцию через `pg_settings`.",
    },
  },

  // ---------- 21xxx — Cardinality Violation ----------
  {
    code: "21000",
    en: "A subquery returned more than one row where exactly one was expected.",
    ru: "Подзапрос вернул более одной строки там, где ожидалась ровно одна.",
    suggestedFix: {
      en: "Add `LIMIT 1` to the subquery, use `IN (...)` instead of `=`, or aggregate (e.g. `MAX(...)`) to collapse the rows.",
      ru: "Добавьте `LIMIT 1` в подзапрос, используйте `IN (...)` вместо `=` или агрегируйте (например, `MAX(...)`).",
    },
  },

  // ---------- 22xxx — Data Exception ----------
  {
    code: "22001",
    en: "A string value is too long for the column's declared length (e.g. `VARCHAR(50)` and you supplied 60 chars).",
    ru: "Строковое значение превышает длину колонки (например `VARCHAR(50)`, а передано 60 символов).",
    suggestedFix: {
      en: "Truncate the value, widen the column with `ALTER COLUMN … TYPE varchar(N)`, or switch to `TEXT` (no length cap).",
      ru: "Обрежьте значение, расширьте колонку через `ALTER COLUMN … TYPE varchar(N)` или используйте `TEXT` (без ограничения).",
    },
  },
  {
    code: "22003",
    en: "A numeric value is out of range for the target type (e.g. value 200 for `SMALLINT`).",
    ru: "Числовое значение выходит за допустимый диапазон типа (например, 200 для `SMALLINT`).",
    suggestedFix: {
      en: "Use a wider numeric type (`INT`, `BIGINT`, `NUMERIC`) or scale the value before insert.",
      ru: "Используйте более широкий числовой тип (`INT`, `BIGINT`, `NUMERIC`) или масштабируйте значение перед вставкой.",
    },
  },
  {
    code: "22004",
    en: "A NULL was passed to a parameter or function argument that does not allow NULLs.",
    ru: "NULL передан в параметр или аргумент функции, не допускающий NULL.",
  },
  {
    code: "22007",
    en: "Invalid date/time format — the input string couldn't be parsed.",
    ru: "Неверный формат даты/времени — строку не удалось распарсить.",
    suggestedFix: {
      en: "Use ISO 8601 (`YYYY-MM-DD HH:MI:SS`) or pass through `TO_TIMESTAMP(input, format)`.",
      ru: "Используйте ISO 8601 (`YYYY-MM-DD HH:MI:SS`) или преобразуйте через `TO_TIMESTAMP(input, format)`.",
    },
  },
  {
    code: "22008",
    en: "Date/time field overflow (e.g. month 13).",
    ru: "Переполнение поля даты/времени (например, месяц 13).",
  },
  {
    code: "22012",
    en: "Division by zero.",
    ru: "Деление на ноль.",
    suggestedFix: {
      en: "Guard with `NULLIF(divisor, 0)` or `CASE WHEN divisor = 0 THEN NULL ELSE … END`.",
      ru: "Защититесь через `NULLIF(divisor, 0)` или `CASE WHEN divisor = 0 THEN NULL ELSE … END`.",
    },
    pattern: /division by zero/i,
  },
  {
    code: "22023",
    en: "Invalid parameter value passed to a function.",
    ru: "Недопустимое значение параметра функции.",
  },
  {
    code: "22P02",
    en: "Invalid input syntax for the column's type (e.g. `'abc'` for an `INTEGER`).",
    ru: "Неверный синтаксис ввода для типа колонки (например, `'abc'` для `INTEGER`).",
    suggestedFix: {
      en: "Sanitize the input or cast explicitly with `::type`. Inspect the offending value in the error message.",
      ru: "Очистите вход или приведите явно через `::type`. Конкретное значение видно в тексте ошибки.",
    },
    pattern: /invalid input syntax for type/i,
  },
  {
    code: "22P04",
    en: "Bad COPY format — column count or quoting doesn't match the COPY definition.",
    ru: "Неверный формат COPY — не совпадает количество колонок или экранирование.",
  },
  {
    code: "22P05",
    en: "Untranslatable character — the source byte sequence can't be encoded in the target encoding.",
    ru: "Непереводимый символ — байтовая последовательность не кодируется в целевой кодировке.",
    suggestedFix: {
      en: "Convert the input to UTF-8 (`convert_to(text, 'UTF8')`) before insert, or change the database encoding.",
      ru: "Сконвертируйте вход в UTF-8 (`convert_to(text, 'UTF8')`) до вставки или измените кодировку БД.",
    },
  },

  // ---------- 23xxx — Integrity Constraint ----------
  {
    code: "23502",
    en: "NOT NULL constraint violated — you tried to insert/update a NULL into a column that requires a value.",
    ru: "Нарушение NOT NULL — вы попытались вставить/обновить NULL в колонке, где значение обязательно.",
    suggestedFix: {
      en: "Provide a value for the column, set a `DEFAULT`, or relax the constraint with `ALTER COLUMN … DROP NOT NULL`.",
      ru: "Передайте значение для колонки, задайте `DEFAULT` или ослабьте ограничение через `ALTER COLUMN … DROP NOT NULL`.",
    },
    pattern: /null value in column .* violates not-null/i,
  },
  {
    code: "23503",
    en: "FOREIGN KEY constraint violated — the referenced row does not exist (or you're deleting a row that's still referenced).",
    ru: "Нарушение FOREIGN KEY — связанная строка не существует (или вы удаляете строку, на которую ссылаются).",
    suggestedFix: {
      en: "Make sure the parent row exists first; for deletes use `ON DELETE CASCADE` or remove dependents manually.",
      ru: "Убедитесь, что родительская строка существует; для удаления используйте `ON DELETE CASCADE` или удалите зависимые строки вручную.",
    },
    pattern: /violates foreign key constraint/i,
  },
  {
    code: "23505",
    en: "UNIQUE constraint violated — a row with this key already exists.",
    ru: "Нарушение UNIQUE — строка с таким ключом уже существует.",
    suggestedFix: {
      en: "Use `INSERT … ON CONFLICT (col) DO NOTHING` (or `DO UPDATE`) for upserts, or pick a different key value.",
      ru: "Для upsert'а используйте `INSERT … ON CONFLICT (col) DO NOTHING` (или `DO UPDATE`) или выберите другое значение ключа.",
    },
    pattern: /duplicate key value violates unique constraint/i,
  },
  {
    code: "23514",
    en: "CHECK constraint violated — the value doesn't satisfy the check predicate.",
    ru: "Нарушение CHECK — значение не удовлетворяет условию check-ограничения.",
    suggestedFix: {
      en: "Inspect the constraint definition (`\\d table` in psql) and supply a value that matches.",
      ru: "Проверьте определение ограничения (`\\d table` в psql) и передайте подходящее значение.",
    },
    pattern: /violates check constraint/i,
  },
  {
    code: "23P01",
    en: "EXCLUSION constraint violated — the row would overlap with an existing one.",
    ru: "Нарушение EXCLUSION — строка пересекается с существующей.",
  },

  // ---------- 25xxx — Invalid Transaction State ----------
  {
    code: "25001",
    en: "This statement is not allowed inside an active transaction.",
    ru: "Этот оператор недопустим внутри активной транзакции.",
    suggestedFix: {
      en: "Run it outside a transaction block (e.g. `VACUUM`, `CREATE INDEX CONCURRENTLY`, `CREATE DATABASE`).",
      ru: "Выполните его вне транзакции (например, `VACUUM`, `CREATE INDEX CONCURRENTLY`, `CREATE DATABASE`).",
    },
  },
  {
    code: "25006",
    en: "Read-only transaction — you're inside a `BEGIN READ ONLY` block.",
    ru: "Транзакция в режиме read-only — вы внутри блока `BEGIN READ ONLY`.",
    suggestedFix: {
      en: "Open a fresh transaction without READ ONLY, or move the read-only switch.",
      ru: "Откройте новую транзакцию без READ ONLY или уберите этот режим.",
    },
    pattern: /cannot execute .* in a read-only transaction/i,
  },
  {
    code: "25P01",
    en: "There is no active transaction (you tried to COMMIT/ROLLBACK without BEGIN).",
    ru: "Нет активной транзакции (попытка COMMIT/ROLLBACK без BEGIN).",
  },
  {
    code: "25P02",
    en: "Current transaction is aborted — every command is being skipped until you ROLLBACK.",
    ru: "Текущая транзакция уже отменена — все команды пропускаются до ROLLBACK.",
    suggestedFix: {
      en: "Run `ROLLBACK;`, then start a new transaction. Investigate the original error that aborted it.",
      ru: "Выполните `ROLLBACK;` и начните новую транзакцию. Найдите исходную ошибку, которая её отменила.",
    },
    pattern: /current transaction is aborted/i,
  },
  {
    code: "25P03",
    en: "Idle in transaction session timeout — the server cancelled an idle session that had an open transaction.",
    ru: "Idle in transaction session timeout — сервер отменил idle-сессию с открытой транзакцией.",
    suggestedFix: {
      en: "Reduce the time between transaction start and commit, or raise `idle_in_transaction_session_timeout`.",
      ru: "Сократите время между BEGIN и COMMIT или увеличьте `idle_in_transaction_session_timeout`.",
    },
  },

  // ---------- 28xxx — Authentication ----------
  {
    code: "28000",
    en: "Invalid authorization specification.",
    ru: "Неверная авторизация.",
  },
  {
    code: "28P01",
    en: "Invalid password — the supplied password did not match.",
    ru: "Неверный пароль — переданный пароль не совпал.",
    suggestedFix: {
      en: "Re-enter the password in Settings → Connections. If using `peer`/`md5`/`scram` auth, confirm with `pg_hba.conf`.",
      ru: "Введите пароль заново в Settings → Подключения. При peer/md5/scram-auth — сверьтесь с `pg_hba.conf`.",
    },
    pattern: /password authentication failed/i,
  },

  // ---------- 2D000 — Invalid Transaction Termination ----------
  {
    code: "2D000",
    en: "Invalid transaction termination — for example COMMIT inside a function that doesn't allow it.",
    ru: "Недопустимое завершение транзакции — например, COMMIT внутри функции, не позволяющей это.",
  },

  // ---------- 40xxx — Transaction Rollback ----------
  {
    code: "40001",
    en: "Serialization failure — concurrent transactions could not be serialized. The transaction was rolled back.",
    ru: "Serialization failure — параллельные транзакции не удалось сериализовать. Транзакция откатилась.",
    suggestedFix: {
      en: "Retry the transaction. If frequent, lower the isolation level to `REPEATABLE READ` or split work into smaller batches.",
      ru: "Повторите транзакцию. Если часто — снизьте уровень изоляции до `REPEATABLE READ` или разбейте работу на меньшие батчи.",
    },
    pattern: /could not serialize access/i,
  },
  {
    code: "40P01",
    en: "Deadlock detected — two transactions are waiting on each other's locks. PostgreSQL killed yours to break the cycle.",
    ru: "Обнаружен deadlock — две транзакции ждут блокировки друг друга. PostgreSQL завершил вашу, чтобы разорвать цикл.",
    suggestedFix: {
      en: "Retry. To avoid: acquire locks in a consistent order across transactions, or shorten transactions.",
      ru: "Повторите. Чтобы избежать: захватывайте блокировки в одинаковом порядке во всех транзакциях или сокращайте их время.",
    },
    pattern: /deadlock detected/i,
  },
  {
    code: "40003",
    en: "Statement completion is unknown — the connection broke after the statement was sent.",
    ru: "Неизвестно завершился ли оператор — соединение оборвалось после отправки.",
  },

  // ---------- 42xxx — Syntax / Access Rule Violation ----------
  {
    code: "42000",
    en: "Generic syntax or access rule violation.",
    ru: "Общая синтаксическая ошибка или нарушение правил доступа.",
  },
  {
    code: "42501",
    en: "Insufficient privilege — your role does not have the required permission for this operation.",
    ru: "Недостаточно прав — роли не хватает разрешения для операции.",
    suggestedFix: {
      en: "Run `GRANT … ON … TO <role>` from a superuser, or connect under a role with the privilege.",
      ru: "Выполните `GRANT … ON … TO <role>` от суперпользователя или подключитесь от роли с правами.",
    },
    pattern: /permission denied/i,
  },
  {
    code: "42601",
    en: "Syntax error in the SQL.",
    ru: "Синтаксическая ошибка в SQL.",
    suggestedFix: {
      en: "Check punctuation, parentheses, and reserved words near the indicated position.",
      ru: "Проверьте пунктуацию, скобки и зарезервированные слова возле указанной позиции.",
    },
    pattern: /syntax error at or near/i,
  },
  {
    code: "42602",
    en: "Invalid identifier name (e.g. starts with a digit, contains a special character without quoting).",
    ru: "Неверное имя идентификатора (например, начинается с цифры или содержит спецсимвол без кавычек).",
    suggestedFix: {
      en: 'Quote the name with double quotes (`"My Column"`) or use only `[a-z_][a-z0-9_]*`.',
      ru: 'Заключите имя в двойные кавычки (`"My Column"`) или используйте только `[a-z_][a-z0-9_]*`.',
    },
  },
  {
    code: "42611",
    en: "Invalid column definition (e.g. unknown type, conflicting modifiers).",
    ru: "Неверное определение колонки (неизвестный тип, конфликтующие модификаторы).",
  },
  {
    code: "42622",
    en: "Identifier name is too long (>63 characters by default).",
    ru: "Имя идентификатора слишком длинное (>63 символов по умолчанию).",
    suggestedFix: {
      en: "Shorten the name. Recompiling PostgreSQL with `NAMEDATALEN` higher is rarely the right answer.",
      ru: "Сократите имя. Перекомпиляция PostgreSQL с большим `NAMEDATALEN` — редко правильное решение.",
    },
  },
  {
    code: "42701",
    en: "Duplicate column name in the SELECT list or table definition.",
    ru: "Повторяющееся имя колонки в списке SELECT или определении таблицы.",
    suggestedFix: {
      en: "Alias one of them with `AS new_name`.",
      ru: "Используйте alias для одной из них через `AS new_name`.",
    },
  },
  {
    code: "42702",
    en: "Ambiguous column reference — the column name exists in multiple joined tables.",
    ru: "Неоднозначная ссылка на колонку — имя есть в нескольких join'ах.",
    suggestedFix: {
      en: "Qualify with the table name or alias: `users.id` instead of just `id`.",
      ru: "Уточните с именем таблицы или alias'ом: `users.id` вместо `id`.",
    },
    pattern: /column reference .* is ambiguous/i,
  },
  {
    code: "42703",
    en: "Undefined column — the column does not exist in any of the FROM tables.",
    ru: "Колонка не существует ни в одной из таблиц FROM.",
    suggestedFix: {
      en: "Check the spelling, table aliases and JOINs. `\\d table` in psql lists actual columns.",
      ru: "Проверьте написание, alias'ы и JOIN'ы. Список колонок: `\\d table` в psql.",
    },
    pattern: /column .* does not exist/i,
  },
  {
    code: "42704",
    en: "Undefined object (type, function, operator, role, schema, etc.).",
    ru: "Объект не определён (тип, функция, оператор, роль, схема и т. п.).",
    pattern: /(type|function|operator|role|schema) .* does not exist/i,
  },
  {
    code: "42710",
    en: "Duplicate object — you're creating something that already exists (table, role, schema, …).",
    ru: "Дубликат объекта — пытаетесь создать то, что уже есть (таблица, роль, схема, …).",
    suggestedFix: {
      en: "Add `IF NOT EXISTS` to the `CREATE` statement, or `DROP` the existing object first.",
      ru: "Добавьте `IF NOT EXISTS` к `CREATE` или сначала `DROP` существующий объект.",
    },
    pattern: /already exists/i,
  },
  {
    code: "42712",
    en: "Duplicate alias — the same alias is used twice in the FROM list.",
    ru: "Повторяющийся alias — один и тот же alias используется дважды в FROM.",
  },
  {
    code: "42723",
    en: "Duplicate function — function with this signature already exists.",
    ru: "Дублирование функции — функция с такой сигнатурой уже существует.",
  },
  {
    code: "42725",
    en: "Ambiguous function — multiple functions match the call. Cast the arguments.",
    ru: "Неоднозначная функция — несколько функций подходят к вызову. Приведите аргументы к нужному типу.",
  },
  {
    code: "42803",
    en: "Grouping error — non-aggregated columns must be in `GROUP BY` or wrapped in an aggregate.",
    ru: "Ошибка группировки — неагрегированные колонки должны быть в `GROUP BY` или внутри агрегатной функции.",
    suggestedFix: {
      en: "Either add the column to `GROUP BY`, or wrap it in `MIN/MAX/SUM/AVG/...`.",
      ru: "Добавьте колонку в `GROUP BY` либо оберните в `MIN/MAX/SUM/AVG/...`.",
    },
    pattern: /must appear in the group by clause/i,
  },
  {
    code: "42804",
    en: "Datatype mismatch — incompatible types in the expression (e.g. `text` + `int` without cast).",
    ru: "Несовпадение типов — несовместимые типы в выражении (например, `text` + `int` без приведения).",
    suggestedFix: {
      en: "Cast explicitly with `::type` or use a conversion function (`CAST`, `text(value)`, `value::int`).",
      ru: "Приведите явно через `::type` или функцию преобразования (`CAST`, `text(value)`, `value::int`).",
    },
  },
  {
    code: "42830",
    en: "Invalid foreign key — the referenced columns must form a primary key or unique constraint.",
    ru: "Неверный foreign key — колонки-цели должны быть primary key или unique-ограничением.",
  },
  {
    code: "42883",
    en: "Function does not exist — no function matches the call signature (name + argument types).",
    ru: "Функция не существует — нет функции с подходящим именем и типами аргументов.",
    suggestedFix: {
      en: "Cast arguments to the expected types, or check the function name with `\\df name` in psql.",
      ru: "Приведите аргументы к ожидаемым типам или проверьте имя через `\\df name` в psql.",
    },
    pattern: /function .* does not exist/i,
  },
  {
    code: "42939",
    en: "Reserved name used as an identifier without quoting.",
    ru: "Зарезервированное имя использовано без двойных кавычек.",
  },
  {
    code: "42P01",
    en: "Undefined table — the relation does not exist or the search_path doesn't include its schema.",
    ru: "Таблица не существует — отношение отсутствует, либо его схема не в search_path.",
    suggestedFix: {
      en: "Check the spelling, the schema (`schema.table`), and `SHOW search_path`.",
      ru: "Проверьте написание, схему (`schema.table`) и `SHOW search_path`.",
    },
    pattern: /relation .* does not exist/i,
  },
  {
    code: "42P02",
    en: "Undefined parameter — the placeholder ($1, $2, …) was never bound.",
    ru: "Параметр не определён — placeholder ($1, $2, …) не был связан.",
  },
  {
    code: "42P03",
    en: "Duplicate cursor name.",
    ru: "Дубликат имени cursor.",
  },
  {
    code: "42P04",
    en: "Database already exists.",
    ru: "База данных уже существует.",
  },
  {
    code: "42P05",
    en: "Duplicate prepared statement name.",
    ru: "Дубликат имени prepared statement.",
  },
  {
    code: "42P06",
    en: "Duplicate schema name.",
    ru: "Дубликат имени схемы.",
  },
  {
    code: "42P07",
    en: "Duplicate table name.",
    ru: "Дубликат имени таблицы.",
    pattern: /relation .* already exists/i,
  },
  {
    code: "42P10",
    en: "Invalid column reference — column index/expression doesn't refer to a real column.",
    ru: "Неверная ссылка на колонку — индекс/выражение не указывает на существующую.",
  },
  {
    code: "42P16",
    en: "Invalid table definition (e.g. partition without partition key).",
    ru: "Неверное определение таблицы (например, partition без partition key).",
  },
  {
    code: "42P17",
    en: "Invalid object definition (e.g. recursive view).",
    ru: "Неверное определение объекта (например, рекурсивный view).",
  },
  {
    code: "42P18",
    en: "Indeterminate datatype — PG can't infer the type, you need to cast explicitly.",
    ru: "Не удалось вывести тип — нужно явно привести через cast.",
  },

  // ---------- 53xxx — Insufficient Resources ----------
  {
    code: "53000",
    en: "Insufficient server resources to complete the request.",
    ru: "Серверу недостаточно ресурсов для запроса.",
  },
  {
    code: "53100",
    en: "Disk full on the server.",
    ru: "На сервере закончилось место на диске.",
    suggestedFix: {
      en: "Free disk space (drop unused indexes, `VACUUM FULL`, archive old data) and retry.",
      ru: "Освободите место (drop unused indexes, `VACUUM FULL`, архивируйте старые данные) и повторите.",
    },
  },
  {
    code: "53200",
    en: "Out of memory on the server.",
    ru: "Серверу не хватило памяти.",
    suggestedFix: {
      en: "Lower `work_mem` for this session, simplify the query, or split into smaller batches.",
      ru: "Уменьшите `work_mem` для сессии, упростите запрос или разбейте на батчи.",
    },
  },
  {
    code: "53300",
    en: "Too many connections — `max_connections` is reached.",
    ru: "Слишком много подключений — достигнут лимит `max_connections`.",
    suggestedFix: {
      en: "Close idle connections, raise `max_connections`, or use a connection pooler (PgBouncer).",
      ru: "Закройте idle-соединения, поднимите `max_connections` или используйте connection pooler (PgBouncer).",
    },
    pattern: /too many .* connections/i,
  },
  {
    code: "53400",
    en: "Configuration limit exceeded.",
    ru: "Превышен лимит конфигурации.",
  },

  // ---------- 54xxx — Program Limit Exceeded ----------
  {
    code: "54000",
    en: "Program limit exceeded.",
    ru: "Превышен программный лимит.",
  },
  {
    code: "54001",
    en: "Statement is too complex.",
    ru: "Оператор слишком сложен.",
  },
  {
    code: "54011",
    en: "Too many columns for this operation.",
    ru: "Слишком много колонок для этой операции.",
  },
  {
    code: "54023",
    en: "Too many arguments to a function.",
    ru: "Слишком много аргументов у функции.",
  },

  // ---------- 55xxx — Object Not in Prerequisite State ----------
  {
    code: "55000",
    en: "Object is not in the state required for this operation.",
    ru: "Объект не в нужном состоянии для операции.",
  },
  {
    code: "55006",
    en: "Object in use — drop/alter is blocked because something else holds it (open cursor, prepared statement, …).",
    ru: "Объект используется — drop/alter заблокирован, что-то держит его (открытый cursor, prepared statement, …).",
  },
  {
    code: "55P03",
    en: "Lock not available — `NOWAIT` was specified and the lock is held by another session.",
    ru: "Блокировка недоступна — указан `NOWAIT`, а другая сессия её держит.",
    suggestedFix: {
      en: "Retry without `NOWAIT`, or wait until the holder releases the lock.",
      ru: "Повторите без `NOWAIT` или дождитесь освобождения блокировки.",
    },
  },

  // ---------- 57xxx — Operator Intervention ----------
  {
    code: "57000",
    en: "Operator intervention.",
    ru: "Вмешательство оператора.",
  },
  {
    code: "57014",
    en: "Query was canceled — typically by `pg_cancel_backend()` or `statement_timeout`.",
    ru: "Запрос был отменён — обычно через `pg_cancel_backend()` или по `statement_timeout`.",
    suggestedFix: {
      en: "Optimize the query (add indexes, narrow filters), raise `statement_timeout`, or split the work.",
      ru: "Оптимизируйте запрос (индексы, сужение фильтров), увеличьте `statement_timeout` или разбейте работу.",
    },
    pattern: /canceling statement due to/i,
  },
  {
    code: "57P01",
    en: "Server is shutting down — the admin issued a shutdown.",
    ru: "Сервер останавливается — администратор инициировал shutdown.",
  },
  {
    code: "57P02",
    en: "Server crashed and is restarting.",
    ru: "Сервер аварийно завершился и перезапускается.",
  },
  {
    code: "57P03",
    en: "Server cannot connect — postmaster is not yet ready.",
    ru: "Сервер не принимает подключения — postmaster ещё не готов.",
  },
  {
    code: "57P04",
    en: "Database has been dropped under your session.",
    ru: "База данных удалена под вашей сессией.",
  },

  // ---------- 58xxx — System Error ----------
  {
    code: "58000",
    en: "External system error.",
    ru: "Внешняя системная ошибка.",
  },
  {
    code: "58030",
    en: "I/O error on the server side.",
    ru: "Ошибка ввода/вывода на стороне сервера.",
  },
  {
    code: "58P01",
    en: "Undefined file (e.g. tablespace path missing).",
    ru: "Файл не определён (например, отсутствует tablespace).",
  },
  {
    code: "58P02",
    en: "Duplicate file.",
    ru: "Дубликат файла.",
  },

  // ---------- F0xxx — Configuration File ----------
  {
    code: "F0000",
    en: "Configuration file error.",
    ru: "Ошибка в файле конфигурации.",
  },
  {
    code: "F0001",
    en: "Lock file already exists.",
    ru: "Lock-файл уже существует.",
  },

  // ---------- HV0xx — Foreign Data Wrapper ----------
  {
    code: "HV000",
    en: "FDW (foreign data wrapper) error.",
    ru: "Ошибка FDW (foreign data wrapper).",
  },
  {
    code: "HV004",
    en: "FDW invalid datatype.",
    ru: "FDW: неверный тип данных.",
  },
  {
    code: "HV005",
    en: "FDW column descriptor error.",
    ru: "FDW: ошибка описания колонки.",
  },

  // ---------- P0xxx — PL/pgSQL ----------
  {
    code: "P0001",
    en: "PL/pgSQL `RAISE EXCEPTION` — your function explicitly raised an error.",
    ru: "PL/pgSQL `RAISE EXCEPTION` — ваша функция явно подняла ошибку.",
    suggestedFix: {
      en: "The message above is the function-author's text. Find the `RAISE EXCEPTION` in the function body.",
      ru: "Сообщение выше — текст из функции. Найдите `RAISE EXCEPTION` в её теле.",
    },
  },
  {
    code: "P0002",
    en: "PL/pgSQL `NO_DATA_FOUND` — `SELECT INTO` returned no rows.",
    ru: "PL/pgSQL `NO_DATA_FOUND` — `SELECT INTO` не вернул строк.",
  },
  {
    code: "P0003",
    en: "PL/pgSQL `TOO_MANY_ROWS` — `SELECT INTO` returned more than one row.",
    ru: "PL/pgSQL `TOO_MANY_ROWS` — `SELECT INTO` вернул более одной строки.",
  },
  {
    code: "P0004",
    en: "PL/pgSQL `ASSERT` failed.",
    ru: "PL/pgSQL `ASSERT` провалился.",
  },

  // ---------- XX0xx — Internal Error ----------
  {
    code: "XX000",
    en: "Internal PostgreSQL error.",
    ru: "Внутренняя ошибка PostgreSQL.",
    suggestedFix: {
      en: "Check the server log for the full backtrace. Often points to a corruption or a bug.",
      ru: "Смотрите серверный лог для полного backtrace. Обычно указывает на повреждение или баг.",
    },
  },
  {
    code: "XX001",
    en: "Data corruption detected.",
    ru: "Обнаружено повреждение данных.",
    suggestedFix: {
      en: "Stop write traffic, take a backup, run `pg_amcheck` to assess damage.",
      ru: "Остановите запись, сделайте backup, запустите `pg_amcheck` для оценки повреждений.",
    },
  },
  {
    code: "XX002",
    en: "Index corruption detected.",
    ru: "Обнаружено повреждение индекса.",
    suggestedFix: {
      en: "REINDEX the affected index.",
      ru: "Сделайте REINDEX для повреждённого индекса.",
    },
  },
];

// ---------- Class-level fallback (when no exact entry matches) ----------

export const ERROR_CLASS_ENTRIES: ErrorClassEntry[] = [
  {
    classCode: "08",
    en: "Connection exception — the database connection has a problem.",
    ru: "Ошибка соединения — проблема с подключением к БД.",
  },
  {
    classCode: "0A",
    en: "Feature not supported by this PostgreSQL build.",
    ru: "Функция не поддерживается этой сборкой PostgreSQL.",
  },
  {
    classCode: "21",
    en: "Cardinality violation — wrong number of rows somewhere.",
    ru: "Cardinality violation — неверное количество строк где-то в запросе.",
  },
  {
    classCode: "22",
    en: "Data exception — a value can't be processed (wrong type, out of range, bad encoding, …).",
    ru: "Data exception — значение не может быть обработано (неверный тип, диапазон, кодировка, …).",
  },
  {
    classCode: "23",
    en: "Integrity constraint violation — NOT NULL / FK / UNIQUE / CHECK / EXCLUSION.",
    ru: "Нарушение integrity constraint — NOT NULL / FK / UNIQUE / CHECK / EXCLUSION.",
  },
  {
    classCode: "24",
    en: "Invalid cursor state.",
    ru: "Неверное состояние cursor.",
  },
  {
    classCode: "25",
    en: "Invalid transaction state.",
    ru: "Неверное состояние транзакции.",
  },
  {
    classCode: "26",
    en: "Invalid SQL statement name.",
    ru: "Неверное имя SQL-оператора.",
  },
  {
    classCode: "27",
    en: "Triggered data change violation.",
    ru: "Нарушение изменения данных триггером.",
  },
  {
    classCode: "28",
    en: "Invalid authorization specification.",
    ru: "Неверная авторизация.",
  },
  {
    classCode: "2B",
    en: "Dependent privilege descriptors still exist.",
    ru: "Существуют зависимые privilege descriptors.",
  },
  {
    classCode: "2D",
    en: "Invalid transaction termination.",
    ru: "Недопустимое завершение транзакции.",
  },
  {
    classCode: "2F",
    en: "SQL routine exception.",
    ru: "Исключение в SQL-routine.",
  },
  {
    classCode: "34",
    en: "Invalid cursor name.",
    ru: "Неверное имя cursor.",
  },
  {
    classCode: "38",
    en: "External routine exception.",
    ru: "Исключение во внешней routine.",
  },
  {
    classCode: "39",
    en: "External routine invocation exception.",
    ru: "Исключение при вызове внешней routine.",
  },
  {
    classCode: "3B",
    en: "Savepoint exception.",
    ru: "Исключение savepoint.",
  },
  {
    classCode: "3D",
    en: "Invalid catalog name.",
    ru: "Неверное имя каталога.",
  },
  {
    classCode: "3F",
    en: "Invalid schema name.",
    ru: "Неверное имя схемы.",
  },
  {
    classCode: "40",
    en: "Transaction rollback (serialization, deadlock, integrity-constraint failure).",
    ru: "Транзакция откатилась (serialization, deadlock, integrity-constraint).",
  },
  {
    classCode: "42",
    en: "Syntax error or access rule violation.",
    ru: "Синтаксическая ошибка или нарушение прав доступа.",
  },
  {
    classCode: "44",
    en: "WITH CHECK OPTION violation.",
    ru: "Нарушение WITH CHECK OPTION.",
  },
  {
    classCode: "53",
    en: "Insufficient resources (disk, memory, connections, …).",
    ru: "Недостаточно ресурсов (диск, память, подключения, …).",
  },
  {
    classCode: "54",
    en: "Program limit exceeded.",
    ru: "Превышен программный лимит.",
  },
  {
    classCode: "55",
    en: "Object not in prerequisite state.",
    ru: "Объект не в нужном состоянии.",
  },
  {
    classCode: "57",
    en: "Operator intervention (cancel, shutdown, crash).",
    ru: "Вмешательство оператора (cancel, shutdown, crash).",
  },
  {
    classCode: "58",
    en: "External system error (I/O, file, …).",
    ru: "Внешняя системная ошибка (I/O, файл, …).",
  },
  {
    classCode: "F0",
    en: "Configuration file error.",
    ru: "Ошибка файла конфигурации.",
  },
  {
    classCode: "HV",
    en: "FDW (foreign data wrapper) error.",
    ru: "Ошибка FDW.",
  },
  {
    classCode: "P0",
    en: "PL/pgSQL exception.",
    ru: "Исключение PL/pgSQL.",
  },
  {
    classCode: "XX",
    en: "Internal PostgreSQL error — usually corruption or a bug.",
    ru: "Внутренняя ошибка PostgreSQL — обычно повреждение или баг.",
  },
];

// ---------- Indices for O(1) lookup ----------

export const ERROR_BY_CODE: ReadonlyMap<string, ErrorEntry> = new Map(  ERROR_ENTRIES.map((e) => [e.code, e]),
);

export const ERROR_CLASS_BY_PREFIX: ReadonlyMap<string, ErrorClassEntry> = new Map(  ERROR_CLASS_ENTRIES.map((e) => [e.classCode, e]),
);
