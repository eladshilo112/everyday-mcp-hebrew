import assert from "node:assert/strict";
import test from "node:test";
import { scanAltText, getAltTextReport } from "../src/scanner.js";
import { scanSchema, reportSchema } from "../src/schemas.js";
import { fixture } from "./helpers.js";

test("recursive scope, supported extensions, exclusions and global lexical order", async () => {
  const f = await fixture({ "z.html": "<img>", "a/deep/p.MDX": "\n![](x)", "a.md": "![](x)", "a!.md": "![](x)", "a/z.md": "![](x)", "node_modules/a.md": "![](x)", ".git/a.md": "![](x)", ".hidden/deep/a.md": "![](x)", ".hidden.md": "![](x)", "a.txt": "<img>", "a.png": "<img>", "a.htm": "<img>" });
  try {
    const output = scanSchema.parse(await scanAltText({ directory: f.directory }));
    assert.equal(output.ok, true); assert.equal(output.files_scanned, 5);
    assert.deepEqual(output.findings.map(i => i.file), ["a!.md", "a.md", "a/deep/p.MDX", "a/z.md", "z.html"]);
    assert.equal(output.findings[2]?.line, 2);
  } finally { await f.cleanup(); }
});
test("report aggregates the same scan and empty directory succeeds", async () => {
  const f = await fixture({ "a.md": '![](x)\n![photo](x)\n<img alt="">', "b.html": '<img>\n<img alt="IMAGE">' });
  const empty = await fixture({ "plain.md": "Just text" });
  try {
    const scan = await scanAltText({ directory: f.directory });
    const report = reportSchema.parse(await getAltTextReport({ directory: f.directory }));
    assert.deepEqual(report.by_issue, { missing: 2, empty: 1, generic: 2 });
    assert.deepEqual(report.by_file.map(i => i.total), [3, 2]);
    const { findings, findings_omitted, ...summary } = scan;
    assert.deepEqual(report, summary);
    const clean = await scanAltText({ directory: empty.directory });
    assert.equal(clean.ok, true); assert.equal(clean.images_scanned, 0); assert.deepEqual(clean.findings, []);
  } finally { await f.cleanup(); await empty.cleanup(); }
});
test("bad paths, malformed input and encoding failures are explicit", async () => {
  const f = await fixture({ "bad.md": Buffer.from([0xff]), "good.md": "![](x)" });
  try {
    for (const directory of ["https://example.invalid", "//server/share", "\\\\server\\share", "relative"]) {
      const output = await scanAltText({ directory });
      assert.equal(output.ok, false); assert.equal(output.files_scanned, 0);
    }
    assert.equal((await scanAltText({ directory: f.directory, extra: true })).errors[0]?.code, "INVALID_INPUT");
    assert.equal((await scanAltText({ directory: f.directory + "/absent" })).ok, false);
    assert.equal((await scanAltText({ directory: f.directory + "/good.md" })).errors[0]?.code, "NOT_DIRECTORY");
    const scan = await scanAltText({ directory: f.directory });
    assert.equal(scan.complete, false); assert.equal(scan.files_scanned, 1);
    assert.deepEqual(scan.errors, [{ file: "bad.md", code: "INVALID_UTF8" }]);
  } finally { await f.cleanup(); }
});
