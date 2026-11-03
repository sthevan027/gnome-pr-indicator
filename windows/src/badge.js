// Texto do selo no canto do ícone da bandeja.
export function badgeText({status, count}) {
    if (status === 'loading')
        return '…';
    if (status === 'error')
        return '!';
    return count > 99 ? '99+' : String(count);
}

export function tooltipText({status, count, badgeSection, error}) {
    if (status === 'error')
        return `PR Indicator — Erro: ${error}`;
    if (status !== 'ok')
        return 'PR Indicator';
    if (badgeSection === 'mine')
        return `PR Indicator — ${count} ${count === 1 ? 'PR meu aberto' : 'PRs meus abertos'}`;
    return `PR Indicator — ${count} ${count === 1 ? 'PR' : 'PRs'} pra eu revisar`;
}
