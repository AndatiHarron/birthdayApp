import {
  SUPPORTED_CURRENCIES,
  cancelOrderSchema,
  createOrderSchema,
  createProductSchema,
  createReviewSchema,
  deliveryAddressSchema,
  initiatePaymentSchema,
  orderQuerySchema,
  productQuerySchema,
  updateDeliveryStatusSchema,
  updateProductSchema,
  validateCouponSchema,
  vendorApplicationSchema,
  walletTopupSchema,
} from '@bday/shared';
import express from 'express';
import { z } from 'zod';
import { env } from '../config/env';
import { idOrSlugParams, idParams } from '../http/params';
import { createModule } from '../http/route';
import { asyncHandler } from '../lib/async';
import { AppError } from '../lib/errors';
import { ok } from '../lib/response';
import { paymentLimiter, webhookLimiter } from '../middleware/rateLimit';
import * as addressService from '../services/address.service';
import * as catalogService from '../services/catalog.service';
import { evaluateCoupon, listActivePromotions } from '../services/coupon.service';
import * as orderService from '../services/order.service';
import * as paymentService from '../services/payment.service';

/* -------------------------------- catalogue -------------------------------- */

export const products = createModule('/products', 'Marketplace');

products.get(
  '/',
  { summary: 'Browse and filter gifts (price, category, shelf, location, rating)', auth: 'optional', query: productQuerySchema },
  async ({ query }) => catalogService.listProducts(query),
);

products.get(
  '/:id',
  { summary: 'Product detail by id or slug', auth: 'optional', params: idOrSlugParams },
  async ({ params }) => catalogService.getProduct(params.id),
);

products.get(
  '/:id/reviews',
  { summary: 'Product reviews', auth: 'optional', params: idParams },
  async ({ params }) => catalogService.listReviews(params.id),
);

products.post(
  '/:id/reviews',
  { summary: 'Review a product you bought', auth: 'user', params: idParams, body: createReviewSchema, status: 201 },
  async ({ userId, params, body }) => catalogService.createReview(userId, params.id, body),
);

export const catalog = createModule('', 'Marketplace');

catalog.get('/categories', { summary: 'Gift categories', auth: 'public' }, async () => catalogService.listCategories());
catalog.get('/shelves', { summary: 'Curated discovery shelves', auth: 'public' }, async () => catalogService.listShelves());

catalog.get(
  '/vendors',
  {
    summary: 'Approved local shops (filter by city)',
    auth: 'optional',
    query: z.object({ city: z.string().trim().max(80).optional(), q: z.string().trim().max(80).optional(), limit: z.coerce.number().int().min(1).max(100).default(30) }),
  },
  async ({ query }) => catalogService.listVendors(query),
);

catalog.get(
  '/vendors/:id',
  { summary: 'A shop by id or slug', auth: 'optional', params: idOrSlugParams },
  async ({ params }) => catalogService.getVendor(params.id),
);

catalog.get('/promotions', { summary: 'Active promotions', auth: 'optional' }, async () => listActivePromotions());

catalog.post(
  '/coupons/validate',
  { summary: 'Check a promo code against a basket', auth: 'user', body: validateCouponSchema },
  async ({ userId, body }) => evaluateCoupon(userId, body),
);

/* --------------------------------- vendors --------------------------------- */

export const vendor = createModule('/vendor', 'Vendor');

vendor.post(
  '/apply',
  { summary: 'Apply to sell in the marketplace', auth: 'user', body: vendorApplicationSchema, status: 201 },
  async ({ userId, body }) => catalogService.applyAsVendor(userId, body),
);

vendor.get('/me', { summary: 'Your shop and its approval status', auth: 'user' }, async ({ userId }) => catalogService.getMyVendor(userId));

vendor.get('/products', { summary: 'Your listings (any status)', auth: 'user' }, async ({ userId }) => catalogService.listMyProducts(userId));

vendor.post(
  '/products',
  { summary: 'List a product (goes to admin review)', auth: 'user', body: createProductSchema, status: 201 },
  async ({ userId, body }) => catalogService.createProduct(userId, body),
);

vendor.patch(
  '/products/:id',
  { summary: 'Update price, stock or details', auth: 'user', params: idParams, body: updateProductSchema },
  async ({ userId, params, body }) => catalogService.updateProduct(userId, params.id, body),
);

vendor.delete(
  '/products/:id',
  { summary: 'Archive a listing', auth: 'user', params: idParams, status: 204 },
  async ({ userId, params }) => catalogService.deleteProduct(userId, params.id),
);

vendor.get(
  '/orders',
  { summary: 'Paid orders for your shop', auth: 'user', query: orderQuerySchema },
  async ({ userId, query }) => orderService.listVendorOrders(userId, query),
);

vendor.post(
  '/orders/:id/delivery',
  { summary: 'Advance delivery: processing → dispatched → out for delivery → delivered', auth: 'user', params: idParams, body: updateDeliveryStatusSchema },
  async ({ userId, auth, params, body }) => orderService.updateDeliveryStatus({ userId, role: auth!.role }, params.id, body),
);

/* ---------------------------------- orders ---------------------------------- */

export const orders = createModule('/orders', 'Orders');

