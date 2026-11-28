# Atualização dentro do app — Implementation Plan

> **For agentic workers:** execute as tarefas na ordem, marcando os checkboxes. **Não faça commit, push, tag nem release.**

**Goal:** O app da bandeja avisa que há versão nova no popup e só baixa/instala quando o usuário clica.

**Architecture:** `src/updater.js` é uma máquina de estados pura (sem importar `electron`) que recebe o `autoUpdater` por parâmetro e já devolve os textos que a tela mostra. `main.js` liga o `electron-updater`, inclui o estado em `viewState()` e expõe quatro IPCs; o renderer só desenha.

**Tech Stack:** Electron 44, ESM, `electron-updater` 6.x, electron-builder 26, `node --test`.

**Spec:** [../specs/2026-11-27-atualizacao-no-app-design.md](../specs/2026-11-27-atualizacao-no-app-design.md)

## Global Constraints

- Trabalhar só em `windows/` e `.github/workflows/release.yml`. Não tocar na extensão GNOME.
- Nada é baixado sem clique: `autoDownload = false`. `autoInstallOnAppQuit = true`.
- Checagem ao iniciar, a cada 6 horas e pelo botão `Procurar atualizações`.
- Versão nova do app: `1.3.0`.
- Repositório das releases: `sthevan027/gnome-pr-indicator`.
- Textos em português, copiados exatamente deste plano.
- Comentários em português, no estilo do código existente (4 espaços, aspas simples, `{a, b}` sem espaços).
- CSP do popup é `default-src 'self'`: sem estilo ou script inline.

## Review Focus

- Checagem automática sem rede: nada aparece na tela; uma linha já visível continua.
- Checagem enquanto baixa ou com versão pronta: a linha não muda.
- Duplo clique em "Baixar": um único download.
- Versão portátil: nunca chama `downloadUpdate` nem `quitAndInstall`.
- Linux empacotado sem AppImage: o `electron-updater` não checa por padrão (`checkForUpdates()` devolve `null`); precisa de `forceDevUpdateConfig = true`.

---

### Task 1: Máquina de estados (`updater.js`)

**Files:**
- Create: `windows/src/updater.js`
- Test: `windows/tests/updater.test.js`

**Interfaces — Produces:**

```js
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
export function releaseUrl(version) // 'https://github.com/sthevan027/gnome-pr-indicator/releases/tag/v<version>'
export function canInstallUpdates({platform, env}) // win32: !env.PORTABLE_EXECUTABLE_FILE; linux: Boolean(env.APPIMAGE); outros: false
export function createUpdater({autoUpdater, currentVersion, enabled, canInstall, onChange = () => {}, log = console})
// devolve {getState(), check(manual = false): Promise<void>, download(): Promise<void>, install(), releasePageUrl(): string|null}
```

`getState()` devolve:

```js
{
    currentVersion: '1.3.0',
    enabled: true,
    phase: 'none' | 'available' | 'downloading' | 'ready' | 'downloadError',
    version: null,          // versão nova, quando phase !== 'none'
    percent: 0,             // inteiro 0–100
    row: null | {label: string, action: 'download' | 'open' | 'install' | null},
    checkText: string,      // linha de status nas configurações
    checking: boolean,
}
```

`row` por fase (X = versão nova):

| phase | canInstall | label | action |
|---|---|---|---|
| none | — | `row = null` | |
| available | true | `Versão X disponível · Baixar` | `download` |
| available | false | `Versão X disponível · Abrir download` | `open` |
| downloading | true | `Baixando versão X… 42%` | `null` |
| ready | true | `Versão X pronta · Reiniciar para atualizar` | `install` |
| downloadError | true | `Falha ao baixar · Tentar de novo` | `download` |

`checkText`:

