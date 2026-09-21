export const DEFAULT_SECTION_IDS = ['review', 'mine'];

export function normalizeSections(order, hidden, knownIds = DEFAULT_SECTION_IDS) {
    const seen = new Set();
    const result = [];

    for (const id of order) {
        if (knownIds.includes(id) && !seen.has(id)) {
            result.push(id);
            seen.add(id);
        }
    }
    for (const id of knownIds) {
        if (!seen.has(id)) {
            result.push(id);
            seen.add(id);
        }
    }

    const hiddenSet = new Set(hidden.filter(id => knownIds.includes(id)));

    return result.map(id => ({id, hidden: hiddenSet.has(id)}));
}

export function moveSection(list, fromId, toId) {
    const ids = list.map(section => section.id);
    const fromIndex = ids.indexOf(fromId);
    const toIndex = ids.indexOf(toId);
    if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex)
        return list;

    const reordered = list.slice();
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    return reordered;
}

export function toggleHidden(list, id) {
    return list.map(section =>
        section.id === id ? {...section, hidden: !section.hidden} : section);
}

export function effectiveOrder(list) {
    return list.filter(section => !section.hidden).map(section => section.id);
}
