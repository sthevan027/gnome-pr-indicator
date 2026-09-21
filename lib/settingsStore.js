import GLib from 'gi://GLib';
import Secret from 'gi://Secret';

import {normalizeSections, DEFAULT_SECTION_IDS} from './sectionsConfig.js';

const TOKEN_SCHEMA = new Secret.Schema(
    'org.gnome.shell.extensions.pr-indicator.Token',
    Secret.SchemaFlags.NONE,
    {application: Secret.SchemaAttributeType.STRING}
);
const TOKEN_ATTRIBUTES = {application: 'pr-indicator'};

export class SettingsStore {
    constructor(gioSettings) {
        this._settings = gioSettings;
    }

    getSectionsConfig() {
        const order = this._settings.get_strv('sections');
        const hidden = this._settings.get_strv('hidden-sections');
        return normalizeSections(order, hidden, DEFAULT_SECTION_IDS);
    }

    setSectionsConfig(list) {
        this._settings.set_strv('sections', list.map(section => section.id));
        this._settings.set_strv(
            'hidden-sections',
            list.filter(section => section.hidden).map(section => section.id));
    }

    getTheme() {
        return this._settings.get_string('theme');
    }

    setTheme(name) {
        this._settings.set_string('theme', name);
    }

    getBadgeSection() {
        return this._settings.get_string('badge-section');
    }

    setBadgeSection(id) {
        this._settings.set_string('badge-section', id);
    }

    connectChanged(callback) {
        return this._settings.connect('changed', callback);
    }

    disconnectChanged(id) {
        this._settings.disconnect(id);
    }

    hasValidGhAuth() {
        try {
            const [ok, stdout] = GLib.spawn_command_line_sync('gh auth token');
            if (ok && stdout) {
                const token = new TextDecoder().decode(stdout).trim();
                return token.length > 0;
            }
        } catch (e) {
            logError(e, 'pr-indicator: falha ao checar autenticação do gh');
        }
        return false;
    }

    getToken() {
        return new Promise(resolve => {
            Secret.password_lookup(TOKEN_SCHEMA, TOKEN_ATTRIBUTES, null, (source, result) => {
                try {
                    resolve(Secret.password_lookup_finish(result));
                } catch (e) {
                    logError(e, 'pr-indicator: falha ao ler token do keyring');
                    resolve(null);
                }
            });
        });
    }

    setToken(value) {
        return new Promise((resolve, reject) => {
            Secret.password_store(
                TOKEN_SCHEMA, TOKEN_ATTRIBUTES, Secret.COLLECTION_DEFAULT,
                'PR Indicator — token do GitHub', value, null,
                (source, result) => {
                    try {
                        Secret.password_store_finish(result);
                        resolve();
                    } catch (e) {
                        reject(e);
                    }
                });
        });
    }

    clearToken() {
        return new Promise((resolve, reject) => {
            Secret.password_clear(TOKEN_SCHEMA, TOKEN_ATTRIBUTES, null, (source, result) => {
                try {
                    Secret.password_clear_finish(result);
                    resolve();
                } catch (e) {
                    reject(e);
                }
            });
        });
    }
}
