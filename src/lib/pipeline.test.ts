import { describe, expect, it } from "vitest";
import type { ToolMeta } from "../tools/types";
import { createPipeline, pipelineTargets } from "./pipeline";

const tool = (id: string, name: string, acceptsText?: boolean): ToolMeta => ({
  id,
  name,
  description: "",
  category: "Data & format",
  acceptsText,
});

describe("pipelineTargets", () => {
  const tools = [tool("b64", "Base64", true), tool("json", "JSON", true), tool("clock", "Clock"), tool("url", "URL", true)];

  it("lists text-accepting tools except the source, sorted by name", () => {
    expect(pipelineTargets(tools, "json").map((t) => t.id)).toEqual(["b64", "url"]);
  });

  it("is empty when nothing accepts text", () => {
    expect(pipelineTargets([tool("clock", "Clock")], "x")).toEqual([]);
  });

  it("does not mutate the input list", () => {
    const copy = [...tools];
    pipelineTargets(tools, "json");
    expect(tools).toEqual(copy);
  });
});

describe("createPipeline", () => {
  it("hands a value to its target exactly once", () => {
    const pipeline = createPipeline();
    pipeline.send("b64", "hello");
    expect(pipeline.take("b64")).toBe("hello");
    expect(pipeline.take("b64")).toBeUndefined();
  });

  it("keeps the value for the right tool when someone else asks", () => {
    const pipeline = createPipeline();
    pipeline.send("b64", "hello");
    expect(pipeline.take("json")).toBeUndefined();
    expect(pipeline.take("b64")).toBe("hello");
  });

  it("the latest send wins, and empty strings are valid values", () => {
    const pipeline = createPipeline();
    pipeline.send("a", "one");
    pipeline.send("b", "");
    expect(pipeline.take("a")).toBeUndefined();
    expect(pipeline.take("b")).toBe("");
  });
});
