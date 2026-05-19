/**
 * — concept tooltips knowledge base.
 *
 * Each entry maps a PostgreSQL concept (e.g. "schema", "JSONB", "FK") to a
 * short EN+RU explanation and a concrete SQL example. `ConceptTooltip` looks
 * an entry up by `id` and renders the explanation/example inside a Radix
 * Tooltip when the IDE is in Easy mode.
 *
 * Design rules:
 * - 1-3 sentences per `explanation`, plain language (junior-friendly).
 * - `example.en` / `example.ru` is a short SQL snippet or expression that
 * demonstrates the concept; keep it under one line where possible so the
 * monospace block stays compact inside the tooltip.
 * - `matchers` is reserved for future autodetection in tree/grid headers.
 * Today we look entries up by id only; matchers are non-load-bearing but
 * shipped now so the contract stays stable for follow-up sprints.
 */

export interface ConceptEntry {
  /** Stable id used as React key + tooltip-trigger lookup. */
  id: string;
  /** Match this concept against text (case-insensitive). The first
   * regex that matches wins for autodetection in tree/grid headers. */
  matchers: RegExp[];
  /** EN+RU short explanation, 1-3 sentences. */
  explanation: { en: string; ru: string };
  /** Optional one-line example, language-neutral or SQL snippet. */
  example?: { en: string; ru: string };
}

