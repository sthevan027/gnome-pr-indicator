// Iniciar com a sessão. Windows: `app.setLoginItemSettings` grava a entrada em
// HKCU\...\CurrentVersion\Run (Linux: veja mais abaixo).
// - No .exe instalado, basta o próprio executável.
// - Rodando via `electron .`, o executável é o electron.exe e o app precisa
//   ir como argumento (caminho absoluto).
export function loginItemSettings(enabled, execPath, appPath, packaged = false) {
    return {openAtLogin: enabled, path: execPath, args: packaged ? [] : [appPath]};
}

export function parseAutostartArg(argv) {
    const arg = argv.find(a => a.startsWith('--autostart='));
    if (!arg)
        return null;
    return arg.slice('--autostart='.length) === 'enable';
}

/**
 * Na primeira execução do app instalado, liga o autostart — como a extensão
 * GNOME, que roda sempre que a sessão abre. Só acontece uma vez: se o
 * usuário desligar depois (`--autostart=disable`), não volta a ligar.
 * Devolve true se ligou agora.
 */
export function shouldEnableOnFirstRun({packaged, alreadyInitialized}) {
    return packaged && !alreadyInitialized;
}

// ---------------------------------------------------------------------------
// Linux: o Electron não tem `setLoginItemSettings` aqui; o autostart padrão
// da área de trabalho (KDE, GNOME, XFCE…) é um .desktop em
// ~/.config/autostart/.
// ---------------------------------------------------------------------------

export const AUTOSTART_FILE = 'pr-indicator.desktop';

/** Aspas do campo Exec do .desktop (caminhos com espaço, `"`, `$`, crase, `\`). */
export function quoteExecArg(arg) {
    if (arg !== '' && !/[\s"'`$\\<>~|&;*?#()%]/.test(arg))
        return arg;
    return `"${arg.replace(/(["`$\\])/g, '\\$1').replace(/%/g, '%%')}"`;
}

/**
 * Comando que reabre o app: no AppImage é o próprio .AppImage (o execPath
 * aponta pra um mount temporário que some); instalado, o executável; em
 * desenvolvimento, o electron com o caminho do app.
 */
export function linuxExecCommand({execPath, appPath, packaged = false, appImage = null}) {
    if (appImage)
        return quoteExecArg(appImage);
    const parts = packaged ? [execPath] : [execPath, appPath];
    return parts.map(quoteExecArg).join(' ');
}

export function linuxDesktopEntry(options) {
    return [
        '[Desktop Entry]',
        'Type=Application',
        'Name=PR Indicator',
        'Comment=PRs do GitHub esperando a sua revisão',
        `Exec=${linuxExecCommand(options)}`,
        'Terminal=false',
        'X-GNOME-Autostart-enabled=true',
        '',
    ].join('\n');
}

export function linuxAutostartPath(env = process.env, home = '') {
    const base = env.XDG_CONFIG_HOME || `${env.HOME || home}/.config`;
    return `${base}/autostart/${AUTOSTART_FILE}`;
}

/** Liga ou desliga o autostart no Linux. `fs` é injetado pra testar. */
export function setLinuxAutostart(enabled, options, fs, file) {
    if (enabled) {
        fs.mkdirSync(file.slice(0, file.lastIndexOf('/')), {recursive: true});
        fs.writeFileSync(file, linuxDesktopEntry(options));
    } else {
        fs.rmSync(file, {force: true});
    }
}
