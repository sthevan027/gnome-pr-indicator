import {app, BrowserWindow, ipcMain, Menu, nativeImage, nativeTheme, net, powerMonitor, safeStorage, screen, shell, Tray} from 'electron';
import {exec} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {applySectionOrder, DEFAULT_SECTION_IDS, toggleHidden} from '../shared/sectionsConfig.js';
import {linuxAutostartPath, loginItemSettings, parseAutostartArg, setLinuxAutostart, shouldEnableOnFirstRun} from './autostart.js';
import {badgeText, tooltipText} from './badge.js';
import {AuthError, GitHubClient} from './github-client.js';
import {computeCornerPosition, computePopupPosition, roundedShape} from './popup-position.js';
import {electronCrypto, SettingsStore} from './settings-store.js';

const POLL_SECONDS = 60;
const POPUP_WIDTH = 360;
const THEMES = ['auto', 'white', 'black', 'glass'];
// Raio dos cantos do popup no tema Glass (escolhido pelo Sthevan).
const GLASS_RADIUS = 12;

const here = path.dirname(fileURLToPath(import.meta.url));
// No .exe o SVG vem em shared/ (copiado pelo electron-builder); em
// desenvolvimento, direto de icons/ na raiz do repositório.
const GITHUB_ICON_FILE = [
    path.join(here, '..', 'shared', 'github-symbolic.svg'),
    path.join(here, '..', '..', 'icons', 'github-symbolic.svg'),
].find(file => fs.existsSync(file));
const GITHUB_ICON_PATH = fs.readFileSync(GITHUB_ICON_FILE, 'utf8').match(/ d="([^"]+)"/)[1];

const IS_LINUX = process.platform === 'linux';
// Linux: sem `tray.getBounds()` nem `mouse-move`. O popup abre num canto da
// tela e o número fica sempre visível num selo sobre o logo.
const LINUX_BASE_SIZE = 22;
const LINUX_SCALES = [1, 1.5, 2];

if (IS_LINUX) {
    // Segue a sessão: Wayland nativo quando há WAYLAND_DISPLAY, senão X11.
    // (Forçar XWayland não serve: no KWin do KOS o popup "abre" pro Electron
    // mas a janela nunca aparece.) No Wayland o compositor escolhe onde a
    // janela aparece, então a posição pedida por PR_INDICATOR_CORNER só vale
    // no X11. PR_INDICATOR_OZONE=x11|wayland sobrepõe a escolha.
    const ozone = process.env.PR_INDICATOR_OZONE || (process.env.WAYLAND_DISPLAY ? 'wayland' : 'x11');
    app.commandLine.appendSwitch('ozone-platform', ozone);
}

app.setName('PR Indicator');
app.setAppUserModelId('PR Indicator');

// Modo de desenvolvimento/teste (documentado em windows/README.md):
// PR_INDICATOR_USER_DATA isola configurações/token numa pasta própria,
// PR_INDICATOR_FAKE troca o GitHub por um JSON e PR_INDICATOR_SNAPSHOT tira
// screenshots do popup e das imagens da bandeja e fecha o app.
if (process.env.PR_INDICATOR_USER_DATA)
    app.setPath('userData', process.env.PR_INDICATOR_USER_DATA);

// Liga/desliga o "abrir junto com a sessão": registro no Windows, .desktop
// em ~/.config/autostart no Linux.
function applyAutostart(enabled, packaged) {
    if (IS_LINUX) {
        setLinuxAutostart(enabled, {
            execPath: process.execPath,
            appPath: app.getAppPath(),
            packaged,
            appImage: process.env.APPIMAGE || null,
        }, fs, linuxAutostartPath(process.env, app.getPath('home')));
    } else {
        app.setLoginItemSettings(loginItemSettings(enabled, process.execPath, app.getAppPath(), packaged));
    }
}

