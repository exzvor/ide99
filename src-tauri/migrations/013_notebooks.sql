-- Sprint 34 — Notebook Mode auto-save persistence.
--
-- Notebook = ordered list of cells (SQL / Markdown / Result). Каждый
-- открытый notebook auto-сохраняется здесь (debounced); пользователь
-- также может явно сохранить notebook в `.ide99nb` JSON-файл (на диск
-- — не в эту таблицу).
--
-- `cells_json` — сериализованный массив cells (см. `notebook::types::Cell`).
-- Полный snapshot хранится единым blob'ом потому что:
--   • notebook сравнительно небольшой (десятки cells);
--   • операции frontend всегда над всем notebook (reorder, run-all);
--   • per-cell row требует JOIN+ORDER BY на каждом hydrate, что хуже
--     для нашей характерной нагрузки.
--
-- `file_path` — абсолютный путь до .ide99nb если notebook был сохранён;
-- NULL для untitled notebooks. При reload именно по `id` восстанавливается
-- состояние, file_path — лишь подсказка для UI «Save» vs «Save As».
--
-- `connection_id` — soft-link на connection (последний выбранный для run-cell);
-- ON DELETE SET NULL чтобы удаление connection не дропало notebook.
CREATE TABLE IF NOT EXISTS notebooks (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    cells_json      TEXT NOT NULL DEFAULT '[]',
    connection_id   TEXT,
    file_path       TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_notebooks_updated_at ON notebooks(updated_at DESC);
