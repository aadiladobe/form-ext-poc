import { loadScript } from '../../scripts/aem.js';
import { TFS_FORM_APP } from './form-config.js';

function normalizeSpec(specOrJson) {
  const parsed = typeof specOrJson === 'string' ? JSON.parse(specOrJson) : specOrJson;
  return {
    title: parsed?.title || '',
    submitLabel: parsed?.submitLabel || 'Submit',
    fields: Array.isArray(parsed?.fields) ? parsed.fields : [],
  };
}

function findConfigCell(block) {
  return block.querySelector('[data-aue-prop="formConfig"]')
    || block.querySelector(':scope > div > div');
}

/**
 * Reads formConfig from the persisted block cell in the document.
 * @param {Element} block
 * @returns {{title: string, submitLabel: string, fields: Array}}
 */
export function readConfig(block) {
  const cell = findConfigCell(block);
  const raw = (cell?.textContent || '').trim();
  if (!raw) return { title: '', submitLabel: 'Submit', fields: [] };
  try {
    return normalizeSpec(raw);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[form] formConfig is not valid JSON', error);
    return { title: '', submitLabel: 'Submit', fields: [] };
  }
}

function findFormBlock(resource) {
  if (resource) {
    const escaped = CSS.escape(resource);
    let block = document.querySelector(`.form.block[data-aue-resource="${escaped}"]`)
      || document.querySelector(`div.form[data-aue-resource="${escaped}"]`);
    if (block) return block;
    block = document.querySelector(`[data-aue-resource="${escaped}"]`)?.closest('.form.block, div.form');
    if (block) return block;
  }

  const all = [...document.querySelectorAll('.form.block, div.form.block, div.form')];
  if (all.length === 1) return all[0];
  return null;
}

export function isFormConfigEvent(detail) {
  if (!detail) return false;
  const patches = detail?.request?.patch
    || detail?.request?.operations
    || detail?.patch
    || [];
  if (patches.some((p) => /formConfig/i.test(p.path || ''))) return true;
  const prop = detail?.request?.target?.prop
    || detail?.request?.prop
    || detail?.target?.prop;
  return /formConfig/i.test(prop || '');
}

function extractFormConfigValue(detail) {
  const patches = detail?.request?.patch
    || detail?.request?.operations
    || detail?.patch
    || [];
  const formPatch = patches.find((p) => /formConfig/i.test(p.path || ''));
  if (formPatch?.value != null) {
    return typeof formPatch.value === 'string'
      ? formPatch.value
      : JSON.stringify(formPatch.value);
  }

  const prop = detail?.request?.target?.prop
    || detail?.request?.prop
    || detail?.target?.prop;
  if (/formConfig/i.test(prop || '')) {
    const val = detail?.request?.value ?? detail?.value;
    if (val != null) {
      return typeof val === 'string' ? val : JSON.stringify(val);
    }
  }

  return null;
}

let appPromise;
function loadFormApp() {
  if (!appPromise) {
    appPromise = loadScript(TFS_FORM_APP.scriptUrl).then(() => {
      if (!window.TFSForm?.render) {
        throw new Error('TFSForm global not available after loading bundle');
      }
    });
  }
  return appPromise;
}

/**
 * Re-render the React microfrontend for a form block.
 * Only updates an existing config cell — never creates synthetic DOM that would not persist.
 * @param {Element} block
 * @param {object|string} specOrJson
 */
export async function renderFormBlock(block, specOrJson) {
  const spec = normalizeSpec(specOrJson);

  let mount = block.querySelector(':scope > .tfs-form-app');
  if (!mount) {
    mount = document.createElement('div');
    mount.className = 'tfs-form-app';
    block.appendChild(mount);
  }

  const cell = findConfigCell(block);
  if (cell) {
    cell.textContent = JSON.stringify(spec);
  }

  await loadFormApp();
  window.TFSForm.render(mount, spec);
}

/**
 * Live-preview fallback when the patch event has no server HTML yet.
 * @param {CustomEvent} event
 * @returns {Promise<boolean>}
 */
export async function applyFormConfigPatch(event) {
  const { detail } = event;
  if (!detail) return false;

  const value = extractFormConfigValue(detail);
  if (!value) return false;

  const resource = detail?.request?.target?.resource
    || detail?.request?.target?.editable?.resource
    || detail?.response?.updates?.[0]?.resource;

  const block = findFormBlock(resource);
  if (!block) return false;

  try {
    await renderFormBlock(block, value);
    return true;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[form] live preview update failed', error);
    return false;
  }
}

/**
 * loads and decorates the form block by mounting the TFS React microfrontend
 * @param {Element} block The block element
 */
export default async function decorate(block) {
  const spec = readConfig(block);

  let mount = block.querySelector(':scope > .tfs-form-app');
  if (!mount) {
    mount = document.createElement('div');
    mount.className = 'tfs-form-app';
    block.appendChild(mount);
  }

  try {
    await renderFormBlock(block, spec);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[form] failed to load TFS form microfrontend', error);
    mount.innerHTML = `<p class="tfs-form-error">Unable to load the form application from
      <code>${TFS_FORM_APP.scriptUrl}</code>. Start the tfs-form-app dev server
      (<code>npm run dev</code>) and trust its certificate.</p>`;
  }
}
