export const SCHEMA_VERSION = "1.0.0";

export const TABLES = {
  KEY_VALUE: "key_value",
} as const;

export const CREATE_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS ${TABLES.KEY_VALUE} (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_key_prefix ON ${TABLES.KEY_VALUE}(key);
`;
