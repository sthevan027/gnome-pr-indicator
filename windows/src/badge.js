// Texto que aparece no lugar do ícone quando o mouse passa por cima —
// o mesmo que o `_countLabel` mostra ao lado do ícone no painel do GNOME.
export function badgeText({status, count}) {
    if (status === 'loading')
        return '…';
    if (status === 'error')
        return '!';
    return count > 99 ? '99+' : String(count);
}

export function isInside(point, bounds) {
    return point.x >= bounds.x && point.x < bounds.x + bounds.width &&
        point.y >= bounds.y && point.y < bounds.y + bounds.height;
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
