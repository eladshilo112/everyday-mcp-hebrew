import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "./helpers.js";
import type { Options } from "../src/types.js";
const xml = readFileSync(new URL("../../evaluations.xml", import.meta.url), "utf8");
const pairs = [...xml.matchAll(/<qa_pair id="(\d{2})">([\s\S]*?)<\/qa_pair>/g)];
assert.equal(pairs.length, 10); assert.equal(new Set(pairs.map(p => p[1])).size, 10);
for (const pair of pairs) {
  test(`stable evaluation ${pair[1]}`, () => {
    const body = pair[2]!;
    const input = JSON.parse(/<input><!\[CDATA\[([\s\S]*?)\]\]><\/input>/.exec(body)![1]!) as { text: string; options?: Partial<Options> };
    const expected: unknown = JSON.parse(/<answer><!\[CDATA\[([\s\S]*?)\]\]><\/answer>/.exec(body)![1]!);
    assert.deepEqual(parse(input.text, input.options), expected);
    assert.deepEqual(parse(input.text, input.options), expected);
  });
}
