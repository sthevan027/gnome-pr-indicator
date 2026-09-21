#!/usr/bin/env gjs
// Standalone smoke test for the GitHub polling logic, run outside the Shell
// with plain `gjs` — verifies the Soup request + JSON parsing actually work
// before trusting it inside a live GNOME Shell session.
imports.gi.versions.Soup = '3.0';
const {GLib, Soup} = imports.gi;

const session = new Soup.Session();
session.timeout = 15;

function loadToken() {
    const [ok, stdout] = GLib.spawn_command_line_sync('gh auth token');
    if (!ok)
        throw new Error('gh auth token failed');
    return new TextDecoder().decode(stdout).trim();
}

function search(query) {
    const token = loadToken();
    const url = `https://api.github.com/search/issues?q=${encodeURIComponent(query)}&per_page=8`;
    const msg = Soup.Message.new('GET', url);
    msg.request_headers.append('Authorization', `Bearer ${token}`);
    msg.request_headers.append('Accept', 'application/vnd.github+json');
    msg.request_headers.append('User-Agent', 'pr-indicator-gnome-extension-test');

    const bytes = session.send_and_read(msg, null);
    print(`status: ${msg.get_status()}`);
    const json = JSON.parse(new TextDecoder().decode(bytes.get_data()));
    return json.items ?? [];
}

print('=== review-requested:@me ===');
const needsReview = search('is:pr is:open review-requested:@me archived:false');
print(`count: ${needsReview.length}`);
needsReview.forEach(i => print(` #${i.number} ${i.title} (${i.repository_url})`));

print('=== author:@me ===');
const mine = search('is:pr is:open author:@me archived:false');
print(`count: ${mine.length}`);
mine.forEach(i => print(` #${i.number} ${i.title} (${i.repository_url})`));
