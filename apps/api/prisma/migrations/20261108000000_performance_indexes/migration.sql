-- Every order list reads its items by order, and sorts by date. Neither had an index.
CREATE INDEX "Order_created_at_idx" ON "Order"("created_at");
CREATE INDEX "OrderItem_order_id_idx" ON "OrderItem"("order_id");

-- The notification bell, on every page: one person's newest fifty.
DROP INDEX "Notification_user_id_idx";
CREATE INDEX "Notification_user_id_created_at_idx" ON "Notification"("user_id", "created_at");
