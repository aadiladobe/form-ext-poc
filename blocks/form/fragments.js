/*
 * Resolves `{ type: 'fragment', path }` field entries into the actual fields authored on
 * the Form block at that path, so the complete form is assembled from reusable fragments.
 * This runs entirely on the page's own origin (this is an EDS block), so relative fetches
 * to other pages on the same site resolve correctly — unlike the Universal Editor
 * extension's own preview panels, which run on a different origin and can't reach them.
 */

const MAX_DEPTH = 5;

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizePath(path) {
  return path.replace(/(\.plain)?\.html$/, '');
}

function extractFieldsFromDoc(doc, path) {
  const block = doc.querySelector('.form.block, div.form');
  const cell = block?.querySelector('[data-aue-prop="formConfig"]')
    || block?.querySelector(':scope > div > div');
  if (!cell) throw new Error(`No form found at ${path}`);

  const raw = cell.textContent.trim();
  if (!raw) return [];

  const parsed = JSON.parse(raw);
  return Array.isArray(parsed?.fields) ? parsed.fields : [];
}

// `cache` is scoped to a single resolveFormFields() call (see below), not module-level:
// it only dedupes repeated/nested references to the same fragment *within one resolution
// pass*. It must never persist across renders, or edits to a fragment's own fields would
// keep showing stale results in every form that references it until a full page reload.
function fetchFragmentFields(path, cache) {
  const key = normalizePath(path);
  if (!cache.has(key)) {
    const promise = fetch(`${key}.plain.html`)
      .then((resp) => {
        if (!resp.ok) throw new Error(`Fragment not found (${resp.status}): ${path}`);
        return resp.text();
      })
      .then((html) => extractFieldsFromDoc(new DOMParser().parseFromString(html, 'text/html'), path))
      .catch((error) => {
        cache.delete(key);
        throw error;
      });
    cache.set(key, promise);
  }
  return cache.get(key);
}

/**
 * Recursively flattens `fragment` field entries into their referenced fields.
 * @param {Array} fields raw field list, may contain { type: 'fragment', path }
 * @param {object} [state] internal recursion state — leave unset when calling from outside
 * @returns {Promise<Array>} flattened fields, fragment entries replaced or turned into fragment-error
 */
export async function resolveFormFields(fields, state = {}) {
  const { seenPaths = new Set(), depth = 0, cache = new Map() } = state;
  const out = [];

  for (const field of (fields || [])) {
    if (field?.type !== 'fragment') {
      out.push(field);
      // eslint-disable-next-line no-continue
      continue;
    }

    const { path } = field;
    if (!path || !path.startsWith('/') || path.startsWith('//')) {
      out.push({ type: 'fragment-error', path: path || '', message: 'No valid fragment path set' });
      // eslint-disable-next-line no-continue
      continue;
    }

    const key = normalizePath(path);
    if (seenPaths.has(key)) {
      out.push({ type: 'fragment-error', path, message: 'Circular fragment reference' });
      // eslint-disable-next-line no-continue
      continue;
    }
    if (depth >= MAX_DEPTH) {
      out.push({ type: 'fragment-error', path, message: 'Fragment nesting too deep' });
      // eslint-disable-next-line no-continue
      continue;
    }

    try {
      // eslint-disable-next-line no-await-in-loop
      const fetched = await fetchFragmentFields(path, cache);
      // eslint-disable-next-line no-await-in-loop
      const nested = await resolveFormFields(fetched, {
        seenPaths: new Set([...seenPaths, key]),
        depth: depth + 1,
        cache,
      });
      const slug = slugify(key) || `fragment-${depth}`;
      out.push(...nested.map((f) => (f?.name ? { ...f, name: `${slug}__${f.name}` } : f)));
    } catch (error) {
      out.push({ type: 'fragment-error', path, message: error?.message || 'Failed to load fragment' });
    }
  }

  return out;
}
