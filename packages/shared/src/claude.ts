import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export interface LPGenerationRequest {
  title: string;
  description: string;
  targetAudience: string;
  offerId: string;
  keywords: string[];
}

export interface LPContent {
  title: string;
  headline: string;
  subheadline: string;
  heroImageDescription: string;
  sections: {
    title: string;
    content: string;
    cta?: string;
  }[];
  footer: string;
}

export async function generateText(prompt: string): Promise<string> {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1000,
    messages: [{ role: 'user', content: prompt }],
  });
  const content = response.content[0];
  if (content.type !== 'text') throw new Error('Unexpected response type');
  return content.text;
}

export interface LPPlan {
  title: string;
  description: string;
  target: string;
  keywords: string[];
  offer_id: string;
}

export interface PlanOfferInput {
  id: string;
  name: string;
  description?: string | null;
}

/**
 * Plan new (non-duplicate) LP ideas for a genre. Returns JSON-only output,
 * retried once on parse failure. Each plan's offer_id must come from `offers`.
 */
export async function generateLPPlans(
  genreName: string,
  tonePrompt: string,
  offers: PlanOfferInput[],
  recentTitles: string[],
  count = 1
): Promise<LPPlan[]> {
  const offerList = offers
    .map((o) => `- id="${o.id}" / ${o.name}${o.description ? ` / ${o.description}` : ''}`)
    .join('\n');
  const recent = recentTitles.length ? recentTitles.map((t) => `- ${t}`).join('\n') : '(なし)';

  const prompt = `あなたはアフィリエイトLPの編集長です。ジャンル「${genreName}」の新規LP企画を${count}件立案してください。

このジャンルの文体方針:
${tonePrompt}

利用可能なオファー（offer_id は必ずこの中から選ぶこと）:
${offerList}

過去30日に作成済みのLPタイトル（これらと内容・切り口が重複しないこと）:
${recent}

以下の**正確なJSON構造の配列のみ**を返してください。前後の説明・コードブロックは一切不要です。

[
  { "title": "LPタイトル", "description": "LPの概要(1-2文)", "target": "ターゲット読者", "keywords": ["キーワード1","キーワード2"], "offer_id": "上記から選んだid" }
]

- 配列の要素数はちょうど${count}件
- 既存タイトルと重複しない新しい切り口にすること
- offer_id は必ず利用可能なオファーのidと一致させること
- JSON以外は出力しないこと`;

  const tryOnce = async (): Promise<LPPlan[]> => {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    });
    const content = response.content[0];
    if (content.type !== 'text') throw new Error('Unexpected response type');
    let text = content.text.trim();
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) text = match[1].trim();
    const parsed = JSON.parse(text);
    const arr = Array.isArray(parsed) ? parsed : parsed.plans;
    if (!Array.isArray(arr)) throw new Error('Plan response is not an array');
    return arr.map((p: any) => ({
      title: String(p.title || '').trim(),
      description: String(p.description || '').trim(),
      target: String(p.target || '').trim(),
      keywords: Array.isArray(p.keywords) ? p.keywords.map((k: any) => String(k)) : [],
      offer_id: String(p.offer_id || '').trim(),
    }));
  };

  try {
    return await tryOnce();
  } catch {
    // single retry per spec
    return await tryOnce();
  }
}

export async function generateLPContent(request: LPGenerationRequest): Promise<LPContent> {
  const prompt = `あなたはアフィリエイトLPの専門家です。以下の情報を基に、魅力的なLPコンテンツを生成してください。

オファー情報:
- タイトル: ${request.title}
- 説明: ${request.description}
- ターゲット: ${request.targetAudience}
- キーワード: ${request.keywords.join(', ')}

以下の**正確なJSON構造**で返してください。余計なキーやネストは絶対に追加しないでください。contentは必ず文字列（配列やオブジェクトではなく）にしてください。

{
  "title": "SEO最適化されたタイトル",
  "headline": "注目を引くヘッドライン",
  "subheadline": "詳細な説明文",
  "heroImageDescription": "ヒーロー画像の説明",
  "sections": [
    { "title": "セクション見出し", "content": "セクション本文（文字列）", "cta": "CTAテキスト（任意、不要ならキーごと省略）" }
  ],
  "footer": "クロージングメッセージ"
}

- sectionsは3〜5個
- 内容は日本語で、説得力がありコンバージョン率の高いものにしてください
- JSON以外のテキストは出力しないでください`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  });

  const content = response.content[0];
  if (content.type !== 'text') {
    throw new Error('Unexpected response type');
  }

  try {
    // Claude がコードブロックで囲む場合があるので除去
    let text = content.text.trim();
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) {
      text = match[1].trim();
    }
    let parsed = JSON.parse(text);
    // ネストされている場合 (例: { lp: { ... } }) を展開
    if (parsed.lp && typeof parsed.lp === 'object') {
      parsed = parsed.lp;
    }
    // キー名の揺れを吸収
    if (!parsed.subheadline && parsed.subHeadline) {
      parsed.subheadline = parsed.subHeadline;
    }
    if (!parsed.heroImageDescription && parsed.heroImage?.description) {
      parsed.heroImageDescription = parsed.heroImage.description;
    }
    // sections.content が配列の場合は文字列に変換
    if (Array.isArray(parsed.sections)) {
      parsed.sections = parsed.sections.map((s: any) => ({
        title: s.title,
        content: Array.isArray(s.content) ? s.content.map((c: any) => typeof c === 'string' ? c : (c.point ? `${c.point}: ${c.detail}` : JSON.stringify(c))).join('\n') : String(s.content || ''),
        ...(s.cta && typeof s.cta === 'string' ? { cta: s.cta } : s.cta?.text ? { cta: s.cta.text } : {}),
      }));
    }
    return parsed as LPContent;
  } catch (error) {
    throw new Error('Failed to parse Claude response as JSON');
  }
}