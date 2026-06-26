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

function isFinancialOffer(request: LPGenerationRequest): boolean {
  const text = [
    request.title,
    request.description,
    request.targetAudience,
    ...request.keywords,
  ].join(' ').toLowerCase();

  return [
    'fx',
    'cfd',
    'dmm fx',
    '投資',
    '金融',
    '証券',
    '為替',
    '資産運用',
    '口座開設',
    'レバレッジ',
    'スプレッド',
  ].some((term) => text.includes(term.toLowerCase()));
}

function isInsuranceOffer(request: LPGenerationRequest): boolean {
  const text = [
    request.title,
    request.description,
    request.targetAudience,
    ...request.keywords,
  ].join(' ').toLowerCase();

  return [
    '保険',
    '火災保険',
    '地震保険',
    '家財保険',
    'インズウェブ',
    'insweb',
    '見積もり',
    '一括見積',
    '補償',
  ].some((term) => text.includes(term.toLowerCase()));
}

function financialGuardrails(request: LPGenerationRequest): string {
  if (!isFinancialOffer(request)) return '';

  return `

金融・投資案件の必須ルール:
- 元本保証、利益保証、確実に儲かる、簡単に稼げる、リスクなし等の表現は禁止
- 取引には価格変動等により損失が生じる可能性があり、預託証拠金を上回る損失が生じるおそれがあることを必ず明記
- 手数料、スプレッド、キャンペーン、口座開設条件、成果条件は変更される可能性があるため、公式サイトで最新条件を確認する導線にする
- CTAは「公式サイトで詳細を確認する」「リスクと条件を確認する」など確認型にし、「今すぐ稼ぐ」「絶対に得する」等の煽りは禁止
- 読者が仕組みとリスクを理解して判断できる、落ち着いた情報提供型のLPにする`;
}

function insuranceGuardrails(request: LPGenerationRequest): string {
  if (!isInsuranceOffer(request)) return '';

  return `

保険・一括見積もり案件の必須ルール:
- 必ず安くなる、最安保証、誰でも得する、絶対におすすめ、必ず補償される等の断定は禁止
- 火災保険の保険料や補償内容は、所在地、建物構造、築年数、補償対象、補償範囲、保険金額、保険期間、自己負担額、保険会社によって異なることを明記
- 一括見積もりは比較検討の入口であり、契約条件・補償範囲・免責事項・重要事項説明書は公式サイトや保険会社資料で確認する導線にする
- CTAは「公式サイトで見積もり条件を確認する」「補償内容を比較する」など確認型にする
- 不安を煽りすぎず、補償範囲と保険料を落ち着いて比較できる情報提供型のLPにする`;
}

function normalizeFinancialCta(cta?: string): string | undefined {
  if (!cta) return undefined;
  if (/(申し込|始め|登録|稼|儲|今すぐ|無料)/.test(cta)) {
    return '公式サイトで詳細を確認する';
  }
  return cta;
}

function ensureFinancialRiskCopy(content: LPContent): LPContent {
  const riskNotice =
    'FXは元本や利益が保証されるものではありません。価格変動やスワップポイント等により損失が生じる場合があり、相場変動によっては預託証拠金を上回る損失が生じるおそれがあります。取引条件、手数料、スプレッド、キャンペーンの最新情報は必ず公式サイトで確認してください。';

  const sections = Array.isArray(content.sections) ? content.sections : [];
  const normalizedSections = sections.map((section) => ({
    ...section,
    cta: normalizeFinancialCta(section.cta),
  }));
  const allText = [
    content.title,
    content.headline,
    content.subheadline,
    content.footer,
    ...normalizedSections.flatMap((section) => [section.title, section.content]),
  ].join('\n');

  if (!/(リスク|損失|元本|証拠金)/.test(allText)) {
    normalizedSections.push({
      title: '取引前に確認したいリスク',
      content: riskNotice,
      cta: '公式サイトで詳細を確認する',
    });
  }

  const footer = /(元本|損失|リスク|証拠金)/.test(content.footer)
    ? content.footer
    : `${content.footer}\n${riskNotice}`;

  return {
    ...content,
    sections: normalizedSections,
    footer,
  };
}

function normalizeInsuranceCta(cta?: string): string | undefined {
  if (!cta) return undefined;
  if (/(申し込|始め|登録|今すぐ|最安|必ず|無料)/.test(cta)) {
    return '公式サイトで見積もり条件を確認する';
  }
  return cta;
}

function ensureInsuranceNoticeCopy(content: LPContent): LPContent {
  const notice =
    '火災保険の保険料や補償内容は、所在地、建物構造、築年数、補償対象、補償範囲、保険金額、保険期間、自己負担額、保険会社によって異なります。一括見積もりは比較検討の入口として活用し、契約前には公式サイトや保険会社の重要事項説明書・約款を必ず確認してください。';

  const sections = Array.isArray(content.sections) ? content.sections : [];
  const normalizedSections = sections.map((section) => ({
    ...section,
    cta: normalizeInsuranceCta(section.cta),
  }));
  const allText = [
    content.title,
    content.headline,
    content.subheadline,
    content.footer,
    ...normalizedSections.flatMap((section) => [section.title, section.content]),
  ].join('\n');

  if (!/(補償|保険料|重要事項|約款|条件)/.test(allText)) {
    normalizedSections.push({
      title: '見積もり前に確認したいこと',
      content: notice,
      cta: '公式サイトで見積もり条件を確認する',
    });
  }

  const footer = /(補償|保険料|重要事項|約款|条件)/.test(content.footer)
    ? content.footer
    : `${content.footer}\n${notice}`;

  return {
    ...content,
    sections: normalizedSections,
    footer,
  };
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
${financialGuardrails(request)}
${insuranceGuardrails(request)}

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
- 内容は日本語で、読者の判断に役立つ具体性と説得力を持たせてください
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
    const normalized = parsed as LPContent;
    if (isFinancialOffer(request)) return ensureFinancialRiskCopy(normalized);
    if (isInsuranceOffer(request)) return ensureInsuranceNoticeCopy(normalized);
    return normalized;
  } catch (error) {
    throw new Error('Failed to parse Claude response as JSON');
  }
}
