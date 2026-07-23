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

/**
 * LP content schema (v2).
 * v1 fields (title/headline/subheadline/heroImageDescription/sections/footer)
 * are kept as-is so existing rows keep rendering. New fields are optional and
 * the template renders them only when present.
 */
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
  // ---- v2 optional fields ----
  metaDescription?: string;
  painPoints?: string[];
  faq?: { question: string; answer: string }[];
  recommendedFor?: string[];
  notRecommendedFor?: string[];
  ctaLabel?: string;
  ctaNote?: string;
}

function offerText(request: LPGenerationRequest): string {
  return [
    request.title,
    request.description,
    request.targetAudience,
    ...request.keywords,
  ].join(' ').toLowerCase();
}

function isFinancialOffer(request: LPGenerationRequest): boolean {
  const text = offerText(request);
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
  const text = offerText(request);
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

function isHealthBeautyOffer(request: LPGenerationRequest): boolean {
  const text = offerText(request);
  return [
    '脱毛',
    '美容',
    'スキンケア',
    'コスメ',
    '化粧品',
    'サプリ',
    'ダイエット',
    '育毛',
    '薄毛',
    'エステ',
    'クリニック',
    '医療',
    'ホワイトニング',
    '痩身',
    '健康食品',
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

function healthBeautyGuardrails(request: LPGenerationRequest): string {
  if (!isHealthBeautyOffer(request)) return '';

  return `

健康・美容案件の必須ルール(薬機法・景品表示法):
- 「治る」「痩せる」「生える」「シミが消える」等、効果効能を保証・断定する表現は禁止
- ビフォーアフターの捏造、体験談の創作、医学的根拠の創作は禁止
- 効果には個人差があること、詳細は公式サイトで確認することを前提にした書き方にする
- 医薬品・医療行為と誤認させる表現(「医療レベル」等)は、商材情報に明記がない限り使わない
- 不安や外見コンプレックスを過度に煽る書き方をしない`;
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
    ctaLabel: normalizeFinancialCta(content.ctaLabel) ?? content.ctaLabel,
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
    ctaLabel: normalizeInsuranceCta(content.ctaLabel) ?? content.ctaLabel,
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
- タイトルは検索する人の悩み・状況に寄り添う具体的なものにし、「衝撃」「ヤバい」等の煽りやクリックベイトは禁止
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

function toStringArray(value: any, max: number): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const arr = value
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter(Boolean)
    .slice(0, max);
  return arr.length ? arr : undefined;
}

function toFaqArray(value: any): { question: string; answer: string }[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const arr = value
    .map((v) => ({
      question: String(v?.question ?? v?.q ?? '').trim(),
      answer: String(v?.answer ?? v?.a ?? '').trim(),
    }))
    .filter((v) => v.question && v.answer)
    .slice(0, 5);
  return arr.length ? arr : undefined;
}

export async function generateLPContent(request: LPGenerationRequest): Promise<LPContent> {
  const prompt = `あなたは日本のアフィリエイトLP専門の編集者兼コピーライターです。読者に誠実で、その結果として成約率が高いLP本文を作成します。

# 商材情報（あなたが使ってよい事実は、ここに書かれている範囲だけです）
- タイトル: ${request.title}
- 説明: ${request.description}
- ターゲット: ${request.targetAudience}
- キーワード: ${request.keywords.join(', ')}

# コンプライアンス絶対ルール（違反は納品不可）
1. 事実の捏造禁止: 料金、割引、実績数、利用者数、満足度、受賞歴、掲載メディア、キャンペーン内容など、上の商材情報に書かれていない具体的事実を書かない。
2. 口コミの創作禁止: 架空の体験談、利用者の声、レビュー、星評価を絶対に作らない。
3. 断定・最上級の禁止: 「必ず」「絶対」「100%」「No.1」「業界最安」「誰でも◯◯できる」など、裏付けのない保証・最上級表現を使わない。
4. 不明なことは正直に: 商材情報にない条件（料金の詳細、解約条件など）は断定せず、「最新の条件は公式サイトでご確認ください」と案内する。
${financialGuardrails(request)}${insuranceGuardrails(request)}${healthBeautyGuardrails(request)}

# 文章の品質ルール
- ですます調。1文はおよそ60文字以内。段落は2〜3文で区切る。
- 次のAI的な常套句を禁止: 「いかがでしたか」「〜ではないでしょうか」「ぜひこの機会に」「話題の」「今注目の」「徹底解説」「〜と言っても過言ではありません」
- 抽象的な形容詞（すごい、最高、充実、安心など）の羅列ではなく、商材情報にある具体的な名詞・数字・サービス名を使って書く。
- 読者の悩みや状況の描写から入り、押し売りせず、判断材料を渡す文体にする。

# 出力構成の設計指針
- painPoints: ターゲットが実際に感じていそうな具体的な悩みを3件。各40文字以内。状況が目に浮かぶ具体性で書く。
- sections: ちょうど3件。各セクションは1テーマに絞る（例: (1)どんなサービスか (2)何がどう解決するか (3)始め方・使い方の流れ）。contentは200〜350文字。箇条書きにしたい場合は改行区切りの短文にする。
- faq: 申し込み前の不安に答える3〜4問。費用・解約・所要時間・向き不向きなど。商材情報に事実がない質問には「公式サイトで最新の条件をご確認ください」を含む正直な回答にする。
- recommendedFor: この商材が向いている人を3件。notRecommendedFor: 向いていない人を2件。正直に書く（これが読者の信頼につながる）。
- ctaLabel: 「公式サイトで詳細を確認する」のような確認型。「無料」等の条件は商材情報に明記がある場合のみ使用可。
- ctaNote: CTAボタンの下に添える1行の注記。商材情報にある事実のみ。書ける事実がなければ空文字にする。
- metaDescription: 検索結果に表示される説明文。90〜110文字。

以下の**正確なJSON構造**で返してください。余計なキーやネストは追加しないでください。contentは必ず文字列にしてください。

{
  "title": "検索意図に合った具体的なタイトル(32文字以内目安)",
  "metaDescription": "検索結果用の説明文(90-110文字)",
  "headline": "悩みに寄り添う具体的なヘッドライン",
  "subheadline": "ヘッドラインを補足する2〜3文",
  "heroImageDescription": "ヒーロー画像の説明",
  "painPoints": ["悩み1", "悩み2", "悩み3"],
  "sections": [
    { "title": "セクション見出し", "content": "セクション本文(文字列)", "cta": "CTAテキスト(任意、不要ならキーごと省略)" }
  ],
  "faq": [
    { "question": "質問", "answer": "回答" }
  ],
  "recommendedFor": ["向いている人1", "向いている人2", "向いている人3"],
  "notRecommendedFor": ["向いていない人1", "向いていない人2"],
  "ctaLabel": "公式サイトで詳細を確認する",
  "ctaNote": "商材情報にある事実のみの注記、なければ空文字",
  "footer": "クロージングメッセージ(煽らず、判断を後押しする2〜3文)"
}

JSON以外のテキストは出力しないでください。`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 6000,
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
    // v2フィールドの正規化(欠損・型揺れに耐える)
    const normalized: LPContent = {
      title: String(parsed.title || request.title),
      headline: String(parsed.headline || parsed.title || request.title),
      subheadline: String(parsed.subheadline || ''),
      heroImageDescription: String(parsed.heroImageDescription || ''),
      sections: Array.isArray(parsed.sections) ? parsed.sections : [],
      footer: String(parsed.footer || ''),
      metaDescription: typeof parsed.metaDescription === 'string' && parsed.metaDescription.trim()
        ? parsed.metaDescription.trim()
        : undefined,
      painPoints: toStringArray(parsed.painPoints, 4),
      faq: toFaqArray(parsed.faq),
      recommendedFor: toStringArray(parsed.recommendedFor, 4),
      notRecommendedFor: toStringArray(parsed.notRecommendedFor, 3),
      ctaLabel: typeof parsed.ctaLabel === 'string' && parsed.ctaLabel.trim() ? parsed.ctaLabel.trim() : undefined,
      ctaNote: typeof parsed.ctaNote === 'string' && parsed.ctaNote.trim() ? parsed.ctaNote.trim() : undefined,
    };
    if (isFinancialOffer(request)) return ensureFinancialRiskCopy(normalized);
    if (isInsuranceOffer(request)) return ensureInsuranceNoticeCopy(normalized);
    return normalized;
  } catch (error) {
    throw new Error('Failed to parse Claude response as JSON');
  }
}
