# Painel de Configuração Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar controle ao usuário sobre ordem/visibilidade das seções, tema visual (4 opções) e token do GitHub, tudo dentro do popup já existente do PR Indicator — sem janela de preferências separada.

**Architecture:** Um módulo puro (`lib/sectionsConfig.js`) concentra a lógica de ordem/visibilidade das seções e é testável isoladamente via `gjs -m`. Um módulo de I/O (`lib/settingsStore.js`) concentra toda leitura/escrita de estado persistido (GSettings pra ordem/visibilidade/tema, `libsecret` pro token), também verificável fora do GNOME Shell com backends isolados (memória pro GSettings, schema próprio pro Secret). O `extension.js` ganha uma segunda "view" dentro do mesmo popup (troca de conteúdo, não janela nova) que consome os dois módulos acima; os widgets novos usam `St`/`PopupMenu`/`Clutter`, os mesmos já usados hoje.

**Tech Stack:** GJS (GNOME JavaScript), GObject Introspection (`Gio`, `Secret`, `Shell`, `Clutter`, `St`), GSettings (schema compilado), `libsecret`/GNOME Keyring.

**Spec:** `docs/superpowers/specs/2026-09-21-settings-panel-design.md`

## Global Constraints

- Suporte a GNOME Shell 48, 49 e 50 (já declarado em `metadata.json`) — não usar API exclusiva de uma versão só.
- Sem janela de preferências separada (`prefs.js`/Adw/GTK4) — toda a configuração vive dentro do popup atual, usando `St`/`PopupMenu`/`Clutter`.
- Token do GitHub nunca em texto plano no GSettings — só via `libsecret`, com fallback documentado (não silencioso na UI, só no log) se o Secret Service não responder.
- `gh` CLI sempre tem precedência sobre o token manual quando autenticado; o campo de token fica desabilitado nesse caso.
- Toda mudança de configuração aplica instantaneamente, sem precisar desabilitar/reabilitar a extensão nem fazer logout.
- Não existe framework de teste automatizado neste projeto. Onde a lógica não depende do runtime do GNOME Shell (Clutter/St precisam de um `Stage` que só existe dentro do `gnome-shell` rodando), este plano usa `gjs -m` com backends isolados (memória/schema próprio) para testes reais e automatizáveis. Onde depende do runtime do Shell (drag-and-drop, troca de view, tema, blur), a verificação é manual e visual, documentada em cada tarefa.
- Seguir a convenção de commit já usada no repositório: mensagem curta em português, imperativo, sem prefixo tipo `feat:`/`fix:`.

---

### Task 1: `lib/sectionsConfig.js` — lógica pura de ordem/visibilidade das seções

**Files:**
- Create: `lib/sectionsConfig.js`
- Test: `tests/sectionsConfig.test.js`

**Interfaces:**
- Produces: `DEFAULT_SECTION_IDS: string[]`, `normalizeSections(order: string[], hidden: string[], knownIds = DEFAULT_SECTION_IDS): {id: string, hidden: boolean}[]`, `moveSection(list: {id, hidden}[], fromId: string, toId: string): {id, hidden}[]`, `toggleHidden(list: {id, hidden}[], id: string): {id, hidden}[]`, `effectiveOrder(list: {id, hidden}[]): string[]`.

- [ ] **Step 1: Escrever o teste (vai falhar — o módulo ainda não existe)**

Criar `tests/sectionsConfig.test.js`:

```javascript
import {
    DEFAULT_SECTION_IDS,
    normalizeSections,
    moveSection,
    toggleHidden,
    effectiveOrder,
} from '../lib/sectionsConfig.js';

let failures = 0;

function assertEqual(actual, expected, label) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) {
        failures++;
        print(`FALHOU: ${label}\n  esperado: ${e}\n  recebido: ${a}`);
    } else {
        print(`ok: ${label}`);
    }
}

assertEqual(
    normalizeSections([], []),
    [{id: 'review', hidden: false}, {id: 'mine', hidden: false}],
    'normalizeSections: lista vazia usa a ordem padrão'
);

assertEqual(
    normalizeSections(['mine', 'review'], ['mine']),
    [{id: 'mine', hidden: true}, {id: 'review', hidden: false}],
    'normalizeSections: respeita ordem salva e marca ocultas'
);

assertEqual(
    normalizeSections(['review'], []),
    [{id: 'review', hidden: false}, {id: 'mine', hidden: false}],
    'normalizeSections: acrescenta ids novos que faltam no final'
);

assertEqual(
    normalizeSections(['review', 'fantasma'], ['fantasma']),
    [{id: 'review', hidden: false}, {id: 'mine', hidden: false}],
    'normalizeSections: descarta ids desconhecidos'
);

const base = [{id: 'review', hidden: false}, {id: 'mine', hidden: false}];

assertEqual(
    moveSection(base, 'review', 'mine'),
    [{id: 'mine', hidden: false}, {id: 'review', hidden: false}],
    'moveSection: troca a posição de duas seções'
);
assertEqual(
    moveSection(base, 'review', 'review'),
    base,
    'moveSection: mover pra mesma posição não muda nada'
);
assertEqual(
    moveSection(base, 'fantasma', 'mine'),
    base,
    'moveSection: id inexistente não muda nada'
);

assertEqual(
    toggleHidden(base, 'mine'),
    [{id: 'review', hidden: false}, {id: 'mine', hidden: true}],
    'toggleHidden: oculta a seção'
);
assertEqual(
    toggleHidden(toggleHidden(base, 'mine'), 'mine'),
    base,
    'toggleHidden: aplicar duas vezes volta ao estado original'
);

assertEqual(
    effectiveOrder([{id: 'review', hidden: false}, {id: 'mine', hidden: true}]),
    ['review'],
    'effectiveOrder: remove ocultas e mantém ordem'
);

assertEqual(DEFAULT_SECTION_IDS, ['review', 'mine'], 'DEFAULT_SECTION_IDS correto');

if (failures > 0) {
    print(`\n${failures} teste(s) falharam.`);
    throw new Error(`${failures} teste(s) falharam`);
}
print('\nTodos os testes passaram.');
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `gjs -m tests/sectionsConfig.test.js`
Expected: erro de import — `lib/sectionsConfig.js` não existe ainda (`ImportError` ou `Unable to load file`).

- [ ] **Step 3: Implementar `lib/sectionsConfig.js`**

```javascript
export const DEFAULT_SECTION_IDS = ['review', 'mine'];

