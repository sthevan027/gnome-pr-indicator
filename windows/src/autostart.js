// Iniciar com o Windows: `app.setLoginItemSettings` grava a entrada em
// HKCU\...\CurrentVersion\Run. Rodando via `electron .`, o executável é o
// electron.exe e o app precisa ir como argumento (caminho absoluto).
export function loginItemSettings(enabled, execPath, appPath) {
    return {openAtLogin: enabled, path: execPath, args: [appPath]};
}

export function parseAutostartArg(argv) {
    const arg = argv.find(a => a.startsWith('--autostart='));
    if (!arg)
        return null;
    return arg.slice('--autostart='.length) === 'enable';
}
