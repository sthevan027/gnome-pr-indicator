// Iniciar com o Windows: `app.setLoginItemSettings` grava a entrada em
// HKCU\...\CurrentVersion\Run.
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
