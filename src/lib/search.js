/** Case-insensitive name filtering, shared by the modals and the tag combobox. */

/** Items whose `name` contains `query` (all items when the query is blank). */
export function filterByName(items, query) {
  const needle = query.trim().toLowerCase();
  return needle
    ? items.filter((i) => i.name.toLowerCase().includes(needle))
    : items;
}

/** Whether any item's `name` equals `query` exactly (case-insensitive). */
export function hasExactName(items, query) {
  const needle = query.trim().toLowerCase();
  return items.some((i) => i.name.toLowerCase() === needle);
}
