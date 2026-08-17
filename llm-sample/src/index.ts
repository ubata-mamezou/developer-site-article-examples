import { EmbedContentResponse, GoogleGenAI, type ContentEmbedding } from "@google/genai";
import dotenv from "dotenv";

// 1. 環境変数の読み込み
dotenv.config();
const LLM_MODEL_EMBEDDED =
  process.env.LLM_MODEL_EMBEDDED ?? "gemini-embedding-2";
const LLM_MODEL_GENERATED =
  process.env.LLM_MODEL_GENERATED ?? "gemini-2.5-flash";

if (!process.env.GEMINI_API_KEY) {
  console.error(
    "エラー: GEMINI_API_KEY が設定されていません。.env を確認してください。",
  );
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// 2. 簡易ナレッジベース
const documents = [
  "当社の有給休暇は入社日に10日、毎年4月に一括付与されます。",
  "リモートワークは週2日まで利用可能です。事前の申請が必要です。",
  "経費精算は毎月25日締めです。領収書を添えて提出してください。",
];

async function main() {
  // const query = "有給はいつ付与されますか？";
  const query = "リモートワークするために必要な手続きはありますか？";
  console.log(`クエリ: "${query}"\n`);

  // 4. [Search] ドキュメントとクエリのベクトル化 (Embeddings API)
  const vectorizedDoc: number[][] = await vectorizedContents(
    LLM_MODEL_EMBEDDED,
    documents,
  );
  const vectorizedQuery: number[] = await vectorizedContent(
    LLM_MODEL_EMBEDDED,
    [query],
  );

  // 5. [Search] 類似度計算 & 最も関連度の高いドキュメントの特定 (Top 1)
  const scoredContents = documents.map((doc, index) => {
    const score = cosineSimilarity(vectorizedQuery, vectorizedDoc[index]);
    return { doc, score };
  });

  scoredContents.sort((a, b) => b.score - a.score);
  const retrievedDoc = scoredContents[0].doc;

  console.log(`【検索されたコンテキスト】:\n${retrievedDoc}\n`);

  // 6. [Generate] LLMにコンテキストを渡して回答生成
  const prompt = `以下のコンテキスト（背景情報）のみに基づいて回答してください。

コンテキスト:
${retrievedDoc}

質問:
${query}`;

  const response = await ai.models.generateContent({
    model: LLM_MODEL_GENERATED,
    contents: prompt,
  });

  console.log(`【LLMの回答】:\n${response.text}`);
}

main().catch(console.error);

async function vectorizedContents(model: string, contents: string[]): Promise<number[][]> {
  const res = await Promise.all(
    contents.map(async (doc) => {
      const res = await ai.models.embedContent({
        model,
        contents: doc,
      });
      return extractValues(res);
    }),
  );
  return res;
}

/**
 * コンテンツのベクトル化
 *
 * @param model Embeddingモデル名
 * @param contents 埋め込み対象の文字列配列
 * @returns 埋め込みベクトル
 */
async function vectorizedContent(
  model: string,
  contents: string[],
): Promise<number[]> {
  const res = await ai.models.embedContent({
    model,
    contents,
  });
  return extractValues(res);
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
  console.log(`debug: ${dotProduct} / (${mag1} * ${mag2})`);
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
  if (!res || !res.embeddings || !res.embeddings[0].values || res.embeddings[0].values.length === 0) {
    throw new Error("コンテンツの埋め込みに失敗しました");
  }
  return res.embeddings[0].values;
}
