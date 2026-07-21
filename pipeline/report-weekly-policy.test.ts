import assert from 'node:assert/strict';
import test from 'node:test';

import { buildWeeklyProposals } from './report-weekly-policy';

test('prioritizes X recovery when every account is stopped', () => {
  const proposals = buildWeeklyProposals({
    activeAccounts: 0,
    totalAccounts: 5,
    stoppedSlugs: ['love_signal_edit'],
    postedThisWeek: 0,
    failedThisWeek: 3,
    thisWeekClicks: 0,
    prevWeekClicks: 3,
    lpCount: 89,
  });

  assert.match(proposals[0], /稼働は0\/5/);
  assert.ok(proposals.some((proposal) => proposal.includes('403')));
  assert.ok(proposals.some((proposal) => proposal.includes('既存LP 89件')));
  assert.ok(proposals.every((proposal) => !proposal.includes('GA4')));
});

test('checks click tracking only when posts are actually delivered', () => {
  const proposals = buildWeeklyProposals({
    activeAccounts: 5,
    totalAccounts: 5,
    stoppedSlugs: [],
    postedThisWeek: 4,
    failedThisWeek: 0,
    thisWeekClicks: 0,
    prevWeekClicks: 2,
    lpCount: 89,
  });

  assert.ok(proposals.some((proposal) => proposal.includes('/go')));
  assert.ok(proposals.some((proposal) => proposal.includes('UTM')));
});
