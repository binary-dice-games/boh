// MIT License © 2026 Binary Dice Games
/** @file The words the app shows for errors and sharing states. */
import { reasonOf } from '../errors';
import { formatSize } from '../formats';
import { TooLargeError } from '../errors';
import {
  PROVIDER_LABELS,
  type ProviderId,
  type Sharing,
  type Visibility,
} from '../providers/provider';

/** What to tell the user about a failure, by its `reason`. */
export function errorText(error: unknown, provider?: ProviderId): string {
  const service = provider ? PROVIDER_LABELS[provider] : 'the service';
  switch (reasonOf(error)) {
    case 'network':
      return `Could not reach ${service}. Check the connection and try again.`;
    case 'rate_limited':
      return `${service} asks boh to slow down. Try again in a minute.`;
    case 'needs_sign_in':
      return `Sign in to ${service} again.`;
    case 'forbidden':
      return `${service} refused: this account has no permission for that.`;
    case 'not_found':
      return 'Not found: it may have been moved or deleted.';
    case 'conflict':
      return 'The boh settings changed somewhere else at the same time. Try again.';
    case 'popup_blocked':
      return 'The browser blocked the sign-in window. Allow pop-ups for this site and try again.';
    case 'cancelled':
      return 'Sign-in cancelled.';
    case 'denied':
      return `${service} did not give boh the access it needs${error instanceof Error && error.message !== 'denied' ? `: ${error.message}` : ''}.`;
    case 'expired':
      return `The sign-in to ${service} expired. Sign in again.`;
    case 'not_configured':
      return `This build of boh cannot use ${service}.`;
    case 'too_large':
      return error instanceof TooLargeError
        ? `It is too large (${formatSize(error.size)}; the limit is ${formatSize(error.limit)}).`
        : 'It is too large.';
    case 'aborted':
      return 'Stopped.';
    default:
      return error instanceof Error ? error.message : String(error);
  }
}

export const VISIBILITY_LABELS: Record<Visibility, string> = {
  public: 'Public',
  members: 'Members',
  private: 'Private',
};

export const VISIBILITY_HINTS: Record<Visibility, string> = {
  public: 'anyone with a link can open its pastes',
  members: 'only people the folder is shared with',
  private: 'only you',
};

/** The folder's real sharing, in words. */
export function sharingText(sharing: Sharing): string {
  switch (sharing.kind) {
    case 'public':
      return 'Shared publicly';
    case 'members':
      return sharing.members === undefined
        ? 'Shared with others'
        : `Shared with ${sharing.members} ${sharing.members === 1 ? 'person or group' : 'people or groups'}`;
    case 'private':
      return 'Not shared';
    default:
      return 'Sharing unknown';
  }
}

/** A warning when the folder's real sharing does not match the bin's visibility, else `undefined`. */
export function sharingMismatch(visibility: Visibility, sharing: Sharing): string | undefined {
  const kind = sharing.kind;
  if (kind === 'unknown' || kind === visibility) {
    return undefined;
  }
  if (visibility === 'public') {
    return 'The folder is not shared publicly in its service: links work only for people who already have access.';
  }
  if (visibility === 'private') {
    return 'The folder is shared in its service: others can see these pastes.';
  }
  return kind === 'public'
    ? 'The folder is public in its service: anyone with a link can open these pastes.'
    : 'Nobody else has access to the folder yet: share it in its service.';
}
