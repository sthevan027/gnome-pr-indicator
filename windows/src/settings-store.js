import fs from 'node:fs';
import path from 'node:path';

import {normalizeSections, DEFAULT_SECTION_IDS} from '../../lib/sectionsConfig.js';

// Mesmas chaves e padrões do schema GSettings da extensão GNOME
// (schemas/org.gnome.shell.extensions.pr-indicator.gschema.xml).
const DEFAULTS = {
    'sections': ['review', 'mine'],
    'hidden-sections': [],
    'theme': 'auto',
    'badge-section': 'review',
};
const THEMES = ['auto', 'white', 'black', 'glass'];

/**
 * Equivalente Windows do `lib/settingsStore.js`: um JSON no lugar do
 * GSettings e o `safeStorage` do Electron (DPAPI) no lugar do libsecret.
 * `crypto` é injetado pra dar pra testar fora do Electron.
 */
export class SettingsStore {
    constructor(dir, crypto) {
        this._dir = dir;
        this._crypto = crypto;
        this._file = path.join(dir, 'settings.json');
        this._tokenFile = path.join(dir, 'token.bin');
        this._listeners = [];
        this._data = this._load();
    }

    _load() {
        try {
            const parsed = JSON.parse(fs.readFileSync(this._file, 'utf8'));
            return {...DEFAULTS, ...parsed};
        } catch {
            return {...DEFAULTS};
        }
    }

    _set(key, value) {
        this._data[key] = value;
        fs.mkdirSync(this._dir, {recursive: true});
        fs.writeFileSync(this._file, JSON.stringify(this._data, null, 2));
        for (const listener of this._listeners)
            listener(key);
    }

    onChanged(listener) {
        this._listeners.push(listener);
    }

    getSectionsConfig() {
        const order = Array.isArray(this._data.sections) ? this._data.sections : [];
        const hidden = Array.isArray(this._data['hidden-sections']) ? this._data['hidden-sections'] : [];
        return normalizeSections(order, hidden, DEFAULT_SECTION_IDS);
    }

    setSectionsConfig(list) {
        this._data['hidden-sections'] = list.filter(section => section.hidden).map(section => section.id);
        this._set('sections', list.map(section => section.id));
    }

    getTheme() {
        return THEMES.includes(this._data.theme) ? this._data.theme : DEFAULTS.theme;
    }

    setTheme(name) {
        this._set('theme', name);
    }

    getBadgeSection() {
        const value = this._data['badge-section'];
        return DEFAULT_SECTION_IDS.includes(value) ? value : DEFAULTS['badge-section'];
    }

    setBadgeSection(id) {
        this._set('badge-section', id);
    }

    getToken() {
        try {
            return this._crypto.decrypt(fs.readFileSync(this._tokenFile));
        } catch {
            return null;
        }
    }

    setToken(value) {
        if (!this._crypto.isAvailable())
            throw new Error('cofre de senhas do Windows indisponível');
        fs.mkdirSync(this._dir, {recursive: true});
        fs.writeFileSync(this._tokenFile, this._crypto.encrypt(value));
    }

    clearToken() {
        fs.rmSync(this._tokenFile, {force: true});
    }
}
