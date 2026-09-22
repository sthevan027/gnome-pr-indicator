import {
    DEFAULT_SECTION_IDS,
    normalizeSections,
    moveSection,
    toggleHidden,
    effectiveOrder,
} from '../lib/sectionsConfig.js';

let failures = 0;

function assertEqual(actual, expected, label) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) {
        failures++;
        print(`FALHOU: ${label}\n  esperado: ${e}\n  recebido: ${a}`);
    } else {
        print(`ok: ${label}`);
    }
}

assertEqual(
    normalizeSections([], []),
    [{id: 'review', hidden: false}, {id: 'mine', hidden: false}],
    'normalizeSections: lista vazia usa a ordem padrão'
);

assertEqual(
    normalizeSections(['mine', 'review'], ['mine']),
    [{id: 'mine', hidden: true}, {id: 'review', hidden: false}],
    'normalizeSections: respeita ordem salva e marca ocultas'
);

assertEqual(
    normalizeSections(['review'], []),
    [{id: 'review', hidden: false}, {id: 'mine', hidden: false}],
    'normalizeSections: acrescenta ids novos que faltam no final'
);

assertEqual(
    normalizeSections(['review', 'fantasma'], ['fantasma']),
    [{id: 'review', hidden: false}, {id: 'mine', hidden: false}],
    'normalizeSections: descarta ids desconhecidos'
);

const base = [{id: 'review', hidden: false}, {id: 'mine', hidden: false}];

assertEqual(
    moveSection(base, 'review', 'mine'),
    [{id: 'mine', hidden: false}, {id: 'review', hidden: false}],
    'moveSection: troca a posição de duas seções'
);
assertEqual(
    moveSection(base, 'review', 'review'),
    base,
    'moveSection: mover pra mesma posição não muda nada'
);
assertEqual(
    moveSection(base, 'fantasma', 'mine'),
    base,
    'moveSection: id inexistente não muda nada'
);

assertEqual(
    toggleHidden(base, 'mine'),
    [{id: 'review', hidden: false}, {id: 'mine', hidden: true}],
    'toggleHidden: oculta a seção'
);
assertEqual(
    toggleHidden(toggleHidden(base, 'mine'), 'mine'),
    base,
    'toggleHidden: aplicar duas vezes volta ao estado original'
);

assertEqual(
    effectiveOrder([{id: 'review', hidden: false}, {id: 'mine', hidden: true}]),
    ['review'],
    'effectiveOrder: remove ocultas e mantém ordem'
);

assertEqual(DEFAULT_SECTION_IDS, ['review', 'mine'], 'DEFAULT_SECTION_IDS correto');

if (failures > 0) {
    print(`\n${failures} teste(s) falharam.`);
    throw new Error(`${failures} teste(s) falharam`);
}
print('\nTodos os testes passaram.');
