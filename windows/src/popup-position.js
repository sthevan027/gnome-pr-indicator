const GAP = 8;

function clamp(value, min, max) {
    return Math.max(min, Math.min(value, max));
}

/**
 * Onde abrir o popup pra ele ficar colado no ícone da bandeja, do lado
 * certo da barra de tarefas (que pode estar em qualquer borda) e sem sair
 * da área útil da tela.
 */
export function computePopupPosition(tray, size, workArea) {
    const left = workArea.x;
    const top = workArea.y;
    const right = workArea.x + workArea.width;
    const bottom = workArea.y + workArea.height;

    const centerX = tray.x + tray.width / 2;
    const centerY = tray.y + tray.height / 2;
    const clampX = x => clamp(Math.round(x), left + GAP, right - size.width - GAP);
    const clampY = y => clamp(Math.round(y), top + GAP, bottom - size.height - GAP);

    if (tray.x >= right)
        return {x: right - size.width - GAP, y: clampY(centerY - size.height / 2)};
    if (tray.x + tray.width <= left)
        return {x: left + GAP, y: clampY(centerY - size.height / 2)};
    if (tray.y + tray.height <= top)
        return {x: clampX(centerX - size.width / 2), y: top + GAP};

    // Barra embaixo (padrão do Windows) ou ícone dentro da área de
    // transbordamento: abre pra cima.
    const y = tray.y >= bottom ? bottom - size.height - GAP : tray.y - size.height - GAP;
    return {x: clampX(centerX - size.width / 2), y: clampY(y)};
}