export function normalizeSections(order, hidden, knownIds = DEFAULT_SECTION_IDS) {
    const seen = new Set();
    const result = [];

    for (const id of order) {
        if (knownIds.includes(id) && !seen.has(id)) {
            result.push(id);
            seen.add(id);
        }
    }
    for (const id of knownIds) {
        if (!seen.has(id)) {
            result.push(id);
            seen.add(id);
        }
    }

    const hiddenSet = new Set(hidden.filter(id => knownIds.includes(id)));

    return result.map(id => ({id, hidden: hiddenSet.has(id)}));
}

export function moveSection(list, fromId, toId) {
    const ids = list.map(section => section.id);
    const fromIndex = ids.indexOf(fromId);
    const toIndex = ids.indexOf(toId);
    if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex)
        return list;

    const reordered = list.slice();
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    return reordered;
}

export function toggleHidden(list, id) {
    return list.map(section =>
        section.id === id ? {...section, hidden: !section.hidden} : section);
}

export function effectiveOrder(list) {
    return list.filter(section => !section.hidden).map(section => section.id);
}
```

- [ ] **Step 4: Rodar de novo e confirmar que passa**

Run: `gjs -m tests/sectionsConfig.test.js`
Expected: todas as linhas `ok: ...` e no final `Todos os testes passaram.`, saída (exit code) 0.

- [ ] **Step 5: Commit**

```bash
git add lib/sectionsConfig.js tests/sectionsConfig.test.js
git commit -m "Adiciona lógica de ordem/visibilidade das seções com testes"
```

---

### Task 2: Schema GSettings + `lib/settingsStore.js`

**Files:**
- Create: `schemas/org.gnome.shell.extensions.pr-indicator.gschema.xml`
- Create: `lib/settingsStore.js`
- Test: `tests/settingsStore.smoke.js` (GSettings, backend em memória)
- Test: `tests/settingsStoreToken.smoke.js` (libsecret real, com limpeza no final)

**Interfaces:**
- Consumes: `normalizeSections`, `DEFAULT_SECTION_IDS` de `lib/sectionsConfig.js` (Task 1).
- Produces: `class SettingsStore` com `constructor(gioSettings)`, `getSectionsConfig(): {id,hidden}[]`, `setSectionsConfig(list: {id,hidden}[]): void`, `getTheme(): string`, `setTheme(name: string): void`, `hasValidGhAuth(): boolean`, `getToken(): Promise<string|null>`, `setToken(value: string): Promise<void>`, `clearToken(): Promise<void>`.

- [ ] **Step 1: Criar o schema GSettings**

Criar `schemas/org.gnome.shell.extensions.pr-indicator.gschema.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<schemalist gettext-domain="pr-indicator">
  <schema id="org.gnome.shell.extensions.pr-indicator" path="/org/gnome/shell/extensions/pr-indicator/">
    <key name="sections" type="as">
      <default>['review', 'mine']</default>
      <summary>Ordem das seções</summary>
      <description>Ids das seções do popup, na ordem em que devem aparecer</description>
    </key>
    <key name="hidden-sections" type="as">
      <default>[]</default>
      <summary>Seções ocultas</summary>
      <description>Ids das seções que não devem aparecer na lista de PRs</description>
    </key>
    <key name="theme" type="s">
      <default>'auto'</default>
      <summary>Tema do popup</summary>
      <description>Um de: auto, white, black, glass</description>
    </key>
  </schema>
</schemalist>
```

- [ ] **Step 2: Compilar o schema e confirmar**

Run: `glib-compile-schemas schemas/`
Expected: comando termina sem erro e cria `schemas/gschemas.compiled`.

- [ ] **Step 3: Escrever o smoke test do GSettings (vai falhar — `settingsStore.js` ainda não existe)**

Criar `tests/settingsStore.smoke.js`:

```javascript
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
```

- [ ] **Step 4: Rodar e confirmar que falha**

Run: `gjs -m tests/settingsStore.smoke.js`
Expected: erro de import — `lib/settingsStore.js` não existe ainda.

- [ ] **Step 5: Implementar `lib/settingsStore.js`**

```javascript
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
```

- [ ] **Step 6: Rodar o smoke test do GSettings de novo e confirmar que passa**

Run: `gjs -m tests/settingsStore.smoke.js`
Expected: `OK: settingsStore.smoke.js passou`, exit code 0.

- [ ] **Step 7: Escrever e rodar o smoke test do token (libsecret real)**

Este teste usa um schema/atributo **próprio de teste** (`pr-indicator-smoketest`), diferente do usado em produção (`pr-indicator`), pra não colidir com um token real que já esteja salvo. Ele grava, lê e depois limpa o segredo — não deixa lixo no chaveiro.

Criar `tests/settingsStoreToken.smoke.js`:

```javascript
import GLib from 'gi://GLib';
import Secret from 'gi://Secret';

