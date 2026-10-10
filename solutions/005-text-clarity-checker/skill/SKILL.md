---
name: clear-writing-tips
description: Check a user-provided text or local text file for deterministic clarity issues and present read-only writing tips without changing the source.
---

# Clear writing tips

Use this skill when the user wants a concise, repeatable clarity review of text they supplied directly or selected in a local file.

## Workflow

1. Confirm the exact text or local file path. Supply exactly one of `text` or `file_path`, never both.
2. Call `check_clarity` and report the score, Hebrew label, average sentence length, counts, and rule-based limitations.
3. If the result contains a structured error, explain it and stop.
4. Call `list_issues` with the same input when the user needs sentence-level findings.
5. Report `issues_omitted` or `complex_sentences_omitted` whenever it is nonzero. Then group the returned `long_sentence`, `passive_voice`, and `complex_term` findings by issue type, preserve their returned order, and turn the Hebrew messages into a short manual editing checklist.
6. If the user asks for a rewrite, draft it in the conversation and clearly distinguish it from the unchanged source.

## Safety boundary

The tools are local and read-only. Do not write, replace, rename, move, or delete the source file. Do not upload its text or path, call network services, or claim that a suggested edit was applied.
