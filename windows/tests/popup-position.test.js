import {test} from 'node:test';
import assert from 'node:assert/strict';

import {computePopupPosition, roundedShape} from '../src/popup-position.js';

const GAP = 8;
// Tela 1920x1080 com barra de tarefas de 48px embaixo.
const workArea = {x: 0, y: 0, width: 1920, height: 1032};
const size = {width: 380, height: 300};

test('barra embaixo: abre pra cima, centrado no ícone', () => {
    const tray = {x: 1700, y: 1040, width: 24, height: 32};
    assert.deepEqual(computePopupPosition(tray, size, workArea),
        {x: 1700 + 12 - 190, y: 1032 - 300 - GAP});
});

test('não passa da borda direita', () => {
    const tray = {x: 1890, y: 1040, width: 24, height: 32};
    assert.equal(computePopupPosition(tray, size, workArea).x, 1920 - 380 - GAP);
});

test('não passa da borda esquerda', () => {
    const tray = {x: 5, y: 1040, width: 24, height: 32};
    assert.equal(computePopupPosition(tray, size, workArea).x, GAP);
});

test('barra em cima: abre pra baixo', () => {
    const top = {x: 0, y: 48, width: 1920, height: 1032};
    const tray = {x: 1700, y: 8, width: 24, height: 32};
    assert.deepEqual(computePopupPosition(tray, size, top), {x: 1522, y: 48 + GAP});
});

test('barra na direita: abre à esquerda, alinhado ao ícone', () => {
    const right = {x: 0, y: 0, width: 1872, height: 1080};
    const tray = {x: 1884, y: 900, width: 24, height: 24};
    const pos = computePopupPosition(tray, size, right);
    assert.equal(pos.x, 1872 - 380 - GAP);
    assert.equal(pos.y, 900 + 12 - 150);
});

test('barra em cima com ícone no flyout do ^: abre abaixo do ícone', () => {
    const top = {x: 0, y: 32, width: 1920, height: 1048};
    const tray = {x: 1646, y: 49, width: 40, height: 40};
    const pos = computePopupPosition(tray, {width: 360, height: 518}, top);
    assert.equal(pos.y, 49 + 40 + GAP);
});

test('barra embaixo com ícone no flyout do ^: abre acima do ícone', () => {
    const tray = {x: 1646, y: 950, width: 40, height: 40};
    const pos = computePopupPosition(tray, size, workArea);
    assert.equal(pos.y, 950 - 300 - GAP);
});

test('popup mais alto que a tela gruda no topo', () => {
    const tray = {x: 1700, y: 1040, width: 24, height: 32};
    assert.equal(computePopupPosition(tray, {width: 380, height: 2000}, workArea).y, GAP);
});

test('roundedShape cobre a janela inteira menos os cantos', () => {
    const rects = roundedShape(100, 50, 8);
    const area = rects.reduce((sum, r) => sum + r.width * r.height, 0);
    // Menor que o retângulo cheio, mas só pelos 4 cantos (< 4 * r²).
    assert.ok(area < 100 * 50 && area > 100 * 50 - 4 * 8 * 8);
    // Linha do topo é recuada; o meio vai de ponta a ponta.
    assert.ok(rects[0].x > 0);
    assert.deepEqual(rects.at(-1), {x: 0, y: 8, width: 100, height: 34});
    assert.ok(rects.every(r => r.x >= 0 && r.x + r.width <= 100 && r.y >= 0 && r.y + r.height <= 50));
});

test('roundedShape limita o raio a metade do tamanho', () => {
    const rects = roundedShape(10, 6, 8);
    assert.ok(rects.every(r => r.height >= 0 && r.width >= 0));
});
