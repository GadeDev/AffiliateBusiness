import assert from 'node:assert/strict';
import test from 'node:test';

import { formatTwitterError } from './twitterError';

test('includes safe X API response details', () => {
  const error = {
    code: 403,
    data: {
      title: 'Forbidden',
      detail: 'Client is not permitted to perform this action.',
      type: 'about:blank',
    },
    headers: { authorization: 'OAuth secret' },
  };

  assert.equal(
    formatTwitterError(error),
    'HTTP 403: Forbidden / Client is not permitted to perform this action.'
  );
  assert.doesNotMatch(formatTwitterError(error), /authorization|OAuth secret/);
});

test('explains credit depletion when X omits a response body', () => {
  assert.match(formatTwitterError({ code: 402 }), /クレジットが不足/);
});

test('redacts OAuth values from request errors', () => {
  assert.equal(
    formatTwitterError(new Error('Request failed oauth_token="secret-value"')),
    'Request failed oauth_***="***"'
  );
});
