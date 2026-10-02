import {test} from 'node:test';
import assert from 'node:assert/strict';

import {computePopupPosition} from '../src/popup-position.js';

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

test('popup mais alto que a tela gruda no topo', () => {
    const tray = {x: 1700, y: 1040, width: 24, height: 32};
    assert.equal(computePopupPosition(tray, {width: 380, height: 2000}, workArea).y, GAP);
});
