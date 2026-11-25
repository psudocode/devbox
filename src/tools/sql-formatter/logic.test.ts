import { describe, expect, it } from "vitest";
import { DIALECTS, formatSql, type SqlOptions } from "./logic";

const base: SqlOptions = {
  dialect: "postgresql",
  indent: 2,
  keywordCase: "upper",
  dataTypeCase: "preserve",
  functionCase: "preserve",
  logicalOperator: "before",
  linesBetweenQueries: 1,
  denseOperators: false,
};

function fmt(sql: string, patch: Partial<SqlOptions> = {}): string {
  const result = formatSql(sql, { ...base, ...patch });
  if (!result.ok) throw new Error(result.error);
  return result.output;
}

describe("formatSql", () => {
  it("formats a query with upper-cased keywords", () => {
    expect(fmt("select a,b from t where x=1 and y=2 order by a desc")).toBe(
      "SELECT\n  a,\n  b\nFROM\n  t\nWHERE\n  x = 1\n  AND y = 2\nORDER BY\n  a DESC\n",
    );
  });

  it("supports other keyword cases, indents and tabs", () => {
    expect(fmt("SELECT a FROM t", { keywordCase: "lower" })).toBe("select\n  a\nfrom\n  t\n");
    expect(fmt("select a from t", { keywordCase: "preserve" })).toBe("select\n  a\nfrom\n  t\n");
    expect(fmt("select a, b from t", { indent: 4 })).toBe("SELECT\n    a,\n    b\nFROM\n    t\n");
    expect(fmt("select a, b from t", { indent: "tab" })).toBe("SELECT\n\ta,\n\tb\nFROM\n\tt\n");
  });

  it("controls data type and function case", () => {
    const sql = "create table t (id int, name varchar(10)); select count(*), now() from t";
    const upper = fmt(sql, { dataTypeCase: "upper", functionCase: "upper" });
    expect(upper).toContain("id INT");
    expect(upper).toContain("VARCHAR(10)");
    expect(upper).toContain("COUNT(*)");
    expect(upper).toContain("NOW()");
    const lower = fmt(sql, { dataTypeCase: "lower", functionCase: "lower" });
    expect(lower).toContain("varchar(10)");
    expect(lower).toContain("count(*)");
  });

  it("places AND / OR before or after the line break", () => {
    expect(fmt("select 1 from t where a=1 and b=2", { logicalOperator: "before" })).toContain("a = 1\n  AND b = 2");
    expect(fmt("select 1 from t where a=1 and b=2", { logicalOperator: "after" })).toContain("a = 1 AND\n  b = 2");
  });

  it("handles dense operators and blank lines between statements", () => {
    expect(fmt("select a+b from t", { denseOperators: true })).toContain("a+b");
    expect(fmt("select a+b from t")).toContain("a + b");
    expect(fmt("select 1; select 2", { linesBetweenQueries: 2 })).toBe("SELECT\n  1;\n\n\nSELECT\n  2\n");
    expect(fmt("select 1; select 2", { linesBetweenQueries: 99 })).toBe("SELECT\n  1;\n\n\n\nSELECT\n  2\n");
  });

  it("formats subqueries, joins, CTEs and comments", () => {
    const out = fmt(
      "-- top\nwith x as (select id from u) select * from x join y on x.id=y.id /* c */ where y.n in (select n from z)",
    );
    expect(out).toContain("-- top");
    expect(out).toContain("WITH\n  x AS (\n    SELECT\n      id");
    expect(out).toContain("/* c */");
    expect(out).toContain("JOIN y ON x.id = y.id");
    expect(out).toMatch(/IN \(\n\s+SELECT/);
  });

  it("understands dialect specifics", () => {
    expect(fmt("select [a b] from t", { dialect: "transactsql" })).toContain("[a b]");
    expect(fmt("select `a b` from t", { dialect: "mysql" })).toContain("`a b`");
    expect(fmt("select a::int from t", { dialect: "postgresql" })).toContain("a::int");
    expect(fmt("select $1, :name, ? from t", { dialect: "sqlite" })).toContain("$1");
  });

  it("keeps application placeholders ($1, :name, ?, @p) in any dialect", () => {
    for (const dialect of ["sql", "sqlite", "postgresql", "mysql", "transactsql"] as const) {
      const out = fmt("select * from t where a = $1 and b = :name and c = ? and d = @p", { dialect });
      expect(out, dialect).toContain("$1");
      expect(out, dialect).toContain(":name");
      expect(out, dialect).toContain("?");
      // In PostgreSQL `@` is the absolute-value operator, not a placeholder prefix, so it is spaced like an operator.
      expect(out, dialect).toContain(dialect === "postgresql" ? "@ p" : "@p");
    }
  });

  it("is idempotent", () => {
    const once = fmt("select a,b from t where x=1 and y in (1,2,3) group by a having count(*)>1");
    expect(fmt(once)).toBe(once);
  });

  it("counts statements", () => {
    const one = formatSql("select 1", base);
    const three = formatSql("select 1; select ';'; -- ;\nselect 3;", base);
    expect(one).toMatchObject({ ok: true, statements: 1 });
    expect(three).toMatchObject({ ok: true, statements: 3 });
  });

  it("reports empty input and parse errors with a position", () => {
    expect(formatSql("  ", base)).toEqual({ ok: false, error: "Input is empty." });
    const bad = formatSql("select 'abc from t", { ...base, dialect: "sql" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.error).toMatch(/line 1 column 8/);
      expect(bad.error).toMatch(/specific dialect/);
    }
    const bad2 = formatSql("select 'abc from t", base);
    if (!bad2.ok) expect(bad2.error).not.toMatch(/specific dialect/);
  });

  it("offers every dialect and each one can format a trivial query", () => {
    expect(DIALECTS.length).toBeGreaterThanOrEqual(15);
    for (const { id } of DIALECTS) {
      const result = formatSql("select 1", { ...base, dialect: id });
      expect(result.ok, id).toBe(true);
    }
  });
});
