import {
  completePayoutSchema,
  failPayoutSchema,
  PaymentProvider,
  PaymentStatus,
  ProductStatus,
  VendorStatus,
  adminBroadcastSchema,
  adminCategorySchema,
  adminOrderQuerySchema,
  adminProductReviewSchema,
  adminPromotionSchema,
  adminRefundSchema,
  adminReportQuerySchema,
  adminResolveReportSchema,
  adminStatsQuerySchema,
  adminUpdateUserSchema,
  adminUserQuerySchema,
  adminVendorReviewSchema,
  noteSchema,
  paginationSchema,
  updateDeliveryStatusSchema,
} from '@bday/shared';
import { z } from 'zod';
import { idParams } from '../http/params';
import { createModule } from '../http/route';
import * as adminService from '../services/admin.service';
import * as payoutService from '../services/payout.service';
import { auditContext, listAuditLogs } from '../services/audit.service';
import { getOrder, updateDeliveryStatus } from '../services/order.service';

const admin = createModule('/admin', 'Admin');

admin.get('/stats', { summary: 'Dashboard statistics and daily series', auth: 'admin', query: adminStatsQuerySchema }, async ({ query }) => adminService.getDashboardStats(query));

admin.get(
  '/reports/engagement',
  { summary: 'Engagement, conversion and category report', auth: 'admin', query: z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }) },
  async ({ query }) => adminService.getEngagementReport(query.days),
);

/* users */
admin.get('/users', { summary: 'Search and filter users', auth: 'admin', query: adminUserQuerySchema }, async ({ query }) => adminService.listUsers(query));
admin.get('/users/:id', { summary: 'User detail', auth: 'admin', params: idParams }, async ({ params }) => adminService.getUserDetail(params.id));

admin.patch(
  '/users/:id',
  { summary: 'Suspend, verify, change role or premium', auth: 'admin', params: idParams, body: adminUpdateUserSchema },
  async ({ req, params, body }) => adminService.updateUser(auditContext(req), params.id, body),
);

admin.delete(
  '/users/:id',
  { summary: 'Delete a user account', auth: 'admin', params: idParams, body: z.object({ reason: noteSchema(500) }), status: 204 },
  async ({ req, params, body }) => adminService.deleteUser(auditContext(req), params.id, body.reason ?? null),
);

/* products */
admin.get(
  '/products',
  {
    summary: 'Products in any status',
    auth: 'admin',
    query: paginationSchema.extend({ q: z.string().trim().max(120).optional(), status: z.nativeEnum(ProductStatus).optional() }),
  },
  async ({ query }) => adminService.listProductsForReview(query),
);

admin.patch(
  '/products/:id',
  { summary: 'Approve, reject, archive or feature a product', auth: 'admin', params: idParams, body: adminProductReviewSchema },
  async ({ req, params, body }) => adminService.reviewProduct(auditContext(req), params.id, body),
);

/* vendors */
admin.get(
  '/vendors',
  {
    summary: 'Vendors with performance figures',
    auth: 'admin',
    query: paginationSchema.extend({ q: z.string().trim().max(120).optional(), status: z.nativeEnum(VendorStatus).optional() }),
  },
  async ({ query }) => adminService.listVendorsForReview(query),
);

admin.patch(
  '/vendors/:id',
  { summary: 'Approve, suspend or reject a vendor; set commission', auth: 'admin', params: idParams, body: adminVendorReviewSchema },
  async ({ req, params, body }) => adminService.reviewVendor(auditContext(req), params.id, body),
);

/* orders */
admin.get('/orders', { summary: 'Track orders', auth: 'admin', query: adminOrderQuerySchema }, async ({ query }) => adminService.listOrders(query));
admin.get('/orders/:id', { summary: 'Order detail', auth: 'admin', params: idParams }, async ({ userId, auth, params }) => getOrder(userId, params.id, auth?.role));

admin.post(
  '/orders/:id/status',
  { summary: 'Move a paid order to processing, or cancel an unpaid one', auth: 'admin', params: idParams, body: z.object({ status: z.enum(['PROCESSING', 'CANCELLED']), reason: noteSchema(500) }) },
  async ({ req, params, body }) => adminService.updateOrderStatus(auditContext(req), params.id, body.status, body.reason ?? null),
);

admin.post(
  '/orders/:id/delivery',
  { summary: 'Update delivery status', auth: 'admin', params: idParams, body: updateDeliveryStatusSchema },
  async ({ userId, auth, params, body }) => updateDeliveryStatus({ userId, role: auth!.role }, params.id, body),
);

admin.post(
  '/orders/:id/refund',
  { summary: 'Refund an order (full or partial)', auth: 'admin', params: idParams, body: adminRefundSchema },
  async ({ req, params, body }) => adminService.refundOrder(auditContext(req), params.id, body),
);

