import {test} from 'node:test';
import assert from 'node:assert/strict';

import {badgeText, tooltipText} from '../src/badge.js';

test('badgeText', () => {
    assert.equal(badgeText({status: 'loading'}), '…');
    assert.equal(badgeText({status: 'error'}), '!');
    assert.equal(badgeText({status: 'ok', count: 0}), '0');
    assert.equal(badgeText({status: 'ok', count: 7}), '7');
    assert.equal(badgeText({status: 'ok', count: 99}), '99');
    assert.equal(badgeText({status: 'ok', count: 120}), '99+');
});

test('tooltipText', () => {
    assert.equal(tooltipText({status: 'loading'}), 'PR Indicator');
    assert.equal(tooltipText({status: 'error', error: 'falhou'}), 'PR Indicator — Erro: falhou');
    assert.equal(tooltipText({status: 'ok', count: 3, badgeSection: 'review'}), 'PR Indicator — 3 PRs pra eu revisar');
    assert.equal(tooltipText({status: 'ok', count: 1, badgeSection: 'mine'}), 'PR Indicator — 1 PR meu aberto');
    assert.equal(tooltipText({status: 'ok', count: 2, badgeSection: 'mine'}), 'PR Indicator — 2 PRs meus abertos');
});
