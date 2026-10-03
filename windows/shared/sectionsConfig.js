// Em desenvolvimento, só reexporta a lógica compartilhada com a extensão
// GNOME. No .exe, o electron-builder põe aqui o arquivo real de
// ../lib/sectionsConfig.js (ver "files" em package.json), porque nada fora
// de windows/ entra no pacote.
export * from '../../lib/sectionsConfig.js';
