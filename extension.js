import GObject from 'gi://GObject';
import St from 'gi://St';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup?version=3.0';
import Clutter from 'gi://Clutter';
import Shell from 'gi://Shell';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {SettingsStore} from './lib/settingsStore.js';
import {moveSection, toggleHidden, effectiveOrder} from './lib/sectionsConfig.js';

const POLL_SECONDS = 60;
const MAX_ITEMS_PER_SECTION = 8;

const SECTION_LABELS = {
    review: 'Precisa da minha revisão',
    mine: 'Meus PRs abertos',
};

/**
 * Talks to the GitHub Search API for "PRs needing my review" and
 * "my open PRs". Auth token comes from the local `gh` CLI (already
 * logged in on this machine) instead of asking the user for a new one.
 */
class GitHubClient {
    constructor(settingsStore) {
        this._session = new Soup.Session();
        this._session.timeout = 15;
        this._token = null;
        this._settingsStore = settingsStore;
    }

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

    /** PRs abertos onde fui pedido como revisor. */
    fetchNeedsReview() {
        return this._search('is:pr is:open review-requested:@me archived:false');
    }

    /** Meus PRs abertos, em qualquer repositório. */
    fetchMyOpenPRs() {
        return this._search('is:pr is:open author:@me archived:false');
    }
}

function repoNameFromItem(item) {
    // repository_url looks like https://api.github.com/repos/<owner>/<repo>
    const parts = (item.repository_url || '').split('/');
    return parts.slice(-2).join('/');
}

