// Desenha a imagem do ícone da bandeja num canvas: o logo do GitHub
// (path do icons/github-symbolic.svg) ou, no hover, só o número de PRs.
// O main chama via executeJavaScript e monta um nativeImage com uma
// representação por escala de DPI.
window.renderTrayIcon = function renderTrayIcon({kind, text, path, color}) {
    const scales = [1, 1.25, 1.5, 2];
    return scales.map(scale => {
        const size = Math.round(16 * scale);
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = color;

        if (kind === 'icon') {
            ctx.scale(size / 24, size / 24);
            ctx.fill(new Path2D(path));
        } else {
            // Fonte o maior possível que caiba em 16px de largura.
            let fontSize = size;
            const font = px => `bold ${px}px "Segoe UI", sans-serif`;
            ctx.font = font(fontSize);
            while (fontSize > 6 && ctx.measureText(text).width > size)
                ctx.font = font(--fontSize);
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(text, size / 2, size / 2 + scale);
        }

        return {scale, dataUrl: canvas.toDataURL('image/png')};
    });
};
