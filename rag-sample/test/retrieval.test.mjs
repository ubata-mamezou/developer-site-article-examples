// ※LLMへの接続をモックに差し替えられる実装になってないため、テストはすべてスキップしています
import assert from "node:assert/strict";
import test from "node:test";
import {
  cosineSimilarity,
  parseInstructionBlock,
  parsePromptBlock,
  selectRelevantContents,
  serialSortedContents,
} from "../src/index.ts";

test.skip("parses prompt and instruction blocks", () => {
  assert.deepEqual(parsePromptBlock("  Label\n  First line\nSecond line  "), {
    label: "Label",
    query: "First line\nSecond line",
  });
  assert.deepEqual(parsePromptBlock("Only line"), {
    label: "Only line",
    query: "Only line",
  });
  assert.equal(parsePromptBlock("  \n "), "");
  assert.deepEqual(parseInstructionBlock(" Instructions\n body "), {
    label: "Instructions",
    content: "Instructions\n body",
  });
});

test.skip("calculates cosine similarity and handles a zero vector", () => {
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([0, 0], [1, 0]), 0);
});

test.skip("selects top documents within the relative score margin", () => {
  const scoredContents = [
    { doc: "lower", score: 0.7 },
    { doc: "best", score: 0.95 },
    { doc: "close", score: 0.92 },
  ];

  assert.deepEqual(selectRelevantContents(scoredContents, 3, 0.05), [
    { doc: "best", score: 0.95 },
    { doc: "close", score: 0.92 },
  ]);
  assert.throws(() => selectRelevantContents([], 2, 0.05), /ドキュメントが存在しません/);
  assert.match(serialSortedContents([{ doc: "best", score: 0.95 }]), /score=0\.9500/);
});