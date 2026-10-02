import {app, BrowserWindow, ipcMain, nativeImage, nativeTheme, safeStorage, screen, shell, Tray} from 'electron';
import {execFile} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {toggleHidden} from '../../lib/sectionsConfig.js';
import {loginItemSettings, parseAutostartArg} from './autostart.js';
import {badgeText, isInside, tooltipText} from './badge.js';
import {AuthError, GitHubClient} from './github-client.js';
import {computePopupPosition} from './popup-position.js';
import {applySectionOrder, electronCrypto, SettingsStore} from './settings-store.js';

const POLL_SECONDS = 60;
const POPUP_WIDTH = 360;
const HOVER_CHECK_MS = 150;

const here = path.dirname(fileURLToPath(import.meta.url));
const GITHUB_ICON_PATH = fs.readFileSync(path.join(here, '..', '..', 'icons', 'github-symbolic.svg'), 'utf8')
    .match(/ d="([^"]+)"/)[1];

app.setName('PR Indicator');
app.setAppUserModelId('PR Indicator');

// Modo de desenvolvimento/teste (documentado em windows/README.md):
// PR_INDICATOR_USER_DATA isola configurações/token numa pasta própria,
// PR_INDICATOR_FAKE troca o GitHub por um JSON e PR_INDICATOR_SNAPSHOT tira
// screenshots do popup e das imagens da bandeja e fecha o app.
if (process.env.PR_INDICATOR_USER_DATA)
    app.setPath('userData', process.env.PR_INDICATOR_USER_DATA);

const autostart = parseAutostartArg(process.argv);
if (autostart !== null) {
    app.setLoginItemSettings(loginItemSettings(autostart, process.execPath, app.getAppPath()));
    console.log(autostart ? 'PR Indicator vai abrir junto com o Windows.' : 'Autostart desligado.');
    app.exit(0);
} else if (!app.requestSingleInstanceLock()) {
    app.exit(0);
} else {
    app.whenReady().then(start);
}

let tray = null;
let popup = null;
let store = null;
let client = null;
let lastHiddenAt = 0;
let hovering = false;
let hoverTimer = null;
let iconImages = {};
let popupHeight = 300;

// status: 'loading' | 'ok' | 'error'
const state = {
    status: 'loading',
    error: null,
    items: {review: [], mine: []},
    updatedAt: null,
    ghAuth: false,
};

function execGh() {
    return new Promise((resolve, reject) => {
        execFile('gh', ['auth', 'token'], {windowsHide: true, timeout: 10000}, (err, stdout) => {
            if (err)
                reject(err);
            else
                resolve(stdout);
        });
    });
}

function trayIsDark() {
    return nativeTheme.shouldUseDarkColorsForSystemIntegratedUI;
}

function effectiveTheme() {
    const theme = store.getTheme();
    if (theme !== 'auto')
        return theme;
    return nativeTheme.shouldUseDarkColors ? 'auto-dark' : 'auto-light';
}

async function renderImage(kind, text = '') {
    const args = {kind, text, path: GITHUB_ICON_PATH, color: trayIsDark() ? '#ffffff' : '#1a1a1a'};
    const urls = await popup.webContents.executeJavaScript(`window.renderTrayIcon(${JSON.stringify(args)})`);
    const image = nativeImage.createEmpty();
    for (const {scale, dataUrl} of urls)
        image.addRepresentation({scaleFactor: scale, dataURL: dataUrl});
    return image;
}

async function imageFor(key, kind, text) {
    if (!iconImages[key])
        iconImages[key] = await renderImage(kind, text);
    return iconImages[key];
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
    const badge = badgeState();
    tray.setToolTip(tooltipText(badge));
    if (hovering) {
        const text = badgeText(badge);
        tray.setImage(await imageFor(`text:${text}`, 'text', text));
    } else {
        tray.setImage(await imageFor('icon', 'icon'));
    }
}

function stopHover() {
    hovering = false;
    clearInterval(hoverTimer);
    hoverTimer = null;
    updateTray();
}

function onTrayMouseMove() {
    if (hovering)
        return;
    hovering = true;
    updateTray();
    // No Windows o Tray só emite `mouse-move` (não há `mouse-leave`), então
    // a saída do mouse é detectada olhando a posição do cursor.
    hoverTimer = setInterval(() => {
        if (!tray || !isInside(screen.getCursorScreenPoint(), tray.getBounds()))
            stopHover();
    }, HOVER_CHECK_MS);
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
    };
}

