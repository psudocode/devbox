import { describe, expect, it } from "vitest";
import { evaluateJsonPath, JsonPathError } from "./jsonpath";

const store = {
  store: {
    book: [
      { category: "reference", author: "Nigel Rees", title: "Sayings of the Century", price: 8.95 },
      { category: "fiction", author: "Evelyn Waugh", title: "Sword of Honour", price: 12.99 },
      { category: "fiction", author: "Herman Melville", title: "Moby Dick", isbn: "0-553-21311-3", price: 8.99 },
      { category: "fiction", author: "J. R. R. Tolkien", title: "The Lord of the Rings", isbn: "0-395-19395-8", price: 22.99 },
    ],
    bicycle: { color: "red", price: 399 },
  },
  "o": { "j j": { "k.k": 3 } },
};

const values = (data: unknown, query: string) => evaluateJsonPath(data, query).map((n) => n.value);
const paths = (data: unknown, query: string) => evaluateJsonPath(data, query).map((n) => n.path);

describe("selectors", () => {
  it("root, names and indexes", () => {
    expect(values(store, "$")).toEqual([store]);
    expect(values(store, "$.store.bicycle.color")).toEqual(["red"]);
    expect(values(store, "$['store']['bicycle']['price']")).toEqual([399]);
    expect(values(store, "$.store.book[0].title")).toEqual(["Sayings of the Century"]);
    expect(values(store, "$.store.book[-1].title")).toEqual(["The Lord of the Rings"]);
    expect(values(store, "$.store.book[99]")).toEqual([]);
    expect(values(store, "$.nope.deeper")).toEqual([]);
  });

  it("quoted names with special characters", () => {
    expect(values(store, "$.o['j j']['k.k']")).toEqual([3]);
    expect(values(store, '$.o["j j"]["k.k"]')).toEqual([3]);
    expect(values({ "it's": 1 }, "$['it\\'s']")).toEqual([1]);
  });

  it("wildcards", () => {
    expect(values(store, "$.store.bicycle.*")).toEqual(["red", 399]);
    expect(values(store, "$.store.book[*].price")).toEqual([8.95, 12.99, 8.99, 22.99]);
    expect(values([1, [2, 3]], "$[*]")).toEqual([1, [2, 3]]);
  });

  it("unions", () => {
    expect(values(store, "$.store.book[0,2].title")).toEqual(["Sayings of the Century", "Moby Dick"]);
    expect(values({ a: 1, b: 2, c: 3 }, "$['a','c']")).toEqual([1, 3]);
  });

  it("slices", () => {
    const a = ["a", "b", "c", "d", "e", "f", "g"];
    expect(values(a, "$[1:3]")).toEqual(["b", "c"]);
    expect(values(a, "$[5:]")).toEqual(["f", "g"]);
    expect(values(a, "$[1:5:2]")).toEqual(["b", "d"]);
    expect(values(a, "$[5:1:-2]")).toEqual(["f", "d"]);
    expect(values(a, "$[::-1]")).toEqual(["g", "f", "e", "d", "c", "b", "a"]);
    expect(values(a, "$[-2:]")).toEqual(["f", "g"]);
    expect(values(a, "$[::0]")).toEqual([]);
    expect(values(a, "$[:2]")).toEqual(["a", "b"]);
  });

  it("descendants", () => {
    expect(values(store, "$..author")).toEqual(["Nigel Rees", "Evelyn Waugh", "Herman Melville", "J. R. R. Tolkien"]);
    expect(values(store, "$.store..price")).toEqual([8.95, 12.99, 8.99, 22.99, 399]);
    expect(values(store, "$..book[2].title")).toEqual(["Moby Dick"]);
    expect(values({ a: [{ b: 1 }, { b: 2 }] }, "$..[0]")).toEqual([{ b: 1 }]);
    expect(values({ a: { b: 1 } }, "$..*")).toEqual([{ b: 1 }, 1]);
  });

  it("reports normalized paths", () => {
    expect(paths(store, "$.store.book[?@.price > 10].title")).toEqual([
      "$['store']['book'][1]['title']",
      "$['store']['book'][3]['title']",
    ]);
    expect(paths({ "a'b": [1] }, "$['a\\'b'][0]")).toEqual(["$['a\\'b'][0]"]);
  });
});

