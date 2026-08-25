import { EmbedContentResponse, GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import { readFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";

// 環境変数の読み込み
dotenv.config();
const LLM_MODEL_EMBEDDED = process.env.LLM_MODEL_EMBEDDED ?? "gemini-embedding-2";
const LLM_MODEL_GENERATED = process.env.LLM_MODEL_GENERATED ?? "gemini-2.5-flash";
const DEFAULT_DOCUMENT_PATH = "resources/document_work-rules.txt";
const DEFAULT_PROMPT_PATH = "resources/prompt_work-rules.txt";
const RETRIEVAL_TOP_N = 2;
const RELATIVE_SCORE_MARGIN = 0.05;
if (!process.env.GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY が設定されていません。.env を確認してください。");
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

type PromptOption = {
  label: string;
  query: string;
};

type InspectionOption = {
  label: string;
  content: string;
};

type ScoredContent = {
  doc: string;
  score: number;
};

async function main() {
  const inspectionPath = process.argv[2] ?? "";
  const documentPath = resolveDocumentPath(process.argv[3]);
  const promptPath = resolvePromptPath(process.argv[4]);

  // Inspectionファイルの読み込みおよび選択
  const inspection = inspectionPath
    ? await selectInspection(await loadInspectionsFromFile(inspectionPath))
    : "";

  // ドキュメントのベクトル化
  const documents = await loadDocumentsFromFile(documentPath);
  const vectorizedDoc: number[][] = await embedAndVectorizedContents(LLM_MODEL_EMBEDDED, documents);

  // クエリのベクトル化
  const prompts = await loadPromptsFromFile(promptPath);
  const query = await selectPrompt(prompts);
  // console.log(`クエリ: "${query}"\n`);
  const vectorizedQuery: number[] = await embedAndVectorizedContent(LLM_MODEL_EMBEDDED, query);

  // 類似度計算
  const scoredContents: ScoredContent[] = documents.map((doc, index) => {
    const score = cosineSimilarity(vectorizedQuery, vectorizedDoc[index]);
    return { doc, score };
  });

  // Top N と相対閾値のAND条件で関連チャンクを抽出
  const retrievedContext = serialSortedContents(
    selectRelevantContents(scoredContents, RETRIEVAL_TOP_N, RELATIVE_SCORE_MARGIN),
  );

  // console.log(`ドキュメントファイル: ${documentPath}`);
  // console.log(`プロンプトファイル: ${promptPath}`);
  // console.log(`【検索されたコンテキスト】:\n${retrievedContext}\n`);

  // LLMにコンテキストを渡して回答生成
  const prompt = `
以下のInspectionおよびコンテキストに基づいて回答してください。

Inspection:
${inspection}

コンテキスト（背景情報）:
${retrievedContext}

質問:
${query}`;

  const response = await ai.models.generateContent({
    model: LLM_MODEL_GENERATED,
    contents: prompt,
  });
  console.log(`【LLMの回答】:\n${response.text}`);
}

main().catch(console.error);

/**
 * ドキュメントファイルの解決
 *
 * @param inputPath 実行引数で受け取るファイルパス
 * @returns 絶対パス
 */
function resolveDocumentPath(inputPath?: string): string {
  return path.resolve(process.cwd(), inputPath ?? DEFAULT_DOCUMENT_PATH);
}

/**
 * プロンプトファイルの解決
 *
 * @param inputPath 実行引数で受け取るファイルパス
 * @returns 絶対パス
 */
function resolvePromptPath(inputPath?: string): string {
  return path.resolve(process.cwd(), inputPath ?? DEFAULT_PROMPT_PATH);
}

/**
 * ドキュメントファイルを空行区切りでチャンクに分割して読み込む
 *
 * @param documentPath ドキュメントファイルパス
 * @returns ドキュメントチャンク配列
 */
async function loadDocumentsFromFile(documentPath: string): Promise<string[]> {
  const content = await readFile(documentPath, "utf-8");
  const documents = content
    .split(/\r?\n\s*\r?\n+/)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0);

  if (documents.length === 0) {
    throw new Error(`ドキュメントが存在しません: ${documentPath}`);
  }

  return documents;
}

/**
 * プロンプトファイルを空行区切りで読み込む
 *
 * @param promptPath プロンプトファイルパス
 * @returns プロンプト配列
 */
async function loadPromptsFromFile(promptPath: string): Promise<PromptOption[]> {
  const prompts = (await readFile(promptPath, "utf-8"))
    .split(/\r?\n\s*\r?\n+/)
    .map((prompt) => parsePromptBlock(prompt))
    .filter((prompt): prompt is PromptOption => prompt !== "");

  if (prompts.length === 0) {
    throw new Error(`プロンプトが存在しません: ${promptPath}`);
  }

  return prompts;
}

/**
 * プロンプト一覧から1件選択する
 *
 * @param prompts プロンプト配列
 * @returns 選択されたプロンプト
 */
async function selectPrompt(prompts: PromptOption[]): Promise<string> {
  if (prompts.length === 1) {
    return prompts[0].query;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const promptList = prompts.map((prompt, index) => `${index + 1}: ${prompt.label}`).join("\n");

    while (true) {
      const answer = await rl.question(
        `プロンプトを選択してください。\n${promptList}\n\n番号を入力してください: `,
      );
      const selectedIndex = Number.parseInt(answer.trim(), 10) - 1;

      if (selectedIndex >= 0 && selectedIndex < prompts.length) {
        return prompts[selectedIndex].query;
      }

      console.log("無効な番号です。表示された番号を入力してください。\n");
    }
  } finally {
    rl.close();
  }
}

/**
 * Inspectionファイルを空行区切りで読み込む
 *
 * @param inspectionPath Inspectionファイルパス
 * @returns Inspection配列
 */
async function loadInspectionsFromFile(inspectionPath: string): Promise<InspectionOption[]> {
  const inspections = (await readFile(inspectionPath, "utf-8"))
    .split(/\r?\n\s*\r?\n+/)
    .map((inspection) => parseInspectionBlock(inspection))
    .filter((inspection): inspection is InspectionOption => inspection !== "");

  if (inspections.length === 0) {
    throw new Error(`Inspectionが存在しません: ${inspectionPath}`);
  }

  return inspections;
}

/**
 * Inspection一覧から1件選択する
 *
 * @param inspections Inspection配列
 * @returns 選択されたInspection本文
 */
async function selectInspection(inspections: InspectionOption[]): Promise<string> {
  if (inspections.length === 1) {
    return inspections[0].content;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const inspectionList = inspections
      .map((inspection, index) => `${index + 1}: ${inspection.label}`)
      .join("\n");

    while (true) {
      const answer = await rl.question(
        `Inspectionを選択してください。\n${inspectionList}\n\n番号を入力してください: `,
      );
      const selectedIndex = Number.parseInt(answer.trim(), 10) - 1;

      if (selectedIndex >= 0 && selectedIndex < inspections.length) {
        return inspections[selectedIndex].content;
      }

      console.log("無効な番号です。表示された番号を入力してください。\n");
    }
  } finally {
    rl.close();
  }
}

/**
 * プロンプトブロックを表示名と本文に分解する
 *
 * 1行目を表示名、2行目以降を本文として扱う。
 * 1行しかない場合は表示名と本文に同じ値を使う。
 *
 * @param promptBlock プロンプトブロック
 * @returns 表示名と本文
 */
function parsePromptBlock(promptBlock: string): PromptOption | "" {
  const normalizedBlock = promptBlock.trim();
  if (normalizedBlock.length === 0) {
    return "";
  }

  const lines = normalizedBlock
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return "";
  }

  const [label, ...queryLines] = lines;
  const query = queryLines.length > 0 ? queryLines.join("\n") : label;
  return { label, query };
}

/**
 * Inspectionブロックを表示名と本文に分解する
 *
 * 表示名は先頭行を使用し、本文はブロック全体をそのまま使用する。
 *
 * @param inspectionBlock Inspectionブロック
 * @returns 表示名と本文
 */
function parseInspectionBlock(inspectionBlock: string): InspectionOption | "" {
  const normalizedBlock = inspectionBlock.trim();
  if (normalizedBlock.length === 0) {
    return "";
  }

  const firstLine = normalizedBlock.split(/\r?\n/)[0]?.trim() ?? "";
  if (firstLine.length === 0) {
    return "";
  }

  return {
    label: firstLine,
    content: normalizedBlock,
  };
}

/**
 * コンテンツの埋め込み
 *
 * @param model Embeddingモデル名
 * @param content Embed対象の文字列
 * @returns {@link EmbedContentResponse}
 */
async function embedContent(model: string, content: string): Promise<EmbedContentResponse> {
  return await ai.models.embedContent({ model, contents: content });
}

/**
 * コンテンツの埋め込みおよびベクトル化
 *
 * @param model Embeddingモデル名
 * @param content Embed対象の文字列
 * @returns 埋め込みベクトル
 */
async function embedAndVectorizedContent(model: string, content: string): Promise<number[]> {
  return extractValues(await embedContent(model, content));
}

/**
 * コンテンツリストの埋め込みおよびベクトル化
 *
 * @param model Embeddingモデル名
 * @param contents Embed対象の文字列配列
 * @returns 埋め込みベクトル
 */
async function embedAndVectorizedContents(model: string, contents: string[]): Promise<number[][]> {
  const res = await Promise.all(
    contents.map(async (doc) => {
      return await embedAndVectorizedContent(model, doc);
    }),
  );
  return res;
}

/**
 * コサイン類似度の計算
 *
 * @param v1 ベクトル1
 * @param v2 ベクトル2
 * @returns コサイン類似度 (0〜1)
 */
function cosineSimilarity(v1: number[], v2: number[]): number {
  const dotProduct = v1.reduce((sum, a, idx) => sum + a * v2[idx], 0);
  const mag1 = Math.sqrt(v1.reduce((sum, a) => sum + a * a, 0));
  const mag2 = Math.sqrt(v2.reduce((sum, b) => sum + b * b, 0));
  if (!mag1 || !mag2) return 0;
  return dotProduct / (mag1 * mag2);
}

/**
 * レスポンスのあらゆる構造から確実に number[] を抽出するヘルパー関数
 *
 * @param res 埋め込みレスポンス
 * @returns 埋め込みベクトル
 */
function extractValues(res: EmbedContentResponse): number[] {
  if (
    !res ||
    !res.embeddings ||
    !res.embeddings[0].values ||
    res.embeddings[0].values.length === 0
  ) {
    throw new Error("コンテンツの埋め込みに失敗しました");
  }
  return res.embeddings[0].values;
}

/**
 * Top Nと相対閾値のAND条件で関連チャンクを選択する
 *
 * @param scoredContents スコア付きドキュメント配列
 * @param topN 取得する上位件数
 * @param relativeScoreMargin top1からの許容差分
 * @returns 選択されたスコア付きドキュメント配列
 */
function selectRelevantContents(
  scoredContents: ScoredContent[],
  topN: number,
  relativeScoreMargin: number,
): ScoredContent[] {
  if (scoredContents.length === 0) {
    throw new Error("ドキュメントが存在しません");
  }

  const sortedContents = [...scoredContents].sort((a, b) => b.score - a.score);
  const topContents = sortedContents.slice(0, topN);
  const topScore = topContents[0].score;
  const relativeThreshold = topScore - relativeScoreMargin;
  const filteredContents = topContents.filter((item) => item.score >= relativeThreshold);

  // 念のため、0件になった場合はtop1を返す。
  if (filteredContents.length === 0) {
    return [topContents[0]];
  }

  return filteredContents;
}

/**
 * 関連チャンクをシリアライズして文字列化する
 *
 * @param contents スコア付きドキュメント配列
 * @returns シリアライズされた文字列
 */
function serialSortedContents(contents: ScoredContent[]): string {
  return contents
    .map((item, index) => `[Chunk ${index + 1} / score=${item.score.toFixed(4)}]\n${item.doc}`)
    .join("\n\n---\n\n");
}
