/**
 * Service worker registration.
 *
 * The worker caches the application shell only. See public/sw.js for the hard
 * rule it enforces: clinical content and verification responses are never
 * cached (docs/17-diseno-y-experiencia.md).
 *
 * Registration is skipped in development so a stale worker never shadows a
 * Vite HMR update.
 */
export function registerServiceWorker(): void {
  if (import.meta.env.DEV) {
    return;
  }

  if (!('serviceWorker' in navigator)) {
    return;
  }

  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((error: unknown) => {
      // A failed registration must never break the counter flow: the app works
      // online without it.
      console.warn('service worker registration failed', error);
    });
  });
}
