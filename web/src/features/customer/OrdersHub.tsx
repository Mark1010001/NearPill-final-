import type { ReactNode } from 'react';
import { useLocation, useSearchParams } from 'react-router';

/** The app's Orders screen: one page with two tabs, "Cart (n)" and "My Orders". */
export function OrdersHub({ cartCount, cart, orders }: { cartCount: number; cart: ReactNode; orders: ReactNode }) {
  const [params, setParams] = useSearchParams();
  const { state } = useLocation();
  const requested = params.get('tab');
  const tab: 'cart' | 'orders' = requested === 'cart' ? 'cart'
    : requested === 'orders' || params.has('testOrder') || typeof state?.reservedOrder === 'number' ? 'orders' : 'cart';
  const choose = (next: 'cart' | 'orders') => {
    const query = new URLSearchParams(params);
    query.set('tab', next);
    query.delete('testOrder');
    setParams(query, { replace: true });
  };
  const keyMove = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); choose(tab === 'cart' ? 'orders' : 'cart'); }
  };
  return <>
    <div className="page-heading"><h1>Orders</h1></div>
    <div className="tabs" role="tablist" aria-label="Orders" onKeyDown={keyMove}>
      <button type="button" role="tab" id="tab-cart" aria-selected={tab === 'cart'} aria-controls="panel-cart" tabIndex={tab === 'cart' ? 0 : -1}
        onClick={() => choose('cart')}>Cart ({cartCount})</button>
      <button type="button" role="tab" id="tab-orders" aria-selected={tab === 'orders'} aria-controls="panel-orders" tabIndex={tab === 'orders' ? 0 : -1}
        onClick={() => choose('orders')}>My Orders</button>
    </div>
    <div role="tabpanel" id="panel-cart" aria-labelledby="tab-cart" hidden={tab !== 'cart'}>{tab === 'cart' && cart}</div>
    <div role="tabpanel" id="panel-orders" aria-labelledby="tab-orders" hidden={tab !== 'orders'}>{tab === 'orders' && orders}</div>
  </>;
}
