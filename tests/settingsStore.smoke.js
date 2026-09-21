import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {SettingsStore} from '../lib/settingsStore.js';

const schemaDir = GLib.build_filenamev([GLib.get_current_dir(), 'schemas']);
const source = Gio.SettingsSchemaSource.new_from_directory(
    schemaDir, Gio.SettingsSchemaSource.get_default(), false);
const schema = source.lookup('org.gnome.shell.extensions.pr-indicator', false);

// Backend em memória: não toca no dconf real do usuário, seguro pra rodar
// quantas vezes quiser.
const backend = Gio.memory_settings_backend_new();
const gioSettings = Gio.Settings.new_full(schema, backend, null);

const store = new SettingsStore(gioSettings);

const defaults = store.getSectionsConfig();
if (JSON.stringify(defaults) !== JSON.stringify([{id: 'review', hidden: false}, {id: 'mine', hidden: false}]))
    throw new Error(`getSectionsConfig padrão errado: ${JSON.stringify(defaults)}`);

if (store.getTheme() !== 'auto')
    throw new Error(`getTheme padrão errado: ${store.getTheme()}`);

store.setSectionsConfig([{id: 'mine', hidden: true}, {id: 'review', hidden: false}]);
store.setTheme('glass');

const after = store.getSectionsConfig();
if (JSON.stringify(after) !== JSON.stringify([{id: 'mine', hidden: true}, {id: 'review', hidden: false}]))
    throw new Error(`getSectionsConfig depois de setSectionsConfig errado: ${JSON.stringify(after)}`);

if (store.getTheme() !== 'glass')
    throw new Error(`getTheme depois de setTheme errado: ${store.getTheme()}`);

print('OK: settingsStore.smoke.js passou');
