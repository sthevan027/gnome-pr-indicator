import {test} from 'node:test';
import assert from 'node:assert/strict';

import {
    AuthError,
    GitHubClient,
    parseSearchResults,
    repoNameFromItem,
} from '../src/github-client.js';

const ok = json => ({ok: true, status: 200, json: async () => json});
const status = code => ({ok: false, status: code, json: async () => ({})});

function client({gh = async () => 'gho_gh', manual = null, fetchImpl = async () => ok({items: []})} = {}) {
    return new GitHubClient({execGh: gh, getManualToken: () => manual, fetchImpl});
}

test('repoNameFromItem pega dono/repo da repository_url', () => {
    assert.equal(repoNameFromItem({repository_url: 'https://api.github.com/repos/dono/repo'}), 'dono/repo');
    assert.equal(repoNameFromItem({}), '');
});

test('parseSearchResults extrai os campos usados no popup', () => {
    assert.deepEqual(parseSearchResults({items: [{
        number: 42,
        title: 'Corrige bug',
        html_url: 'https://github.com/dono/repo/pull/42',
        repository_url: 'https://api.github.com/repos/dono/repo',
    }]}), [{number: 42, title: 'Corrige bug', repo: 'dono/repo', url: 'https://github.com/dono/repo/pull/42'}]);
    assert.deepEqual(parseSearchResults({}), []);
});

test('token: gh tem precedência sobre o manual', async () => {
    assert.equal(await client({manual: 'ghp_manual'}).resolveToken(), 'gho_gh');
});

test('token: sem gh usa o manual', async () => {
    const c = client({gh: async () => { throw new Error('gh não encontrado'); }, manual: 'ghp_manual'});
    assert.equal(await c.resolveToken(), 'ghp_manual');
});

test('token: gh com saída vazia conta como não autenticado', async () => {
    const c = client({gh: async () => '  \n', manual: 'ghp_manual'});
    assert.equal(await c.resolveToken(), 'ghp_manual');
});

test('token: sem gh e sem manual lança AuthError', async () => {
    const c = client({gh: async () => { throw new Error('x'); }});
    await assert.rejects(c.resolveToken(), AuthError);
});

test('hasValidGhAuth', async () => {
    assert.equal(await client().hasValidGhAuth(), true);
    assert.equal(await client({gh: async () => { throw new Error('x'); }}).hasValidGhAuth(), false);
});

test('fetchAll faz as mesmas buscas do GNOME com o token', async () => {
    const urls = [];
    let auth;
    const fetchImpl = async (url, opts) => {
        urls.push(decodeURIComponent(url));
        auth = opts.headers.Authorization;
        return ok({items: []});
    };
    const result = await client({fetchImpl}).fetchAll();
    assert.deepEqual(result, {review: [], mine: []});
    assert.equal(auth, 'Bearer gho_gh');
    assert.ok(urls[0].includes('is:pr is:open review-requested:@me archived:false'));
    assert.ok(urls[1].includes('is:pr is:open author:@me archived:false'));
    assert.ok(urls.every(u => u.includes('per_page=8')));
});

test('401 vira AuthError', async () => {
    await assert.rejects(client({fetchImpl: async () => status(401)}).fetchAll(), AuthError);
});

test('500 vira erro comum com o status', async () => {
    await assert.rejects(client({fetchImpl: async () => status(500)}).fetchAll(),
        err => !(err instanceof AuthError) && /500/.test(err.message));
});

test('validateToken devolve o login', async () => {
    const c = client({fetchImpl: async url => {
        assert.ok(url.endsWith('/user'));
        return ok({login: 'sthevan027'});
    }});
    assert.equal(await c.validateToken('t'), 'sthevan027');
});

test('validateToken rejeita token inválido', async () => {
    await assert.rejects(client({fetchImpl: async () => status(401)}).validateToken('t'), /401/);
});
