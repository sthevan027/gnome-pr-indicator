// Atualização dentro do app: uma máquina de estados sem `electron`, pra ser
// testada com um autoUpdater falso. O main liga o `electron-updater` e mostra
// `getState()` no popup; nada é baixado sem o usuário clicar.

export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

const RELEASES_URL = 'https://github.com/sthevan027/gnome-pr-indicator/releases';
const NO_CHECK_TEXT = 'Atualização indisponível ao rodar pelo código-fonte';
const UP_TO_DATE_TEXT = 'Você está na versão mais recente';
const CHECK_FAILED_TEXT = '✗ não foi possível procurar atualizações';

export function releaseUrl(version) {
    return `${RELEASES_URL}/tag/v${version}`;
}

// Portátil e Linux fora do AppImage não conseguem se trocar sozinhos: nesses
// casos a linha só abre a página da release.
export function canInstallUpdates({platform, env}) {
    if (platform === 'win32')
        return !env.PORTABLE_EXECUTABLE_FILE;
    if (platform === 'linux')
        return Boolean(env.APPIMAGE);
    return false;
}

export function createUpdater({autoUpdater, currentVersion, enabled, canInstall, onChange = () => {}, log = console}) {
    // phase: 'none' | 'available' | 'downloading' | 'ready' | 'downloadError'
    let phase = 'none';
    let version = null;
    let percent = 0;
    // Resultado da última checagem manual: 'found' | 'same' | 'error' | null.
    let manualResult = null;
    // Checagem em andamento: a Promise compartilhada e se ela já foi pedida pelo usuário.
    let inFlight = null;
    let inFlightManual = false;
    // O que a última checagem em andamento viu nos eventos do autoUpdater.
    let lastOutcome = null;

    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;

    const notify = () => onChange();

    autoUpdater.on('update-available', info => {
        lastOutcome = 'found';
        if (phase === 'downloading' || phase === 'ready')
            return;
        phase = 'available';
        version = info.version;
        percent = 0;
        notify();
    });

    autoUpdater.on('update-not-available', () => {
        lastOutcome = 'same';
        if (phase === 'downloading' || phase === 'ready')
            return;
        phase = 'none';
        version = null;
        notify();
    });

    autoUpdater.on('download-progress', progress => {
        if (phase !== 'downloading')
            return;
        percent = Math.max(0, Math.min(100, Math.round(progress.percent)));
        notify();
    });

    autoUpdater.on('update-downloaded', info => {
        phase = 'ready';
        version = info.version;
        notify();
    });

    // Só registra: a falha de checagem e de download é tratada em check() e download().
    autoUpdater.on('error', err => {
        log.error('pr-indicator: erro do atualizador', err);
    });

    function checkText() {
        if (!enabled)
            return NO_CHECK_TEXT;
        if (inFlightManual)
            return 'Procurando…';
        if (manualResult === 'same')
            return UP_TO_DATE_TEXT;
        if (manualResult === 'error')
            return CHECK_FAILED_TEXT;
        if (manualResult === 'found')
            return `Versão ${version} disponível`;
        return '';
    }

    function row() {
        switch (phase) {
            case 'available':
                return canInstall
                    ? {label: `Versão ${version} disponível · Baixar`, action: 'download'}
                    : {label: `Versão ${version} disponível · Abrir download`, action: 'open'};
            case 'downloading':
                return {label: `Baixando versão ${version}… ${percent}%`, action: null};
            case 'ready':
                return {label: `Versão ${version} pronta · Reiniciar para atualizar`, action: 'install'};
            case 'downloadError':
                return {label: 'Falha ao baixar · Tentar de novo', action: 'download'};
            default:
                return null;
        }
    }

    function getState() {
        return {
            currentVersion,
            enabled,
            phase,
            version,
            percent,
            row: row(),
            checkText: checkText(),
            checking: inFlightManual,
        };
    }

    function check(manual = false) {
        if (!enabled)
            return Promise.resolve();
        // Com uma versão já baixada ou baixando, não há o que procurar.
        if (phase === 'downloading' || phase === 'ready') {
            if (manual) {
                manualResult = 'found';
                notify();
            }
            return Promise.resolve();
        }
        if (inFlight) {
            // Pedido manual durante uma checagem automática: reaproveita a
            // mesma e passa a mostrar o resultado.
            if (manual && !inFlightManual) {
                inFlightManual = true;
                notify();
            }
            return inFlight;
        }
        inFlightManual = manual;
        lastOutcome = null;
        notify();
        inFlight = (async () => {
            let failed = false;
            try {
                await autoUpdater.checkForUpdates();
            } catch {
                failed = true;
            }
            if (inFlightManual) {
                if (failed || lastOutcome === null)
                    manualResult = 'error';
                else
                    manualResult = lastOutcome;
            } else if (!failed && lastOutcome) {
                // Uma resposta nova torna velho o texto da última manual.
                manualResult = null;
            }
            inFlightManual = false;
            inFlight = null;
            notify();
        })();
        return inFlight;
    }

    async function download() {
        if (!canInstall)
            return;
        if (phase !== 'available' && phase !== 'downloadError')
            return;
        // Muda a fase antes do primeiro await: um segundo clique cai na guarda acima.
        phase = 'downloading';
        percent = 0;
        notify();
        try {
            await autoUpdater.downloadUpdate();
        } catch {
            // Erro já foi para o log pelo listener de 'error'.
        }
        if (phase === 'downloading') {
            phase = 'downloadError';
            notify();
        }
    }

    function install() {
        if (!canInstall || phase !== 'ready')
            return;
        autoUpdater.quitAndInstall(true, true);
    }

    function releasePageUrl() {
        return version && phase !== 'none' ? releaseUrl(version) : null;
    }

    return {getState, check, download, install, releasePageUrl};
}