/* payments */
admin.get(
  '/payments',
  {
    summary: 'Transactions',
    auth: 'admin',
    query: paginationSchema.extend({
      q: z.string().trim().max(120).optional(),
      status: z.nativeEnum(PaymentStatus).optional(),
      provider: z.nativeEnum(PaymentProvider).optional(),
    }),
  },
  async ({ query }) => adminService.listPayments(query),
);

admin.get('/payments/reconciliation', { summary: 'Stuck payments, webhook errors, pending refunds', auth: 'admin' }, async () => adminService.paymentReconciliation());

admin.post(
  '/refunds/:id/complete',
  { summary: 'Mark a manual refund as completed', auth: 'admin', params: idParams, body: z.object({ providerRef: z.string().trim().max(120).nullable() }) },
  async ({ req, params, body }) => adminService.completeManualRefund(auditContext(req), params.id, body.providerRef),
);

/* withdrawals */
admin.get(
  '/payouts',
  { summary: 'Withdrawal queue', auth: 'admin', query: z.object({ status: z.enum(['REQUESTED', 'PROCESSING', 'PAID', 'FAILED', 'CANCELLED']).optional() }) },
  async ({ query }) => payoutService.listPayouts(query.status),
);

admin.post(
  '/payouts/:id/complete',
  { summary: 'Mark a withdrawal as sent', auth: 'admin', params: idParams, body: completePayoutSchema },
  async ({ req, params, body }) => payoutService.completePayout(params.id, req.auth!.userId, body.providerRef),
);

admin.post(
  '/payouts/:id/fail',
  { summary: 'Return a withdrawal to the wallet', auth: 'admin', params: idParams, body: failPayoutSchema },
  async ({ req, params, body }) => payoutService.failPayout(params.id, body.reason, req.auth!.userId),
);

/* categories */
admin.get('/categories', { summary: 'All categories', auth: 'admin' }, async () => adminService.listCategoriesAdmin());
admin.post('/categories', { summary: 'Create a category', auth: 'admin', body: adminCategorySchema, status: 201 }, async ({ req, body }) => adminService.upsertCategory(auditContext(req), null, body));
admin.put('/categories/:id', { summary: 'Update a category', auth: 'admin', params: idParams, body: adminCategorySchema }, async ({ req, params, body }) => adminService.upsertCategory(auditContext(req), params.id, body));
admin.delete('/categories/:id', { summary: 'Delete an unused category', auth: 'admin', params: idParams, status: 204 }, async ({ req, params }) => adminService.deleteCategory(auditContext(req), params.id));

/* promotions */
admin.get('/promotions', { summary: 'All promotions and coupons', auth: 'admin' }, async () => adminService.listPromotions());
admin.post('/promotions', { summary: 'Create a promotion', auth: 'admin', body: adminPromotionSchema, status: 201 }, async ({ req, body }) => adminService.upsertPromotion(auditContext(req), null, body));
admin.put('/promotions/:id', { summary: 'Update a promotion', auth: 'admin', params: idParams, body: adminPromotionSchema }, async ({ req, params, body }) => adminService.upsertPromotion(auditContext(req), params.id, body));
admin.delete('/promotions/:id', { summary: 'Deactivate a promotion', auth: 'admin', params: idParams, status: 204 }, async ({ req, params }) => adminService.deactivatePromotion(auditContext(req), params.id));

/* notifications */
admin.post(
  '/notifications/broadcast',
  { summary: 'Send a notification to a filtered audience', auth: 'admin', body: adminBroadcastSchema, status: 202 },
  async ({ req, body }) => adminService.broadcast(auditContext(req), body),
);

/* moderation */
admin.get('/complaints', { summary: 'User reports and complaints', auth: 'admin', query: adminReportQuerySchema }, async ({ query }) => adminService.listReports(query));

admin.patch(
  '/complaints/:id',
  { summary: 'Review or resolve a report', auth: 'admin', params: idParams, body: adminResolveReportSchema },
  async ({ req, params, body }) => adminService.resolveReport(auditContext(req), params.id, body),
);

/* audit */
admin.get(
  '/audit-logs',
  {
    summary: 'Audit trail',
    auth: 'admin',
    query: z.object({
      limit: z.coerce.number().int().min(1).max(100).default(50),
      cursor: z.string().max(64).optional(),
      action: z.string().max(64).optional(),
      actorId: z.string().max(64).optional(),
      targetId: z.string().max(64).optional(),
    }),
  },
  async ({ query }) => listAuditLogs(query),
);

/** Spec §42 lists `POST /notifications` — for administrators it is the broadcast. */
export const adminNotificationAlias = createModule('/notifications', 'Admin');
adminNotificationAlias.post(
  '/',
  { summary: 'Broadcast a notification (admin)', auth: 'admin', body: adminBroadcastSchema, status: 202 },
  async ({ req, body }) => adminService.broadcast(auditContext(req), body),
);

export default admin;
