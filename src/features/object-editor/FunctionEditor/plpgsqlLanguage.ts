// — PL/pgSQL Monarch language definition for Monaco.
//
// Registers the `plpgsql` language id once per page lifetime (idempotent
// guard so calling `registerPlpgsqlLanguage(monaco)` from multiple editor
// mounts is safe). Built for Monaco's tokens-only-grammar model (Monarch),
// not a full PL/pgSQL parser — purely cosmetic highlighting in the body
// editor. Real parsing happens server-side when DDL is applied.
//
// Highlights:
// - Control flow + embedded SQL keyword sets.
// - Type keywords as a separate token group.
// - Single-quoted strings with `''` escape and dedicated `string` state.
// - Dollar-quoted strings `$tag$...$tag$` with stateful tag matching via
// `dollarString` (Monarch captures the tag from the opening delimiter and
// re-uses it as the closing sentinel — no nesting required since Postgres
// forbids identical-tag nesting).
// - Line + block comments.

export const PLPGSQL_LANGUAGE_ID = "plpgsql";

/** Idempotent registration guard. */
let registered = false;

/**
 * Reset the idempotent guard. Test-only — normal callers must NOT use this.
 * Exported so the test suite can re-exercise registration without leaking
 * state between cases.
 */
export function __resetForTests(): void {
  registered = false;
}

/**
 * Full keyword set as enumerated in spec section 3 / plan B4.T1.
 * Kept as a single flat list because Monarch's casing-insensitive matcher
 * accepts uppercase keywords directly. Multi-word forms ("END IF",
 * "RETURN NEXT", etc.) are handled inside the tokenizer with regex
 * alternations rather than the keyword list.
 */
const KEYWORDS: readonly string[] = [
  // Control flow.
  "DECLARE",
  "BEGIN",
  "END",
  "IF",
  "THEN",
  "ELSE",
  "ELSIF",
  "ELSEIF",
  "LOOP",
  "WHILE",
  "FOR",
  "FOREACH",
  "IN",
  "REVERSE",
  "BY",
  "CASE",
  "WHEN",
  "EXIT",
  "CONTINUE",
  "RETURN",
  "RETURNS",
  "PERFORM",
  "EXECUTE",
  "USING",
  "INTO",
  "STRICT",
  "EXCEPTION",
  "RAISE",
  "NOTICE",
  "WARNING",
  "DEBUG",
  "INFO",
  "LOG",
  "GET",
  "DIAGNOSTICS",
  "STACKED",
  "CURRENT",
  "FOUND",
  "ROW_COUNT",
  "ASSERT",
  "NULL",
  // Embedded SQL.
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "FROM",
  "WHERE",
  "GROUP",
  "HAVING",
  "ORDER",
  "LIMIT",
  "OFFSET",
  "VALUES",
  "SET",
  "JOIN",
  "INNER",
  "OUTER",
  "LEFT",
  "RIGHT",
  "FULL",
  "CROSS",
  "ON",
  "AS",
  "DISTINCT",
  "ALL",
  "UNION",
  "INTERSECT",
  "EXCEPT",
  "AND",
  "OR",
  "NOT",
  "IS",
  "TRUE",
  "FALSE",
  "BETWEEN",
  "LIKE",
  "ILIKE",
  "SIMILAR",
  "WITH",
  "RECURSIVE",
  // Declaration.
  "FUNCTION",
  "PROCEDURE",
  "TRIGGER",
  "CREATE",
  "REPLACE",
  "ALTER",
  "DROP",
  "VOLATILE",
  "STABLE",
  "IMMUTABLE",
  "PARALLEL",
  "SAFE",
  "RESTRICTED",
  "UNSAFE",
  "SECURITY",
  "DEFINER",
  "INVOKER",
  "COST",
  "ROWS",
  "LANGUAGE",
  "OUT",
  "INOUT",
  "VARIADIC",
  "DEFAULT",
  // Trigger.
  "BEFORE",
  "AFTER",
  "INSTEAD",
  "OF",
  "EACH",
  "ROW",
  "STATEMENT",
  "REFERENCING",
  "OLD",
  "NEW",
  "TABLE",
  "TRANSITION",
];