export const CONCEPTS: ConceptEntry[] = [
  {
    id: "schema",
    matchers: [/^schema$/i, /\bschema\b/i],
    explanation: {
      en: "A schema is a namespace inside a PostgreSQL database. It groups tables, views and functions, similar to a folder. Every database has at least the built-in `public` schema.",
      ru: "Schema — пространство имён внутри БД PostgreSQL. Группирует таблицы, представления и функции, похоже на папку. В каждой БД по умолчанию есть схема `public`.",
    },
    example: {
      en: "SELECT * FROM public.users;  -- `public` is the schema, `users` is the table",
      ru: "SELECT * FROM public.users;  -- `public` — схема, `users` — таблица",
    },
  },
  {
    id: "search_path",
    matchers: [/search_path/i],
    explanation: {
      en: "`search_path` is the ordered list of schemas PostgreSQL scans when you reference an unqualified name. The first schema that contains a matching object wins; everything else is shadowed.",
      ru: "`search_path` — упорядоченный список схем, в которых PostgreSQL ищет объект, если имя не уточнено схемой. Первая схема со совпадением выигрывает, остальные скрыты.",
    },
    example: {
      en: "SET search_path = analytics, public;  -- analytics first, then public",
      ru: "SET search_path = analytics, public;  -- сначала analytics, затем public",
    },
  },
  {
    id: "transaction",
    matchers: [/^transaction$/i, /\btransaction\b/i],
    explanation: {
      en: "A transaction is an all-or-nothing unit of work. Statements between `BEGIN` and `COMMIT` either all apply or all roll back — no partial state ever reaches the database.",
      ru: "Transaction — атомарная единица изменений. Запросы между `BEGIN` и `COMMIT` применяются целиком или откатываются целиком; промежуточного состояния не бывает.",
    },
    example: {
      en: "BEGIN;\nUPDATE accounts SET balance = balance - 10 WHERE id = 1;\nUPDATE accounts SET balance = balance + 10 WHERE id = 2;\nCOMMIT;",
      ru: "BEGIN;\nUPDATE accounts SET balance = balance - 10 WHERE id = 1;\nUPDATE accounts SET balance = balance + 10 WHERE id = 2;\nCOMMIT;",
    },
  },
  {
    id: "null",
    matchers: [/^null$/i, /\bNULL\b/],
    explanation: {
      en: 'NULL means "unknown" — it is not the empty string and not zero. Comparisons with NULL using `=` or `<>` always yield NULL (treated as false in WHERE), so use `IS NULL` / `IS NOT NULL`.',
      ru: "NULL означает «неизвестно» — это не пустая строка и не ноль. Сравнения через `=` / `<>` с NULL всегда дают NULL (в WHERE считается ложью), поэтому пишите `IS NULL` / `IS NOT NULL`.",
    },
    example: {
      en: "SELECT * FROM users WHERE deleted_at IS NULL;  -- not `= NULL`",
      ru: "SELECT * FROM users WHERE deleted_at IS NULL;  -- не `= NULL`",
    },
  },
  {
    id: "index",
    matchers: [/^index$/i, /\bindex\b/i],
    explanation: {
      en: "An index is an auxiliary data structure that speeds up SELECT lookups by avoiding full-table scans. It costs disk space and slows down INSERT/UPDATE/DELETE because the index must be kept in sync.",
      ru: "Index — вспомогательная структура, ускоряющая SELECT за счёт того, что PostgreSQL не сканирует всю таблицу. Платой идёт место на диске и замедление INSERT/UPDATE/DELETE — индекс приходится поддерживать в актуальном состоянии.",
    },
    example: {
      en: "CREATE INDEX idx_users_email ON users (email);",
      ru: "CREATE INDEX idx_users_email ON users (email);",
    },
  },
  {
    id: "jsonb",
    matchers: [/^jsonb$/i, /\bjsonb\b/i],
    explanation: {
      en: "`jsonb` stores JSON in a binary, indexable form. Prefer it over plain `json` unless you need to preserve key order and whitespace verbatim — `jsonb` supports operators like `->`, `->>`, `@>` and GIN indexes.",
      ru: "`jsonb` — бинарное представление JSON, которое можно индексировать. Используйте его вместо `json`, если не нужно сохранять оригинальный порядок ключей и пробелы — `jsonb` поддерживает операторы `->`, `->>`, `@>` и GIN-индексы.",
    },
    example: {
      en: "SELECT data->>'email' FROM users WHERE data @> '{\"role\":\"admin\"}';",
      ru: "SELECT data->>'email' FROM users WHERE data @> '{\"role\":\"admin\"}';",
    },
  },
  {
    id: "cte",
    matchers: [/\bCTE\b/, /common table expression/i, /\bWITH\b/i],
    explanation: {
      en: "A CTE (Common Table Expression) is a named subquery declared with `WITH`. It makes complex queries readable and can be referenced multiple times in the same statement; recursive CTEs let you traverse trees and graphs.",
      ru: "CTE (Common Table Expression) — именованный подзапрос, объявленный через `WITH`. Делает сложные запросы читаемыми и позволяет ссылаться на результат несколько раз; рекурсивные CTE используются для обхода деревьев и графов.",
    },
    example: {
      en: "WITH active AS (\n  SELECT * FROM users WHERE deleted_at IS NULL\n)\nSELECT count(*) FROM active;",
      ru: "WITH active AS (\n  SELECT * FROM users WHERE deleted_at IS NULL\n)\nSELECT count(*) FROM active;",
    },
  },
  {
    id: "generated_column",
    matchers: [/generated\s+column/i, /\bGENERATED\b/],
    explanation: {
      en: "A generated column is a column whose value is computed from other columns in the same row. PostgreSQL supports `STORED` generated columns (materialised on disk) — virtual generated columns are not yet implemented.",
      ru: "Generated column — колонка, значение которой вычисляется из других колонок той же строки. PostgreSQL поддерживает `STORED` (значение материализовано на диске); virtual generated columns пока не реализованы.",
    },
    example: {
      en: "ALTER TABLE products\n  ADD COLUMN price_with_tax numeric\n  GENERATED ALWAYS AS (price * 1.2) STORED;",
      ru: "ALTER TABLE products\n  ADD COLUMN price_with_tax numeric\n  GENERATED ALWAYS AS (price * 1.2) STORED;",
    },
  },
  {
    id: "foreign_key",
    matchers: [/foreign\s+key/i, /\bFK\b/, /\bREFERENCES\b/i],
    explanation: {
      en: "A foreign key (FK) is a column that references the primary key of another table. PostgreSQL enforces referential integrity — you cannot insert a row whose FK points to a non-existent parent, and parent rows are protected from accidental deletion.",
      ru: "Foreign key (FK) — колонка, ссылающаяся на primary key другой таблицы. PostgreSQL проверяет ссылочную целостность: нельзя вставить строку с FK, указывающим в никуда, а родительские строки защищены от случайного удаления.",
    },
    example: {
      en: "CREATE TABLE orders (\n  id serial PRIMARY KEY,\n  user_id int REFERENCES users (id)\n);",
      ru: "CREATE TABLE orders (\n  id serial PRIMARY KEY,\n  user_id int REFERENCES users (id)\n);",
    },
  },
  {
    id: "vacuum",
    matchers: [/^vacuum$/i, /\bVACUUM\b/i],
    explanation: {
      en: "`VACUUM` is PostgreSQL's garbage collector. It reclaims space taken by rows that have been UPDATEd or DELETEd (MVCC keeps old row versions until vacuumed) and refreshes statistics used by the planner. Autovacuum runs it automatically.",
      ru: "`VACUUM` — сборщик мусора PostgreSQL. Освобождает место, занятое старыми версиями строк после UPDATE/DELETE (MVCC хранит их до vacuum), и обновляет статистику планировщика. Обычно запускается автоматически (autovacuum).",
    },
    example: {
      en: "VACUUM (ANALYZE) users;  -- reclaim dead tuples and refresh stats",
      ru: "VACUUM (ANALYZE) users;  -- освободить место и обновить статистику",
    },
  },
  {
    id: "primary_key",
    matchers: [/primary\s+key/i, /\bPK\b/, /\bpkey\b/i],
    explanation: {
      en: "A primary key is the column (or set of columns) that uniquely identifies each row in a table. PostgreSQL automatically creates a unique index for it, and the column(s) cannot be NULL.",
      ru: "Primary key — колонка (или набор колонок), которая уникально идентифицирует строку таблицы. PostgreSQL автоматически создаёт по ней уникальный индекс, и значение не может быть NULL.",
    },
    example: {
      en: "CREATE TABLE users (\n  id serial PRIMARY KEY,\n  email text NOT NULL\n);",
      ru: "CREATE TABLE users (\n  id serial PRIMARY KEY,\n  email text NOT NULL\n);",
    },
  },
  {
    id: "view",
    matchers: [/^view$/i, /\bview\b/i],
    explanation: {
      en: "A view is a saved SELECT query that you can query like a table. The underlying SQL runs each time the view is referenced — views do not store data themselves (use a materialized view for that).",
      ru: "View — сохранённый SELECT-запрос, к которому можно обращаться как к таблице. SQL запускается заново при каждом обращении — view не хранит данные (для этого нужен materialized view).",
    },
    example: {
      en: "CREATE VIEW active_users AS\n  SELECT * FROM users WHERE deleted_at IS NULL;",
      ru: "CREATE VIEW active_users AS\n  SELECT * FROM users WHERE deleted_at IS NULL;",
    },
  },
];

/** Index by id for O(1) lookup at render time. */
export const CONCEPTS_BY_ID: ReadonlyMap<string, ConceptEntry> = new Map(
  CONCEPTS.map((c) => [c.id, c]),
);
