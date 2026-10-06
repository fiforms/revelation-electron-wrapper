/*
 * Advanced tab helpers for the Create / Edit Metadata form.
 *
 * The Advanced tab is generated from presentation-schema.json by the shared field builders in
 * metadata-form-core.js; the only thing specific to it is the table layout applied afterwards.
 *
 * Caller: create.js buildFormWithTabs(), once the Advanced fields have been appended.
 */

// Collapse the label+input field wrappers in a tab into a two-column table.
// Anything else (dynamic array sections, etc.) is left in place after the table.
export function condenseIntoTable(container) {
  const table = document.createElement('table');
  table.className = 'advanced-table';
  const body = document.createElement('tbody');
  table.appendChild(body);

  Array.from(container.children).forEach(child => {
    if (child.tagName === 'HR') {
      child.remove();
      return;
    }
    const label = child.querySelector(':scope > label');
    const input = child.querySelector(':scope > input, :scope > select, :scope > textarea');
    if (!label || !input) return;

    const row = document.createElement('tr');
    const th = document.createElement('th');
    const td = document.createElement('td');
    th.appendChild(label);
    td.appendChild(input);
    row.appendChild(th);
    row.appendChild(td);
    body.appendChild(row);
    child.remove();
  });

  container.insertBefore(table, container.firstChild);
}
