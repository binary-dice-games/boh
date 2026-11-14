// MIT License © 2026 Binary Dice Games
/**
 * @file The messages between the app and the render frame (design section 5.2). The app sends
 * only the paste's bytes and display options; tokens and settings never cross.
 */

/** The renderers that run in the frame. */
export type FrameRenderer = 'text' | 'markdown' | 'html';

/** App to frame: show a paste. `bytes` is transferred. */
export interface RenderRequest {
  type: 'render';
  id: number;
  renderer: FrameRenderer;
  name: string;
  bytes: ArrayBuffer;
  options: {
    /** Load images, styles and fonts from other sites. */
    remote: boolean;
    /** Wrap long lines (text). */
    wrap: boolean;
    /** Highlight syntax (text and code blocks). */
    highlight: boolean;
    /** highlight.js language of a text paste. */
    language: string;
  };
}

/** Frame to app. */
export type FrameMessage =
  | { type: 'ready' }
  /** `blocked`: remote resources left out (not counting CSS `url()`, which the policy blocks). */
  | { type: 'rendered'; id: number; blocked: number }
  | { type: 'error'; id: number; reason: string };
