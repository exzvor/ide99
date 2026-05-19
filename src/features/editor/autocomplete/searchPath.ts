import { type Token, tokenize } from "./scope";

/**
 * Recognises `SET [LOCAL|SESSION] search_path { TO | = } a, b, …` and returns
 * the schema list. Returns `null` if no such statement is present, or if the
 * occurrence sits inside a string / dollar-quoted body / comment / CTE name
 * (the lexer drops those).
 *
 * When the SQL contains multiple `SET search_path …` statements, the last one
 * wins — that mirrors PG's effective state at end-of-batch.
 */
export function parseSearchPathFromSql(sql: string): string[] | null {
  const tokens = tokenize(sql).filter(
    (t) => t.kind !== "ws" && t.kind !== "comment" && t.kind !== "eof",
  );
  let last: string[] | null = null;

  for (let i = 0; i < tokens.length; i++) {
    if (!isKeyword(tokens[i], "set")) continue;
    let j = i + 1;
    if (isKeyword(tokens[j], "local") || isKeyword(tokens[j], "session")) {
      j++;
    }
    if (!isIdent(tokens[j], "search_path")) continue;
    j++;
    // expect TO or =
    if (
      !isKeyword(tokens[j], "to") &&
      !(tokens[j]?.kind === "operator" && tokens[j]?.text === "=")
    ) {
      continue;
    }
    j++;
    const list: string[] = [];
    while (j < tokens.length) {
      const t = tokens[j];
      if (!t) break;
      if (t.kind === "ident") {
        list.push(t.text);
      } else if (t.kind === "qident") {
        list.push(t.text.slice(1, -1).replace(/""/g, '"'));
      } else if (t.kind === "punct" && t.text === ",") {
        j++;
        continue;
      } else if (t.kind === "punct" && t.text === ";") {
        break;
      } else {
        break;
      }
      j++;
    }
    if (list.length > 0) last = list;
  }

  return last;
}

function isKeyword(t: Token | undefined, lower: string): boolean {
  return !!t && t.kind === "keyword" && t.text.toLowerCase() === lower;
}

function isIdent(t: Token | undefined, lower: string): boolean {
  return !!t && (t.kind === "ident" || t.kind === "qident") && t.text.toLowerCase() === lower;
}
