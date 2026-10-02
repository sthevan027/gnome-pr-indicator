# Versão Windows (tray) — Design

> Reescrita em 2026-10-02. O commit original de 2026-09-22 ficou só no clone
> do notebook e nunca subiu. Revisada no mesmo dia: o Sthevan quer o **mesmo
> visual do GNOME** (popup, temas, painel de config inline), não um menu
> nativo simples.

## Objetivo

Deixar o PR Indicator funcional no Windows **sem mudar nada do que já foi
desenhado no GNOME**. Isso inclui o ícone com o número ao lado, o popup com as
duas seções, "Atualizar agora" com a engrenagem, a linha de status, e o painel
de configuração inline (ordem e visibilidade das seções, o que o indicador
acompanha, tema e autenticação). Os textos, o comportamento e as opções são
os mesmos.

A extensão GNOME é específica do GNOME Shell (GJS, `St`, `Clutter`), então
não roda no Windows. A solução é um app separado que reaproveita a lógica
pura (`lib/sectionsConfig.js`) e redesenha **a mesma** interface em
HTML/CSS.

## Decisões

| Tema | Decisão | Motivo |
|---|---|---|
| Localização | Mesmo repo, pasta `windows/` | A extensão GNOME não é tocada; `lib/` é compartilhada. |
| Runtime/UI | **Electron**; Bun só como gerenciador de pacotes | É o único jeito razoável de ter um popup customizado (cantos arredondados, transparência, blur) preso à bandeja, mantendo tudo em JS. O main process importa `../lib/sectionsConfig.js` direto. Substitui o `systray2` do plano anterior, que só fazia menu nativo. |
| Bandeja | `Tray` do Electron | Ícone do GitHub; **ao passar o mouse, a imagem troca pela contagem de PRs** e volta ao tirar. O popup só abre no clique. (A bandeja do Windows é um quadrado 16×16, então não cabe ícone + número lado a lado como no painel do GNOME.) |
| Popup | `BrowserWindow` sem moldura, transparente, `alwaysOnTop`, `skipTaskbar` | Abre colado ao ícone da bandeja e fecha ao perder o foco, como o popup do GNOME. |
| Configurações | JSON em `%APPDATA%\PR Indicator\settings.json` com as mesmas chaves e padrões do gschema (`sections`, `hidden-sections`, `theme`, `badge-section`) | É o equivalente do GSettings. |
| Token manual | `safeStorage` do Electron (DPAPI do Windows) | É o equivalente do libsecret/GNOME Keyring: o token nunca fica em texto plano. |
| Autostart | `app.setLoginItemSettings` (entrada `Run` do HKCU), ligado e desligado via `bun run autostart:enable/disable` | Não exige admin nem `.vbs`, e não acrescenta nada novo na UI. |

## Visual (equivalências)

- **Ícone ↔ número (hover):** o normal é só o ícone do GitHub
  (`icons/github-symbolic.svg`) em branco. Com o mouse em cima, a imagem
  vira a contagem da seção escolhida em "O indicador acompanha", em negrito
  e branco: `…` enquanto carrega, `!` em erro, `99+` acima de 99. Ao tirar o
  mouse, volta o ícone. O tooltip também mostra a contagem. O Electron no
  Windows só emite `mouse-move` no tray (sem `mouse-leave`), então a saída é
  detectada checando `screen.getCursorScreenPoint()` contra
  `tray.getBounds()` a cada ~150ms enquanto o mouse está em cima.
- **Popup "Automático":** reproduz o popup padrão do GNOME Shell (fundo
  cinza-escuro, cantos arredondados, itens com hover arredondado). Segue o
  tema claro/escuro do Windows, com a variante clara do Shell no modo claro.
- **Branco / Preto / Glass:** as mesmas cores do `stylesheet.css`
  (`#ffffff`/`#1a1a1a`, `#101010`/`#f2f2f2`, `rgba(20,20,20,0.55)`/`#f2f2f2`).
  No Glass, o blur vem do material acrílico do Windows 11
  (`backgroundMaterial: 'acrylic'`), no lugar do `Shell.BlurEffect`.
- **Estilos portados 1:1** do `stylesheet.css`: título de seção (negrito,
  0.85em, opacidade 0.7), "Nada por aqui" (itálico, 0.6), título do PR
  (até 320px, com reticências), repo (0.85em, 0.6), linha oculta na
  config (0.45), botão `−`/`+`, check `✓` no tema e no badge.
- **Fonte:** a interface do sistema (Segoe UI). No GNOME a fonte também é a
  da interface do sistema.

## Comportamento

Igual ao GNOME:

- Atualiza a cada 60s, até 8 PRs por seção, e clicar no PR abre no
  navegador.
- A engrenagem troca pra view de config e "← Voltar" volta. Mudanças
  aplicam na hora.
- Reordenar arrastando pelo ícone `☰`.
- Na autenticação, o `gh` CLI tem precedência. Se ele estiver logado, o
  campo de token fica desabilitado com "✓ Usando gh CLI (autenticado)".
  Senão, o token é validado em `/user` antes de salvar, com feedback "✓
  conectado como X" ou "✗ token inválido…".

Uma diferença vinda do plano de 22/09: o GNOME mostra `!` e
`Erro: ...` em qualquer falha. No Windows:

- Falha de autenticação (`AuthError`: sem `gh` e sem token, ou HTTP 401):
  as listas são limpas, aparece `!` e `Erro: ...`.
- Falha pontual de rede ou de API: **mantém a última lista boa**, só a
  linha de status mostra o erro.

## Fora de escopo (v1)

Instalador/`.exe` empacotado (roda via `bun run start` + autostart),
notificações toast e mudanças de visual ou comportamento em relação ao
GNOME.
