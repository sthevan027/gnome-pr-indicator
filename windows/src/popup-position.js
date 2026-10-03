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

    if (tray.y >= bottom)
        return {x: clampX(centerX - size.width / 2), y: clampY(bottom - size.height - GAP)};

    // Ícone dentro da área útil (flyout do `^`): abre do lado que tem mais
    // espaço, sem cobrir o ícone.
    const above = tray.y - top;
    const below = bottom - (tray.y + tray.height);
    const y = below > above ? tray.y + tray.height + GAP : tray.y - size.height - GAP;
    return {x: clampX(centerX - size.width / 2), y: clampY(y)};
}

/**
 * Região de janela com cantos arredondados, como uma lista de retângulos (o
 * formato do `BrowserWindow.setShape`). Usada no tema Glass: a janela
 * transparente que o acrílico exige não ganha os cantos arredondados do
 * Windows, então o recorte é feito aqui, linha a linha nos cantos.
 */
export function roundedShape(width, height, radius) {
    const r = Math.min(radius, Math.floor(width / 2), Math.floor(height / 2));
    const rects = [];
    for (let y = 0; y < r; y++) {
        const dy = r - y - 0.5;
        const inset = Math.round(r - Math.sqrt(r * r - dy * dy));
        rects.push({x: inset, y, width: width - 2 * inset, height: 1});
        rects.push({x: inset, y: height - 1 - y, width: width - 2 * inset, height: 1});
    }
    rects.push({x: 0, y: r, width, height: height - 2 * r});
    return rects;
}
