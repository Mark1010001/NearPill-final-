import { useCallback, useEffect, useRef, useState } from 'react';

/** App-style snackbar: one message at a time, announced politely. */
export function useToast(duration = 2000) {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const show = useCallback((text: string) => {
    window.clearTimeout(timer.current);
    setMessage(text);
    timer.current = window.setTimeout(() => setMessage(null), duration);
  }, [duration]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const toast = <div className="toast-region" role="status" aria-live="polite">{message && <div className="toast">{message}</div>}</div>;
  return { show, toast };
}
