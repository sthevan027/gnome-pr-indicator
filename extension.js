import GObject from 'gi://GObject';
import St from 'gi://St';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup?version=3.0';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const POLL_SECONDS = 60;
const MAX_ITEMS_PER_SECTION = 8;

/**
 * Talks to the GitHub Search API for "PRs needing my review" and
 * "my open PRs". Auth token comes from the local `gh` CLI (already
 * logged in on this machine) instead of asking the user for a new one.
 */
class GitHubClient {
    constructor() {
        this._session = new Soup.Session();
        this._session.timeout = 15;
        this._token = null;
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
        this._client = new GitHubClient();
        this._timeoutId = null;

        const box = new St.BoxLayout({style_class: 'pr-indicator-box', y_align: 2 /* Clutter.ActorAlign.CENTER */});
        this._icon = new St.Icon({
            icon_name: 'emblem-synchronizing-symbolic',
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

        this._reviewSection = new PopupMenu.PopupMenuSection();
        this._mineSection = new PopupMenu.PopupMenuSection();

        this.menu.box.add_child(this._sectionTitle('Precisa da minha revisão'));
        this.menu.addMenuItem(this._reviewSection);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.box.add_child(this._sectionTitle('Meus PRs abertos'));
        this.menu.addMenuItem(this._mineSection);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const refreshItem = new PopupMenu.PopupMenuItem('Atualizar agora');
        refreshItem.connect('activate', () => this.refresh());
        this.menu.addMenuItem(refreshItem);

        this._statusItem = new PopupMenu.PopupMenuItem('', {reactive: false, style_class: 'pr-indicator-empty'});
        this.menu.addMenuItem(this._statusItem);

        this.refresh();
        this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, POLL_SECONDS, () => {
            this.refresh();
            return GLib.SOURCE_CONTINUE;
        });
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

            this._fillSection(this._reviewSection, needsReview);
            this._fillSection(this._mineSection, mine);
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
