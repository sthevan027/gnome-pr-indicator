# Painel de configuração dentro do popup — design

Data: 2026-09-21

## Contexto e objetivo

O PR Indicator hoje é fixo: ordem das duas seções, tema visual e origem do
token do GitHub são todos hardcoded/implícitos (a extensão só usa o token
do `gh auth token`). O objetivo desta mudança é dar controle disso ao
usuário, sem sair do popup que já existe e sem depender de `gh` estar
instalado.

Escopo:

- Reordenar e ocultar as duas seções existentes ("Precisa da minha
  revisão" / "Meus PRs abertos").
- Trocar o tema visual do popup entre 4 opções: Automático (padrão, segue
  o sistema), Branco, Preto, Glass (fundo escuro semitransparente com
  blur).
- Configurar manualmente um token pessoal do GitHub, usado só quando o
  `gh` CLI não está instalado/autenticado.

Fora de escopo (explicitamente adiado por YAGNI): mais de 2 seções
configuráveis, cores customizadas por tema, janela de preferências
separada (`prefs.js`/Adw), testes automatizados.

## Arquitetura

Toda a interface de configuração vive **dentro do popup existente** — não
há janela de preferências separada nem dependência de GTK4/libadwaita.
Os widgets usados são os mesmos do popup atual (`St`, `PopupMenu`,
`Clutter`).

### Arquivos novos

- `lib/settingsStore.js` — módulo sem UI, único ponto de leitura/escrita
  de estado persistido. Interface:
  - `getSectionsConfig()` / `setSectionsConfig(list)` — ordem completa +
    quais estão ocultas.
  - `getTheme()` / `setTheme(name)` — `"auto" | "white" | "black" | "glass"`.
  - `getToken()` / `setToken(value)` — async, via `libsecret`.
  - `hasValidGhAuth()` — reaproveita a checagem que hoje vive em
    `GitHubClient`.

  `extension.js` só chama esses métodos; não sabe (nem precisa saber)
  onde cada dado é guardado. Isso isola a lógica de persistência da
  lógica de renderização do popup, que já vai crescer bastante com a
  tela de configuração.

- `schemas/org.gnome.shell.extensions.pr-indicator.gschema.xml` — chaves
  novas:
  - `sections` (`as`) — array ordenado de ids, ex: `["review", "mine"]`.
  - `hidden-sections` (`as`) — ids atualmente ocultos. Separado da ordem
    de propósito: ocultar uma seção não deve embaralhar sua posição.
  - `theme` (`s`) — `"auto" | "white" | "black" | "glass"`.

  O token do GitHub **não** entra no GSettings — fica só no
  `libsecret`/GNOME Keyring (`Secret.password_store` / `lookup` /
  `clear`, chave fixa `{application: "pr-indicator", account:
  "github-token"}`). É um token de API, não deveria ficar em texto
  plano no dconf.

### Arquivos alterados

- `extension.js` — ganha o item de menu "⚙ Configurações", o estado de
  view (`'prs' | 'config'`), a tela de configuração em si, e passa a
  consultar `settingsStore` antes de desenhar as seções de PR.
- `stylesheet.css` — ganha as classes dos 3 temas fixos (branco, preto,
  glass).

## Fluxo de UI

### Troca de tela (view-swap)

- Item fixo **"⚙ Configurações"** na lista atual, abaixo de "Atualizar
  agora".
- Clicar nele não fecha o popup: troca a visibilidade dos grupos
  internos. As seções de PR (e separadores) somem; aparece um item
  **"← Voltar"** no topo seguido da tela de configuração. "← Voltar"
  faz o caminho inverso.
- Estado interno: `this._view` (`'prs' | 'config'`), com dois métodos
  `_showConfigView()` / `_showPRView()` que só ligam/desligam `.visible`
  nos containers — nada é destruído/recriado, a troca é instantânea.
- Reabrir o popup do zero (depois de fechar clicando fora) sempre volta
  pra tela de PRs por padrão.

### Ordem e visibilidade das seções

- Cada seção vira uma linha custom (`St.BoxLayout` dentro de um
  `PopupBaseMenuItem`): alça de arrastar (`⋮⋮`) + nome + botão `−`/`+`.
- Arrastar reordena ao vivo via `Clutter.DragAction` anexado à alça —
  troca de posição entre os itens ao cruzar o meio do vizinho durante o
  arrasto; soltar grava a nova ordem via
  `settingsStore.setSectionsConfig()`.
  - **Risco técnico:** `PopupMenu` do GNOME Shell não tem suporte nativo
    a lista arrastável (diferente de `Gtk.ListBox`). Isso precisa ser
    implementado à mão com `Clutter.DragAction` ou rastreamento manual
    de ponteiro. É mais trabalho que um par de botões ▲▼, mas é viável.
  - Soltar fora dos limites válidos simplesmente reverte pra última
    ordem válida, sem erro visível.
- `−` oculta a seção **no lugar** (linha fica esmaecida, continua
  arrastável); `+` reverte. Não existe lista separada de seções ocultas.
- `refresh()` no popup de PRs passa a ler ordem + visibilidade do
  `settingsStore` antes de decidir o que desenhar e em que sequência.

### Tema

- Seção "Tema" na tela de config com 4 itens de menu, cada um com marca
  de seleção (`PopupMenu.Ornament.CHECK`) — clicar num marca ele e
  desmarca os outros (grupo tipo rádio construído à mão, sem widget
  nativo de rádio no `PopupMenu`).
- Selecionar chama `settingsStore.setTheme(name)` e aplica
  imediatamente, trocando a classe CSS no ator do popup:
  - `Automático` → nenhuma classe extra (comportamento de hoje).
  - `Branco` / `Preto` → classes novas no `stylesheet.css`, cores fixas
    de fundo/texto/separador.
  - `Glass` → fundo escuro semitransparente (`rgba(20,20,20,.55)`) +
    `Shell.BlurEffect` como efeito Clutter no ator do menu (mesma
    técnica usada pela extensão "Blur my Shell"; confirmado que o
    typelib `Shell-18` está disponível no ambiente de desenvolvimento).
- Como é só troca de classe CSS + efeito no ator já existente (nada é
  recriado), a repintura é instantânea mesmo com a tela de configuração
  aberta — inclusive o efeito é visível enquanto a própria tela de
  configuração está sendo usada.

### Autenticação / token do GitHub

- Seção "Autenticação" mostra o status: `✓ Usando gh CLI (autenticado
  como <login>)` quando `settingsStore.hasValidGhAuth()` retorna true.
- Nesse caso, o campo de token (`St.Entry`) fica desabilitado/acinzentado
  (`reactive: false`) — `gh` sempre tem precedência, não faz sentido
  deixar editar um valor que não vai ser usado.
- Quando `gh` não está disponível/autenticado, o campo fica ativo, com
  máscara de senha (`clutter_text.set_password_char('•')`).
- Apertar **Enter** no campo dispara validação assíncrona (`GET /user`
  na API do GitHub com esse token, reaproveitando o padrão de request já
  usado em `GitHubClient`).
  - Sucesso → grava no `libsecret` via `settingsStore.setToken()`,
    mostra `✓ conectado como <login>` embaixo do campo.
  - Falha → mostra `✗ token inválido ou sem permissão`, não persiste
    nada, campo continua editável.
- `GitHubClient._loadToken()` passa a: tentar `gh auth token` primeiro
  (como hoje) → se vazio/falhar, cai para `settingsStore.getToken()`
  (libsecret).

## Tratamento de erros

- Secret Service indisponível (raro — setups GNOME sem
  `gnome-keyring-daemon` rodando): `settingsStore` cai num fallback
  silencioso, guardando o token direto no GSettings em texto plano, com
  um `logError` registrado (sem popup de erro, pra não poluir a UI).
  Essa limitação vai pro README.
- Falha de rede/API ao validar o token: tratada como no fluxo de
  autenticação acima (mensagem inline, nada persistido).
- Drag-and-drop solto fora dos limites válidos: reverte pra última
  ordem válida.

## Testes

Não existe suíte automatizada para esta extensão (não há framework de
teste estabelecido para extensões GNOME Shell neste projeto). A
verificação é manual, seguindo o mesmo processo já usado para confirmar
a troca de ícone:

1. Implementar a mudança.
2. `gnome-extensions disable` + `enable` para recarregar (deve bastar
   para JS/CSS incremental; só se a estrutura de classes exportadas
   mudar é que pode esbarrar no cache de módulo do GNOME Shell 45+ e
   pedir logout/login, como aconteceu com a troca do ícone).
3. Confirmação visual manual de cada peça: arrastar/ocultar seção, cada
   um dos 4 temas, validação de token com e sem `gh` instalado.

## Decisões registradas (histórico da conversa)

- Configuração vive dentro do popup, sem janela separada.
- Ordem **e** visibilidade por seção, ambas configuráveis.
- Tema afeta só o popup, não o ícone/label da barra.
- 4ª opção "Automático" como padrão.
- Token guardado no `libsecret`/GNOME Keyring.
- `gh` sempre vence quando autenticado; campo de token fica
  desabilitado nesse caso.
- Validação do token ao salvar (Enter), com feedback inline.
- Aplicação instantânea de todas as mudanças, incluindo repintura do
  próprio popup enquanto está aberto.
- Entrada via item de menu fixo que substitui o conteúdo do popup
  (view-swap), não um ícone extra na barra nem um submenu que convive
  com a lista de PRs.
- Reordenação por arrastar-e-soltar (não botões ▲▼), aceitando o risco
  técnico de implementação manual.
- Ocultar mantém a seção na mesma lista, esmaecida, sem lista separada
  de "ocultas".
