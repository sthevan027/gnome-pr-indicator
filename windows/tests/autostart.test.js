import {test} from 'node:test';
import assert from 'node:assert/strict';

import {loginItemSettings, parseAutostartArg, shouldEnableOnFirstRun} from '../src/autostart.js';

test('loginItemSettings aponta o electron pro app com o caminho absoluto', () => {
    assert.deepEqual(
        loginItemSettings(true, 'C:\\x\\electron.exe', 'D:\\Projetos\\gnome-pr-indicator\\windows'),
        {openAtLogin: true, path: 'C:\\x\\electron.exe', args: ['D:\\Projetos\\gnome-pr-indicator\\windows']});
    assert.equal(loginItemSettings(false, 'a', 'b').openAtLogin, false);
});

test('loginItemSettings no .exe instalado não passa argumento', () => {
    assert.deepEqual(
        loginItemSettings(true, 'C:\\Users\\x\\AppData\\Local\\Programs\\PR Indicator\\PR Indicator.exe', 'C:\\...\\app.asar', true),
        {openAtLogin: true, path: 'C:\\Users\\x\\AppData\\Local\\Programs\\PR Indicator\\PR Indicator.exe', args: []});
});

test('shouldEnableOnFirstRun só no app instalado e só uma vez', () => {
    assert.equal(shouldEnableOnFirstRun({packaged: true, alreadyInitialized: false}), true);
    assert.equal(shouldEnableOnFirstRun({packaged: true, alreadyInitialized: true}), false);
    assert.equal(shouldEnableOnFirstRun({packaged: false, alreadyInitialized: false}), false);
});

test('parseAutostartArg', () => {
    assert.equal(parseAutostartArg(['electron.exe', '.', '--autostart=enable']), true);
    assert.equal(parseAutostartArg(['electron.exe', '.', '--autostart=disable']), false);
    assert.equal(parseAutostartArg(['electron.exe', '.']), null);
});

import {
    linuxAutostartPath, linuxDesktopEntry, linuxExecCommand, quoteExecArg, setLinuxAutostart,
} from '../src/autostart.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('quoteExecArg só põe aspas quando precisa', () => {
    assert.equal(quoteExecArg('/usr/bin/electron'), '/usr/bin/electron');
    assert.equal(quoteExecArg('/home/a b/App.AppImage'), '"/home/a b/App.AppImage"');
    assert.equal(quoteExecArg('/x/$HOME/"y"'), '"/x/\\$HOME/\\"y\\""');
    assert.equal(quoteExecArg('100%'), '"100%%"');
});

test('linuxExecCommand: AppImage, instalado e desenvolvimento', () => {
    assert.equal(
        linuxExecCommand({execPath: '/tmp/.mount_x/pr', appPath: '/tmp/.mount_x/app', packaged: true, appImage: '/home/u/Apps/PR Indicator.AppImage'}),
        '"/home/u/Apps/PR Indicator.AppImage"');
    assert.equal(linuxExecCommand({execPath: '/opt/pr/pr-indicator', appPath: '/opt/pr/app.asar', packaged: true}), '/opt/pr/pr-indicator');
    assert.equal(
        linuxExecCommand({execPath: '/p/node_modules/electron/dist/electron', appPath: '/p/windows'}),
        '/p/node_modules/electron/dist/electron /p/windows');
});

test('linuxDesktopEntry é um .desktop de aplicativo válido', () => {
    const entry = linuxDesktopEntry({execPath: '/opt/pr/pr', appPath: '/x', packaged: true});
    assert.match(entry, /^\[Desktop Entry\]\nType=Application\n/);
    assert.match(entry, /\nName=PR Indicator\n/);
    assert.match(entry, /\nExec=\/opt\/pr\/pr\n/);
    assert.match(entry, /\nTerminal=false\n/);
});

test('linuxAutostartPath respeita XDG_CONFIG_HOME', () => {
    assert.equal(linuxAutostartPath({XDG_CONFIG_HOME: '/c'}), '/c/autostart/pr-indicator.desktop');
    assert.equal(linuxAutostartPath({HOME: '/home/u'}), '/home/u/.config/autostart/pr-indicator.desktop');
    assert.equal(linuxAutostartPath({}, '/h'), '/h/.config/autostart/pr-indicator.desktop');
});

test('setLinuxAutostart cria e remove o arquivo', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-autostart-'));
    try {
        const file = linuxAutostartPath({XDG_CONFIG_HOME: dir});
        setLinuxAutostart(true, {execPath: '/opt/pr/pr', appPath: '/x', packaged: true}, fs, file);
        assert.match(fs.readFileSync(file, 'utf8'), /Exec=\/opt\/pr\/pr/);
        setLinuxAutostart(false, {}, fs, file);
        assert.equal(fs.existsSync(file), false);
        setLinuxAutostart(false, {}, fs, file); // desligar de novo não falha
    } finally {
        fs.rmSync(dir, {recursive: true, force: true});
    }
});
