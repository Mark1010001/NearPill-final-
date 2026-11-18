import { useEffect, useRef, useState } from 'react';
import { api } from '../../api/client';
import type { SessionUser } from '../../api/types';
import { useCart } from './cartContext';
import { MaterialIcon } from './MaterialIcon';

type Turn = { role: 'user' | 'assistant'; content: string };

/** Ask NearPill: a chat that answers questions about NearPill only (the server holds the rules and the key). */
export function AssistantPage({ user }: { user: SessionUser }) {
  const cart = useCart();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState('');
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => () => { request.current += 1; }, []);
  useEffect(() => { end.current?.scrollIntoView?.({ block: 'end' }); }, [turns, waiting, error]);

  async function ask(history: Turn[]) {
    const id = ++request.current;
    setWaiting(true); setError(null);
    try {
      const { reply } = await api.assistantChat(String(user.id), {
        messages: history.slice(-12).map((turn) => ({ role: turn.role, content: turn.content.slice(0, 1000) })),
        cart: cart.cart.slice(0, 20).map((line) => ({ name: line.listing.name.slice(0, 80), quantity: Math.min(999, Math.max(1, line.quantity)), pharmacy: (line.listing.drugstoreName ?? '').slice(0, 80) })),
      }, new AbortController().signal);
      if (id !== request.current) return;
      setTurns([...history, { role: 'assistant', content: reply }]);
    } catch (caught) {
      if (id !== request.current) return;
      setError(caught instanceof Error && caught.message ? caught.message : 'The assistant could not be reached. Check your connection and try again.');
    } finally {
      if (id === request.current) setWaiting(false);
    }
  }

  function send() {
    const content = text.trim();
    if (!content || waiting) return;
    const next: Turn[] = [...turns, { role: 'user', content }];
    setTurns(next); setText('');
    void ask(next);
  }
  function newChat() { request.current += 1; setTurns([]); setText(''); setError(null); setWaiting(false); }
  const lastIsUser = turns.length > 0 && turns[turns.length - 1].role === 'user';

  return <div className="chat-page">
    <div className="screen-header"><h1>Ask NearPill</h1>
      <button type="button" className="icon-button" aria-label="New chat" title="New chat" disabled={turns.length === 0 && !error} onClick={newChat}><MaterialIcon name="restartAlt" size={24} /></button></div>
    <div className="chat-thread" aria-live="polite">
      {turns.length === 0 && !waiting && !error && <div className="chat-empty">
        <span className="chat-empty-icon" aria-hidden="true"><MaterialIcon name="chatBubbleOutline" size={28} /></span>
        <h2>Ask NearPill</h2>
        <p>Ask me anything about using NearPill: medicines and pharmacies, your orders and cart, payment and pickup, or your account.</p>
      </div>}
      {turns.map((turn, index) => <div key={index} className={`chat-bubble chat-${turn.role}`}>{turn.content}</div>)}
      {waiting && <p className="chat-typing" role="status">Typing…</p>}
      {error && <div role="alert"><p className="form-error">{error}</p>
        {lastIsUser && <button type="button" className="shop-text-link" onClick={() => void ask(turns)}>Try again</button>}</div>}
      <div ref={end} />
    </div>
    <p className="chat-note">Ask NearPill can make mistakes and does not give medical advice.</p>
    <form className="chat-input" onSubmit={(event) => { event.preventDefault(); send(); }}>
      <textarea aria-label="Message Ask NearPill" placeholder="Message Ask NearPill" rows={1} maxLength={500} value={text} onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(); } }} />
      <button type="submit" className="primary" aria-label="Send question" disabled={waiting}><MaterialIcon name="send" size={20} /></button>
    </form>
  </div>;
}
