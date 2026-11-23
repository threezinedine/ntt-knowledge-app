import { createContext, useContext } from 'react';

/**
 * True inside the Android app (Capacitor injects `window.Capacitor` into the
 * page it shows). The phone app is for looking things up, so it is read-only.
 */
export function isNativeApp(): boolean {
  const cap = (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return cap?.isNativePlatform?.() === true;
}

/**
 * Read-only mode: no control that changes data is shown. Set in the phone
 * app, or when the session is read-only. The server refuses writes from a
 * read-only session anyway; this keeps the UI from offering them.
 */
export const ReadOnlyContext = createContext(false);

export const useReadOnly = () => useContext(ReadOnlyContext);
