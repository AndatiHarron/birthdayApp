-- Database-level invariants.
--
-- The services enforce these already; the constraints are the backstop that
-- turns a future bug into a failed transaction instead of corrupt money or a
-- double-claimed gift (spec §58 rules 1 and 4).

-- Rule 1: a wishlist item can never be claimed more times than it exists.
ALTER TABLE "wishlist_items"
  ADD CONSTRAINT "wishlist_items_quantity_positive" CHECK ("quantity" >= 1),
  ADD CONSTRAINT "wishlist_items_reserved_within_quantity" CHECK ("reservedQuantity" >= 0 AND "reservedQuantity" <= "quantity"),
  ADD CONSTRAINT "wishlist_items_price_non_negative" CHECK ("priceMinor" IS NULL OR "priceMinor" >= 0);

ALTER TABLE "gift_reservations"
  ADD CONSTRAINT "gift_reservations_quantity_positive" CHECK ("quantity" >= 1);

-- Rule 4: group gift money moves only in whole, non-negative amounts.
ALTER TABLE "group_gifts"
  ADD CONSTRAINT "group_gifts_target_positive" CHECK ("targetMinor" > 0),
  ADD CONSTRAINT "group_gifts_raised_non_negative" CHECK ("raisedMinor" >= 0),
  ADD CONSTRAINT "group_gifts_min_contribution_non_negative" CHECK ("minContributionMinor" >= 0);

ALTER TABLE "gift_contributions"
  ADD CONSTRAINT "gift_contributions_amount_positive" CHECK ("amountMinor" > 0);

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_amount_positive" CHECK ("amountMinor" > 0);

ALTER TABLE "refunds"
  ADD CONSTRAINT "refunds_amount_positive" CHECK ("amountMinor" > 0);

-- The wallet can never go overdrawn, whatever the application does.
ALTER TABLE "wallets"
  ADD CONSTRAINT "wallets_balance_non_negative" CHECK ("balanceMinor" >= 0);

ALTER TABLE "wallet_transactions"
  ADD CONSTRAINT "wallet_transactions_amount_positive" CHECK ("amountMinor" > 0),
  ADD CONSTRAINT "wallet_transactions_balance_non_negative" CHECK ("balanceAfterMinor" >= 0);

ALTER TABLE "gift_orders"
  ADD CONSTRAINT "gift_orders_amounts_non_negative" CHECK (
    "subtotalMinor" >= 0 AND "deliveryFeeMinor" >= 0 AND "discountMinor" >= 0 AND "totalMinor" >= 0
  ),
  ADD CONSTRAINT "gift_orders_total_consistent" CHECK ("totalMinor" = "subtotalMinor" + "deliveryFeeMinor" - "discountMinor");

ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_quantity_positive" CHECK ("quantity" >= 1),
  ADD CONSTRAINT "order_items_total_consistent" CHECK ("totalMinor" = "unitPriceMinor" * "quantity");

ALTER TABLE "products"
  ADD CONSTRAINT "products_price_positive" CHECK ("priceMinor" > 0),
  ADD CONSTRAINT "products_stock_non_negative" CHECK ("stock" IS NULL OR "stock" >= 0),
  ADD CONSTRAINT "products_rating_range" CHECK ("rating" IS NULL OR ("rating" >= 0 AND "rating" <= 5));

ALTER TABLE "reviews"
  ADD CONSTRAINT "reviews_rating_range" CHECK ("rating" BETWEEN 1 AND 5);

ALTER TABLE "vendors"
  ADD CONSTRAINT "vendors_commission_range" CHECK ("commissionBps" BETWEEN 0 AND 10000);

-- Birthdays are calendar anniversaries.
ALTER TABLE "profiles"
  ADD CONSTRAINT "profiles_birth_month_range" CHECK ("birthMonth" IS NULL OR "birthMonth" BETWEEN 1 AND 12),
  ADD CONSTRAINT "profiles_birth_day_range" CHECK ("birthDay" IS NULL OR "birthDay" BETWEEN 1 AND 31);

ALTER TABLE "tracked_birthdays"
  ADD CONSTRAINT "tracked_birthdays_birth_month_range" CHECK ("birthMonth" BETWEEN 1 AND 12),
  ADD CONSTRAINT "tracked_birthdays_birth_day_range" CHECK ("birthDay" BETWEEN 1 AND 31);

-- Friendships cannot point at oneself.
ALTER TABLE "friendships"
  ADD CONSTRAINT "friendships_not_self" CHECK ("requesterId" <> "addresseeId");

ALTER TABLE "blocked_users"
  ADD CONSTRAINT "blocked_users_not_self" CHECK ("blockerId" <> "blockedId");

-- Search helpers: case-insensitive lookups used by people and product search.
CREATE INDEX IF NOT EXISTS "profiles_display_name_lower_idx" ON "profiles" (lower("displayName"));
CREATE INDEX IF NOT EXISTS "products_name_lower_idx" ON "products" (lower("name"));