const TYPE_KEYWORDS: readonly string[] = [
  "TEXT",
  "VARCHAR",
  "CHAR",
  "INTEGER",
  "INT",
  "INT2",
  "INT4",
  "INT8",
  "BIGINT",
  "SMALLINT",
  "NUMERIC",
  "DECIMAL",
  "REAL",
  "FLOAT",
  "DOUBLE",
  "BOOLEAN",
  "BOOL",
  "DATE",
  "TIME",
  "TIMESTAMP",
  "TIMESTAMPTZ",
  "INTERVAL",
  "JSON",
  "JSONB",
  "UUID",
  "BYTEA",
  "ARRAY",
  "RECORD",
  "ROW",
  "REFCURSOR",
  "CURSOR",
  "VOID",
  "ANY",
  "ANYELEMENT",
  "ANYARRAY",
];

/** Public for tests. */
export const PLPGSQL_KEYWORDS: readonly string[] = KEYWORDS;
export const PLPGSQL_TYPE_KEYWORDS: readonly string[] = TYPE_KEYWORDS;

/**
 * Build the Monarch language descriptor. Pure factory so tests can inspect
 * the structure without needing a real Monaco runtime.
 */
export function buildPlpgsqlMonarchLanguage(): {
  defaultToken: string;
  ignoreCase: boolean;
  keywords: string[];
  typeKeywords: string[];
  operators: string[];
  symbols: RegExp;
  tokenizer: {
    root: unknown[];
    string: unknown[];
    dollarString: unknown[];
    comment: unknown[];
  };
} {
  return {
    defaultToken: "",
    ignoreCase: true,
    keywords: [...KEYWORDS],
    typeKeywords: [...TYPE_KEYWORDS],
    operators: [
      "=",
      ">",
      "<",
      "!",
      "~",
      ":=",
      "<>",
      "<=",
      ">=",
      "+",
      "-",
      "*",
      "/",
      "%",
      "||",
      "::",
    ],
    symbols: /[=><!~?:&|+\-*/^%]+/,
    tokenizer: {
      root: [
        // Multi-word constructs surfaced as single keyword tokens.
        [/\bEND\s+IF\b/i, "keyword"],
        [/\bEND\s+LOOP\b/i, "keyword"],
        [/\bEND\s+CASE\b/i, "keyword"],
        [/\bRETURN\s+NEXT\b/i, "keyword"],
        [/\bRETURN\s+QUERY\b/i, "keyword"],
        // Trigger pseudo-records — surfaced explicitly because plain `NEW`/
        // `OLD` are also in the keyword list; the dotted form is what users
        // recognise visually.
        [/\b(NEW|OLD)\.[A-Za-z_][A-Za-z0-9_]*/, "variable.predefined"],
        // Identifiers / keywords / types — Monarch's `cases` table dispatches
        // on the keyword list so we don't have to enumerate per-word rules.
        [
          /[A-Za-z_][A-Za-z0-9_]*/,
          {
            cases: {
              "@typeKeywords": "type",
              "@keywords": "keyword",
              "@default": "identifier",
            },
          },
        ],
        // Numbers (integer + decimal + exponent).
        [/\d+\.\d+([eE][-+]?\d+)?/, "number.float"],
        [/\d+/, "number"],
        // Strings — single-quoted enters dedicated `string` state; SQL `''`
        // escape is handled inside that state.
        [/'/, { token: "string.quote", next: "@string" }],
        // Dollar-quoted body: capture tag (possibly empty) and re-use it as
        // the closing sentinel via `@dollarString.$1`.
        [/\$([A-Za-z_][A-Za-z0-9_]*)?\$/, { token: "string.quote", next: "@dollarString.$1" }],
        // Comments.
        [/--.*$/, "comment"],
        [/\/\*/, { token: "comment", next: "@comment" }],
        // Operators.
        [/@symbols/, { cases: { "@operators": "operator", "@default": "" } }],
        // Punctuation / whitespace.
        [/[;,.()\[\]{}]/, "delimiter"],
        [/\s+/, "white"],
      ],
      string: [
        [/[^']+/, "string"],
        // Doubled `''` is the SQL escape — keep state.
        [/''/, "string"],
        [/'/, { token: "string.quote", next: "@pop" }],
      ],
      dollarString: [
        // Closing sentinel — must match the original tag captured in `$S2`.
        [
          /\$([A-Za-z_][A-Za-z0-9_]*)?\$/,
          {
            cases: {
              "$1==$S2": { token: "string.quote", next: "@pop" },
              "@default": "string",
            },
          },
        ],
        [/[^$]+/, "string"],
        [/\$/, "string"],
      ],
      comment: [
        [/[^/*]+/, "comment"],
        [/\*\//, { token: "comment", next: "@pop" }],
        [/[/*]/, "comment"],
      ],
    },
  };
}

/**
 * Build the language configuration (brackets, indent rules, comments).
 * Pure factory — kept separate from Monarch tokens so tests can introspect
 * each independently and the registration call stays declarative.
 */
export function buildPlpgsqlLanguageConfiguration(monacoIndentAction: {
  Indent: number;
  None: number;
}): {
  comments: { lineComment: string; blockComment: [string, string] };
  brackets: Array<[string, string]>;
  autoClosingPairs: Array<{ open: string; close: string }>;
  surroundingPairs: Array<{ open: string; close: string }>;
  onEnterRules: Array<{ beforeText: RegExp; action: { indentAction: number } }>;
} {
  return {
    comments: {
      lineComment: "--",
      blockComment: ["/*", "*/"],
    },
    brackets: [
      ["(", ")"],
      ["[", "]"],
      ["{", "}"],
    ],
    autoClosingPairs: [
      { open: "(", close: ")" },
      { open: "[", close: "]" },
      { open: "{", close: "}" },
      { open: "'", close: "'" },
    ],
    surroundingPairs: [
      { open: "(", close: ")" },
      { open: "[", close: "]" },
      { open: "{", close: "}" },
      { open: "'", close: "'" },
    ],
    onEnterRules: [
      {
        // Indent after BEGIN / IF / LOOP / THEN / ELSE / DECLARE.
        beforeText: /\b(BEGIN|DECLARE|LOOP|THEN|ELSE)\s*$/i,
        action: { indentAction: monacoIndentAction.Indent },
      },
    ],
  };
}

/**
 * Minimal monaco-editor surface we depend on. Kept narrow so the language
 * module doesn't pull in monaco's full type baggage at compile time and so
 * tests can pass a stub.
 */
export interface MonacoLike {
  languages: {
    register: (descriptor: { id: string; extensions?: string[]; aliases?: string[] }) => void;
    setLanguageConfiguration: (id: string, config: unknown) => void;
    setMonarchTokensProvider: (id: string, provider: unknown) => void;
    IndentAction: { Indent: number; None: number };
  };
}

/**
 * Idempotent registration. Subsequent calls are no-ops — useful when the
 * BodyEditor mounts multiple times across tabs sharing the same monaco
 * instance.
 */
export function registerPlpgsqlLanguage(monaco: MonacoLike): void {
  if (registered) return;
  registered = true;

  monaco.languages.register({
    id: PLPGSQL_LANGUAGE_ID,
    extensions: [".plpgsql"],
    aliases: ["PL/pgSQL", "plpgsql"],
  });

  monaco.languages.setLanguageConfiguration(    PLPGSQL_LANGUAGE_ID,
    buildPlpgsqlLanguageConfiguration(monaco.languages.IndentAction),
);

  monaco.languages.setMonarchTokensProvider(PLPGSQL_LANGUAGE_ID, buildPlpgsqlMonarchLanguage());
}
