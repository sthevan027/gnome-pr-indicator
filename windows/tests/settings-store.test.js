import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {SettingsStore} from '../src/settings-store.js';

// Cifra de mentira: só inverte e marca, o suficiente pra provar que o
// token nunca vai pro disco em texto plano.
const fakeCrypto = {
    isAvailable: () => true,
    encrypt: text => Buffer.from(`enc:${[...text].reverse().join('')}`),
    decrypt: buf => [...buf.toString().slice(4)].reverse().join(''),
};

function tempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'pr-indicator-test-'));
}

test('sem arquivo usa os padrões do gschema', () => {
    const store = new SettingsStore(tempDir(), fakeCrypto);
    assert.deepEqual(store.getSectionsConfig(),
        [{id: 'review', hidden: false}, {id: 'mine', hidden: false}]);
    assert.equal(store.getTheme(), 'auto');
    assert.equal(store.getBadgeSection(), 'review');
});

test('grava e relê ordem, ocultas, tema e badge', () => {
    const dir = tempDir();
    const store = new SettingsStore(dir, fakeCrypto);
    store.setSectionsConfig([{id: 'mine', hidden: false}, {id: 'review', hidden: true}]);
    store.setTheme('glass');
    store.setBadgeSection('mine');

    const again = new SettingsStore(dir, fakeCrypto);
    assert.deepEqual(again.getSectionsConfig(),
        [{id: 'mine', hidden: false}, {id: 'review', hidden: true}]);
    assert.equal(again.getTheme(), 'glass');
    assert.equal(again.getBadgeSection(), 'mine');

    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
    assert.deepEqual(raw.sections, ['mine', 'review']);
    assert.deepEqual(raw['hidden-sections'], ['review']);
});

test('JSON corrompido cai nos padrões', () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'settings.json'), '{oops');
    const store = new SettingsStore(dir, fakeCrypto);
    assert.equal(store.getTheme(), 'auto');
});

test('valores inválidos caem no padrão', () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({theme: 'rosa', 'badge-section': 'x'}));
    const store = new SettingsStore(dir, fakeCrypto);
    assert.equal(store.getTheme(), 'auto');
    assert.equal(store.getBadgeSection(), 'review');
});

test('avisa quem está ouvindo quando muda', () => {
    const store = new SettingsStore(tempDir(), fakeCrypto);
    let calls = 0;
    store.onChanged(() => calls++);
    store.setTheme('black');
    assert.equal(calls, 1);
});

test('token: cifrado no disco, relido, apagado', () => {
    const dir = tempDir();
    const store = new SettingsStore(dir, fakeCrypto);
    assert.equal(store.getToken(), null);

    store.setToken('ghp_segredo');
    const onDisk = fs.readFileSync(path.join(dir, 'token.bin'));
    assert.ok(!onDisk.toString().includes('ghp_segredo'));
    assert.equal(new SettingsStore(dir, fakeCrypto).getToken(), 'ghp_segredo');

    store.clearToken();
    assert.equal(store.getToken(), null);
});

test('token: sem cifra disponível recusa salvar', () => {
    const store = new SettingsStore(tempDir(), {...fakeCrypto, isAvailable: () => false});
    assert.throws(() => store.setToken('x'));
});
