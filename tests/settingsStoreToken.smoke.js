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