describe("filters", () => {
  it("compares numbers and strings", () => {
    expect(values(store, "$.store.book[?@.price < 10].title")).toEqual(["Sayings of the Century", "Moby Dick"]);
    expect(values(store, "$.store.book[?(@.price >= 12.99)].author")).toEqual(["Evelyn Waugh", "J. R. R. Tolkien"]);
    expect(values(store, "$.store.book[?@.category == 'reference'].title")).toEqual(["Sayings of the Century"]);
    expect(values(store, '$.store.book[?@.category != "fiction"].title')).toEqual(["Sayings of the Century"]);
  });

  it("tests for existence", () => {
    expect(values(store, "$.store.book[?@.isbn].title")).toEqual(["Moby Dick", "The Lord of the Rings"]);
    expect(values(store, "$.store.book[?!@.isbn].title")).toEqual(["Sayings of the Century", "Sword of Honour"]);
  });

  it("combines with && || ! and parentheses", () => {
    expect(values(store, "$.store.book[?@.price < 10 && @.category == 'fiction'].title")).toEqual(["Moby Dick"]);
    expect(values(store, "$.store.book[?@.price > 20 || @.category == 'reference'].title")).toEqual([
      "Sayings of the Century",
      "The Lord of the Rings",
    ]);
    expect(values(store, "$.store.book[?!(@.price < 20)].title")).toEqual(["The Lord of the Rings"]);
    expect(values(store, "$.store.book[?(@.price < 9 || @.price > 20) && @.isbn].title")).toEqual([
      "Moby Dick",
      "The Lord of the Rings",
    ]);
  });

  it("filters objects' members as well as array items", () => {
    expect(values({ a: { v: 1 }, b: { v: 5 } }, "$[?@.v > 2]")).toEqual([{ v: 5 }]);
  });

  it("compares against the root with $ and handles null / booleans", () => {
    expect(values({ limit: 9, items: [{ p: 5 }, { p: 12 }] }, "$.items[?@.p > $.limit]")).toEqual([{ p: 12 }]);
    expect(values([{ a: null }, { a: false }, {}], "$[?@.a == null]")).toEqual([{ a: null }]);
    expect(values([{ a: true }, { a: false }], "$[?@.a == true]")).toEqual([{ a: true }]);
  });

  it("does not order values of different types", () => {
    expect(values([{ a: "x" }, { a: 5 }], "$[?@.a < 10]")).toEqual([{ a: 5 }]);
    expect(values([{ a: 1 }], "$[?@.missing == @.alsoMissing]")).toEqual([{ a: 1 }]);
  });

  it("supports nested queries in tests", () => {
    expect(values([{ t: [1, 2] }, { t: [] }], "$[?@.t[0]]")).toEqual([{ t: [1, 2] }]);
    expect(values([{ t: [1, 5] }, { t: [1, 2] }], "$[?@.t[?@ > 3]]")).toEqual([{ t: [1, 5] }]);
  });

  it("supports functions", () => {
    expect(values(store, "$.store.book[?length(@.title) > 20].title")).toEqual([
      "Sayings of the Century",
      "The Lord of the Rings",
    ]);
    expect(values({ a: [1, 2, 3], b: [1] }, "$[?count(@[*]) > 1]")).toEqual([[1, 2, 3]]);
    expect(values(store, "$.store.book[?match(@.author, 'J\\\\. R\\\\. R\\\\. .*')].title")).toEqual(["The Lord of the Rings"]);
    expect(values(store, "$.store.book[?search(@.title, 'Rings|Dick')].title")).toEqual(["Moby Dick", "The Lord of the Rings"]);
    expect(values({ a: [{ k: 1 }] }, "$[?value(@[0].k) == 1]")).toEqual([[{ k: 1 }]]);
  });
});

describe("errors", () => {
  const message = (q: string) => {
    try {
      evaluateJsonPath({}, q);
    } catch (err) {
      if (err instanceof JsonPathError) return err.message;
      throw err;
    }
    return null;
  };

  it("requires $ and rejects trailing junk", () => {
    expect(message("store.book")).toMatch(/must start with "\$"/);
    expect(message("$.store )")).toMatch(/Unexpected/);
    expect(message("")).toMatch(/must start with/);
  });

  it("reports malformed selectors with a position", () => {
    expect(message("$[")).toMatch(/Expected a selector/);
    expect(message("$[1")).toMatch(/Expected "\]"/);
    expect(message("$['a")).toMatch(/Unterminated string/);
    expect(message("$.")).toMatch(/Expected a member name/);
    expect(message("$[-0]")).toMatch(/-0/);
    expect(message("$[?@.a >]")).toMatch(/Unexpected/);
  });

  it("rejects non-singular queries in comparisons and unknown functions", () => {
    expect(message("$[?@.* == 1]")).toMatch(/singular/);
    expect(message("$[?nope(@)]")).toMatch(/Unknown function/);
    expect(message("$[?length(@, @)]")).toMatch(/takes 1 argument/);
    expect(message("$[?1]")).toMatch(/literal/);
  });

  it("limits the number of results", () => {
    const big = Array.from({ length: 10_001 }, (_, i) => i);
    expect(() => evaluateJsonPath(big, "$[*]")).toThrow(/only 10000 can be shown/);
  });
});
