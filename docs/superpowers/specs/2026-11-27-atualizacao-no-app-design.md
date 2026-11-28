# Atualização dentro do app (bandeja Windows/Linux)

## Objetivo

Atualizar o app sem precisar procurar e baixar o instalador no GitHub. O app
avisa que há versão nova; **nada é baixado sem um clique**.

## Não faz parte

- Baixar ou reiniciar sozinho, sem o usuário pedir.
- Notificação do sistema ou selo de atualização no ícone da bandeja.
- Canal beta, downgrade ou assinatura de código.
- Extensão GNOME (só o app em `windows/`).

## Abordagens consideradas

| Abordagem | Troca | Decisão |
|---|---|---|
| `electron-updater` | Uma dependência de produção; já resolve download, conferência de hash e instalação no NSIS e no AppImage | **Escolhida** |
| Código próprio (API de releases + download + execução do instalador) | Sem dependência, mas reimplementa a parte mais sensível | Descartada |
| `autoUpdater` nativo do Electron | Exige Squirrel no Windows (outro instalador) e não cobre Linux | Descartada |

## Comportamento

O app procura versão nova ao iniciar, a cada 6 horas e pelo botão
**Procurar atualizações** na tela de configurações, que também mostra a versão
atual.

Quando há versão nova, aparece uma linha no popup, acima de *Atualizar agora*:

| Estado | Linha no popup | Clique |
|---|---|---|
| disponível | `Versão X disponível · Baixar` | começa o download |
| baixando | `Baixando versão X… 42%` | nada |
| pronta | `Versão X pronta · Reiniciar para atualizar` | instala em silêncio e reabre |
| falha no download | `Falha ao baixar · Tentar de novo` | baixa de novo |

- No Windows, que não tem a opção *Sair*, a instalação é feita pela linha
  *Reiniciar para atualizar*. No Linux (AppImage), a versão baixada também é
  instalada ao sair pelo menu da bandeja.
- Falha na checagem automática só vai para o log. Na checagem manual, a tela de
  configurações mostra o resultado: atualizado, versão disponível ou erro.
- Uma nova checagem não interrompe um download nem descarta uma versão pronta.

### Onde não dá para instalar

Na versão **portátil** (`PORTABLE_EXECUTABLE_FILE` definido) e no Linux fora do
AppImage (`APPIMAGE` ausente), a linha vira `Versão X disponível · Abrir
download` e abre a página da release no navegador.

Rodando pelo código-fonte (`!app.isPackaged`), não há checagem; as
configurações informam isso.

## Estrutura

- `windows/src/updater.js` (novo): máquina de estados e agendamento. Recebe o
  `autoUpdater` por parâmetro, para ser testado com um objeto falso.
  `autoDownload = false`, `autoInstallOnAppQuit = true`.
- `main.js`: cria o updater, inclui o estado dele no `viewState()` e registra os
  IPCs de checar, baixar, instalar e abrir a release.
- `preload.cjs` e `renderer/`: linha no popup e bloco de versão nas
  configurações.
- `package.json`: `electron-updater` em `dependencies`; `build.publish` apontando
  para o GitHub `sthevan027/gnome-pr-indicator`; scripts `dist` com
  `--publish never`, para o build não tentar publicar sozinho.
- `release.yml`: anexar também `latest.yml`, o `.blockmap` do instalador e
  `latest-linux.yml`.
- `windows/README.md`: documentar a atualização.

## Segurança

Os binários não são assinados. A integridade depende do HTTPS, do SHA-512 em
`latest.yml` e da proteção da conta do GitHub: quem publicar uma release
consegue entregar código aos usuários que clicarem em *Baixar*.

## Verificação

- Testes (`node --test`) das transições de estado, da escolha entre instalar e
  abrir a página, e das falhas.
- Teste de ponta a ponta antes do release: instalar um build local e apontá-lo
  para um servidor local com uma versão maior; baixar, reiniciar e conferir a
  versão.
- Conferir que o build gera `latest.yml`, `.blockmap` e `latest-linux.yml`.
- AppImage: só dá para validar a atualização real num Linux; se não houver,
  registrar como não testado.

## Entrega

Versão **1.3.0**. Quem usa 1.2.2 ou anterior instala essa versão uma vez à mão;
as seguintes chegam pelo app. Commit, PR e release só quando pedidos.
