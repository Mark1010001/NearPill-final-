-- Placing an order checks that the customer's own prescription for each prescription item is approved.
-- The order transaction runs with the order_mutation capability, so it needs its own narrow read policy:
-- a customer can only see their own approved reviews, and only while placing an order.
CREATE POLICY prescription_order_check_read ON nearpill.prescription_reviews FOR SELECT TO nearpill_app
USING (nearpill.current_capability() = 'order_mutation' AND nearpill.current_actor_role() = 'customer'
  AND customer_id = nearpill.current_actor_id() AND status = 'approved');
