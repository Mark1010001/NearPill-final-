-- The composite owner FK introduced in 0010 also protects order_id; remove the redundant single-column FK.
ALTER TABLE order_drugstores DROP CONSTRAINT order_drugstores_order_id_fkey;
