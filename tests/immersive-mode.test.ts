import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createImmersiveController, type FullscreenDocument } from '../src/lib/immersive-mode';

// A document stand-in: a real EventTarget, a fullscreen element that changes only when a "browser" says so, and
// requests the test settles by hand (they resolve later, as in browsers).
function fakeDocument({ supported = true, prefixed = false } = {}) {
  const events = new EventTarget();
  const root = {} as Element;
  const calls: string[] = [];
  let element: Element | null = null;
  const pending: { resolve: () => void; reject: (error: Error) => void }[] = [];
  const browser = {
    /** The browser enters or leaves fullscreen and fires the change event. */
    set(next: Element | null) { element = next; events.dispatchEvent(new Event(prefixed ? 'webkitfullscreenchange' : 'fullscreenchange')); },
    grant() { pending.shift()!.resolve(); browser.set(root); },
    refuse() { pending.shift()!.reject(new Error('refused')); },
    key(key: string, prevented = false) {
      const event = Object.assign(new Event('keydown', { cancelable: true }), { key });
      if (prevented) event.preventDefault();
      events.dispatchEvent(event);
    },
  };
  const doc: FullscreenDocument = {
    get fullscreenElement() { return prefixed ? undefined : element; },
    get webkitFullscreenElement() { return prefixed ? element : undefined; },
    ...(prefixed ? { webkitFullscreenEnabled: supported } : { fullscreenEnabled: supported }),
    ...(prefixed
      ? { webkitExitFullscreen: () => { calls.push('exit'); queueMicrotask(() => browser.set(null)); } }
      : { exitFullscreen: async () => { calls.push('exit'); if (!element) throw new TypeError('not fullscreen'); queueMicrotask(() => browser.set(null)); } }),
    documentElement: prefixed
      ? { webkitRequestFullscreen: () => { calls.push('request'); pending.push({ resolve() {}, reject() {} }); } }
      : supported
        ? { requestFullscreen: () => { calls.push('request'); return new Promise<void>((resolve, reject) => pending.push({ resolve, reject })); } }
        : {},
    addEventListener: (type, listener) => events.addEventListener(type, listener),
    removeEventListener: (type, listener) => events.removeEventListener(type, listener),
  };
  return { doc, browser, calls, root };
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

function mounted(doc: FullscreenDocument) {
  const controller = createImmersiveController(doc);
  const unsubscribe = controller.subscribe(() => {});
  return { controller, unsubscribe };
}

test('without the Fullscreen API (iPhone Safari) the layout alone goes immersive', () => {
  const { doc, calls } = fakeDocument({ supported: false });
  const { controller } = mounted(doc);
  controller.enter();
  assert.deepEqual(controller.getSnapshot(), { immersive: true, fullscreen: false });
  assert.deepEqual(calls, []);
  controller.exit();
  assert.deepEqual(controller.getSnapshot(), { immersive: false, fullscreen: false });
});

test('with the API the whole document goes fullscreen, and the exit button leaves it', async () => {
  const { doc, browser, calls } = fakeDocument();
  const { controller } = mounted(doc);
  controller.toggle();
  assert.deepEqual(calls, ['request']);
  assert.deepEqual(controller.getSnapshot(), { immersive: true, fullscreen: false }, 'the layout does not wait for the browser');
  browser.grant();
  assert.deepEqual(controller.getSnapshot(), { immersive: true, fullscreen: true });
  controller.toggle();
  assert.deepEqual(controller.getSnapshot(), { immersive: false, fullscreen: false });
  assert.deepEqual(calls, ['request', 'exit']);
  await settle();
  assert.deepEqual(controller.getSnapshot(), { immersive: false, fullscreen: false });
});

test('leaving fullscreen through the browser (Esc, back gesture) restores the layout', () => {
  const { doc, browser, calls } = fakeDocument();
  const { controller } = mounted(doc);
  controller.enter();
  browser.grant();
  browser.set(null);
  assert.deepEqual(controller.getSnapshot(), { immersive: false, fullscreen: false });
  assert.deepEqual(calls, ['request'], 'nothing left to exit');
});

test('a refused request keeps the CSS-only mode, and a later browser change is not mistaken for ours', async () => {
  const { doc, browser } = fakeDocument();
  const { controller } = mounted(doc);
  controller.enter();
  browser.refuse();
  await settle();
  assert.deepEqual(controller.getSnapshot(), { immersive: true, fullscreen: false });
  browser.set({} as Element); // some video goes fullscreen
  browser.set(null);
  assert.deepEqual(controller.getSnapshot(), { immersive: true, fullscreen: false });
});

test('Esc leaves the CSS-only mode unless something already handled it', () => {
  const { doc, browser } = fakeDocument({ supported: false });
  const { controller } = mounted(doc);
  controller.enter();
  browser.key('Escape', true); // e.g. the emote picker closing itself
  assert.equal(controller.getSnapshot().immersive, true);
  browser.key('Enter');
  assert.equal(controller.getSnapshot().immersive, true);
  browser.key('Escape');
  assert.equal(controller.getSnapshot().immersive, false);
});

test('exiting before the request lands undoes the fullscreen it brings', async () => {
  const { doc, browser, calls } = fakeDocument();
  const { controller } = mounted(doc);
  controller.enter();
  controller.exit();
  browser.grant(); // the browser goes fullscreen after the visitor already left
  assert.deepEqual(calls, ['request', 'exit']);
  await settle();
  assert.deepEqual(controller.getSnapshot(), { immersive: false, fullscreen: false });
});

test('a fullscreen the page did not ask for is left alone', () => {
  const { doc, browser, calls } = fakeDocument();
  const { controller } = mounted(doc);
  browser.set({} as Element);
  controller.enter(); // already fullscreen: no second request
  assert.deepEqual(controller.getSnapshot(), { immersive: true, fullscreen: false });
  controller.exit();
  assert.deepEqual(calls, []);
});

test('WebKit-prefixed fullscreen (older Safari, iPadOS) works the same way', async () => {
  const { doc, browser, calls, root } = fakeDocument({ prefixed: true });
  const { controller } = mounted(doc);
  controller.enter();
  browser.set(root);
  assert.deepEqual(controller.getSnapshot(), { immersive: true, fullscreen: true });
  controller.exit();
  await settle();
  assert.deepEqual(calls, ['request', 'exit']);
  assert.deepEqual(controller.getSnapshot(), { immersive: false, fullscreen: false });
});

test('the page unmounting leaves fullscreen and stops listening', async () => {
  const { doc, browser, calls } = fakeDocument();
  const { controller, unsubscribe } = mounted(doc);
  controller.enter();
  browser.grant();
  unsubscribe();
  assert.deepEqual(calls, ['request', 'exit']);
  await settle();
  assert.deepEqual(controller.getSnapshot(), { immersive: false, fullscreen: false });
  browser.key('Escape'); // no listener left: nothing throws or changes
});

test('listeners hear each change once, and only real changes', () => {
  const { doc, browser, root } = fakeDocument();
  const controller = createImmersiveController(doc);
  let heard = 0;
  controller.subscribe(() => heard++);
  controller.enter();
  controller.enter();
  browser.grant();
  browser.set(root); // Safari can fire both the prefixed and the standard change event
  assert.equal(heard, 2);
});
