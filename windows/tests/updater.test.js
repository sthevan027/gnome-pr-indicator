import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {test} from 'node:test';

import {canInstallUpdates, createUpdater, releaseUrl} from '../src/updater.js';

const quiet = {error() {}, warn() {}, log() {}};

// `result`: 'new' | 'same' | Error
function fakeAutoUpdater({result = 'new', downloadError = null} = {}) {
    const au = new EventEmitter();
    au.result = result;
    au.downloadError = downloadError;
    au.calls = {check: 0, download: 0, install: []};
    au.checkForUpdates = async () => {
        au.calls.check++;
        await null;
        if (au.result instanceof Error) {
            au.emit('error', au.result);
            throw au.result;
        }
        au.emit(au.result === 'new' ? 'update-available' : 'update-not-available', {version: '1.4.0'});
    };
    au.downloadUpdate = async () => {
        au.calls.download++;
        await null;
        if (au.downloadError) {
            au.emit('error', au.downloadError);
            throw au.downloadError;
        }
        au.emit('update-downloaded', {version: '1.4.0'});
    };
    au.quitAndInstall = (...args) => au.calls.install.push(args);
    return au;
}

function make(options = {}, extra = {}) {
    const au = fakeAutoUpdater(options);
    const updater = createUpdater({
        autoUpdater: au, currentVersion: '1.3.0', enabled: true, canInstall: true, log: quiet, ...extra,
    });
    return {au, updater};
}

test('configura o autoUpdater pra não baixar sozinho', () => {
    const {au} = make();
    assert.equal(au.autoDownload, false);
    assert.equal(au.autoInstallOnAppQuit, true);
});

test('canInstallUpdates: portátil e Linux sem AppImage não instalam', () => {
    assert.equal(canInstallUpdates({platform: 'win32', env: {}}), true);
    assert.equal(canInstallUpdates({platform: 'win32', env: {PORTABLE_EXECUTABLE_FILE: 'C:\\a.exe'}}), false);
    assert.equal(canInstallUpdates({platform: 'linux', env: {APPIMAGE: '/a.AppImage'}}), true);
    assert.equal(canInstallUpdates({platform: 'linux', env: {}}), false);
    assert.equal(canInstallUpdates({platform: 'darwin', env: {}}), false);
});

test('versão nova mostra a linha e não baixa nada', async () => {
    const {au, updater} = make();
    await updater.check();
    assert.deepEqual(updater.getState().row, {label: 'Versão 1.4.0 disponível · Baixar', action: 'download'});
    assert.equal(updater.getState().checkText, '');
    assert.equal(au.calls.download, 0);
});

test('checagem manual sem novidade', async () => {
    const {updater} = make({result: 'same'});
    await updater.check(true);
    assert.equal(updater.getState().row, null);
    assert.equal(updater.getState().checkText, 'Você está na versão mais recente');
});

test('falha: automática fica calada, manual avisa', async () => {
    const {updater} = make({result: new Error('sem rede')});
    await updater.check();
    assert.equal(updater.getState().checkText, '');
    assert.equal(updater.getState().row, null);
    await updater.check(true);
    assert.equal(updater.getState().checkText, '✗ não foi possível procurar atualizações');
});

test('falha numa nova checagem mantém a linha', async () => {
    const {au, updater} = make();
    await updater.check();
    au.result = new Error('sem rede');
    await updater.check();
    assert.equal(updater.getState().phase, 'available');
});

test('chamada manual durante a automática reaproveita e mostra o resultado', async () => {
    const {au, updater} = make({result: 'same'});
    const first = updater.check();
    const second = updater.check(true);
    assert.equal(updater.getState().checkText, 'Procurando…');
    await Promise.all([first, second]);
    assert.equal(au.calls.check, 1);
    assert.equal(updater.getState().checkText, 'Você está na versão mais recente');
});

test('baixar, ver progresso e instalar', async () => {
    const {au, updater} = make();
    await updater.check();
    const done = updater.download();
    au.emit('download-progress', {percent: 42.4});
    assert.deepEqual(updater.getState().row, {label: 'Baixando versão 1.4.0… 42%', action: null});
    await done;
    assert.deepEqual(updater.getState().row, {label: 'Versão 1.4.0 pronta · Reiniciar para atualizar', action: 'install'});
    updater.install();
    assert.deepEqual(au.calls.install, [[true, true]]);
});

test('duplo clique baixa uma vez só', async () => {
    const {au, updater} = make();
    await updater.check();
    await Promise.all([updater.download(), updater.download()]);
    assert.equal(au.calls.download, 1);
});

test('falha no download permite tentar de novo', async () => {
    const {au, updater} = make({downloadError: new Error('caiu')});
    await updater.check();
    await updater.download();
    assert.deepEqual(updater.getState().row, {label: 'Falha ao baixar · Tentar de novo', action: 'download'});
    au.downloadError = null;
    await updater.download();
    assert.equal(updater.getState().phase, 'ready');
});

test('checagem com versão pronta não mexe na linha', async () => {
    const {au, updater} = make();
    await updater.check();
    await updater.download();
    au.result = 'same';
    await updater.check(true);
    assert.equal(au.calls.check, 1);
    assert.equal(updater.getState().phase, 'ready');
    assert.equal(updater.getState().checkText, 'Versão 1.4.0 disponível');
});

test('onde não dá pra instalar só abre a página', async () => {
    const {au, updater} = make({}, {canInstall: false});
    await updater.check();
    assert.deepEqual(updater.getState().row, {label: 'Versão 1.4.0 disponível · Abrir download', action: 'open'});
    await updater.download();
    updater.install();
    assert.equal(au.calls.download, 0);
    assert.equal(au.calls.install.length, 0);
    assert.equal(updater.releasePageUrl(), releaseUrl('1.4.0'));
    assert.equal(releaseUrl('1.4.0'), 'https://github.com/sthevan027/gnome-pr-indicator/releases/tag/v1.4.0');
});

test('rodando pelo código-fonte não checa', async () => {
    const {au, updater} = make({}, {enabled: false});
    await updater.check(true);
    assert.equal(au.calls.check, 0);
    assert.equal(updater.getState().checkText, 'Atualização indisponível ao rodar pelo código-fonte');
});

test('checagem automática com resposta apaga o texto manual antigo', async () => {
    const {au, updater} = make();
    await updater.check(true);
    au.result = 'same';
    await updater.check();
    assert.equal(updater.getState().checkText, '');
    await updater.check(true);
    au.result = 'new';
    await updater.check();
    assert.equal(updater.getState().checkText, '');
});

test('falha automática mantém o texto da última manual', async () => {
    const {au, updater} = make();
    await updater.check(true);
    au.result = new Error('sem rede');
    await updater.check();
    assert.equal(updater.getState().checkText, 'Versão 1.4.0 disponível');
});