const autostart = parseAutostartArg(process.argv);
if (autostart !== null) {
    applyAutostart(autostart, app.isPackaged);
    console.log(autostart ? 'PR Indicator vai abrir junto com a sessão.' : 'Autostart desligado.');
    app.exit(0);
} else if (!app.requestSingleInstanceLock()) {
    app.exit(0);
} else {
    // Abrir o app de novo (atalho, autostart duplicado) mostra o popup em
    // vez de não fazer nada.
    app.on('second-instance', () => {
        if (popup && tray && !popup.isVisible())
            togglePopup();
    });
    app.whenReady().then(start);
}

let tray = null;
let popup = null;
let store = null;
let client = null;
let lastHiddenAt = 0;
// Cache das imagens da bandeja: a chave inclui a cor e o valor é a Promise,
// assim renders simultâneos da mesma imagem não se duplicam.
const iconImages = new Map();
// Cada updateTray ganha um número; só o mais recente aplica a imagem, pra um
// render lento não sobrescrever um estado mais novo.
let trayGeneration = 0;
let popupHeight = 300;

// status: 'loading' | 'ok' | 'error'
const state = {
    status: 'loading',
    error: null,
    items: {review: [], mine: []},
    updatedAt: null,
    ghAuth: false,
    // true depois de uma busca que deu certo; volta a false no erro de auth.
    loaded: false,
};

function execGh() {
    return new Promise((resolve, reject) => {
        // Via shell (exec) pra achar também o gh instalado como shim .cmd (scoop etc.).
        exec('gh auth token', {windowsHide: true, timeout: 10000}, (err, stdout) => {
            if (err)
                reject(err);
            else
                resolve(stdout);
        });
    });
}

function trayIsDark() {
    // Só Windows/macOS têm um tema próprio da bandeja; no Linux vale o tema
    // do sistema.
    return IS_LINUX ? nativeTheme.shouldUseDarkColors : nativeTheme.shouldUseDarkColorsForSystemIntegratedUI;
}

