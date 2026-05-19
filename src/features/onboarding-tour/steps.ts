/**
 * — onboarding tour, 8-step ID list with full EN+RU copy.
 *
 * Tour is mandatory on first switch to Easy mode; afterwards re-runnable via Help.
 *
 * The 8 steps walk the user through:
 * 1. workspace overview
 * 2. connection list (sidebar)
 * 3. schema tree
 * 4. SQL editor
 * 5. result grid
 * 6. bidirectional SQL panel (Easy-only)
 * 7. settings entry (Cmd+,, MCP for AI agents)
 * 8. help / restart-tour entry
 *
 * Each `target` is a `data-testid` selector resolved at tour-start time via
 * `document.querySelector`. If the target is missing, the host renders the
 * bubble centered without spotlight (graceful degradation — tour stays
 * walkable on workspaces that lack the optional surfaces).
 */

export interface TourStep {
  id: string;
  /** CSS selector or `data-testid` to anchor the spotlight on. */
  target: string;
  /** EN+RU step copy (≤250 chars per locale, friendly tone). */
  body: { en: string; ru: string };
  /** Optional override for the highlight strength (default: 1). */
  emphasis?: 1 | 2 | 3;
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: "welcome",
    target: "[data-testid='workspace-root']",
    body: {
      en: "Welcome to ide99 — your PostgreSQL IDE. Let me show you the main parts in 8 short steps. You can skip anytime.",
      ru: "Добро пожаловать в ide99 — вашу IDE для PostgreSQL. Покажу главное за 8 коротких шагов. Можно пропустить в любой момент.",
    },
  },
  {
    id: "connection-list",
    target: "[data-testid='connection-list']",
    body: {
      en: "These are your saved connections. Click one to connect, or use the + button to add a new database.",
      ru: "Здесь ваши подключения. Кликните на нужное чтобы подключиться, или нажмите + чтобы добавить новую базу.",
    },
  },
  {
    id: "schema-tree",
    target: "[data-testid='schema-tree']",
    body: {
      en: "On the left — schemas, tables, indexes, and functions. Click any object to inspect its structure.",
      ru: "Слева — схемы, таблицы, индексы и функции. Кликните по объекту чтобы увидеть его структуру.",
    },
  },
  {
    id: "editor",
    target: "[data-testid='monaco-editor']",
    body: {
      en: "Write SQL here. Cmd/Ctrl+Enter runs the query, Cmd/Ctrl+E shows EXPLAIN. Autocomplete kicks in as you type.",
      ru: "Здесь пишете SQL. Cmd/Ctrl+Enter — выполнить, Cmd/Ctrl+E — EXPLAIN. Автокомплит работает по мере ввода.",
    },
  },
  {
    id: "result-grid",
    target: "[data-testid='result-grid']",
    body: {
      en: "Query results appear here. Click a column header to sort, use the filter row below to narrow rows down.",
      ru: "Результаты запроса появляются здесь. Кликните по заголовку колонки для сортировки, фильтруйте через строку ниже.",
    },
  },
  {
    id: "bidi-panel",
    target: "[data-testid='bidi-sql-panel']",
    body: {
      en: "Generated SQL panel — shows the SQL behind your GUI actions. Edit it directly and the GUI updates to match.",
      ru: "Generated SQL — показывает SQL за вашими действиями в GUI. Редактируйте текст — GUI подстроится под изменения.",
    },
  },
  {
    id: "settings",
    target: "[data-testid='settings-button']",
    body: {
      en: "Settings — Cmd/Ctrl+, opens them. This is where you connect AI agents (Claude Code, Cursor) via MCP.",
      ru: "Настройки — Cmd/Ctrl+, открывает их. Здесь подключаете AI-агентов (Claude Code, Cursor) через MCP.",
    },
  },
  {
    id: "help",
    target: "[data-testid='help-menu']",
    body: {
      en: "Help → Restart tour to see this again. The Easy mode toggle nearby switches between Easy and Standard layouts.",
      ru: "Help → Restart tour — повторить тур. Кнопка переключения режимов рядом меняет Easy ↔ Standard layout.",
    },
  },
];
