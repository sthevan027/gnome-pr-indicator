// Desenha a imagem do ícone da bandeja num canvas: o logo do GitHub
// (path do icons/github-symbolic.svg) com o número de PRs num selo
// no canto inferior direito, sempre visível (`kind: 'badge'`).
// O main chama via executeJavaScript e monta um nativeImage com uma
// representação por escala de DPI.
window.renderTrayIcon = function renderTrayIcon({kind, text, path, color, base = 16, scales = [1, 1.25, 1.5, 2]}) {
    return scales.map(scale => {
        const size = Math.round(base * scale);
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = color;

        ctx.save();
        ctx.scale(size / 24, size / 24);
        ctx.fill(new Path2D(path));
        ctx.restore();
        if (kind === 'badge' && text)
            drawBadge(ctx, size, text, color);

        return {scale, dataUrl: canvas.toDataURL('image/png')};
    });
};

// Selo no canto inferior direito: cápsula na cor do ícone com o número
// vazado (recortado), pra funcionar em fundo claro e escuro.
function drawBadge(ctx, size, text, color) {
    const height = Math.round(size * 0.55);
    let fontSize = Math.round(height * 0.82);
    const font = px => `bold ${px}px "Noto Sans", "Segoe UI", sans-serif`;
    ctx.font = font(fontSize);
    const padding = Math.max(2, Math.round(size * 0.1));
    let width = Math.ceil(ctx.measureText(text).width) + padding * 2;
    while (width > size && fontSize > 6) {
        ctx.font = font(--fontSize);
        width = Math.ceil(ctx.measureText(text).width) + padding * 2;
    }
    width = Math.max(width, height);
    const x = size - width;
    const y = size - height;

    // Abre um vão ao redor do selo pra ele se destacar do logo.
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    roundRect(ctx, x - 1, y - 1, width + 2, height + 2, (height + 2) / 2);
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = color;
    roundRect(ctx, x, y, width, height, height / 2);
    ctx.fill();

    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + width / 2, y + height / 2 + 0.5);
    ctx.restore();
}

function roundRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + width, y, x + width, y + height, radius);
    ctx.arcTo(x + width, y + height, x, y + height, radius);
    ctx.arcTo(x, y + height, x, y, radius);
    ctx.arcTo(x, y, x + width, y, radius);
    ctx.closePath();
}