// Cor do ícone da bandeja. O painel pode ter uma cor própria (a barra do
// KDE/Quickshell, por exemplo), então PR_INDICATOR_TRAY_COLOR=#rrggbb
// sobrepõe a escolha automática.
function trayColor() {
    const custom = process.env.PR_INDICATOR_TRAY_COLOR;
    if (custom && /^#[0-9a-f]{3,8}$/i.test(custom))
        return custom;
    return trayIsDark() ? '#ffffff' : '#1a1a1a';
}

function effectiveTheme() {
    const theme = store.getTheme();
    if (theme !== 'auto')
        return theme;
    return nativeTheme.shouldUseDarkColors ? 'auto-dark' : 'auto-light';
}

async function renderImage(kind, text, color) {
    const args = {kind, text, path: GITHUB_ICON_PATH, color};
    if (IS_LINUX) {
        args.base = LINUX_BASE_SIZE;
        args.scales = LINUX_SCALES;
    }
    const urls = await popup.webContents.executeJavaScript(`window.renderTrayIcon(${JSON.stringify(args)})`);
    const image = nativeImage.createEmpty();
    for (const {scale, dataUrl} of urls)
        image.addRepresentation({scaleFactor: scale, dataURL: dataUrl});
    return image;
}

function imageFor(kind, text = '') {
    const color = trayColor();
    const key = `${kind}:${text}:${color}`;
    if (!iconImages.has(key)) {
        const promise = renderImage(kind, text, color);
        promise.catch(() => iconImages.delete(key));
        iconImages.set(key, promise);
    }
    return iconImages.get(key);
}

function badgeState() {
    const badgeSection = store.getBadgeSection();
    return {
        status: state.status,
        error: state.error,
        badgeSection,
        count: (state.items?.[badgeSection] ?? []).length,
    };
}

async function updateTray() {
    if (!tray)
        return;
    const generation = ++trayGeneration;
    const badge = badgeState();
    tray.setToolTip(tooltipText(badge));
    // Ícone fixo com a contagem num selo no canto inferior direito, sem hover.
    const image = await imageFor('badge', badgeText(badge));
    if (generation === trayGeneration && tray)
        tray.setImage(image);
}

function viewState() {
    return {
        status: state.status,
        error: state.error,
        items: state.items,
        updatedAt: state.updatedAt,
        sections: store.getSectionsConfig(),
        theme: store.getTheme(),
        effectiveTheme: effectiveTheme(),
        badgeSection: store.getBadgeSection(),
        ghAuth: state.ghAuth,
        loaded: state.loaded,
        systemDark: nativeTheme.shouldUseDarkColors,
    };
}

function pushState() {
    popup?.webContents.send('state', viewState());
    updateTray();
}

function formatTime(date) {
    return date.toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'});
}

async function refreshOnce() {
    try {
        state.items = await client.fetchAll();
        state.loaded = true;
        state.status = 'ok';
        state.error = null;
        state.updatedAt = formatTime(new Date());
    } catch (e) {
        state.status = 'error';
        state.error = e.message;
        // Falha de autenticação limpa a lista; falha pontual (rede, 5xx,
        // rate limit) mantém a última lista boa.
        if (e instanceof AuthError) {
            state.items = {review: [], mine: []};
            state.loaded = false;
        }
        console.error('pr-indicator: refresh failed', e);
    }
    state.ghAuth = client.lastTokenSource === 'gh';
    pushState();
}

let refreshing = null;
let refreshPending = false;
async function refresh() {
    // Pedido durante outro refresh (token acabou de ser salvo, "Atualizar
    // agora" num fetch lento): roda mais uma vez no fim em vez de devolver
    // um resultado de antes do pedido.
    if (refreshing) {
        refreshPending = true;
        return refreshing;
    }
    refreshing = (async () => {
        do {
            refreshPending = false;
            await refreshOnce();
        } while (refreshPending);
    })();
    try {
        await refreshing;
    } finally {
        refreshing = null;
    }
}

function positionPopup() {
    // Linux: o ícone não tem posição conhecida; vale a tela principal e o
    // canto escolhido (PR_INDICATOR_CORNER: top-right, top-left,
    // bottom-right ou bottom-left).
    const bounds = IS_LINUX ? null : tray.getBounds();
    const display = IS_LINUX ? screen.getPrimaryDisplay() : screen.getDisplayNearestPoint({x: bounds.x, y: bounds.y});
    // Se o conteúdo não couber, a janela fica do tamanho da área útil e o
    // popup ganha rolagem.
    const size = {width: POPUP_WIDTH, height: Math.min(popupHeight, display.workArea.height - 16)};
    const {x, y} = IS_LINUX
        ? computeCornerPosition(display.workArea, size, process.env.PR_INDICATOR_CORNER)
        : computePopupPosition(bounds, size, display.workArea);
    popup.setBounds({x, y, ...size});
    if (popupIsGlass)
        popup.setShape(roundedShape(size.width, size.height, GLASS_RADIUS));
}

function togglePopup() {
    if (popup.isVisible()) {
        popup.hide();
        return;
    }
    // O clique no ícone tira o foco do popup (o `blur` já escondeu) e chega
    // logo depois; sem isso o popup reabriria na hora.
    if (Date.now() - lastHiddenAt < 250)
        return;
    positionPopup();
    popup.show();
    popup.focus();
}

// Glass: janela `transparent` com vidro escuro sem desfoque (o fundo vem do
// CSS), escolhido pelo Sthevan entre as variações testadas — o acrílico do
// Windows desfoca demais e, em janela opaca, vira cinza chapado sem foco.
// Como `transparent` só pode ser escolhido na criação (e tira os cantos
// arredondados e a sombra do Windows), a janela é recriada ao entrar ou sair
// do tema Glass e os cantos são recortados com `setShape`.
let popupIsGlass = false;

async function createPopup({view} = {}) {
    const glass = store.getTheme() === 'glass';
    const win = new BrowserWindow({
        width: POPUP_WIDTH,
        height: popupHeight,
        show: false,
        frame: false,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        ...(glass
            ? {transparent: true}
            : {roundedCorners: true, backgroundColor: '#00000000'}),
        webPreferences: {
            preload: path.join(here, 'preload.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        },
    });
    win.setMenu(null);
    win.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.on('blur', () => {
        if (win.isVisible()) {
            win.hide();
            lastHiddenAt = Date.now();
        }
    });
    await win.loadFile(path.join(here, 'renderer', 'popup.html'), {query: view ? {view} : {}});
    popupIsGlass = glass;
    return win;
}

async function recreatePopup() {
    const old = popup;
    const wasVisible = old.isVisible();
    // A troca de tema acontece no painel de config: a janela nova já abre nele.
    const next = await createPopup({view: 'config'});
    old.removeAllListeners('blur');
    popup = next;
    pushState();
    if (wasVisible) {
        positionPopup();
        popup.show();
        popup.focus();
    }
    old.destroy();
}

function isGitHubUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && url.host === 'github.com';
    } catch {
        return false;
    }
}

function registerIpc() {
    ipcMain.handle('get-state', () => viewState());
    ipcMain.on('refresh', () => refresh());
    ipcMain.on('hide', () => popup.hide());
    ipcMain.on('open-url', (_e, url) => {
        if (isGitHubUrl(url)) {
            shell.openExternal(url);
            popup.hide();
        }
    });
    ipcMain.on('toggle-section', (_e, id) => {
        if (!DEFAULT_SECTION_IDS.includes(id))
            return;
        store.setSectionsConfig(toggleHidden(store.getSectionsConfig(), id));
        pushState();
    });
    ipcMain.on('commit-section-order', (_e, orderedIds) => {
        if (!Array.isArray(orderedIds) || !orderedIds.every(id => DEFAULT_SECTION_IDS.includes(id)))
            return;
        store.setSectionsConfig(applySectionOrder(store.getSectionsConfig(), orderedIds));
        pushState();
    });
    ipcMain.on('set-theme', (_e, name) => {
        if (!THEMES.includes(name))
            return;
        store.setTheme(name);
        if ((name === 'glass') !== popupIsGlass)
            recreatePopup();
        else
            pushState();
    });
    ipcMain.on('set-badge-section', (_e, id) => {
        if (!DEFAULT_SECTION_IDS.includes(id))
            return;
        store.setBadgeSection(id);
        pushState();
    });
    ipcMain.handle('submit-token', async (_e, value) => {
        const token = String(value ?? '').trim();
        if (!token)
            return null;
        let login;
        try {
            login = await client.validateToken(token);
        } catch (e) {
            console.error('pr-indicator: falha ao validar token manual', e);
            return {ok: false, message: '✗ token inválido ou sem permissão'};
        }
        try {
            store.setToken(token);
        } catch (e) {
            console.error('pr-indicator: falha ao gravar token', e);
            return {ok: false, message: '✗ token válido, mas falhou ao salvar no cofre de senhas do sistema'};
        }
        refresh();
        return {ok: true, message: `✓ conectado como ${login}`};
    });
    ipcMain.on('resize', (_e, height) => {
        const next = Math.max(60, Math.min(Math.ceil(Number(height) || 0), 900));
        if (next === popupHeight)
            return;
        popupHeight = next;
        // Com a janela escondida só guarda a altura: o `setSize` não tem
        // efeito antes do primeiro show (janela não redimensionável) e o
        // `positionPopup` aplica a altura ao abrir.
        if (popup.isVisible())
            positionPopup();
    });
}

async function start() {
    store = new SettingsStore(app.getPath('userData'), electronCrypto(safeStorage));

    const autostartMarker = path.join(app.getPath('userData'), '.autostart-initialized');
    // No modo de teste (pasta de dados isolada) nunca mexe no registro.
    const testMode = Boolean(process.env.PR_INDICATOR_USER_DATA);
    if (!testMode && shouldEnableOnFirstRun({packaged: app.isPackaged, alreadyInitialized: fs.existsSync(autostartMarker)})) {
        applyAutostart(true, true);
        fs.writeFileSync(autostartMarker, '');
    }
    client = process.env.PR_INDICATOR_FAKE
        ? fakeClient(process.env.PR_INDICATOR_FAKE)
        // net.fetch usa a pilha de rede do Chromium: respeita o proxy e os
        // certificados do Windows (o fetch do Node ignora os dois).
        : new GitHubClient({execGh, getManualToken: () => store.getToken(), fetchImpl: net.fetch});

    registerIpc();
    popup = await createPopup();

    tray = new Tray(await imageFor('badge', badgeText(badgeState())));
    tray.setToolTip('PR Indicator');
    tray.on('click', togglePopup);
    if (IS_LINUX) {
        // No Linux (StatusNotifier) o clique direito abre um menu, não emite
        // `right-click`; sem "Sair" o app não teria como fechar.
        tray.setContextMenu(Menu.buildFromTemplate([
            {label: 'Abrir', click: () => { if (!popup.isVisible()) togglePopup(); }},
            {label: 'Atualizar agora', click: () => refresh()},
            {type: 'separator'},
            {label: 'Sair', click: () => app.quit()},
        ]));
    } else {
        tray.on('right-click', togglePopup);
    }

    // A cor do ícone faz parte da chave do cache, então basta redesenhar.
    nativeTheme.on('updated', pushState);
    // Ao voltar da suspensão a rede pode ter ficado em erro; não espera os 60s.
    powerMonitor.on('resume', () => setTimeout(refresh, 5000));

    pushState();
    const firstRefresh = refresh();
    setInterval(refresh, POLL_SECONDS * 1000);

    if (process.env.PR_INDICATOR_SNAPSHOT) {
        await firstRefresh;
        try {
            await snapshot(process.env.PR_INDICATOR_SNAPSHOT);
        } catch (e) {
            console.error('pr-indicator: snapshot falhou', e);
            app.exit(1);
        }
        app.exit(0);
    }
}

function fakeClient(file) {
    const read = () => JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
        lastTokenSource: null,
        async fetchAll() {
            const data = read();
            this.lastTokenSource = (data.ghAuth ?? true) ? 'gh' : 'manual';
            if (data.error === 'auth')
                throw new AuthError('sem token (rode "gh auth login" ou configure um token manual)');
            if (data.error)
                throw new Error(data.error);
            return {review: data.review ?? [], mine: data.mine ?? []};
        },
        validateToken: async token => {
            if (token !== 'valido')
                throw new Error('GitHub respondeu 401');
            return 'usuario-fake';
        },
    };
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function snapshot(dir) {
    fs.mkdirSync(dir, {recursive: true});
    const save = (name, image) => fs.writeFileSync(path.join(dir, name), image.toPNG());

    const text = badgeText(badgeState());
    save('tray-icon.png', (await imageFor('badge', text)).resize({width: 32, height: 32}));
    // O selo ampliado, pra dar pra ver no screenshot.
    save('tray-badge.png', (await imageFor('badge', text)).resize({width: 128, height: 128}));
    fs.writeFileSync(path.join(dir, 'tooltip.txt'), tooltipText(badgeState()));

    positionPopup();
    popup.showInactive();
    for (const view of ['pr', 'config']) {
        await popup.webContents.executeJavaScript(
            `document.getElementById('${view === 'pr' ? 'back' : 'settings'}').click()`);
        await delay(400);
        save(`popup-${view}.png`, await popup.webContents.capturePage());
    }
    fs.writeFileSync(path.join(dir, 'bounds.json'), JSON.stringify({
        popup: popup.getBounds(), tray: tray.getBounds(),
    }, null, 2));
}
