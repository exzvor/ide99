import { bench, describe } from "vitest";
import { analyzeScope } from "./scope";

const stress = (() => {
  const ctes = Array.from({ length: 50 }, (_, i) => `c${i} AS (SELECT ${i} AS x${i} FROM t${i})`);
  const joins = Array.from({ length: 100 }, (_, i) => `JOIN t${i} t${i}_a ON t${i}_a.id = t.id`);
  return `WITH ${ctes.join(", ")} SELECT * FROM t ${joins.join(" ")} WHERE t.id = `;
})();

describe("analyzeScope bench", () => {
  bench("8KB stress prefix", () => {
    analyzeScope(stress);
  });
});
