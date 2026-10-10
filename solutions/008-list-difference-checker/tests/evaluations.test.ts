import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { snapshot } from "./helpers.js";

// This reads only the checked-in synthetic evaluation fixture, never tool input.
const xml = readFileSync(new URL("../../evaluations.xml", import.meta.url), "utf8");
const pairs = [...xml.matchAll(/<qa_pair id="(\d{2})">([\s\S]*?)<\/qa_pair>/g)];
assert.equal(pairs.length, 10);
assert.equal(new Set(pairs.map(pair => pair[1])).size, 10);
for (const pair of pairs) {
  test(`stable evaluation ${pair[1]}`, () => {
    const body = pair[2] ?? "";
    const question = /<question>([\s\S]*?)<\/question>/.exec(body)?.[1] ?? "";
    assert.ok(question.length >= 10);
    const inputText = /<input><!\[CDATA\[([\s\S]*?)\]\]><\/input>/.exec(body)?.[1];
    const answerText = /<answer><!\[CDATA\[([\s\S]*?)\]\]><\/answer>/.exec(body)?.[1];
    assert.ok(inputText);
    assert.ok(answerText);
    const input = JSON.parse(inputText) as Record<string, unknown>;
    if (input.repeat !== undefined) {
      assert.equal(input.repeat, 300);
      assert.equal(input.left, "x");
      assert.equal(input.right, "x");
      input.left = Array(300).fill("x").join("\n");
      input.right = Array(300).fill("x").join("\n");
      delete input.repeat;
    }
    assert.deepEqual(snapshot(input), JSON.parse(answerText));
  });
}
