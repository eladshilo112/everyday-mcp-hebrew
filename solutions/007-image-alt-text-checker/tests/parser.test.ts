import assert from "node:assert/strict";
import test from "node:test";
import { classifyAlt, parseImages } from "../src/parser.js";

test("Markdown alt, whitespace, escaped brackets, balanced destinations and lines", () => {
  const result = parseImages('![](a.png)\r\n![Sunset over the mountains](a.png)\r\n![  ](b)\n![photo123](b(x).png)\n![A \\] bracket](x)', "readme.md");
  assert.equal(result.images, 5);
  assert.deepEqual(result.findings.map(f => [f.line, f.issue_type]), [[1, "missing"], [3, "empty"], [4, "generic"]]);
});
test("HTML attribute parser handles quotes, uppercase, multiline, bare alt and decoys", () => {
  const source = '<img src="a">\n<IMG ALT="" src="a">\n<img alt=PHOTO123>\n<img title="alt=photo" data-alt="good">\n<img title="a > b"\nalt="נהר ליד העיר">\n<img alt>\n<img alt="&#32;&nbsp;">';
  const result = parseImages(source, "page.html");
  assert.equal(result.images, 7);
  assert.deepEqual(result.findings.map(f => [f.line, f.issue_type]), [[1, "missing"], [2, "empty"], [3, "generic"], [4, "missing"], [7, "empty"], [8, "empty"]]);
});
test("generic detection is exact, case insensitive and supports numeric suffixes", () => {
  for (const value of ["image", "Image", "IMAGE", "photo", "picture", "img123", "photo123", "  PHOTO123  ", "&#105;mage"]) assert.equal(classifyAlt(value), "generic");
  for (const value of ["Image of a river", "Photography workshop", "תמונה של הר", "image-name"]) assert.equal(classifyAlt(value), null);
  assert.equal(classifyAlt("\t\n\u00a0"), "empty");
});
test("malformed HTML is deterministic and does not crash", () => {
  for (const source of ['<img src="x"', '<img alt="', '<img src=x <img alt="image">', '<img alt="&#999999999;">']) {
    assert.deepEqual(parseImages(source, "a.html"), parseImages(source, "a.html"));
  }
  assert.equal(parseImages('<img src="x"', "a.html").findings[0]?.issue_type, "missing");
  assert.equal(parseImages('<img alt="', "a.html").findings[0]?.issue_type, "empty");
});
test("skip comments, code fences, inline code, scripts, styles and escaped images", () => {
  const source = '<!-- <img> -->\n```md\n![](x)\n```\n`![](x)`\n<script>"<img>"</script>\n<style>/* <img> */</style>\n\\![](x)\n![](real)';
  assert.deepEqual(parseImages(source, "a.mdx").findings.map(f => f.line), [9]);
  assert.equal(parseImages('![](plain text)', "a.html").images, 0);
});
test("same-line images retain document order and bounded snippets", () => {
  const output = parseImages('<img><img alt="image">![](x)' + '<img src="' + 'x'.repeat(1000) + '">', "a.md");
  assert.deepEqual(output.findings.map(f => f.issue_type), ["missing", "generic", "missing", "missing"]);
  assert.ok(output.findings.every(f => f.snippet.length <= 240));
});
