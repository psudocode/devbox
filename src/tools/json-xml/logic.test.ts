// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { jsonToXml, xmlToJson } from "./logic";

const toXml = { rootName: "root", indent: 2 as const, declaration: false };
const toJson = { indent: null, typed: false };

describe("jsonToXml", () => {
  it("uses a single top-level key as the root element", () => {
    expect(jsonToXml('{"user":{"name":"Ann","age":30}}', toXml)).toEqual({
      ok: true,
      output: "<user>\n  <name>Ann</name>\n  <age>30</age>\n</user>",
    });
  });

  it("wraps several keys, scalars and arrays in the root name", () => {
    expect(jsonToXml('{"a":1,"b":2}', { ...toXml, rootName: "data", indent: null })).toEqual({
      ok: true,
      output: "<data><a>1</a><b>2</b></data>",
    });
    expect(jsonToXml("[1,2]", { ...toXml, indent: null })).toEqual({
      ok: true,
      output: "<root><item>1</item><item>2</item></root>",
    });
    expect(jsonToXml('"hi"', { ...toXml, indent: null })).toEqual({ ok: true, output: "<root>hi</root>" });
  });

  it("repeats elements for arrays", () => {
    expect(jsonToXml('{"list":{"i":[1,2,3]}}', { ...toXml, indent: null })).toEqual({
      ok: true,
      output: "<list><i>1</i><i>2</i><i>3</i></list>",
    });
  });

  it("writes attributes, text and empty elements", () => {
    const json = '{"a":{"@id":"1","@ok":true,"#text":"hi","b":null}}';
    expect(jsonToXml(json, { ...toXml, indent: null })).toEqual({
      ok: true,
      output: '<a id="1" ok="true">hi<b/></a>',
    });
    expect(jsonToXml('{"a":{"@id":"1"}}', toXml)).toEqual({ ok: true, output: '<a id="1"/>' });
    expect(jsonToXml('{"a":{"#text":"x","@k":"v"}}', toXml)).toEqual({ ok: true, output: '<a k="v">x</a>' });
  });

  it("escapes special characters in text and attributes", () => {
    expect(jsonToXml('{"a":{"@t":"say \\"x\\" & <y>","#text":"1 < 2 && 3 > 2"}}', toXml)).toEqual({
      ok: true,
      output: '<a t="say &quot;x&quot; &amp; &lt;y&gt;">1 &lt; 2 &amp;&amp; 3 &gt; 2</a>',
    });
  });

  it("supports tab indent and the XML declaration", () => {
    expect(jsonToXml('{"a":{"b":1}}', { rootName: "root", indent: "tab", declaration: true })).toEqual({
      ok: true,
      output: '<?xml version="1.0" encoding="UTF-8"?>\n<a>\n\t<b>1</b>\n</a>',
    });
  });

  it("rejects invalid element and attribute names", () => {
    const element = jsonToXml('{"a":{"not valid":1}}', toXml);
    expect(element).toEqual({ ok: false, error: '"not valid" is not a valid XML element name.' });
    const attr = jsonToXml('{"a":{"@1x":1}}', toXml);
    expect(attr).toEqual({ ok: false, error: '"1x" is not a valid XML attribute name.' });
    expect(jsonToXml('{"a":{"@o":{"x":1}}}', toXml).ok).toBe(false);
  });

  it("rejects control characters and invalid JSON", () => {
    expect(jsonToXml('{"a":"x\\u0001"}', toXml).ok).toBe(false);
    const bad = jsonToXml("{nope", toXml);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/^Invalid JSON/);
  });

  it("allows namespaces and unicode names", () => {
    expect(jsonToXml('{"ns:tag":{"é":1}}', { ...toXml, indent: null })).toEqual({
      ok: true,
      output: "<ns:tag><é>1</é></ns:tag>",
    });
  });
});

describe("xmlToJson", () => {
  it("converts elements, attributes and text", () => {
    const xml = '<user id="7"><name>Ann</name><note lang="en">hi</note><empty/></user>';
    expect(xmlToJson(xml, toJson)).toEqual({
      ok: true,
      output: '{"user":{"@id":"7","name":"Ann","note":{"@lang":"en","#text":"hi"},"empty":null}}',
    });
  });

  it("turns repeated elements into arrays", () => {
    expect(xmlToJson("<l><i>1</i><i>2</i><i>3</i></l>", toJson)).toEqual({
      ok: true,
      output: '{"l":{"i":["1","2","3"]}}',
    });
  });

  it("detects types when asked", () => {
    const xml = '<a n="5"><x>1.5</x><y>true</y><z>007</z><w>text</w></a>';
    expect(xmlToJson(xml, { indent: null, typed: true })).toEqual({
      ok: true,
      output: '{"a":{"@n":5,"x":1.5,"y":true,"z":"007","w":"text"}}',
    });
  });

  it("handles CDATA, entities, comments and the XML declaration", () => {
    const xml = '<?xml version="1.0"?><!-- c --><a><![CDATA[1 < 2]]> &amp; &lt;b&gt;</a>';
    expect(xmlToJson(xml, toJson)).toEqual({ ok: true, output: '{"a":"1 < 2 & <b>"}' });
  });

  it("keeps mixed content text under #text", () => {
    expect(xmlToJson("<p>Hello <b>world</b>!</p>", toJson)).toEqual({
      ok: true,
      output: '{"p":{"b":"world","#text":"Hello !"}}',
    });
  });

  it("keeps namespace prefixes", () => {
    expect(xmlToJson('<ns:a xmlns:ns="urn:x"><ns:b>1</ns:b></ns:a>', toJson)).toEqual({
      ok: true,
      output: '{"ns:a":{"@xmlns:ns":"urn:x","ns:b":"1"}}',
    });
  });

  it("pretty prints with the chosen indent", () => {
    expect(xmlToJson("<a><b>1</b></a>", { indent: 2, typed: false })).toEqual({
      ok: true,
      output: '{\n  "a": {\n    "b": "1"\n  }\n}',
    });
  });

  it("reports malformed and empty input", () => {
    const bad = xmlToJson("<a><b></a>", toJson);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/^Invalid XML/);
    expect(xmlToJson("not xml at all", toJson).ok).toBe(false);
    expect(xmlToJson("   ", toJson)).toEqual({ ok: false, error: "Input is empty." });
  });

  it("round-trips typical data", () => {
    const original = { order: { "@id": "9", item: [{ sku: "a", qty: "1" }, { sku: "b", qty: "2" }], note: null } };
    const xml = jsonToXml(JSON.stringify(original), toXml);
    expect(xml.ok).toBe(true);
    if (xml.ok) {
      const back = xmlToJson(xml.output, toJson);
      expect(back.ok && JSON.parse(back.output)).toEqual(original);
    }
  });
});
