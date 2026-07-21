export interface WeeklyOperationsHealth {
  activeAccounts: number;
  totalAccounts: number;
  stoppedSlugs: string[];
  postedThisWeek: number;
  failedThisWeek: number;
  thisWeekClicks: number;
  prevWeekClicks: number;
  lpCount: number;
}

/** Build evidence-based actions without spending an LLM API call. */
export function buildWeeklyProposals(health: WeeklyOperationsHealth): string[] {
  const proposals: string[] = [];

  if (health.activeAccounts < health.totalAccounts) {
    proposals.push(
      `X送客を最優先で復旧する。現在の稼働は${health.activeAccounts}/${health.totalAccounts}アカウント。`
    );
  }

  if (health.failedThisWeek > 0 || health.stoppedSlugs.length > 0) {
    proposals.push(
      'X APIエラーの詳細に従い、402はクレジット、403は書き込み権限・権限変更後のアクセストークン・アカウント制限を確認する。'
    );
    proposals.push('修正後は1アカウントずつ実投稿を確認し、成功したアカウントだけを有効化する。');
  }

  if (health.postedThisWeek === 0 && health.thisWeekClicks === 0) {
    proposals.push(
      `既存LP ${health.lpCount}件への送客が止まっているため、新規LP追加よりX投稿復旧を優先する。`
    );
  } else if (health.thisWeekClicks === 0) {
    proposals.push('投稿済みXのLPリンクを開き、/go経由の遷移とclick_logsへの記録を1件確認する。');
  } else {
    proposals.push('クリック上位LPの投稿テーマと時間帯を、次週の投稿へ優先的に再利用する。');
  }

  if (health.prevWeekClicks > 0 && health.thisWeekClicks === 0 && health.postedThisWeek > 0) {
    proposals.push('前週にクリックされたLPと今週の投稿URLを比較し、リンク切れやUTM欠落がないか確認する。');
  }

  return proposals.slice(0, 5);
}