const Indicator = GObject.registerClass(
class Indicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.5, 'PR Indicator');
        this._extension = extension;
        this._settingsStore = new SettingsStore(extension.getSettings());
        this._client = new GitHubClient(this._settingsStore);
        this._timeoutId = null;

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

        this._reviewTitle = this._sectionTitle('Precisa da minha revisão');
        this._reviewSeparator = new PopupMenu.PopupSeparatorMenuItem();
        this._reviewBlock = new St.BoxLayout({vertical: true, x_expand: true});
        this._reviewBlock.add_child(this._reviewTitle);
        this._reviewBlock.add_child(this._reviewSection.actor);
        this._reviewBlock.add_child(this._reviewSeparator.actor);
        this._prView.box.add_child(this._reviewBlock);

        this._mineTitle = this._sectionTitle('Meus PRs abertos');
        this._mineSeparator = new PopupMenu.PopupSeparatorMenuItem();
        this._mineBlock = new St.BoxLayout({vertical: true, x_expand: true});
        this._mineBlock.add_child(this._mineTitle);
        this._mineBlock.add_child(this._mineSection.actor);
        this._mineBlock.add_child(this._mineSeparator.actor);
        this._prView.box.add_child(this._mineBlock);

        const refreshRow = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        const refreshRowBox = new St.BoxLayout({x_expand: true, y_align: 2 /* Clutter.ActorAlign.CENTER */});
        const refreshButton = new St.Button({
            style_class: 'popup-menu-item',
            x_expand: true,
            can_focus: true,
            label: 'Atualizar agora',
        });
        refreshButton.connect('clicked', () => this.refresh());
        const settingsButton = new St.Button({
            style_class: 'pr-indicator-settings-button',
            can_focus: true,
            y_align: 2,
        });
        settingsButton.set_child(new St.Icon({
            icon_name: 'emblem-system-symbolic',
            style_class: 'popup-menu-icon',
        }));
        settingsButton.connect('clicked', () => this._showConfigView());
        refreshRowBox.add_child(refreshButton);
        refreshRowBox.add_child(settingsButton);
        refreshRow.add_child(refreshRowBox);
        this._prView.addMenuItem(refreshRow);
        this._refreshItem = refreshRow;

        this._statusItem = new PopupMenu.PopupMenuItem('', {reactive: false, style_class: 'pr-indicator-empty'});
        this._prView.addMenuItem(this._statusItem);

        this.menu.addMenuItem(this._prView);

        this._configView = new PopupMenu.PopupMenuSection();
        this._configView.actor.visible = false;
        this.menu.addMenuItem(this._configView);

        const backItem = new PopupMenu.PopupMenuItem('← Voltar');
        backItem.connect('activate', () => this._showPRView());
        this._configView.addMenuItem(backItem);

        this._configView.box.add_child(this._sectionTitle('Ordem e visibilidade das seções'));
        this._configView.addMenuItem(this._buildSectionsOrderRows());

        this._configView.box.add_child(this._sectionTitle('O indicador acompanha'));
        this._configView.addMenuItem(this._buildBadgeSection());

        this._configView.box.add_child(this._sectionTitle('Tema'));
        this._configView.addMenuItem(this._buildThemeSection());

        this._configView.box.add_child(this._sectionTitle('Autenticação'));
        this._configView.addMenuItem(this._buildAuthSection());

        this._applyTheme(this._settingsStore.getTheme());

        this.refresh();
        this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, POLL_SECONDS, () => {
            this.refresh();
            return GLib.SOURCE_CONTINUE;
        });
    }

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

    _showConfigView() {
        this._prView.actor.visible = false;
        this._configView.actor.visible = true;
    }

    _showPRView() {
        this._configView.actor.visible = false;
        this._prView.actor.visible = true;
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

        // Clutter.DragAction foi removido no Mutter 18 (GNOME 50) em favor da
        // API de Clutter.Gesture. Reordenar arrastando é reimplementado aqui
        // à mão, rastreando o ponteiro no stage entre press e release.
        //
        // motionId/releaseId ficam presos no `stage` (global, fora do popup),
        // então se o popup fechar/for destruído no meio do drag (reload da
        // extensão, disable/enable) e ninguém desconectar, o handler de
        // motion continua vivo pra sempre, disparando a cada movimento do
        // mouse em qualquer lugar do desktop e lançando exceção porque `row`
        // já foi destruído — foi isso que gerou a enxurrada de erros
        // "already disposed" no journal. _endDrag() garante que os dois
        // sempre são desconectados, mesmo fora do fluxo normal de release.
        handle.connect('button-press-event', (actor, event) => {
            if (event.get_button() !== Clutter.BUTTON_PRIMARY)
                return Clutter.EVENT_PROPAGATE;

            this._endDrag();

            this._dragStage = handle.get_stage();
            let [, lastY] = event.get_coords();

            this._dragMotionId = this._dragStage.connect('motion-event', (_stage, motionEvent) => {
                const [, y] = motionEvent.get_coords();
                this._reorderDuringDrag(row, y - lastY);
                lastY = y;
                return Clutter.EVENT_STOP;
            });
            this._dragReleaseId = this._dragStage.connect('button-release-event', () => {
                this._endDrag();
                this._commitSectionOrder();
                return Clutter.EVENT_STOP;
            });

            return Clutter.EVENT_STOP;
        });

        this._sectionRows[section.id] = row;
        return row;
    }

    _endDrag() {
        if (!this._dragStage)
            return;
        if (this._dragMotionId) {
            this._dragStage.disconnect(this._dragMotionId);
            this._dragMotionId = null;
        }
        if (this._dragReleaseId) {
            this._dragStage.disconnect(this._dragReleaseId);
            this._dragReleaseId = null;
        }
        this._dragStage = null;
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

    _buildBadgeSection() {
        const wrapper = new St.BoxLayout({vertical: true, x_expand: true});
        this._badgeCheckIcons = {};

        const options = [
            ['review', 'PRs pra eu revisar'],
            ['mine', 'Meus PRs abertos'],
        ];
        const current = this._settingsStore.getBadgeSection();

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
            button.connect('clicked', () => this._onSelectBadgeSection(value));
            row.add_child(button);

            this._badgeCheckIcons[value] = check;
            wrapper.add_child(row);
        }

        const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        item.add_child(wrapper);
        return item;
    }

    _onSelectBadgeSection(value) {
        for (const [key, icon] of Object.entries(this._badgeCheckIcons))
            icon.icon_name = key === value ? 'object-select-symbolic' : '';

        this._settingsStore.setBadgeSection(value);
        this.refresh();
    }

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
        // A classe precisa ir em `menu.box` (nó `.popup-menu-content`), não em
        // `menu.actor` (o BoxPointer): é o `.popup-menu-content` que o tema do
        // sistema pinta com fundo/borda — o BoxPointer em si é transparente.
        const classes = ['pr-indicator-theme-white', 'pr-indicator-theme-black', 'pr-indicator-theme-glass'];
        const targetClass = {
            white: 'pr-indicator-theme-white',
            black: 'pr-indicator-theme-black',
            glass: 'pr-indicator-theme-glass',
        }[themeName];

        for (const menu of [this.menu]) {
            for (const cls of classes)
                menu.box.remove_style_class_name(cls);

            if (menu.box._prBlurEffect) {
                menu.box.remove_effect(menu.box._prBlurEffect);
                menu.box._prBlurEffect = null;
            }

            if (targetClass)
                menu.box.add_style_class_name(targetClass);

            if (themeName === 'glass') {
                // `Shell.BlurEffect` não tem propriedade `sigma` nesta versão
                // (Shell-18/GNOME 50) — é `radius` (gint). Usar `sigma` faz o
                // construtor lançar exceção, o que derruba a extensão inteira
                // (GNOME Shell destrói o objeto que lançou a exceção).
                menu.box._prBlurEffect = new Shell.BlurEffect({
                    brightness: 0.85,
                    radius: 30,
                    mode: Shell.BlurMode.BACKGROUND,
                });
                menu.box.add_effect(menu.box._prBlurEffect);
            }
        }
        // 'auto' não adiciona classe nenhuma — comportamento padrão do sistema.
    }

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
        let login;
        try {
            login = await this._validateToken(value);
        } catch (e) {
            this._tokenFeedbackLabel.text = '✗ token inválido ou sem permissão';
            logError(e, 'pr-indicator: falha ao validar token manual');
            return;
        }

        try {
            await this._settingsStore.setToken(value);
        } catch (e) {
            this._tokenFeedbackLabel.text = '✗ token válido, mas falhou ao salvar no chaveiro do sistema';
            logError(e, 'pr-indicator: falha ao gravar token no keyring');
            return;
        }

        this._client.resetToken();
        this._tokenFeedbackLabel.text = `✓ conectado como ${login}`;
        this.refresh();
    }

    _sectionTitle(text) {
        return new St.Label({text, style_class: 'pr-indicator-section-title'});
    }

    _fillSection(section, items) {
        section.removeAll();
        if (items.length === 0) {
            const empty = new PopupMenu.PopupMenuItem('Nada por aqui', {reactive: false, style_class: 'pr-indicator-empty'});
            section.addMenuItem(empty);
            return;
        }
        for (const item of items) {
            const repo = repoNameFromItem(item);
            const menuItem = new PopupMenu.PopupBaseMenuItem();
            const wrap = new St.BoxLayout({vertical: true});
            wrap.add_child(new St.Label({text: `#${item.number} ${item.title}`, style_class: 'pr-indicator-item-title'}));
            wrap.add_child(new St.Label({text: repo, style_class: 'pr-indicator-item-repo'}));
            menuItem.add_child(wrap);
            menuItem.connect('activate', () => {
                Gio.AppInfo.launch_default_for_uri(item.html_url, null);
            });
            section.addMenuItem(menuItem);
        }
    }

    async refresh() {
        try {
            const [needsReview, mine] = await Promise.all([
                this._client.fetchNeedsReview(),
                this._client.fetchMyOpenPRs(),
            ]);

            const itemsBySection = {review: needsReview, mine};
            const sectionsConfig = this._settingsStore.getSectionsConfig();
            const visibleIds = effectiveOrder(sectionsConfig);
            const reviewVisible = visibleIds.includes('review');
            const mineVisible = visibleIds.includes('mine');

            this._applySectionsOrder(sectionsConfig);

            // Cada bloco controla sua própria visibilidade, incluindo título,
            // lista e separador, sem afetar a outra seção.
            this._reviewTitle.visible = reviewVisible;
            this._reviewSection.actor.visible = reviewVisible;
            this._reviewSeparator.actor.visible = reviewVisible;
            this._mineTitle.visible = mineVisible;
            this._mineSection.actor.visible = mineVisible;
            this._mineSeparator.actor.visible = mineVisible;

            this._fillSection(this._reviewSection, itemsBySection.review ?? []);
            this._fillSection(this._mineSection, itemsBySection.mine ?? []);

            const badgeSection = this._settingsStore.getBadgeSection();
            this._countLabel.text = String((itemsBySection[badgeSection] ?? needsReview).length);

            const now = GLib.DateTime.new_now_local().format('%H:%M');
            this._statusItem.label.text = `Atualizado às ${now}`;
        } catch (e) {
            this._countLabel.text = '!';
            this._statusItem.label.text = `Erro: ${e.message}`;
            logError(e, 'pr-indicator: refresh failed');
        }
    }

    _applySectionsOrder(sectionsConfig) {
        const blocks = {
            review: this._reviewBlock,
            mine: this._mineBlock,
        };
        let anchor = this._refreshItem.actor;

        for (let index = sectionsConfig.length - 1; index >= 0; index--) {
            const block = blocks[sectionsConfig[index].id];
            if (!block)
                continue;

            this._prView.box.set_child_above_sibling(block, anchor);
            anchor = block;
        }
    }

    destroy() {
        this._endDrag();
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = null;
        }
        super.destroy();
    }
});

export default class PrIndicatorExtension extends Extension {
    enable() {
        this._indicator = new Indicator(this);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
