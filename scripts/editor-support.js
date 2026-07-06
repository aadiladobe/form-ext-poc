import {
  decorateBlock,
  decorateBlocks,
  decorateIcons,
  decorateSections,
  loadBlock,
  loadScript,
  loadSections,
} from './aem.js';
import { decorateRichtext } from './editor-support-rte.js';
import { decorateButtons, decorateMain } from './scripts.js';

let promiseChanges$ = Promise.resolve();

async function applyBlockContentUpdate(resource, parsedUpdate) {
  const element = document.querySelector(`[data-aue-resource="${resource}"]`);
  if (!element) return false;

  const block = element.parentElement?.closest('.block[data-aue-resource]')
    || element?.closest('.block[data-aue-resource]');
  if (!block) return false;

  const blockResource = block.getAttribute('data-aue-resource');
  const newBlock = parsedUpdate.querySelector(`[data-aue-resource="${blockResource}"]`);
  if (!newBlock) return false;

  newBlock.style.display = 'none';
  block.insertAdjacentElement('afterend', newBlock);
  decorateButtons(newBlock);
  decorateIcons(newBlock);
  decorateBlock(newBlock);
  decorateRichtext(newBlock);
  await loadBlock(newBlock);
  block.remove();
  newBlock.style.display = null;
  return true;
}

async function applyChanges(event) {
  await promiseChanges$;

  const { detail } = event;
  let isFormEvent = false;

  try {
    const { isFormConfigEvent, applyFormConfigPatch } = await import(`${window.hlx.codeBasePath}/blocks/form/form.js`);
    isFormEvent = isFormConfigEvent(detail);

    if (isFormEvent) {
      const resource = detail?.request?.target?.resource
        || detail?.request?.target?.editable?.resource
        || detail?.response?.updates?.[0]?.resource;
      const updates = detail?.response?.updates;
      const content = updates?.[0]?.content;

      // Prefer server HTML — persisted to preview/publish.
      if (resource && content) {
        await loadScript(`${window.hlx.codeBasePath}/scripts/dompurify.min.js`);
        const sanitizedContent = window.DOMPurify.sanitize(
          content,
          { USE_PROFILES: { html: true } },
        );
        const parsedUpdate = new DOMParser().parseFromString(sanitizedContent, 'text/html');
        if (await applyBlockContentUpdate(resource, parsedUpdate)) return true;
      }

      // Live preview only when the response has no HTML payload yet.
      if (await applyFormConfigPatch(event)) return true;

      // Form patch handled; never reload the page for formConfig events.
      return true;
    }
  } catch {
    // form block not involved
  }

  // redecorate default content and blocks on patches (in the properties rail)
  const resource = detail?.request?.target?.resource
    || detail?.request?.target?.container?.resource
    || detail?.request?.to?.container?.resource
    || detail?.response?.updates?.[0]?.resource;
  if (!resource) return false;
  const updates = detail?.response?.updates;
  if (!updates?.length) return false;
  const { content } = updates[0];
  if (!content) return false;

  await loadScript(`${window.hlx.codeBasePath}/scripts/dompurify.min.js`);

  const sanitizedContent = window.DOMPurify.sanitize(content, { USE_PROFILES: { html: true } });
  const parsedUpdate = new DOMParser().parseFromString(sanitizedContent, 'text/html');
  const element = document.querySelector(`[data-aue-resource="${resource}"]`);

  if (element) {
    if (element.matches('main')) {
      const newMain = parsedUpdate.querySelector(`[data-aue-resource="${resource}"]`);
      if (!newMain) return false;
      newMain.style.display = 'none';
      element.insertAdjacentElement('afterend', newMain);
      decorateMain(newMain);
      decorateRichtext(newMain);
      await loadSections(newMain);
      element.remove();
      newMain.style.display = null;
      attachEventListeners(newMain); // eslint-disable-line no-use-before-define
      return true;
    }

    if (await applyBlockContentUpdate(resource, parsedUpdate)) return true;

    const newElements = parsedUpdate.querySelectorAll(`[data-aue-resource="${resource}"],[data-richtext-resource="${resource}"]`);
    if (newElements.length) {
      const { parentElement } = element;
      if (element.matches('.section')) {
        const [newSection] = newElements;
        newSection.style.display = 'none';
        element.insertAdjacentElement('afterend', newSection);
        decorateButtons(newSection);
        decorateIcons(newSection);
        decorateRichtext(newSection);
        decorateSections(parentElement);
        decorateBlocks(parentElement);
        await loadSections(parentElement);
        element.remove();
        newSection.style.display = null;
      } else {
        element.replaceWith(...newElements);
        decorateButtons(parentElement);
        decorateIcons(parentElement);
        decorateRichtext(parentElement);
      }
      return true;
    }
  }

  return false;
}

function attachEventListeners(main) {
  [
    'aue:content-patch',
    'aue:content-update',
    'aue:content-add',
    'aue:content-move',
    'aue:content-remove',
    'aue:content-copy',
  ].forEach((eventType) => main?.addEventListener(eventType, async (event) => {
    event.stopPropagation();
    promiseChanges$ = applyChanges(event);
    const applied = await promiseChanges$;
    if (applied) return;

    try {
      const { isFormConfigEvent } = await import(`${window.hlx.codeBasePath}/blocks/form/form.js`);
      if (isFormConfigEvent(event.detail)) return;
    } catch {
      // not a form patch
    }

    window.location.reload();
  }));
}

attachEventListeners(document.querySelector('main'));

decorateRichtext();
const observer = new MutationObserver(() => decorateRichtext());
observer.observe(document, { attributeFilter: ['data-richtext-prop'], subtree: true });
