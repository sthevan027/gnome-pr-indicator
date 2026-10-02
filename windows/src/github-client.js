// Port do GitHubClient do extension.js: mesmas buscas, mesmo limite, mesma
// precedência de token (gh CLI primeiro, token manual como fallback).
export const MAX_ITEMS_PER_SECTION = 8;

const QUERIES = {
    review: 'is:pr is:open review-requested:@me archived:false',
    mine: 'is:pr is:open author:@me archived:false',
};

/** Falha de autenticação — o app limpa a lista em vez de manter a última boa. */
export class AuthError extends Error {
    constructor(message) {
        super(message);
        this.name = 'AuthError';
    }
}

export function repoNameFromItem(item) {
    // repository_url looks like https://api.github.com/repos/<owner>/<repo>
    const parts = (item.repository_url || '').split('/');
    return parts.slice(-2).join('/');
}

export function parseSearchResults(json) {
    return (json.items ?? []).map(item => ({
        number: item.number,
        title: item.title,
        repo: repoNameFromItem(item),
        url: item.html_url,
    }));
}

export class GitHubClient {
    /**
     * @param {object} deps
     * @param {() => Promise<string>} deps.execGh  stdout de `gh auth token`
     * @param {() => string|null} deps.getManualToken
     * @param {typeof fetch} [deps.fetchImpl]
     */
    constructor({execGh, getManualToken, fetchImpl = fetch}) {
        this._execGh = execGh;
        this._getManualToken = getManualToken;
        this._fetch = fetchImpl;
    }

    async _ghToken() {
        try {
            const token = (await this._execGh()).trim();
            return token.length > 0 ? token : null;
        } catch {
            return null;
        }
    }

    async hasValidGhAuth() {
        return (await this._ghToken()) !== null;
    }

    async resolveToken() {
        const token = (await this._ghToken()) ?? this._getManualToken();
        if (!token)
            throw new AuthError('sem token (rode "gh auth login" ou configure um token manual)');
        return token;
    }

    async _get(url, token) {
        const response = await this._fetch(url, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/vnd.github+json',
                'User-Agent': 'pr-indicator-windows',
            },
            signal: AbortSignal.timeout(15000),
        });
        if (response.status === 401)
            throw new AuthError(`GitHub respondeu ${response.status}`);
        if (!response.ok)
            throw new Error(`GitHub respondeu ${response.status}`);
        return response.json();
    }

    async _search(query, token) {
        const url = `https://api.github.com/search/issues?q=${encodeURIComponent(query)}&per_page=${MAX_ITEMS_PER_SECTION}`;
        return parseSearchResults(await this._get(url, token));
    }

    async fetchAll() {
        const token = await this.resolveToken();
        const [review, mine] = await Promise.all([
            this._search(QUERIES.review, token),
            this._search(QUERIES.mine, token),
        ]);
        return {review, mine};
    }

    async validateToken(token) {
        const json = await this._get('https://api.github.com/user', token);
        return json.login;
    }
}
