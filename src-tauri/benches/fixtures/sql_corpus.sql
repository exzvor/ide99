-- Sprint 37 — autocomplete bench corpus.
-- 10 queries representative of what users actually type:
--   - simple SELECT with ORDER BY / LIMIT
--   - 2-table JOIN with alias
--   - 3-table JOIN with alias + qualified columns
--   - non-recursive CTE used in a JOIN
--   - WITH RECURSIVE traversal
--   - window function over PARTITION BY
--   - subquery in WHERE
--   - JSONB path expression
--   - array contains predicate
--   - Cyrillic identifier query (i18n smoke)
--
-- Statements MUST be `;`-terminated. The bench loader splits on `;` at the end
-- of a line, ignores blank/comment lines, and feeds each query through the
-- parser. No external IO at bench time — entire file is `include_str!`-baked
-- into the bench binary.

SELECT id, email, created_at FROM public.users WHERE id > 10 AND email LIKE 'a%' ORDER BY id DESC LIMIT 100;

SELECT u.id, u.email, o.total FROM users u JOIN orders o ON o.user_id = u.id WHERE o.status = 'open' LIMIT 50;

SELECT u.email, o.id, oi.product_id, p.name FROM users u JOIN orders o ON o.user_id = u.id JOIN order_items oi ON oi.order_id = o.id JOIN products p ON p.id = oi.product_id WHERE o.created_at >= '2026-01-01';

WITH recent AS (SELECT id, type, ts FROM events WHERE ts > now() - interval '1 day') SELECT type, count(*) FROM recent GROUP BY type ORDER BY count DESC LIMIT 20;

WITH RECURSIVE org AS (SELECT id, parent_id, name FROM departments WHERE parent_id IS NULL UNION ALL SELECT d.id, d.parent_id, d.name FROM departments d JOIN org ON d.parent_id = org.id) SELECT * FROM org;

SELECT user_id, amount, row_number() OVER (PARTITION BY user_id ORDER BY paid_at DESC) AS rn FROM payments WHERE paid_at >= '2026-01-01';

SELECT id, email FROM users WHERE id IN (SELECT user_id FROM orders WHERE status = 'pending') ORDER BY email;

SELECT id, payload->'meta'->>'source' AS source, payload #>> '{user,country}' AS country FROM events WHERE payload @> '{"type":"signup"}' LIMIT 200;

SELECT id, tags FROM products WHERE tags @> ARRAY['featured', 'new'] AND id = ANY(ARRAY[1,2,3,4,5]) LIMIT 100;

SELECT "Идентификатор", "Электронная почта" FROM "Заказы" WHERE "Статус" = 'pending' AND "ДатаСоздания" >= '2026-01-01' ORDER BY "Идентификатор" DESC LIMIT 50;