function pushState() {
    popup?.webContents.send('state', viewState());
    updateTray();
}

function applyWindowMaterial() {
    if (!popup)
        return;
    if (store.getTheme() === 'glass') {
        popup.setBackgroundColor('#00000000');
        popup.setBackgroundMaterial('acrylic');
    } else {
        popup.setBackgroundMaterial('none');
        popup.setBackgroundColor('#00000000');
    }
}

function formatTime(date) {
    return date.toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'});
}

let refreshing = null;
async function refresh() {
    if (refreshing)
        return refreshing;
    refreshing = (async () => {
        state.ghAuth = await client.hasValidGhAuth();
        try {
            state.items = await client.fetchAll();
            state.status = 'ok';
            state.error = null;
            state.updatedAt = formatTime(new Date());
        } catch (e) {
            state.status = 'error';
            state.error = e.message;
            // Falha de autenticação limpa a lista; falha pontual (rede, 5xx,
            // rate limit) mantém a última lista boa.
            if (e instanceof AuthError)
                state.items = {review: [], mine: []};
            console.error('pr-indicator: refresh failed', e);
        }
        pushState();
    })();
    try {
        await refreshing;
    } finally {
        refreshing = null;
    }
}

function positionPopup() {
    const bounds = tray.getBounds();
    const display = screen.getDisplayNearestPoint({x: bounds.x, y: bounds.y});
    const size = {width: POPUP_WIDTH, height: popupHeight};
    const {x, y} = computePopupPosition(bounds, size, display.workArea);
    popup.setBounds({x, y, ...size});
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

function createPopup() {
    popup = new BrowserWindow({
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
        roundedCorners: true,
        backgroundColor: '#00000000',
        webPreferences: {
            preload: path.join(here, 'preload.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        },
    });
    popup.setMenu(null);
    popup.on('blur', () => {
        if (popup.isVisible()) {
            popup.hide();
            lastHiddenAt = Date.now();
        }
    });
    applyWindowMaterial();
    return popup.loadFile(path.join(here, 'renderer', 'popup.html'));
}

function registerIpc() {
    ipcMain.handle('get-state', () => viewState());
    ipcMain.on('refresh', () => refresh());
    ipcMain.on('hide', () => popup.hide());
    ipcMain.on('open-url', (_e, url) => {
        if (typeof url === 'string' && url.startsWith('https://github.com/')) {
            shell.openExternal(url);
            popup.hide();
        }
    });
    ipcMain.on('toggle-section', (_e, id) => {
        store.setSectionsConfig(toggleHidden(store.getSectionsConfig(), id));
        pushState();
    });
    ipcMain.on('commit-section-order', (_e, orderedIds) => {
        store.setSectionsConfig(applySectionOrder(store.getSectionsConfig(), orderedIds));
        pushState();
    });
    ipcMain.on('set-theme', (_e, name) => {
        store.setTheme(name);
        applyWindowMaterial();
        pushState();
    });
    ipcMain.on('set-badge-section', (_e, id) => {
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
            return {ok: false, message: '✗ token válido, mas falhou ao salvar no cofre de senhas do Windows'};
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
    client = process.env.PR_INDICATOR_FAKE
        ? fakeClient(process.env.PR_INDICATOR_FAKE)
        : new GitHubClient({execGh, getManualToken: () => store.getToken()});

    registerIpc();
    await createPopup();

    tray = new Tray(await imageFor('icon', 'icon'));
    tray.setToolTip('PR Indicator');
    tray.on('click', togglePopup);
    tray.on('right-click', togglePopup);
    tray.on('mouse-move', onTrayMouseMove);

    nativeTheme.on('updated', () => {
        iconImages = {};
        pushState();
    });

    pushState();
    const firstRefresh = refresh();
    setInterval(refresh, POLL_SECONDS * 1000);

    if (process.env.PR_INDICATOR_SNAPSHOT) {
        await firstRefresh;
        await snapshot(process.env.PR_INDICATOR_SNAPSHOT);
        app.exit(0);
    }
}

function fakeClient(file) {
    const read = () => JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
        hasValidGhAuth: async () => read().ghAuth ?? true,
        fetchAll: async () => {
            const data = read();
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

    save('tray-icon.png', (await imageFor('icon', 'icon')).resize({width: 32, height: 32}));
    const text = badgeText(badgeState());
    save('tray-hover.png', (await imageFor(`text:${text}`, 'text', text)).resize({width: 32, height: 32}));
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
