import { Link } from 'react-router';
import type { SessionUser } from '../../api/types';
import { EmptyState, ErrorState, SkeletonCards } from '../../components/States';
import { MaterialIcon } from './MaterialIcon';
import { useOrderUpdates } from './notifications';

/** "Order updates": the status of each order, with changes since the last visit marked New. */
export function NotificationsPage({ user }: { user: SessionUser }) {
  const { updates, unreadCount, markAllRead, query } = useOrderUpdates(String(user.id));
  return <>
    <Link className="shop-text-link shop-back-link" to="/app/profile">Back</Link>
    <div className="screen-header"><h1>Order updates</h1>
      <button type="button" className="secondary" disabled={unreadCount === 0} onClick={markAllRead}>Mark all as read</button></div>
    {query.isPending ? <SkeletonCards label="Loading your order updates…" count={4} />
      : query.isError ? <ErrorState error={query.error} retry={() => void query.refetch()} />
      : updates.length === 0 ? <EmptyState><strong>No order updates yet.</strong><p>When a pharmacy prepares or finishes your order, you will see it here.</p></EmptyState>
      : <>
        <p role="status" className="shop-muted">{unreadCount === 0 ? 'You are all caught up.' : `${unreadCount} new ${unreadCount === 1 ? 'update' : 'updates'}`}</p>
        <ul className="update-list">
          {updates.map(({ order, message, unread }) => <li key={order.id} className={`card update-item${unread ? ' update-new' : ''}`}>
            <span className="icon-tile icon-tile-sm" aria-hidden="true"><MaterialIcon name={unread ? 'notificationsRounded' : 'notificationsOutlined'} size={22} /></span>
            <div><strong>{message}</strong>
              <span className="shop-muted">Order #{order.reference ?? order.id}{order.placedOn ? ` • ${order.placedOn}` : ''}</span></div>
            {unread && <span className="status status-active">New</span>}
            <Link className="shop-text-link" to="/app/orders?tab=orders" aria-label={`View orders for ${message}`}>View</Link>
          </li>)}
        </ul>
      </>}
  </>;
}
