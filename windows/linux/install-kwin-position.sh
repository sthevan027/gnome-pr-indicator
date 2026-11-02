#!/usr/bin/env bash
# Instala (ou remove) o script do KWin que fixa o popup do PR Indicator no
# canto superior direito. No Wayland o app não escolhe a posição da janela.
#
#   ./install-kwin-position.sh            instala e ativa
#   ./install-kwin-position.sh --remove   desativa e remove
set -euo pipefail

ID=pr-indicator-position
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

reload() {
    qdbus6 org.kde.KWin /KWin reconfigure 2>/dev/null \
        || busctl --user call org.kde.KWin /KWin org.kde.KWin reconfigure >/dev/null
}

if [[ "${1:-}" == "--remove" ]]; then
    kwriteconfig6 --file kwinrc --group Plugins --key "${ID}Enabled" false
    kpackagetool6 --type KWin/Script --remove "$ID" 2>/dev/null || true
    reload
    echo "Script removido."
    exit 0
fi

kpackagetool6 --type KWin/Script --install "$HERE/kwin-script" 2>/dev/null \
    || kpackagetool6 --type KWin/Script --upgrade "$HERE/kwin-script"
kwriteconfig6 --file kwinrc --group Plugins --key "${ID}Enabled" true
reload
echo "Script instalado e ativo. O popup abre no canto superior direito."
