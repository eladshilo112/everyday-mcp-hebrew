import assert from "node:assert/strict";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import test from "node:test";
import { checkClarity, listIssues } from "../src/analyzer.js";
import { MAX_RETURNED_ITEMS } from "../src/schemas.js";

test("a finding-heavy 190,000-character input completes within the supported limit", async () => {
  const text = "synergy.".repeat(23_750);
  const result = await checkClarity({ text });
  assert.equal(result.ok, true);
  assert.equal(result.character_count, 190_000);
  assert.equal(result.word_count, 23_750);
  assert.equal(result.sentence_count, 23_750);
  assert.equal(result.long_sentence_count, 0);
  assert.equal(result.complex_term_count, 23_750);
  assert.equal(result.complex_sentence_count, 23_750);
  assert.equal(result.complex_sentences_returned, MAX_RETURNED_ITEMS);
  assert.equal(result.complex_sentences_omitted, 23_750 - MAX_RETURNED_ITEMS);
  assert.equal(result.complex_sentences.length, MAX_RETURNED_ITEMS);
});

test("dense passive matches at the exact limit are filtered without quadratic overlap checks", async () => {
  const text = "נכתב ".repeat(40_000);
  const result = await checkClarity({ text });
  assert.equal(result.ok, true);
  assert.equal(result.character_count, 200_000);
  assert.equal(result.passive_count, 40_000);
  assert.equal(result.long_sentence_count, 1);
});

test("list_issues reports stable totals when its bounded result is truncated", async () => {
  const result = await listIssues({ text: "synergy ".repeat(600) });
  assert.equal(result.ok, true);
  assert.equal(result.issue_count, 601);
  assert.equal(result.issues_returned, MAX_RETURNED_ITEMS);
  assert.equal(result.issues_omitted, 101);
  assert.equal(result.issues.length, MAX_RETURNED_ITEMS);
  assert.equal(result.issues[0]?.type, "long_sentence");
  assert.ok(result.issues.slice(1).every((issue) => issue.type === "complex_term"));
});

test("analysis performs no calls through common outbound network APIs", async () => {
  let calls = 0;
  const blocked = (): never => {
    calls += 1;
    throw new Error("network access is blocked in this test");
  };
  const mutableHttp = http as unknown as { request: typeof http.request; get: typeof http.get };
  const mutableHttps = https as unknown as { request: typeof https.request; get: typeof https.get };
  const mutableNet = net as unknown as {
    connect: typeof net.connect;
    createConnection: typeof net.createConnection;
  };
  const originalHttpRequest = mutableHttp.request;
  const originalHttpGet = mutableHttp.get;
  const originalHttpsRequest = mutableHttps.request;
  const originalHttpsGet = mutableHttps.get;
  const originalNetConnect = mutableNet.connect;
  const originalCreateConnection = mutableNet.createConnection;
  const originalFetch = globalThis.fetch;

  mutableHttp.request = blocked as typeof http.request;
  mutableHttp.get = blocked as typeof http.get;
  mutableHttps.request = blocked as typeof https.request;
  mutableHttps.get = blocked as typeof https.get;
  mutableNet.connect = blocked as typeof net.connect;
  mutableNet.createConnection = blocked as typeof net.createConnection;
  globalThis.fetch = blocked as typeof fetch;
  try {
    const result = await listIssues({ text: "המסמך נכתב על ידי הצוות." });
    assert.equal(result.ok, true);
    assert.equal(result.issue_count, 1);
    assert.equal(calls, 0);
  } finally {
    mutableHttp.request = originalHttpRequest;
    mutableHttp.get = originalHttpGet;
    mutableHttps.request = originalHttpsRequest;
    mutableHttps.get = originalHttpsGet;
    mutableNet.connect = originalNetConnect;
    mutableNet.createConnection = originalCreateConnection;
    globalThis.fetch = originalFetch;
  }
});

test("UNC and URL-like file paths are rejected before filesystem access", async () => {
  const unc = await checkClarity({ file_path: "\\\\example.invalid\\share\\note.txt" });
  const url = await checkClarity({ file_path: "https://example.invalid/note.txt" });
  assert.equal(unc.error?.code, "network_path_not_allowed");
  assert.equal(url.error?.code, "network_path_not_allowed");
});
