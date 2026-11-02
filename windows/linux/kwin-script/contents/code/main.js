// Fixa o popup do PR Indicator no canto superior direito da área útil.
// O app (Electron) no Wayland não consegue escolher a posição da janela.
const MARGIN_RIGHT = 8;
const MARGIN_TOP = 8;

function isPopup(w) {
    if (!w || w.specialWindow || w.popupWindow)
        return false;
    const id = `${w.resourceClass}|${w.resourceName}|${w.desktopFileName}`.toLowerCase();
    return /pr[-_ ]?indicator/.test(id) || (/electron/.test(id) && w.caption === 'PR Indicator');
}

function place(w) {
    const area = workspace.clientArea(KWin.MaximizeArea, w.output, workspace.currentDesktop);
    const g = w.frameGeometry;
    const x = Math.round(area.x + area.width - g.width - MARGIN_RIGHT);
    const y = Math.round(area.y + MARGIN_TOP);
    if (Math.round(g.x) !== x || Math.round(g.y) !== y)
        w.frameGeometry = {x: x, y: y, width: g.width, height: g.height};
}

function watch(w) {
    if (!isPopup(w))
        return;
    print('pr-indicator-position: fixando ' + w.resourceClass);
    place(w);
    w.frameGeometryChanged.connect(() => place(w));
}

workspace.windowAdded.connect(watch);
for (const w of workspace.windowList())
    watch(w);
