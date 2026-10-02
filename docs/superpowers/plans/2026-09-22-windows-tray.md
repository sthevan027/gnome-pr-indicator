# Versão Windows (tray) Implementation Plan

> Reescrito em 2026-10-02 (o original ficou só no clone do notebook) e
> revisado pra manter o mesmo visual do GNOME.

**Goal:** PR Indicator funcional no Windows com a mesma interface da extensão GNOME (ícone + número, popup, temas, config inline).

**Architecture:** App Electron em `windows/`. O main process concentra a lógica:
- módulos puros testados com `node --test`: `github-client.js`, `settings-store.js`, `popup-position.js`, `badge.js`;
- reuso de `../lib/sectionsConfig.js`;
- `Tray` e `BrowserWindow`.

O renderer (`popup.html/css/js`) é só view. Ele recebe o estado por IPC e devolve intenções (`toggleSection`, `moveSection`, `setTheme`, …), sem regra de negócio.

**Tech Stack:** Electron, Node ≥ 20 (`fetch`, `node:test`), Bun como gerenciador de pacotes (`trustedDependencies: ["electron"]` pro postinstall baixar o binário).

**Spec:** `docs/superpowers/specs/2026-09-22-windows-tray-design.md`

## Global Constraints

- Nada em `windows/` altera a extensão GNOME; `lib/` continua sem dependência de Node/Electron.
- Textos, opções e comportamento idênticos ao `extension.js`; estilos portados do `stylesheet.css`.
- Renderer com `contextIsolation: true`, `nodeIntegration: false`, API exposta só via `preload.cjs`.
- Commits curtos em português, imperativo, sem prefixo.

---

### Task 1: Scaffold Electron
- Trocar `systray2` por `electron` (`bun add -d electron`), `trustedDependencies`, scripts `start`, `test`, `autostart:enable/disable`.
- `src/main.js` mínimo: `Tray` com o ícone, instância única (`requestSingleInstanceLock`), sem janela na barra de tarefas.
- **Verificação:** `bun run start` → ícone aparece na bandeja.

### Task 2: `settings-store.js` (TDD)
- Lê e grava `settings.json` com as chaves e padrões do gschema; `getSectionsConfig` usa `normalizeSections`.
- Token: `setToken/getToken/clearToken` via um `crypto` injetado (`safeStorage` em produção, fake no teste).
- **Testes:** padrão sem arquivo, round-trip das chaves, JSON corrompido → padrão, token cifrado no disco (nunca em texto plano).

### Task 3: `github-client.js` (TDD)
- `resolveToken({execGh, store})`: `gh auth token` primeiro, depois token manual, senão `AuthError`.
- `searchPRs(query)` com 401 → `AuthError` e outros não-OK → `Error`; `fetchAll()` → `{review, mine}` com as mesmas queries do GNOME.
- `validateToken(token)` → login, via `/user`.
- `repoNameFromItem` igual ao GNOME.

### Task 4: Ícone com número (`badge.js` + render)
- Pura (TDD): `badgeText({state, items, badgeSection})` → `'…' | '!' | 'N'`.
- O render desenha o SVG do GitHub + o texto num canvas offscreen (1x e 2x pra DPI) e gera um `nativeImage` pra `tray.setImage`.
- **Verificação:** o número aparece e muda com o "O indicador acompanha".

### Task 5: Janela do popup (`popup-position.js` TDD)
- `computePopupPosition(trayBounds, size, workArea)` centraliza no ícone, abre pra cima com a barra embaixo e pra baixo com a barra em cima, sem sair da área útil.
- `BrowserWindow` sem moldura, transparente, `show: false`, fecha no `blur`; clique no tray alterna; altura acompanha o conteúdo (o renderer reporta a altura).

### Task 6: View de PRs (renderer)
- Port 1:1 da estrutura: título da seção, itens (`#N título` + repo), "Nada por aqui", separador, linha "Atualizar agora" + engrenagem, status "Atualizado às HH:MM" ou "Erro: …".
- Ordem e visibilidade conforme a config; clique → `shell.openExternal`.

### Task 7: View de config (renderer)
- "← Voltar"; "Ordem e visibilidade das seções" com `☰` arrastável (pointer events) e `−`/`+`; "O indicador acompanha" e "Tema" com `✓`; "Autenticação" com status do `gh`, campo de senha (Enter envia) e feedback.
- Cada ação → IPC → main aplica com `moveSection`/`toggleHidden`/store → re-render + refresh.

### Task 8: Temas
- Classes CSS `theme-auto/white/black/glass`; o auto segue `nativeTheme`; no glass liga `backgroundMaterial: 'acrylic'` (Win 11) e, sem suporte, cai no fundo `rgba(20,20,20,0.55)`.
- **Verificação:** os 4 temas, comparados lado a lado com os screenshots do GNOME.

### Task 9: Loop de atualização
- Polling de 60s + "Atualizar agora"; `AuthError` limpa as listas e mostra `!`; erro pontual mantém a última lista boa.

### Task 10: Autostart
- `src/autostart.js` (TDD nos argumentos de `setLoginItemSettings`) + scripts `autostart:enable/disable`.

### Task 11: README + verificação manual
- Seção "Windows" no README raiz e `windows/README.md`.
- Checklist:
  - ícone na bandeja; o hover troca pelo número e volta ao tirar o mouse;
  - o popup abre colado ao ícone e fecha ao clicar fora;
  - o clique abre o PR;
  - os 4 temas funcionam;
  - arrastar e `−`/`+` persistem após reiniciar;
  - o badge troca de seção;
  - o token manual funciona com `gh auth logout`;
  - sem rede, a lista boa é mantida;
  - o autostart liga e desliga.