| Situação | Texto |
|---|---|
| `enabled = false` | `Atualização indisponível ao rodar pelo código-fonte` |
| checagem manual em andamento | `Procurando…` |
| última manual: sem novidade | `Você está na versão mais recente` |
| última manual: há versão (ou já baixando/pronta) | `Versão X disponível` |
| última manual: falhou | `✗ não foi possível procurar atualizações` |
| nenhuma checagem manual | `''` |

Regras:

- O construtor define `autoUpdater.autoDownload = false` e `autoUpdater.autoInstallOnAppQuit = true` e assina os eventos `update-available` (`info.version`), `update-not-available`, `download-progress` (`progress.percent`), `update-downloaded` (`info.version`) e `error` (só registra no log; sem listener o EventEmitter lança).
- `check()`: não faz nada se `!enabled`. Se `phase` é `downloading` ou `ready`, não chama o `autoUpdater`; se manual, mostra `Versão X disponível`. Com checagem em andamento, devolve a mesma Promise, e uma chamada manual a promove a manual. Nunca rejeita. Falha mantém `phase`.
- `update-available` e `update-not-available` são ignorados se `phase` é `downloading` ou `ready`.
- `download()`: só age com `canInstall` e `phase` `available` ou `downloadError`. Muda a fase **antes** do primeiro `await`. Nunca rejeita; falha → `downloadError`.
- `download-progress` só vale em `downloading`.
- `install()`: só com `phase === 'ready'`; chama `autoUpdater.quitAndInstall(true, true)`.
- `releasePageUrl()`: `releaseUrl(version)` ou `null`.
- Toda mudança de estado chama `onChange()`.

- [ ] **Step 1: Escrever o teste** em `windows/tests/updater.test.js`

```js
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
```

- [ ] **Step 2:** `cd windows && npm test` — esperado: falha porque `src/updater.js` não existe.
- [ ] **Step 3:** implementar `windows/src/updater.js` conforme as interfaces e regras acima.
- [ ] **Step 4:** `npm test` — esperado: `fail 0`.

### Task 2: Ligar no app

**Files:**
- Modify: `windows/package.json` (dependência), `windows/package-lock.json`, `windows/bun.lock`
- Modify: `windows/src/main.js` (imports, `viewState`, `registerIpc`, `start`)
- Modify: `windows/src/preload.cjs`
- Modify: `windows/src/renderer/popup.html`, `popup.js`, `popup.css`

**Interfaces — Consumes:** Task 1. **Produces:** `viewState().update` = `getState()`; em `window.prIndicator`: `checkUpdate()`, `downloadUpdate()`, `installUpdate()`, `openRelease()` nos canais `check-update`, `download-update`, `install-update`, `open-release`.

- [ ] **Step 1:** em `windows/`, rodar `npm install electron-updater@^6` (fica em `dependencies`) e `bun install --lockfile-only`.
- [ ] **Step 2:** `main.js`
  - Import (o pacote é CommonJS): `import electronUpdater from 'electron-updater';`. Só acessar `electronUpdater.autoUpdater` dentro de `start()`.
  - Em `start()`, **antes** de `registerIpc()`: se `process.platform === 'linux' && !process.env.APPIMAGE`, `autoUpdater.forceDevUpdateConfig = true` — somente quando `app.isPackaged`. Criar o updater com `currentVersion: app.getVersion()`, `enabled: app.isPackaged`, `canInstall: canInstallUpdates({platform: process.platform, env: process.env})`, `onChange: pushState`. Guardar numa variável `updater` no topo, junto de `store` e `client`.
  - `onChange` pode disparar antes de a bandeja e o popup existirem; `pushState` já tolera (`popup?.`, `if (!tray)`). Não chamar `check()` antes de o popup e a bandeja serem criados.
  - Depois do `pushState()` final: `updater.check(); setInterval(() => updater.check(), CHECK_INTERVAL_MS);`. No modo `PR_INDICATOR_USER_DATA` isso continua valendo (em dev o updater fica desligado).
  - `viewState()` ganha `update: updater.getState()`.
  - `pushState` hoje redesenha a bandeja a cada chamada; não precisa mudar.
  - IPCs: `check-update` → `updater.check(true)`; `download-update` → `updater.download()`; `install-update` → `updater.install()`; `open-release` → se `releasePageUrl()` não for null, `shell.openExternal(url)` e `popup.hide()`. A URL nunca vem do renderer.