orders.post(
  '/',
  {
    summary: 'Buy a physical gift and start payment',
    description: 'Prices, delivery fee and discounts are computed on the server. Idempotent per idempotencyKey.',
    auth: 'user',
    body: createOrderSchema,
    status: 201,
    middleware: [paymentLimiter],
  },
  async ({ userId, body }) => orderService.createOrder(userId, body),
);

orders.get(
  '/',
  { summary: 'Orders you placed, or gifts delivered to you', auth: 'user', query: orderQuerySchema },
  async ({ userId, query }) => orderService.listOrders(userId, query),
);

orders.get(
  '/:id',
  { summary: 'Order with delivery timeline', auth: 'user', params: idParams },
  async ({ userId, auth, params }) => orderService.getOrder(userId, params.id, auth?.role),
);

orders.post(
  '/:id/cancel',
  { summary: 'Cancel before dispatch (refunds if paid)', auth: 'user', params: idParams, body: cancelOrderSchema },
  async ({ userId, params, body }) => orderService.cancelOrder(userId, params.id, body),
);

export const addresses = createModule('/addresses', 'Orders');

addresses.get('/', { summary: 'Saved delivery addresses', auth: 'user' }, async ({ userId }) => addressService.listAddresses(userId));

addresses.post(
  '/',
  { summary: 'Save an address', auth: 'user', body: deliveryAddressSchema, status: 201 },
  async ({ userId, body }) => addressService.createAddress(userId, body),
);

addresses.patch(
  '/:id',
  { summary: 'Edit an address', auth: 'user', params: idParams, body: deliveryAddressSchema.partial() },
  async ({ userId, params, body }) => addressService.updateAddress(userId, params.id, body),
);

addresses.delete(
  '/:id',
  { summary: 'Delete an address', auth: 'user', params: idParams, status: 204 },
  async ({ userId, params }) => addressService.deleteAddress(userId, params.id),
);

/* --------------------------------- payments --------------------------------- */

/** Premium: one month, in minor units of the default currency. */
export const PREMIUM_PRICE_MINOR = 49_900;

export const payments = createModule('/payments', 'Payments');

payments.get(
  '/providers',
  { summary: 'Payment methods available for a currency', auth: 'public', query: z.object({ currency: z.enum(SUPPORTED_CURRENCIES).default('KES') }) },
  async ({ query }) => paymentService.listProviders(query.currency),
);

payments.post(
  '/',
  {
    summary: 'Initiate a payment',
    description: 'Returns the next client action (e.g. await the M-Pesa STK prompt). Status only becomes SUCCESSFUL from the provider.',
    auth: 'user',
    body: initiatePaymentSchema,
    status: 201,
    middleware: [paymentLimiter],
  },
  async ({ userId, body }) => {
    // Money-carrying purposes have dedicated endpoints that compute the amount
    // server-side; accepting a client amount for them here would bypass that.
    if (body.purpose !== 'WALLET_TOPUP' && body.purpose !== 'PREMIUM_SUBSCRIPTION') {
      throw new AppError('VALIDATION_ERROR', {
        message: 'Use the order, contribution or digital gift endpoint for this payment.',
      });
    }
    if (
      body.purpose === 'PREMIUM_SUBSCRIPTION' &&
      (body.amountMinor !== PREMIUM_PRICE_MINOR || body.currency !== env.PAYMENTS_DEFAULT_CURRENCY)
    ) {
      throw new AppError('VALIDATION_ERROR', { message: 'That is not the current premium price.' });
    }
    return paymentService.initiatePayment(userId, body);
  },
);

payments.get('/', { summary: 'Your payments', auth: 'user' }, async ({ userId }) => paymentService.listPayments(userId));

payments.get(
  '/:id',
  { summary: 'One payment', auth: 'user', params: idParams },
  async ({ userId, params }) => paymentService.getPayment(userId, params.id),
);

payments.post(
  '/:id/verify',
  { summary: 'Ask the provider for the latest status (poll after an STK push)', auth: 'user', params: idParams },
  async ({ userId, params }) => paymentService.verifyPayment(userId, params.id),
);

payments.get('/premium/price', { summary: 'Current premium membership price', auth: 'public' }, async () => ({
  amountMinor: PREMIUM_PRICE_MINOR,
  currency: env.PAYMENTS_DEFAULT_CURRENCY,
  periodDays: 30,
}));

payments.post(
  '/wallet-topup',
  { summary: 'Top up the birthday wallet', auth: 'user', body: walletTopupSchema, status: 201, middleware: [paymentLimiter] },
  async ({ userId, body }) => {
    if (body.provider === 'WALLET') throw new AppError('VALIDATION_ERROR', { message: 'Choose M-Pesa or card to top up.' });
    return paymentService.initiatePayment(userId, { ...body, purpose: 'WALLET_TOPUP', referenceType: 'WALLET' });
  },
);

/**
 * Provider webhooks. Mounted before the JSON body parser: signature checks
 * need the exact raw bytes the provider signed.
 */
export const webhookRouter = express.Router();

webhookRouter.post(
  '/payments/:provider',
  webhookLimiter,
  express.raw({ type: '*/*', limit: '1mb' }),
  asyncHandler(async (req, res) => {
    const provider = String(req.params.provider ?? '').toLowerCase();
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
    const result = await paymentService.handleWebhook(provider, req.headers, raw);
    // M-Pesa expects this exact acknowledgement shape.
    if (provider === 'mpesa') {
      res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
      return;
    }
    ok(res, result);
  }),
);
