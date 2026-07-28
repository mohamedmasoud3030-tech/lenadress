/**
 * Minimal DOM double for the print overlay.
 *
 * The print boundary no longer uses `window.open` — it renders an in-app
 * overlay with an iframe — so the tests need just enough of `document` to
 * observe: what markup was written, whether print was called, and whether the
 * overlay can be dismissed. Deliberately tiny: a full DOM library would hide
 * exactly the details these tests exist to pin down.
 */

class FakeClassList {
  constructor(element) {
    this.element = element;
  }

  add(...names) {
    const current = new Set((this.element.className || '').split(/\s+/).filter(Boolean));
    names.forEach((name) => current.add(name));
    this.element.className = Array.from(current).join(' ');
  }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attributes = {};
    this.dataset = {};
    this.style = new FakeStyle();
    this.className = '';
    this.textContent = '';
    this.listeners = new Map();
    this.classList = new FakeClassList(this);
    this.focusCount = 0;

    if (this.tagName === 'IFRAME') {
      const frameDocument = new FakeFrameDocument();
      this.contentDocument = frameDocument;
      this.contentWindow = {
        document: frameDocument,
        focus: () => { this.focusCount += 1; },
        print: () => { frameDocument.printCount += 1; },
      };
    }
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  append(...nodes) {
    nodes.forEach((node) => this.appendChild(node));
  }

  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    this.parentNode = null;
  }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }

  removeEventListener(type, handler) {
    const handlers = this.listeners.get(type) ?? [];
    this.listeners.set(type, handlers.filter((registered) => registered !== handler));
  }

  dispatch(type, event = {}) {
    (this.listeners.get(type) ?? []).forEach((handler) => handler(event));
  }

  focus() {
    this.focusCount += 1;
  }

  /** Depth-first descendants, including this element. */
  tree() {
    return [this, ...this.children.flatMap((child) => child.tree())];
  }

  querySelectorAll(selector) {
    const className = selector.replace(/^\./, '');
    return this.tree().filter((element) => (element.className || '').split(/\s+/).includes(className));
  }
}

class FakeStyle {
  setProperty(name, value) {
    this[name] = value;
  }

  removeProperty(name) {
    delete this[name];
  }
}

class FakeFrameDocument {
  constructor() {
    this.written = [];
    this.printCount = 0;
    this.openCount = 0;
    this.closeCount = 0;
  }

  open() {
    this.openCount += 1;
  }

  write(markup) {
    this.written.push(markup);
  }

  close() {
    this.closeCount += 1;
  }
}

/**
 * Installs `globalThis.document` (and the window listeners the overlay uses)
 * on top of an existing `globalThis.window` storage double.
 */
export function installDom() {
  const head = new FakeElement('head');
  const body = new FakeElement('body');
  const documentListeners = new Map();

  const fakeDocument = {
    head,
    body,
    activeElement: null,
    createElement: (tagName) => new FakeElement(tagName),
    addEventListener(type, handler) {
      if (!documentListeners.has(type)) documentListeners.set(type, []);
      documentListeners.get(type).push(handler);
    },
    removeEventListener(type, handler) {
      const handlers = documentListeners.get(type) ?? [];
      documentListeners.set(type, handlers.filter((registered) => registered !== handler));
    },
    dispatch(type, event = {}) {
      (documentListeners.get(type) ?? []).forEach((handler) => handler(event));
    },
    querySelectorAll(selector) {
      return [...head.querySelectorAll(selector), ...body.querySelectorAll(selector)];
    },
  };

  globalThis.document = fakeDocument;
  globalThis.window = globalThis.window ?? {};
  const windowListeners = new Map();
  globalThis.window.addEventListener = (type, handler) => {
    if (!windowListeners.has(type)) windowListeners.set(type, []);
    windowListeners.get(type).push(handler);
  };
  globalThis.window.removeEventListener = (type, handler) => {
    const handlers = windowListeners.get(type) ?? [];
    windowListeners.set(type, handlers.filter((registered) => registered !== handler));
  };
  globalThis.window.dispatchWindowEvent = (type, event = {}) => {
    (windowListeners.get(type) ?? []).forEach((handler) => handler(event));
  };

  return fakeDocument;
}

export function uninstallDom() {
  delete globalThis.document;
}

/** The overlay currently mounted in the fake body, if any. */
export function getPrintOverlay() {
  return globalThis.document.body.children.find((child) => (child.className || '').includes('lena-print-overlay')) ?? null;
}

/** The iframe document inside the mounted overlay. */
export function getPrintFrameDocument() {
  const overlay = getPrintOverlay();
  if (!overlay) return null;
  const frame = overlay.tree().find((element) => element.tagName === 'IFRAME');
  return frame ? frame.contentDocument : null;
}

/** Finds a button in the overlay by its visible Arabic label. */
export function getOverlayButton(label) {
  const overlay = getPrintOverlay();
  if (!overlay) return null;
  return overlay.tree().find((element) => element.tagName === 'BUTTON' && element.textContent === label) ?? null;
}
