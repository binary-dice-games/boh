// MIT License © 2026 Binary Dice Games
/**
 * @file The app side of the render frame: creates the sandboxed frame, sends it a paste, and
 * waits for its answer (design section 5.2).
 */
import { BohError } from './errors';
import type { FrameMessage, FrameRenderer, RenderRequest } from './render/protocol';

/** How long the frame may take to load or to render. */
const FRAME_TIMEOUT_MS = 15000;

/** A render frame in `container`. */
export class RenderHost {
  readonly frame: HTMLIFrameElement;
  private readonly ready: Promise<void>;
  private next = 1;
  private readonly waiting = new Map<number, (m: FrameMessage) => void>();
  private readonly onMessage = (event: MessageEvent<FrameMessage>) => {
    if (event.source !== this.frame.contentWindow) {
      return;
    }
    const m = event.data;
    if (m?.type === 'ready') {
      this.markReady();
    } else if (m && (m.type === 'rendered' || m.type === 'error')) {
      this.waiting.get(m.id)?.(m);
    }
  };
  private markReady: () => void = () => undefined;

  /** @param src the frame page, next to the app */
  constructor(container: HTMLElement, src = 'render.html') {
    this.frame = document.createElement('iframe');
    this.frame.className = 'render-frame';
    this.frame.title = 'Paste';
    // An opaque origin: no allow-same-origin. Popups let the paste's links open new tabs.
    this.frame.setAttribute('sandbox', 'allow-scripts allow-popups allow-popups-to-escape-sandbox');
    this.frame.setAttribute('referrerpolicy', 'no-referrer');
    this.ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new BohError('render_failed', 'the render frame did not load')),
        FRAME_TIMEOUT_MS,
      );
      this.markReady = () => {
        clearTimeout(timer);
        resolve();
      };
    });
    window.addEventListener('message', this.onMessage);
    this.frame.src = src;
    container.append(this.frame);
  }

  /**
   * Shows a paste. `bytes` is transferred to the frame (it is unusable afterwards).
   * @returns how many remote resources the frame left out
   * @throws {BohError} `render_failed`
   */
  async render(
    renderer: FrameRenderer,
    name: string,
    bytes: ArrayBuffer,
    options: RenderRequest['options'],
  ): Promise<{ blocked: number }> {
    await this.ready;
    const id = this.next++;
    const answer = new Promise<FrameMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        reject(new BohError('render_failed', 'the paste took too long to show'));
      }, FRAME_TIMEOUT_MS);
      this.waiting.set(id, (m) => {
        clearTimeout(timer);
        this.waiting.delete(id);
        resolve(m);
      });
    });
    const request: RenderRequest = { type: 'render', id, renderer, name, bytes, options };
    // The frame's origin is opaque, so it cannot be named; only the paste's bytes are sent.
    this.frame.contentWindow?.postMessage(request, '*', [bytes]);
    const m = await answer;
    if (m.type === 'error') {
      throw new BohError('render_failed', m.reason);
    }
    return { blocked: m.type === 'rendered' ? m.blocked : 0 };
  }

  /** Removes the frame. */
  destroy(): void {
    window.removeEventListener('message', this.onMessage);
    this.frame.remove();
    for (const resolve of this.waiting.values()) {
      resolve({ type: 'error', id: 0, reason: 'closed' });
    }
    this.waiting.clear();
  }
}
