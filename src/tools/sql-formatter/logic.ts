import { ConfigError, format, type ParamTypes, type SqlLanguage } from "sql-formatter";

export const DIALECTS = [
  { id: "sql", label: "Standard SQL" },
  { id: "postgresql", label: "PostgreSQL" },
  { id: "mysql", label: "MySQL" },
  { id: "mariadb", label: "MariaDB" },
  { id: "sqlite", label: "SQLite" },
  { id: "transactsql", label: "SQL Server (T-SQL)" },
  { id: "plsql", label: "Oracle (PL/SQL)" },
  { id: "bigquery", label: "BigQuery" },
  { id: "snowflake", label: "Snowflake" },
  { id: "redshift", label: "Redshift" },
  { id: "duckdb", label: "DuckDB" },
  { id: "clickhouse", label: "ClickHouse" },
  { id: "db2", label: "Db2" },
  { id: "spark", label: "Spark" },
  { id: "hive", label: "Hive" },
  { id: "trino", label: "Trino" },
  { id: "tidb", label: "TiDB" },
  { id: "singlestoredb", label: "SingleStoreDB" },
  { id: "n1ql", label: "Couchbase N1QL" },
] as const satisfies readonly { id: SqlLanguage; label: string }[];

export type Dialect = (typeof DIALECTS)[number]["id"];

export type Case = "upper" | "lower" | "preserve";

export interface SqlOptions {
  dialect: Dialect;
  indent: 2 | 4 | "tab";
  keywordCase: Case;
  /** Case of data types such as VARCHAR / INT. */
  dataTypeCase: Case;
  /** Case of function names such as COUNT / now. */
  functionCase: Case;
  /** Put AND / OR at the start (before) or end (after) of a line. */
  logicalOperator: "before" | "after";
  /** Blank lines between statements (0-3). */
  linesBetweenQueries: number;
  /** Write `a+b` instead of `a + b`. */
  denseOperators: boolean;
}

export type SqlResult = { ok: true; output: string; statements: number } | { ok: false; error: string };

/** Format SQL for the chosen dialect. */
export function formatSql(sql: string, options: SqlOptions): SqlResult {
  if (sql.trim() === "") return { ok: false, error: "Input is empty." };
  const config = {
    language: options.dialect,
    tabWidth: options.indent === "tab" ? 2 : options.indent,
    useTabs: options.indent === "tab",
    keywordCase: options.keywordCase,
    dataTypeCase: options.dataTypeCase,
    functionCase: options.functionCase,
    logicalOperatorNewline: options.logicalOperator,
    linesBetweenQueries: Math.min(Math.max(Math.trunc(options.linesBetweenQueries), 0), 3),
    denseOperators: options.denseOperators,
  } as const;

  try {
    let output: string;
    try {
      output = format(sql, config);
    } catch (first) {
      // Pasted application SQL often has placeholders the dialect does not know by default ($1, :name, ?, @p).
      // Retry accepting all common styles; if that fails too, report the original error.
      try {
        output = format(sql, { ...config, paramTypes: ANY_PARAMS });
      } catch {
        throw first;
      }
    }
    return { ok: true, output: `${output}\n`, statements: countStatements(output) };
  } catch (err) {
    return { ok: false, error: describeError(err, options.dialect) };
  }
}

const ANY_PARAMS = { positional: true, numbered: ["?", "$", ":"], named: [":", "@", "$"] } as const satisfies ParamTypes;

/** Number of non-empty statements: split on top-level `;` using the already formatted text. */
function countStatements(formatted: string): number {
  const stripped = formatted
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""')
    .replace(/--[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  return stripped.split(";").filter((part) => part.trim() !== "").length;
}

function describeError(err: unknown, dialect: Dialect): string {
  if (err instanceof ConfigError) return `Invalid option: ${err.message}`;
  const message = err instanceof Error ? err.message : String(err);
  // sql-formatter appends advice about picking a dialect; keep the position line and say it briefly.
  const headline = message.split("\n")[0].replace(/^Parse error:\s*/, "");
  const hint = dialect === "sql" ? " Try choosing a specific dialect." : "";
  return `${headline}${hint}`;
}