- [ ] **Step 3:** `preload.cjs`: os quatro métodos, com `ipcRenderer.send`.
- [ ] **Step 4:** `popup.html`
  - Dentro de `#pr-view`, antes de `.refresh-row`: `<button id="update-row" class="popup-menu-item pr-indicator-update" type="button" hidden></button>`.
  - No fim de `#config-view`: título `pr-indicator-section-title` com texto `Atualização`; `<div id="update-version" class="popup-menu-item"></div>`; `<button id="check-update" class="popup-menu-item" type="button">Procurar atualizações</button>`; `<div id="update-check" class="popup-menu-item pr-indicator-empty"></div>`.
- [ ] **Step 5:** `popup.js`: função `renderUpdate(state)` chamada em `render`.
  - `#update-row`: `hidden = !row`; `textContent = row.label`; `disabled = row.action === null`; `title` igual ao texto. O clique usa a `action` do estado atual (`current.update.row`): `download` → `api.downloadUpdate()`, `open` → `api.openRelease()`, `install` → `api.installUpdate()`. Um único listener, registrado fora do render.
  - `#update-version`: `Versão atual: <currentVersion>`.
  - `#check-update`: `disabled = !enabled || checking`; clique → `api.checkUpdate()`.
  - `#update-check`: `textContent = checkText`; `hidden = !checkText`.
- [ ] **Step 6:** `popup.css`: `.pr-indicator-update` com `color: var(--accent)`, `font-weight: bold`, reticências em texto longo; `button.popup-menu-item:disabled` sem fundo de hover. `#check-update:disabled` com `opacity: 0.5`.
- [ ] **Step 7:** `npm test` (`fail 0`) e `node --check src/main.js`.

### Task 3: Empacotamento, release e documentação

**Files:**
- Modify: `windows/package.json`, `windows/package-lock.json`, `.github/workflows/release.yml`, `windows/README.md`

- [ ] **Step 1:** `npm version 1.3.0 --no-git-tag-version`.
- [ ] **Step 2:** `package.json`: em `build`, adicionar `"publish": {"provider": "github", "owner": "sthevan027", "repo": "gnome-pr-indicator"}`; scripts: `"dist": "electron-builder --win --publish never"`, `"dist:linux": "electron-builder --linux --publish never"`.
- [ ] **Step 3:** `release.yml`: no artefato `windows`, adicionar `windows/dist/latest.yml` e `windows/dist/PR-Indicator-Setup-*.exe.blockmap`; no artefato `linux`, `windows/dist/latest-linux.yml`. Não mudar mais nada.
- [ ] **Step 4:** `windows/README.md`: nova seção `## Atualização` depois de `## Instalação`, explicando: quando procura; nada baixa sem clique; instala ao reiniciar ou ao sair; portátil e Linux fora do AppImage só abrem a página; versões até 1.2.2 precisam instalar a 1.3.0 à mão; binários não assinados, integridade por HTTPS e SHA-512 do `latest.yml`. Incluir `src/updater.js` no bloco `## Estrutura`.
- [ ] **Step 5:** `npm run dist` — esperado: `dist/latest.yml` (campo `path: PR-Indicator-Setup-1.3.0.exe`), `dist/PR-Indicator-Setup-1.3.0.exe.blockmap` e `dist/win-unpacked/resources/app-update.yml`.

---

## Verificação final (feita pelo revisor, não pelo implementador)

- Revisar o diff contra a spec e o Review Focus.
- Rodar o app empacotado contra um servidor local com versão maior; conferir os textos na tela e o download.
