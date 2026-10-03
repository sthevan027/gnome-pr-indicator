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