const SCHEMA = new Secret.Schema(
    'org.gnome.shell.extensions.pr-indicator.SmokeTest',
    Secret.SchemaFlags.NONE,
    {application: Secret.SchemaAttributeType.STRING}
);
const ATTRS = {application: 'pr-indicator-smoketest'};

function store(value) {
    return new Promise((resolve, reject) => {
        Secret.password_store(SCHEMA, ATTRS, Secret.COLLECTION_DEFAULT, 'PR Indicator smoke test', value, null,
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

function lookup() {
    return new Promise((resolve, reject) => {
        Secret.password_lookup(SCHEMA, ATTRS, null, (source, result) => {
            try {
                resolve(Secret.password_lookup_finish(result));
            } catch (e) {
                reject(e);
            }
        });
    });
}

function clear() {
    return new Promise((resolve, reject) => {
        Secret.password_clear(SCHEMA, ATTRS, null, (source, result) => {
            try {
                Secret.password_clear_finish(result);
                resolve();
            } catch (e) {
                reject(e);
            }
        });
    });
}

const loop = new GLib.MainLoop(null, false);

async function main() {
    await store('token-de-teste-123');
    const got = await lookup();
    if (got !== 'token-de-teste-123')
        throw new Error(`roundtrip do libsecret falhou: recebido "${got}"`);
    await clear();
    const afterClear = await lookup();
    if (afterClear !== null)
        throw new Error('clear não removeu o segredo');
    print('OK: settingsStoreToken.smoke.js passou');
}

main()
    .catch(e => {
        logError(e);
        globalThis.__smokeFailed = true;
    })
    .finally(() => loop.quit());

loop.run();

if (globalThis.__smokeFailed)
    throw new Error('smoke test do libsecret falhou (ver log acima)');
```

Run: `gjs -m tests/settingsStoreToken.smoke.js`
Expected: `OK: settingsStoreToken.smoke.js passou`, exit code 0. Pode pedir desbloqueio do chaveiro na primeira vez, dependendo do ambiente — normal.

- [ ] **Step 8: Commit**

```bash
git add schemas/org.gnome.shell.extensions.pr-indicator.gschema.xml lib/settingsStore.js tests/settingsStore.smoke.js tests/settingsStoreToken.smoke.js
git commit -m "Adiciona schema GSettings e SettingsStore (GSettings + libsecret)"
```

---

### Task 3: Entrada da configuração e troca de tela (view-swap)

**Files:**
- Modify: `extension.js`

**Interfaces:**
- Consumes: `SettingsStore` (Task 2) — só a construção (`new SettingsStore(this._extension.getSettings())`), sem chamar ainda os getters específicos de seção/tema/token (isso vem nas Tasks 4–6).
- Produces: `Indicator._settingsStore`, `Indicator._showConfigView()`, `Indicator._showPRView()`, container `Indicator._prView` (`PopupMenu.PopupMenuSection`) e `Indicator._configView` (`PopupMenu.PopupMenuSection`, vazio por enquanto — as Tasks 4/5/6 preenchem).

Este passo reestrutura o `_init` pra agrupar tudo que hoje é a lista de PRs dentro de uma única `PopupMenu.PopupMenuSection` (`this._prView`), cria uma segunda seção vazia (`this._configView`) pro conteúdo das próximas tasks, e liga o botão de entrada/saída.

- [ ] **Step 1: Importar `Gio` (já importado) e adicionar `SettingsStore`**

Em `extension.js`, no topo, junto dos outros imports:

```javascript
import {SettingsStore} from './lib/settingsStore.js';
```

- [ ] **Step 2: Reestruturar `Indicator._init` pra agrupar a view de PRs**

Substituir o corpo de `_init` (do trecho que cria `this._reviewSection`/`this._mineSection` até o fim do método) por:

```javascript
    _init(extension) {
        super._init(0.5, 'PR Indicator');
        this._extension = extension;
        this._settingsStore = new SettingsStore(extension.getSettings());
        this._client = new GitHubClient(this._settingsStore);
        this._timeoutId = null;
        this._view = 'prs';

        const box = new St.BoxLayout({style_class: 'pr-indicator-box', y_align: 2 /* Clutter.ActorAlign.CENTER */});
        const iconPath = GLib.build_filenamev([this._extension.path, 'icons', 'github-symbolic.svg']);
        this._icon = new St.Icon({
            gicon: Gio.icon_new_for_string(iconPath),
            style_class: 'system-status-icon',
        });
        this._countLabel = new St.Label({
            text: '…',
            style_class: 'pr-indicator-count',
            y_align: 2,
        });
        box.add_child(this._icon);
        box.add_child(this._countLabel);
        this.add_child(box);

        this._prView = new PopupMenu.PopupMenuSection();
        this._reviewSection = new PopupMenu.PopupMenuSection();
        this._mineSection = new PopupMenu.PopupMenuSection();

        this._prView.box.add_child(this._sectionTitle('Precisa da minha revisão'));
        this._prView.addMenuItem(this._reviewSection);
        this._prView.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._prView.box.add_child(this._sectionTitle('Meus PRs abertos'));
        this._prView.addMenuItem(this._mineSection);
        this._prView.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const refreshItem = new PopupMenu.PopupMenuItem('Atualizar agora');
        refreshItem.connect('activate', () => this.refresh());
        this._prView.addMenuItem(refreshItem);

        this._statusItem = new PopupMenu.PopupMenuItem('', {reactive: false, style_class: 'pr-indicator-empty'});
        this._prView.addMenuItem(this._statusItem);

        this._configEntryRow = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        const configButton = new St.Button({x_expand: true, style_class: 'pr-indicator-config-entry'});
        configButton.set_child(new St.Label({text: '⚙ Configurações'}));
        configButton.connect('clicked', () => this._showConfigView());
        this._configEntryRow.add_child(configButton);
        this._prView.addMenuItem(this._configEntryRow);

        this.menu.addMenuItem(this._prView);

        this._configView = new PopupMenu.PopupMenuSection();
        this._configView.actor.visible = false;

        const backRow = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        const backButton = new St.Button({x_expand: true, style_class: 'pr-indicator-back-entry'});
        backButton.set_child(new St.Label({text: '← Voltar'}));
        backButton.connect('clicked', () => this._showPRView());
        backRow.add_child(backButton);
        this._configView.addMenuItem(backRow);

        this.menu.addMenuItem(this._configView);

        this.refresh();
        this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, POLL_SECONDS, () => {
            this.refresh();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _showConfigView() {
        this._view = 'config';
        this._prView.actor.visible = false;
        this._configView.actor.visible = true;
    }

    _showPRView() {
        this._view = 'prs';
        this._configView.actor.visible = false;
        this._prView.actor.visible = true;
    }
```

- [ ] **Step 3: Atualizar `GitHubClient` pra receber o `SettingsStore` (constructor apenas — a lógica de fallback vem na Task 6)**

Modificar o construtor de `GitHubClient`:

```javascript
    constructor(settingsStore) {
        this._session = new Soup.Session();
        this._session.timeout = 15;
        this._token = null;
        this._settingsStore = settingsStore;
    }
```

- [ ] **Step 4: Verificação manual**

```bash
gnome-extensions disable pr-indicator@sthevan027
gnome-extensions enable pr-indicator@sthevan027
```

Abrir o popup (clicar no ícone na barra): a lista de PRs deve aparecer normalmente, igual a antes, com um item novo "⚙ Configurações" no final. Clicar nele: a lista de PRs deve sumir e aparecer só "← Voltar" (tela de config vazia, ainda sem conteúdo — isso é esperado, as próximas tasks preenchem). Clicar em "← Voltar": deve voltar pra lista de PRs. Fechar o popup (clicar fora) e abrir de novo: deve sempre reabrir na lista de PRs, mesmo que a última ação tenha sido entrar na config.

- [ ] **Step 5: Commit**

```bash
git add extension.js
git commit -m "Adiciona troca de tela entre lista de PRs e configuração no popup"
```

---

### Task 4: Ordem e visibilidade das seções (arrastar-e-soltar + ocultar)

**Files:**
- Modify: `extension.js`
- Modify: `stylesheet.css`

**Interfaces:**
- Consumes: `moveSection`, `toggleHidden`, `effectiveOrder` de `lib/sectionsConfig.js` (Task 1); `SettingsStore.getSectionsConfig()`/`setSectionsConfig()` (Task 2); `Indicator._configView` (Task 3).
- Produces: `Indicator._buildSectionsOrderRows()`, `Indicator._onToggleSection(id)`, `Indicator._commitSectionOrder()`. Altera `Indicator.refresh()` pra usar `effectiveOrder()` na hora de decidir o que desenhar.

- [ ] **Step 1: Importar `Clutter` e as funções de `sectionsConfig.js`**

No topo de `extension.js`:

```javascript
import Clutter from 'gi://Clutter';
```

E junto do import de `SettingsStore`:

```javascript
import {moveSection, toggleHidden, effectiveOrder} from './lib/sectionsConfig.js';
```

- [ ] **Step 2: Mapa de nomes das seções**

Perto do topo do arquivo, junto de `POLL_SECONDS`/`MAX_ITEMS_PER_SECTION`:

```javascript
const SECTION_LABELS = {
    review: 'Precisa da minha revisão',
    mine: 'Meus PRs abertos',
};
```

- [ ] **Step 3: Construir as linhas arrastáveis na tela de configuração**

Adicionar estes métodos à classe `Indicator` (logo depois de `_showPRView`):

```javascript
    _buildSectionsOrderRows() {
        this._sectionsOrderContainer = new St.BoxLayout({vertical: true, x_expand: true});
        this._sectionRows = {};

        const list = this._settingsStore.getSectionsConfig();
        for (const section of list)
            this._sectionsOrderContainer.add_child(this._makeSectionRow(section));

        const wrapper = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        wrapper.add_child(this._sectionsOrderContainer);
        return wrapper;
    }

    _makeSectionRow(section) {
        const row = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        row._sectionId = section.id;
        row.add_style_class_name('pr-indicator-config-row');
        if (section.hidden)
            row.add_style_class_name('pr-indicator-config-row-hidden');

        const handle = new St.Icon({
            icon_name: 'view-list-symbolic',
            style_class: 'pr-indicator-drag-handle',
            reactive: true,
        });
        const label = new St.Label({
            text: SECTION_LABELS[section.id] ?? section.id,
            x_expand: true,
            y_align: 2,
        });
        const toggleButton = new St.Button({
            style_class: 'pr-indicator-toggle-button',
            label: section.hidden ? '+' : '−',
            can_focus: true,
        });
        toggleButton.connect('clicked', () => this._onToggleSection(section.id));

        row.add_child(handle);
        row.add_child(label);
        row.add_child(toggleButton);
        row._toggleButton = toggleButton;

        const dragAction = new Clutter.DragAction({dragThreshold: 4});
        handle.add_action(dragAction);
        dragAction.connect('drag-motion', (action, actor, deltaX, deltaY) => {
            this._reorderDuringDrag(row, deltaY);
        });
        dragAction.connect('drag-end', () => this._commitSectionOrder());

        this._sectionRows[section.id] = row;
        return row;
    }

    _reorderDuringDrag(row, deltaY) {
        const container = this._sectionsOrderContainer;
        const siblings = container.get_children();
        const index = siblings.indexOf(row);
        const rowHeight = row.get_height() || 1;

        if (deltaY > rowHeight / 2 && index < siblings.length - 1)
            container.set_child_above_sibling(row, siblings[index + 1]);
        else if (deltaY < -rowHeight / 2 && index > 0)
            container.set_child_below_sibling(row, siblings[index - 1]);
    }

    _onToggleSection(id) {
        const current = this._settingsStore.getSectionsConfig();
        const updated = toggleHidden(current, id);
        this._settingsStore.setSectionsConfig(updated);

        const row = this._sectionRows[id];
        const nowHidden = updated.find(section => section.id === id)?.hidden;
        row._toggleButton.label = nowHidden ? '+' : '−';
        if (nowHidden)
            row.add_style_class_name('pr-indicator-config-row-hidden');
        else
            row.remove_style_class_name('pr-indicator-config-row-hidden');

        this.refresh();
    }

    _commitSectionOrder() {
        const orderedIds = this._sectionsOrderContainer.get_children().map(row => row._sectionId);
        const current = this._settingsStore.getSectionsConfig();

        let updated = current;
        for (let i = 1; i < orderedIds.length; i++)
            updated = moveSection(updated, orderedIds[i], orderedIds[i - 1]);

        this._settingsStore.setSectionsConfig(updated);
        this.refresh();
    }
```

- [ ] **Step 4: Adicionar as linhas de seção na tela de configuração, dentro de `_init`**

Em `extension.js`, dentro de `_init`, logo depois da linha `this.menu.addMenuItem(this._configView);` (Task 3), inserir:

```javascript
        this._configView.box.add_child(this._sectionTitle('Ordem e visibilidade das seções'));
        this._configView.addMenuItem(this._buildSectionsOrderRows());
```

(a seção de tema e a de autenticação, adicionadas nas próximas tasks, entram depois dessas duas linhas — nesta task, deixe exatamente como acima.)

- [ ] **Step 5: Fazer `refresh()` respeitar ordem e visibilidade**

Substituir o método `refresh()` por:

```javascript
    async refresh() {
        try {
            const [needsReview, mine] = await Promise.all([
                this._client.fetchNeedsReview(),
                this._client.fetchMyOpenPRs(),
            ]);

            const itemsBySection = {review: needsReview, mine};
            const visibleIds = effectiveOrder(this._settingsStore.getSectionsConfig());

            this._reviewSection.actor.get_parent().visible = visibleIds.includes('review');
            this._mineSection.actor.get_parent().visible = visibleIds.includes('mine');

            this._fillSection(this._reviewSection, itemsBySection.review ?? []);
            this._fillSection(this._mineSection, itemsBySection.mine ?? []);
            this._countLabel.text = String(needsReview.length);

            const now = GLib.DateTime.new_now_local().format('%H:%M');
            this._statusItem.label.text = `Atualizado às ${now}`;
        } catch (e) {
            this._countLabel.text = '!';
            this._statusItem.label.text = `Erro: ${e.message}`;
            logError(e, 'pr-indicator: refresh failed');
        }
    }
```

> Nota: `this._reviewSection.actor.get_parent()` esconde/mostra o item de menu que contém a seção (título + separador continuam visíveis mesmo com a seção oculta — se isso incomodar visualmente na verificação manual do Step 6, ajuste escondendo também `this._sectionTitle(...)` correspondente; guarde a referência do label retornado por `_sectionTitle` em `this._reviewTitleLabel`/`this._mineTitleLabel` pra isso).

- [ ] **Step 6: Adicionar estilos novos em `stylesheet.css`**

Acrescentar ao final de `stylesheet.css`:

```css
.pr-indicator-config-row {
    padding: 4px 12px;
}

.pr-indicator-config-row-hidden {
    opacity: 0.45;
}

.pr-indicator-drag-handle {
    icon-size: 16px;
    padding-right: 6px;
}

.pr-indicator-toggle-button {
    font-weight: bold;
    padding: 0 8px;
    min-width: 24px;
}

.pr-indicator-config-entry,
.pr-indicator-back-entry {
    padding: 4px 12px;
}
```

- [ ] **Step 7: Verificação manual**

```bash
gnome-extensions disable pr-indicator@sthevan027
gnome-extensions enable pr-indicator@sthevan027
```

Abrir o popup → "⚙ Configurações". Confirmar: duas linhas ("Precisa da minha revisão" / "Meus PRs abertos"), cada uma com alça, nome e botão `−`. Clicar no `−` de uma: ela fica esmaecida, o botão vira `+`; voltar pra lista de PRs (`← Voltar`) e confirmar que aquela seção sumiu de verdade da lista. Arrastar pela alça pra trocar a ordem das duas linhas; voltar pra lista de PRs e confirmar que a ordem mudou lá também. Se o arrasto não responder bem (ver risco técnico já registrado na spec), ajustar `dragThreshold` ou a lógica de `_reorderDuringDrag` até funcionar de forma confiável antes de seguir — isso é esperado precisar de ajuste fino aqui.

- [ ] **Step 8: Commit**

```bash
git add extension.js stylesheet.css
git commit -m "Adiciona ordenação por arrastar e ocultar seções na configuração"
```

---

### Task 5: Seletor de tema (Automático/Branco/Preto/Glass)

**Files:**
- Modify: `extension.js`
- Modify: `stylesheet.css`

**Interfaces:**
- Consumes: `SettingsStore.getTheme()`/`setTheme()` (Task 2); `Indicator._configView` (Task 3).
- Produces: `Indicator._buildThemeSection()`, `Indicator._onSelectTheme(value)`, `Indicator._applyTheme(themeName)`.

- [ ] **Step 1: Importar `Shell`**

No topo de `extension.js`:

```javascript
import Shell from 'gi://Shell';
```

- [ ] **Step 2: Construir a seção de tema**

Adicionar à classe `Indicator`:

```javascript
    _buildThemeSection() {
        const wrapper = new St.BoxLayout({vertical: true, x_expand: true});
        this._themeCheckIcons = {};

        const options = [
            ['auto', 'Automático'],
            ['white', 'Branco'],
            ['black', 'Preto'],
            ['glass', 'Glass'],
        ];
        const current = this._settingsStore.getTheme();

        for (const [value, label] of options) {
            const row = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
            const button = new St.Button({x_expand: true, style_class: 'pr-indicator-theme-option'});
            const box = new St.BoxLayout({x_expand: true});
            const check = new St.Icon({
                icon_name: value === current ? 'object-select-symbolic' : '',
                style_class: 'pr-indicator-theme-check',
            });
            const text = new St.Label({text: label, x_expand: true, y_align: 2});

            box.add_child(check);
            box.add_child(text);
            button.set_child(box);
            button.connect('clicked', () => this._onSelectTheme(value));
            row.add_child(button);

            this._themeCheckIcons[value] = check;
            wrapper.add_child(row);
        }

        const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        item.add_child(wrapper);
        return item;
    }

    _onSelectTheme(value) {
        for (const [key, icon] of Object.entries(this._themeCheckIcons))
            icon.icon_name = key === value ? 'object-select-symbolic' : '';

        this._settingsStore.setTheme(value);
        this._applyTheme(value);
    }

    _applyTheme(themeName) {
        const classes = ['pr-indicator-theme-white', 'pr-indicator-theme-black', 'pr-indicator-theme-glass'];
        for (const cls of classes)
            this.menu.actor.remove_style_class_name(cls);

        if (this._blurEffect) {
            this.menu.actor.remove_effect(this._blurEffect);
            this._blurEffect = null;
        }

        if (themeName === 'white') {
            this.menu.actor.add_style_class_name('pr-indicator-theme-white');
        } else if (themeName === 'black') {
            this.menu.actor.add_style_class_name('pr-indicator-theme-black');
        } else if (themeName === 'glass') {
            this.menu.actor.add_style_class_name('pr-indicator-theme-glass');
            this._blurEffect = new Shell.BlurEffect({
                brightness: 0.85,
                sigma: 30,
                mode: Shell.BlurMode.BACKGROUND,
            });
            this.menu.actor.add_effect(this._blurEffect);
        }
        // 'auto' não adiciona classe nenhuma — comportamento padrão do sistema.
    }
```

- [ ] **Step 3: Ligar a seção de tema na tela de configuração e aplicar o tema salvo ao abrir**

Em `_init`, logo depois das linhas adicionadas na Task 4 (`_buildSectionsOrderRows`), inserir:

```javascript
        this._configView.box.add_child(this._sectionTitle('Tema'));
        this._configView.addMenuItem(this._buildThemeSection());

        this._applyTheme(this._settingsStore.getTheme());
```

- [ ] **Step 4: Adicionar estilos dos temas em `stylesheet.css`**

Acrescentar ao final de `stylesheet.css`:

```css
.pr-indicator-theme-option {
    padding: 4px 12px;
}

.pr-indicator-theme-check {
    icon-size: 16px;
    padding-right: 8px;
}

.pr-indicator-theme-white {
    background-color: #ffffff;
    color: #1a1a1a;
}

.pr-indicator-theme-black {
    background-color: #101010;
    color: #f2f2f2;
}

.pr-indicator-theme-glass {
    background-color: rgba(20, 20, 20, 0.55);
    color: #f2f2f2;
}
```

- [ ] **Step 5: Verificação manual**

```bash
gnome-extensions disable pr-indicator@sthevan027
gnome-extensions enable pr-indicator@sthevan027
```

Abrir "⚙ Configurações" → seção "Tema". Clicar em cada uma das 4 opções e confirmar, **sem fechar o popup**: o fundo/texto muda na hora (Branco = fundo claro, Preto = fundo escuro sólido, Glass = fundo escuro semitransparente com desfoque visível do que está atrás, Automático = volta ao visual padrão de hoje). A marca de seleção (✓) deve acompanhar a opção escolhida. Fechar e abrir o popup de novo: o tema escolhido deve continuar aplicado. Se o `Shell.BlurEffect` não desenhar nada visível (fica só a cor sólida sem desfoque), ajustar os parâmetros `sigma`/`brightness`/`mode` até o efeito aparecer — isso é esperado precisar de ajuste visual aqui.

- [ ] **Step 6: Commit**

```bash
git add extension.js stylesheet.css
git commit -m "Adiciona seletor de tema (automático/branco/preto/glass) na configuração"
```

---

### Task 6: Token manual do GitHub (com fallback e validação)

**Files:**
- Modify: `extension.js`

**Interfaces:**
- Consumes: `SettingsStore.hasValidGhAuth()`/`getToken()`/`setToken()` (Task 2); `Indicator._configView` (Task 3).
- Produces: `Indicator._buildAuthSection()`, `Indicator._refreshAuthSection()`, `Indicator._onSubmitToken()`, `GitHubClient.resetToken()`. Altera `GitHubClient._loadToken()`/`_search()` pra async com fallback.

- [ ] **Step 1: Tornar `GitHubClient._loadToken` async com fallback pro token manual**

Substituir `_loadToken` e `_search` em `GitHubClient` por:

```javascript
    async _loadToken() {
        if (this._token)
            return this._token;

        try {
            const [ok, stdout] = GLib.spawn_command_line_sync('gh auth token');
            if (ok && stdout) {
                const ghToken = new TextDecoder().decode(stdout).trim();
                if (ghToken) {
                    this._token = ghToken;
                    return this._token;
                }
            }
        } catch (e) {
            logError(e, 'pr-indicator: failed to read gh auth token');
        }

        const manual = await this._settingsStore.getToken();
        if (manual) {
            this._token = manual;
            return this._token;
        }
        return null;
    }

    resetToken() {
        this._token = null;
    }

    async _search(query) {
        const token = await this._loadToken();
        if (!token)
            throw new Error('sem token (rode "gh auth login" ou configure um token manual)');

        return new Promise((resolve, reject) => {
            const url = `https://api.github.com/search/issues?q=${encodeURIComponent(query)}&per_page=${MAX_ITEMS_PER_SECTION}`;
            const msg = Soup.Message.new('GET', url);
            msg.request_headers.append('Authorization', `Bearer ${token}`);
            msg.request_headers.append('Accept', 'application/vnd.github+json');
            msg.request_headers.append('User-Agent', 'pr-indicator-gnome-extension');

            this._session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null, (session, result) => {
                try {
                    if (msg.get_status() !== Soup.Status.OK) {
                        reject(new Error(`GitHub respondeu ${msg.get_status()}`));
                        return;
                    }
                    const bytes = session.send_and_read_finish(result);
                    const json = JSON.parse(new TextDecoder().decode(bytes.get_data()));
                    resolve(json.items ?? []);
                } catch (e) {
                    reject(e);
                }
            });
        });
    }
```

- [ ] **Step 2: Construir a seção de autenticação**

Adicionar à classe `Indicator`:

```javascript
    _buildAuthSection() {
        const container = new St.BoxLayout({vertical: true, x_expand: true});

        this._authStatusLabel = new St.Label({text: '', style_class: 'pr-indicator-empty', x_expand: true});
        container.add_child(this._authStatusLabel);

        this._tokenEntry = new St.Entry({
            hint_text: 'Token do GitHub (escopos repo, read:org)',
            can_focus: true,
            x_expand: true,
            style_class: 'pr-indicator-token-entry',
        });
        this._tokenEntry.clutter_text.set_password_char('•');
        this._tokenEntry.clutter_text.connect('activate', () => this._onSubmitToken());
        container.add_child(this._tokenEntry);

        this._tokenFeedbackLabel = new St.Label({text: '', style_class: 'pr-indicator-empty', x_expand: true});
        container.add_child(this._tokenFeedbackLabel);

        const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        item.add_child(container);

        this._refreshAuthSection();
        return item;
    }

    _refreshAuthSection() {
        const hasGh = this._settingsStore.hasValidGhAuth();
        this._tokenEntry.reactive = !hasGh;
        this._tokenEntry.can_focus = !hasGh;
        this._tokenEntry.opacity = hasGh ? 120 : 255;
        this._authStatusLabel.text = hasGh
            ? '✓ Usando gh CLI (autenticado)'
            : 'gh CLI não encontrado — configure um token manual abaixo';
    }

    _validateToken(token) {
        return new Promise((resolve, reject) => {
            const session = new Soup.Session();
            session.timeout = 15;
            const msg = Soup.Message.new('GET', 'https://api.github.com/user');
            msg.request_headers.append('Authorization', `Bearer ${token}`);
            msg.request_headers.append('Accept', 'application/vnd.github+json');
            msg.request_headers.append('User-Agent', 'pr-indicator-gnome-extension');

            session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null, (source, result) => {
                try {
                    if (msg.get_status() !== Soup.Status.OK) {
                        reject(new Error(`GitHub respondeu ${msg.get_status()}`));
                        return;
                    }
                    const bytes = session.send_and_read_finish(result);
                    const json = JSON.parse(new TextDecoder().decode(bytes.get_data()));
                    resolve(json.login);
                } catch (e) {
                    reject(e);
                }
            });
        });
    }

    async _onSubmitToken() {
        const value = this._tokenEntry.get_text().trim();
        if (!value)
            return;

        this._tokenFeedbackLabel.text = 'Validando…';
        try {
            const login = await this._validateToken(value);
            await this._settingsStore.setToken(value);
            this._client.resetToken();
            this._tokenFeedbackLabel.text = `✓ conectado como ${login}`;
            this.refresh();
        } catch (e) {
            this._tokenFeedbackLabel.text = '✗ token inválido ou sem permissão';
            logError(e, 'pr-indicator: falha ao validar token manual');
        }
    }
```

- [ ] **Step 3: Ligar a seção de autenticação na tela de configuração**

Em `_init`, logo depois das linhas da Task 5 (`_applyTheme(...)`), inserir:

```javascript
        this._configView.box.add_child(this._sectionTitle('Autenticação'));
        this._configView.addMenuItem(this._buildAuthSection());
```

- [ ] **Step 4: Adicionar estilo do campo de token em `stylesheet.css`**

Acrescentar ao final de `stylesheet.css`:

```css
.pr-indicator-token-entry {
    margin: 4px 12px;
}
```

- [ ] **Step 5: Verificação manual — com `gh` autenticado (estado atual da máquina)**

```bash
gnome-extensions disable pr-indicator@sthevan027
gnome-extensions enable pr-indicator@sthevan027
```

Abrir "⚙ Configurações" → seção "Autenticação". Confirmar: mensagem "✓ Usando gh CLI (autenticado)", campo de token visivelmente acinzentado e não aceitando clique/digitação.

- [ ] **Step 6: Verificação manual — sem `gh` disponível**

Simular a ausência do `gh` sem desinstalar nada, renomeando o binário temporariamente:

```bash
sudo mv "$(which gh)" "$(which gh).bak"
gnome-extensions disable pr-indicator@sthevan027
gnome-extensions enable pr-indicator@sthevan027
```

Abrir "⚙ Configurações" → "Autenticação": confirmar mensagem "gh CLI não encontrado...", campo ativo. Colar um Personal Access Token válido (criar um em https://github.com/settings/tokens com escopo `repo` se não tiver um de teste à mão) e apertar Enter: confirmar `✓ conectado como <seu-login>` aparecendo, e que a lista de PRs volta a atualizar normalmente. Testar também um token inválido (ex: `abc123`) e confirmar `✗ token inválido ou sem permissão`.

Reverter a simulação:

```bash
sudo mv "$(which gh).bak" "$(dirname "$(which gh)")/gh" 2>/dev/null || sudo mv "$(command -v gh).bak" "$(command -v gh | sed 's/\.bak$//')"
```

(Se o comando de reverter não encontrar o caminho automaticamente, mova manualmente o arquivo `.bak` de volta pro nome original de `gh` — confirme com `which gh` antes e depois.)

- [ ] **Step 7: Commit**

```bash
git add extension.js stylesheet.css
git commit -m "Adiciona configuração de token manual do GitHub com validação"
```

---

### Task 7: Atualizar o README

**Files:**
- Modify: `README.md`

**Interfaces:**
- Nenhuma — apenas documentação.

- [ ] **Step 1: Substituir a seção "## Configuração" do README**

Trocar o conteúdo atual dessa seção (a tabela de `POLL_SECONDS`/`MAX_ITEMS_PER_SECTION` continua igual, ela não muda de lugar — acrescentar o texto abaixo **depois** da tabela existente e antes de "## Estrutura"):

```markdown
### Painel de configuração

Clique em "⚙ Configurações", no final da lista, pra abrir o painel — ele
substitui a lista de PRs dentro do mesmo popup ("← Voltar" retorna).

- **Ordem e visibilidade das seções:** arraste pela alça (`⋮⋮`) pra
  reordenar; use `−`/`+` pra ocultar/mostrar uma seção sem perder a
  posição dela.
- **Tema:** Automático (segue o tema do sistema, padrão), Branco, Preto
  ou Glass (fundo semitransparente com desfoque). Aplica na hora.
- **Token do GitHub:** se o `gh` CLI estiver instalado e autenticado, ele
  é usado automaticamente e o campo de token fica desabilitado. Sem
  `gh`, cole um [personal access token](https://github.com/settings/tokens)
  (escopos `repo`, `read:org`) e aperte Enter — é validado na hora e
  guardado de forma criptografada no chaveiro do sistema (`libsecret`/
  GNOME Keyring), nunca em texto plano.
```

- [ ] **Step 2: Acrescentar `libsecret` aos requisitos**

Na seção "## Requisitos" do README, depois do item do `gh` CLI, acrescentar:

```markdown
- `libsecret` (GNOME Keyring ou equivalente) — usado só se você configurar
  um token manual em vez de usar o `gh` CLI. Já vem instalado por padrão
  em praticamente toda instalação GNOME.
```

- [ ] **Step 3: Atualizar a árvore em "## Estrutura"**

Substituir o bloco de código da seção "## Estrutura" por:

```
extension.js       lógica (cliente GitHub, indicador, popup, configuração)
lib/
  sectionsConfig.js   lógica pura de ordem/visibilidade das seções
  settingsStore.js    leitura/escrita de GSettings + libsecret
metadata.json       nome, uuid, versão, versões do Shell suportadas
stylesheet.css       estilo do ícone/label na barra e dos temas
schemas/             schema GSettings compilado (ordem, tema)
icons/               ícones customizados (symbolic, recoloridos pelo tema)
tests/               scripts de verificação via `gjs -m` (sem framework)
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "Documenta o painel de configuração no README"
```

---

## Self-Review

- **Cobertura da spec:** localização dentro do popup (Task 3), ordem+visibilidade por drag/`−`+`+` (Task 4), 4 temas com aplicação instantânea (Task 5), token com precedência do `gh`, máscara, validação no Enter (Task 6), armazenamento GSettings+libsecret (Task 2), lógica pura testável (Task 1), documentação (Task 7) — todos os pontos do spec têm task correspondente.
- **Placeholders:** nenhum "TBD"/"implementar depois" — os dois pontos de incerteza técnica genuína (semântica exata de `deltaX/deltaY` do `Clutter.DragAction` na Task 4, e o resultado visual do `Shell.BlurEffect` na Task 5) vêm com código real funcional e uma instrução explícita de ajuste durante a verificação manual, não como lacuna em aberto.
- **Consistência de tipos/nomes:** `SettingsStore` construído com `gioSettings` (não mais `extension`) e usado assim em todas as tasks; `GitHubClient` recebe `settingsStore` no construtor (Task 3) e só usa seus métodos a partir da Task 6; `effectiveOrder`/`moveSection`/`toggleHidden` importados e usados com a mesma assinatura definida na Task 1 em todas as tasks seguintes.
