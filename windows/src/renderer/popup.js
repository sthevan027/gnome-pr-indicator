// View do popup: só desenha o estado que o main manda e devolve intenções.
// Textos e estrutura copiados do extension.js.
const api = window.prIndicator;

const SECTION_LABELS = {
    review: 'Precisa da minha revisão',
    mine: 'Meus PRs abertos',
};
const BADGE_OPTIONS = [
    ['review', 'PRs pra eu revisar'],
    ['mine', 'Meus PRs abertos'],
];
const THEME_OPTIONS = [
    ['auto', 'Automático'],
    ['white', 'Branco'],
    ['black', 'Preto'],
    ['glass', 'Glass'],
];

const CHECK_SVG = '<svg viewBox="0 0 16 16" class="icon" aria-hidden="true"><path d="M13.3 3.3 6 10.6 2.7 7.3 1.3 8.7 6 13.4l8.7-8.7z"/></svg>';
const HANDLE_SVG = '<svg viewBox="0 0 16 16" class="icon" aria-hidden="true"><path d="M1 3h2v2H1zm4 0h10v2H5zM1 7h2v2H1zm4 0h10v2H5zm-4 4h2v2H1zm4 0h10v2H5z"/></svg>';

const $ = id => document.getElementById(id);
let current = null;
// Enquanto uma linha é arrastada, um estado novo (polling, tema do Windows)
// não pode reconstruir a lista de seções, senão o arraste se perde.
let dragging = false;

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className)
        node.className = className;
    if (text !== undefined)
        node.textContent = text;
    return node;
}

// ---- lista de PRs ----

function renderSections(state) {
    const container = $('sections');
    container.replaceChildren();

    for (const section of state.sections) {
        if (section.hidden)
            continue;

        container.append(el('div', 'pr-indicator-section-title', SECTION_LABELS[section.id] ?? section.id));

        const items = state.items?.[section.id] ?? [];
        if (items.length === 0) {
            container.append(el('div', 'popup-menu-item pr-indicator-empty', 'Nada por aqui'));
        } else {
            for (const item of items) {
                const button = el('button', 'pr-item');
                button.type = 'button';
                button.title = `#${item.number} ${item.title}\n${item.repo}`;
                button.append(
                    el('div', 'pr-indicator-item-title', `#${item.number} ${item.title}`),
                    el('div', 'pr-indicator-item-repo', item.repo));
                button.addEventListener('click', () => api.openUrl(item.url));
                container.append(button);
            }
        }

        container.append(el('div', 'separator'));
    }
}

function renderStatus(state) {
    const status = $('status');
    if (state.status === 'error')
        status.textContent = `Erro: ${state.error}`;
    else if (state.updatedAt)
        status.textContent = `Atualizado às ${state.updatedAt}`;
    else
        status.textContent = '';
}

// ---- configuração ----

function renderSectionsOrder(state) {
    const container = $('sections-order');
    container.replaceChildren();

    for (const section of state.sections) {
        const row = el('div', 'pr-indicator-config-row');
        row.dataset.sectionId = section.id;
        if (section.hidden)
            row.classList.add('pr-indicator-config-row-hidden');

        const handle = el('span', 'pr-indicator-drag-handle');
        handle.innerHTML = HANDLE_SVG;
        attachDrag(handle, row, container);

        const toggle = el('button', 'pr-indicator-toggle-button', section.hidden ? '+' : '−');
        toggle.type = 'button';
        toggle.addEventListener('click', () => api.toggleSection(section.id));

        row.append(handle, el('span', 'label', SECTION_LABELS[section.id] ?? section.id), toggle);
        container.append(row);
    }
}

// Reordenar arrastando pelo ícone — mesma regra do `_reorderDuringDrag` do
// GNOME: troca de lugar com o vizinho quando o ponteiro anda meia linha.
function attachDrag(handle, row, container) {
    handle.addEventListener('pointerdown', event => {
        if (event.button !== 0)
            return;
        event.preventDefault();
        handle.setPointerCapture(event.pointerId);
        row.classList.add('dragging');
        dragging = true;
        let lastY = event.clientY;
        const initialOrder = [...container.children].map(r => r.dataset.sectionId);

        const onMove = moveEvent => {
            const deltaY = moveEvent.clientY - lastY;
            const rowHeight = row.offsetHeight || 1;
            const siblings = [...container.children];
            const index = siblings.indexOf(row);

            if (deltaY > rowHeight / 2 && index < siblings.length - 1) {
                siblings[index + 1].after(row);
                lastY += rowHeight;
            } else if (deltaY < -rowHeight / 2 && index > 0) {
                siblings[index - 1].before(row);
                lastY -= rowHeight;
            }
        };
        const onUp = () => {
            handle.removeEventListener('pointermove', onMove);
            handle.removeEventListener('pointerup', onUp);
            handle.removeEventListener('pointercancel', onUp);
            row.classList.remove('dragging');
            dragging = false;
            const order = [...container.children].map(r => r.dataset.sectionId);
            if (order.join() !== initialOrder.join())
                api.commitSectionOrder(order);
            else if (current)
                renderSectionsOrder(current);
        };

        handle.addEventListener('pointermove', onMove);
        handle.addEventListener('pointerup', onUp);
        handle.addEventListener('pointercancel', onUp);
    });
}

function renderOptions(containerId, options, selected, onSelect) {
    const container = $(containerId);
    container.replaceChildren();
    for (const [value, label] of options) {
        const button = el('button', 'popup-menu-item pr-indicator-theme-option');
        button.type = 'button';
        const check = el('span', 'pr-indicator-theme-check');
        if (value === selected)
            check.innerHTML = CHECK_SVG;
        button.append(check, el('span', 'label', label));
        button.addEventListener('click', () => onSelect(value));
        container.append(button);
    }
}

function renderAuth(state) {
    const entry = $('token');
    entry.disabled = state.ghAuth;
    $('auth-status').textContent = state.ghAuth
        ? '✓ Usando gh CLI (autenticado)'
        : 'gh CLI não encontrado — configure um token manual abaixo';
}

// ---- geral ----

function render(state) {
    current = state;
    document.body.className = `theme-${state.effectiveTheme}`;
    renderSections(state);
    renderStatus(state);
    if (!dragging)
        renderSectionsOrder(state);
    renderOptions('badge-options', BADGE_OPTIONS, state.badgeSection, api.setBadgeSection);
    renderOptions('theme-options', THEME_OPTIONS, state.theme, api.setTheme);
    renderAuth(state);
}

function showConfigView(show) {
    $('pr-view').hidden = show;
    $('config-view').hidden = !show;
}

$('refresh').addEventListener('click', () => api.refresh());
$('settings').addEventListener('click', () => showConfigView(true));
$('back').addEventListener('click', () => showConfigView(false));

$('token').addEventListener('keydown', async event => {
    if (event.key !== 'Enter')
        return;
    const value = event.target.value.trim();
    if (!value || event.target.readOnly)
        return;
    $('token-feedback').textContent = 'Validando…';
    event.target.readOnly = true;
    let result;
    try {
        result = await api.submitToken(value);
    } finally {
        event.target.readOnly = false;
    }
    if (result) {
        $('token-feedback').textContent = result.message;
        if (result.ok)
            event.target.value = '';
    }
});

document.addEventListener('keydown', event => {
    if (event.key === 'Escape')
        api.hide();
});

// A janela acompanha a altura do conteúdo.
new ResizeObserver(() => api.resize(document.getElementById('menu').offsetHeight))
    .observe(document.getElementById('menu'));

api.onState(render);
api.getState().then(state => {
    if (!current)
        render(state);
});
