# PR Indicator — Windows

Versão pra bandeja do Windows da extensão GNOME. Tem o mesmo popup, os
mesmos temas e o mesmo painel de configuração inline. Mostra os PRs
esperando a sua revisão e os seus PRs abertos no GitHub, e atualiza sozinha
a cada 60 segundos.

- **Ícone na bandeja:** o logo do GitHub. **Ao passar o mouse, ele vira o
  número de PRs** da seção escolhida em "O indicador acompanha". Mostra `…`
  enquanto carrega e `!` em erro. Tirando o mouse, o logo volta.
- **Clique (esquerdo ou direito):** abre o popup colado ao ícone. Clicar fora
  ou apertar `Esc` fecha. Clicar num PR abre no navegador.
- **Engrenagem:** abre o painel de configuração, com o mesmo conteúdo do
  GNOME: ordem e visibilidade das seções (arraste pelo `☰`, use `−`/`+`),
  o que o indicador acompanha, o tema (Automático/Branco/Preto/Glass) e a
  autenticação.

Dica: pra deixar o ícone sempre visível, e não escondido no `^`, vá em
*Configurações → Personalização → Barra de tarefas → Outros ícones da
bandeja do sistema* e ligue o **PR Indicator**.

## Requisitos

- Windows 10/11. O tema Glass usa o material acrílico do Windows 11; no
  Windows 10 ele vira um fundo escuro translúcido sem blur.
- [Node.js](https://nodejs.org/) 20+ e [Bun](https://bun.sh/) (gerenciador
  de pacotes).
- [GitHub CLI](https://cli.github.com/) autenticado (`gh auth login`), **ou**
  um token manual configurado no painel.

## Instalação

```powershell
cd windows
bun install
# o Bun não roda scripts de instalação por padrão; se o binário do
# Electron não tiver baixado (node_modules/electron/dist vazio):
node node_modules/electron/install.js
bun run start
```

Pra abrir junto com o Windows:

```powershell
bun run autostart:enable    # desliga com: bun run autostart:disable
```

## Onde ficam os dados

Ficam em `%APPDATA%\PR Indicator\`:

- `settings.json`: ordem e seções ocultas, tema e seção do indicador. Usa as
  mesmas chaves do schema GSettings do GNOME.
- `token.bin`: o token manual, cifrado pelo cofre do Windows (DPAPI via
  `safeStorage`). Nunca fica em texto plano. Só é usado se o `gh` CLI não
  estiver autenticado.

Diferença em relação ao GNOME: quando falha só a rede ou a API (timeout,
5xx, rate limit), o popup **mantém a última lista boa** e só a linha de
status mostra o erro. Quando a falha é de autenticação, a lista é limpa.

## Estrutura

```
src/main.js             processo principal: bandeja, popup, polling, IPC
src/preload.cjs         ponte segura main ↔ popup (contextIsolation)
src/github-client.js    buscas no GitHub, token (gh → manual), AuthError
src/settings-store.js   settings.json + token cifrado
src/badge.js            texto do hover/tooltip, detecção do mouse
src/popup-position.js   onde abrir o popup conforme a barra de tarefas
src/autostart.js        entrada "abrir com o Windows"
src/renderer/           popup (HTML/CSS/JS) e desenho do ícone da bandeja
tests/                  testes com `node --test` (bun run test)
```

A lógica de ordem e visibilidade das seções é a mesma da extensão,
importada direto de `../lib/sectionsConfig.js`.

## Testes

```powershell
bun run test
```

Modo de teste do app. Usa variáveis de ambiente e não mexe nas suas
configurações reais:

| Variável | Efeito |
|---|---|
| `PR_INDICATOR_USER_DATA` | pasta de dados isolada |
| `PR_INDICATOR_FAKE` | usa um JSON no lugar do GitHub: `{"ghAuth": true, "review": [...], "mine": [...], "error": "auth" \| "<mensagem>"}`; no token fake, `valido` é aceito |
| `PR_INDICATOR_SNAPSHOT` | salva `popup-pr.png`, `popup-config.png`, `tray-icon.png`, `tray-hover.png`, `tooltip.txt` e `bounds.json` nessa pasta e fecha |
