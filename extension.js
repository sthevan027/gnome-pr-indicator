import GObject from 'gi://GObject';
import St from 'gi://St';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup?version=3.0';
import Clutter from 'gi://Clutter';

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

    _loadToken() {
        if (this._token)
            return this._token;

        try {
            const [ok, stdout] = GLib.spawn_command_line_sync('gh auth token');
            if (ok && stdout) {
                this._token = new TextDecoder().decode(stdout).trim();
            }
        } catch (e) {
            logError(e, 'pr-indicator: failed to read gh auth token');
        }
        return this._token;
    }

    _search(query) {
        return new Promise((resolve, reject) => {
            const token = this._loadToken();
            if (!token) {
                reject(new Error('sem token do gh (rode "gh auth login")'));
                return;
            }

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

        this._configView.box.add_child(this._sectionTitle('Ordem e visibilidade das seções'));
        this._configView.addMenuItem(this._buildSectionsOrderRows());

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

    destroy() {
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
