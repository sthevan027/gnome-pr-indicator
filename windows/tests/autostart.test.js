import {test} from 'node:test';
import assert from 'node:assert/strict';

import {loginItemSettings, parseAutostartArg} from '../src/autostart.js';

test('loginItemSettings aponta o electron pro app com o caminho absoluto', () => {
    assert.deepEqual(
        loginItemSettings(true, 'C:\\x\\electron.exe', 'D:\\Projetos\\gnome-pr-indicator\\windows'),
        {openAtLogin: true, path: 'C:\\x\\electron.exe', args: ['D:\\Projetos\\gnome-pr-indicator\\windows']});
    assert.equal(loginItemSettings(false, 'a', 'b').openAtLogin, false);
});

test('parseAutostartArg', () => {
    assert.equal(parseAutostartArg(['electron.exe', '.', '--autostart=enable']), true);
    assert.equal(parseAutostartArg(['electron.exe', '.', '--autostart=disable']), false);
    assert.equal(parseAutostartArg(['electron.exe', '.']), null);
});
