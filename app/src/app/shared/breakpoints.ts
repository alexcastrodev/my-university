/** Phone width: below it the bottom nav, the mobile Home and the full-screen Feed take over
 *  (the CSS side of the same breakpoint lives in each component's `@media (max-width: 768px)`). */
export const PHONE_MEDIA_QUERY = '(max-width: 768px)';

/** Browser-only check; on the server there is no viewport, so it reports "not a phone". */
export function isPhoneViewport(): boolean {
  return typeof matchMedia === 'function' && matchMedia(PHONE_MEDIA_QUERY).matches;
}
