import {
  GIFT_SHELVES,
  type CreateProductInput,
  type CreateReviewInput,
  type Paginated,
  type ProductDto,
  type ProductQueryInput,
  type ProductReviewDto,
  type UpdateProductInput,
  type VendorApplicationInput,
  type VendorDto,
} from '@bday/shared';
import type { GiftCategory, Prisma, Product, Vendor } from '@prisma/client';
import { AppError } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { decodeCursor, encodeCursor } from '../lib/response';

/**
 * Gift marketplace (spec §17, §34, §35, §46).
 *
 * Only ACTIVE products from APPROVED vendors are ever visible to shoppers. A
 * vendor suspended mid-trading must stop selling immediately, so vendor status
 * is part of every catalogue query rather than something denormalised onto the
 * product row and left to drift.
 */

type ProductRow = Product & {
  vendor: Pick<Vendor, 'id' | 'name' | 'logoUrl' | 'rating'>;
  categories: Array<{ category: Pick<GiftCategory, 'id' | 'slug' | 'label'> }>;
};

const PRODUCT_INCLUDE = {
  vendor: { select: { id: true, name: true, logoUrl: true, rating: true } },
  categories: { include: { category: { select: { id: true, slug: true, label: true } } } },
} as const;

export function toProductDto(product: ProductRow): ProductDto {
  return {
    id: product.id,
    vendorId: product.vendorId,
    vendor: {
      id: product.vendor.id,
      name: product.vendor.name,
      logoUrl: product.vendor.logoUrl,
      rating: product.vendor.rating,
    },
    name: product.name,
    slug: product.slug,
    description: product.description,
    images: product.images,
    priceMinor: product.priceMinor,
    compareAtPriceMinor: product.compareAtPriceMinor,
    currency: product.currency,
    status: product.status,
    categoryIds: product.categories.map((link) => link.category.id),
    categories: product.categories.map((link) => link.category),
    tags: product.tags,
    stock: product.stock,
    rating: product.rating,
    reviewCount: product.reviewCount,
    deliveryEstimate: product.deliveryEstimate,
    deliveryFeeMinor: product.deliveryFeeMinor,
    isPersonalizable: product.isPersonalizable,
    location:
      product.city || product.area || product.latitude != null
        ? {
            city: product.city,
            area: product.area,
            latitude: product.latitude,
            longitude: product.longitude,
          }
        : null,
    createdAt: product.createdAt.toISOString(),
  };
}

/** Curated shelf filters (spec §46). Shelves are price/tag lenses, not tables. */
function shelfFilter(shelf: string): Prisma.ProductWhereInput {
  switch (shelf) {
    case 'under_1000':
      return { priceMinor: { lte: 100_000 } };
    case 'under_5000':
      return { priceMinor: { lte: 500_000 } };
    case 'premium':
      return { priceMinor: { gte: 1_000_000 } };
    case 'personalized':
      return { isPersonalizable: true };
    case 'popular':
      return { purchaseCount: { gte: 1 } };
    case 'for_her':
    case 'for_him':
    case 'family':
    case 'friends':
    case 'colleagues':
      return { tags: { has: shelf } };
    default:
      return {};
  }
}

export async function listProducts(input: ProductQueryInput): Promise<Paginated<ProductDto>> {
  const cursor = decodeCursor<{ createdAt: string; id: string }>(input.cursor);

  // Several filters are OR-groups; they are ANDed together explicitly, since
  // spreading them into one object would let each `OR` overwrite the last.
  const and: Prisma.ProductWhereInput[] = [];
  if (input.q) {
    and.push({
      OR: [
        { name: { contains: input.q, mode: 'insensitive' } },
        { description: { contains: input.q, mode: 'insensitive' } },
        { tags: { has: input.q.toLowerCase() } },
      ],
    });
  }
  // `stock: null` means made-to-order, which is always in stock.
  if (input.inStockOnly) and.push({ OR: [{ stock: null }, { stock: { gt: 0 } }] });
  if (cursor && (input.sort === 'NEWEST' || input.sort === 'RELEVANCE')) {
    and.push({
      OR: [
        { createdAt: { lt: new Date(cursor.createdAt) } },
        { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
      ],
    });
  }

  const where: Prisma.ProductWhereInput = {
    deletedAt: null,
    status: 'ACTIVE',
    vendor: { status: 'APPROVED' },
    ...(input.categorySlug ? { categories: { some: { category: { slug: input.categorySlug } } } } : {}),
    ...(input.vendorId ? { vendorId: input.vendorId } : {}),
    ...(input.minPriceMinor != null || input.maxPriceMinor != null
      ? {
          priceMinor: {
            ...(input.minPriceMinor != null ? { gte: input.minPriceMinor } : {}),
            ...(input.maxPriceMinor != null ? { lte: input.maxPriceMinor } : {}),
          },
        }
      : {}),
    ...(input.currency ? { currency: input.currency } : {}),
    ...(input.city ? { city: { equals: input.city, mode: 'insensitive' } } : {}),
    ...(input.area ? { area: { equals: input.area, mode: 'insensitive' } } : {}),
    ...(input.minRating ? { rating: { gte: input.minRating } } : {}),
    ...(input.shelf ? shelfFilter(input.shelf) : {}),
    ...(and.length > 0 ? { AND: and } : {}),
  };

  const orderBy: Prisma.ProductOrderByWithRelationInput[] =
    input.sort === 'PRICE_ASC'
      ? [{ priceMinor: 'asc' }, { id: 'asc' }]
      : input.sort === 'PRICE_DESC'
        ? [{ priceMinor: 'desc' }, { id: 'desc' }]
        : input.sort === 'RATING'
          ? [{ rating: 'desc' }, { id: 'desc' }]
          : input.sort === 'NEWEST'
            ? [{ createdAt: 'desc' }, { id: 'desc' }]
            : [{ isFeatured: 'desc' }, { purchaseCount: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }];

  // Cursor paging is only exact for the time-ordered sorts; the others fall
  // back to offsetless "take" from the start, which is what a re-sorted shelf
  // means anyway.
  const products = (await prisma.product.findMany({
    where,
    orderBy,
    take: input.limit + 1,
    include: PRODUCT_INCLUDE,
  })) as ProductRow[];

  const hasMore = products.length > input.limit;
  const items = hasMore ? products.slice(0, input.limit) : products;
  const last = items[items.length - 1];

  return {
    items: items.map(toProductDto),
    nextCursor:
      hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null,
  };
}

export async function getProduct(idOrSlug: string): Promise<ProductDto> {
  const product = (await prisma.product.findFirst({
    where: {
      deletedAt: null,
      OR: [{ id: idOrSlug }, { slug: idOrSlug }],
    },
    include: PRODUCT_INCLUDE,
  })) as ProductRow | null;
  if (!product) throw new AppError('NOT_FOUND', { message: 'That gift could not be found.' });
  if (product.status !== 'ACTIVE') throw new AppError('PRODUCT_UNAVAILABLE');

  await prisma.product.update({
    where: { id: product.id },
    data: { viewCount: { increment: 1 } },
  });

  return toProductDto(product);
}

export async function listCategories() {
  const categories = await prisma.giftCategory.findMany({
    where: { isActive: true },
    orderBy: [{ position: 'asc' }, { label: 'asc' }],
    include: { _count: { select: { products: true } } },
  });
  return categories.map((category) => ({
    id: category.id,
    slug: category.slug,
    label: category.label,
    emoji: category.emoji,
    parentId: category.parentId,
    productCount: category._count.products,
  }));
}

export function listShelves() {
  return GIFT_SHELVES.map((shelf) => ({ ...shelf }));
}

/* -------------------------------- vendors -------------------------------- */

function toVendorDto(vendor: Vendor & { _count?: { products: number } }): VendorDto {
  return {
    id: vendor.id,
    name: vendor.name,
    slug: vendor.slug,
    description: vendor.description,
    logoUrl: vendor.logoUrl,
    status: vendor.status,
    rating: vendor.rating,
    productCount: vendor._count?.products ?? 0,
    city: vendor.city,
    area: vendor.area,
    commissionBps: vendor.commissionBps,
  };
}

export async function listVendors(options: { city?: string; q?: string; limit?: number } = {}) {
  const vendors = await prisma.vendor.findMany({
    where: {
      status: 'APPROVED',
      ...(options.city ? { city: { equals: options.city, mode: 'insensitive' } } : {}),
      ...(options.q ? { name: { contains: options.q, mode: 'insensitive' } } : {}),
    },
    orderBy: [{ rating: 'desc' }, { name: 'asc' }],
    take: options.limit ?? 50,
    include: { _count: { select: { products: { where: { status: 'ACTIVE', deletedAt: null } } } } },
  });
  return vendors.map(toVendorDto);
}

export async function getVendor(idOrSlug: string): Promise<VendorDto> {
  const vendor = await prisma.vendor.findFirst({
    where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
    include: { _count: { select: { products: { where: { status: 'ACTIVE', deletedAt: null } } } } },
  });
  if (!vendor || vendor.status !== 'APPROVED') throw new AppError('NOT_FOUND');
  return toVendorDto(vendor);
}

/**
 * Vendor application (spec §34).
 *
 * Creates a PENDING vendor. The account keeps its USER role until an admin
 * approves — promoting on application would hand out the vendor dashboard to
 * anyone who filled in a form.
 */
export async function applyAsVendor(
  userId: string,
  input: VendorApplicationInput,
): Promise<VendorDto> {
  const existing = await prisma.vendor.findUnique({ where: { ownerUserId: userId } });
  if (existing) {
    throw new AppError('CONFLICT', { message: 'You already have a vendor application.' });
  }

  const vendor = await prisma.vendor.create({
    data: {
      ownerUserId: userId,
      name: input.name,
      slug: await uniqueVendorSlug(input.name),
      description: input.description,
      logoUrl: input.logoUrl ?? null,
      contactEmail: input.contactEmail,
      contactPhone: input.contactPhone,
      city: input.city,
      area: input.area ?? null,
      registrationNumber: input.registrationNumber ?? null,
    },
  });
  return toVendorDto(vendor);
}

async function uniqueVendorSlug(name: string): Promise<string> {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'vendor';
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const taken = await prisma.vendor.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!taken) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export async function getMyVendor(userId: string): Promise<VendorDto | null> {
  const vendor = await prisma.vendor.findUnique({
    where: { ownerUserId: userId },
    include: { _count: { select: { products: true } } },
  });
  return vendor ? toVendorDto(vendor) : null;
}

async function requireApprovedVendor(userId: string): Promise<{ id: string }> {
  const vendor = await prisma.vendor.findUnique({
    where: { ownerUserId: userId },
    select: { id: true, status: true },
  });
  if (!vendor) throw new AppError('NOT_FOUND', { message: 'You do not have a vendor account.' });
  if (vendor.status !== 'APPROVED') throw new AppError('VENDOR_NOT_APPROVED');
  return { id: vendor.id };
}

/* --------------------------- vendor: products --------------------------- */

export async function createProduct(userId: string, input: CreateProductInput): Promise<ProductDto> {
  const vendor = await requireApprovedVendor(userId);

  const categories = await prisma.giftCategory.findMany({
    where: { id: { in: input.categoryIds } },
    select: { id: true },
  });
  if (categories.length === 0) {
    throw new AppError('VALIDATION_ERROR', { fieldErrors: { 'body.categoryIds': ['Choose a category'] } });
  }

  const product = (await prisma.product.create({
    data: {
      vendorId: vendor.id,
      name: input.name,
      slug: await uniqueProductSlug(input.name),
      description: input.description,
      images: input.images,
      priceMinor: input.priceMinor,
      compareAtPriceMinor: input.compareAtPriceMinor ?? null,
      currency: input.currency,
      tags: input.tags,
      stock: input.stock ?? null,
      deliveryEstimate: input.deliveryEstimate ?? null,
      deliveryFeeMinor: input.deliveryFeeMinor ?? null,
      isPersonalizable: input.isPersonalizable,
      city: input.city ?? null,
      area: input.area ?? null,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      // New listings queue for review rather than going live (spec §34).
      status: 'PENDING_REVIEW',
      categories: { create: categories.map((category) => ({ categoryId: category.id })) },
    },
    include: PRODUCT_INCLUDE,
  })) as ProductRow;

  return toProductDto(product);
}

async function uniqueProductSlug(name: string): Promise<string> {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'gift';
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 7)}`;
    const taken = await prisma.product.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!taken) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export async function updateProduct(
  userId: string,
  productId: string,
  input: UpdateProductInput,
): Promise<ProductDto> {
  const vendor = await requireApprovedVendor(userId);
  const existing = await prisma.product.findFirst({
    where: { id: productId, vendorId: vendor.id, deletedAt: null },
    select: { id: true, status: true },
  });
  if (!existing) throw new AppError('NOT_FOUND');

  // Vendors may pause or resume a listing, but cannot approve their own.
  if (input.status && !['ACTIVE', 'OUT_OF_STOCK', 'ARCHIVED', 'DRAFT'].includes(input.status)) {
    throw new AppError('FORBIDDEN', { message: 'Only an administrator can set that status.' });
  }
  if (input.status === 'ACTIVE' && existing.status === 'PENDING_REVIEW') {
    throw new AppError('FORBIDDEN', { message: 'This listing is still awaiting review.' });
  }

  const data: Prisma.ProductUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.description !== undefined) data.description = input.description;
  if (input.images !== undefined) data.images = input.images;
  if (input.priceMinor !== undefined) data.priceMinor = input.priceMinor;
  if (input.compareAtPriceMinor !== undefined) data.compareAtPriceMinor = input.compareAtPriceMinor ?? null;
  if (input.currency !== undefined) data.currency = input.currency;
  if (input.tags !== undefined) data.tags = input.tags;
  if (input.stock !== undefined) data.stock = input.stock ?? null;
  if (input.deliveryEstimate !== undefined) data.deliveryEstimate = input.deliveryEstimate ?? null;
  if (input.deliveryFeeMinor !== undefined) data.deliveryFeeMinor = input.deliveryFeeMinor ?? null;
  if (input.isPersonalizable !== undefined) data.isPersonalizable = input.isPersonalizable;
  if (input.city !== undefined) data.city = input.city ?? null;
  if (input.area !== undefined) data.area = input.area ?? null;
  if (input.latitude !== undefined) data.latitude = input.latitude ?? null;
  if (input.longitude !== undefined) data.longitude = input.longitude ?? null;
  if (input.status !== undefined) data.status = input.status;

  const product = (await prisma.product.update({
    where: { id: productId },
    data,
    include: PRODUCT_INCLUDE,
  })) as ProductRow;

  if (input.categoryIds) {
    const categories = await prisma.giftCategory.findMany({
      where: { id: { in: input.categoryIds } },
      select: { id: true },
    });
    await prisma.productCategoryLink.deleteMany({ where: { productId } });
    await prisma.productCategoryLink.createMany({
      data: categories.map((category) => ({ productId, categoryId: category.id })),
      skipDuplicates: true,
    });
  }

  return toProductDto(product);
}

export async function deleteProduct(userId: string, productId: string): Promise<void> {
  const vendor = await requireApprovedVendor(userId);
  const result = await prisma.product.updateMany({
    where: { id: productId, vendorId: vendor.id, deletedAt: null },
    data: { deletedAt: new Date(), status: 'ARCHIVED' },
  });
  if (result.count === 0) throw new AppError('NOT_FOUND');
}

export async function listMyProducts(userId: string): Promise<ProductDto[]> {
  const vendor = await prisma.vendor.findUnique({
    where: { ownerUserId: userId },
    select: { id: true },
  });
  if (!vendor) throw new AppError('NOT_FOUND', { message: 'You do not have a vendor account.' });

  const products = (await prisma.product.findMany({
    where: { vendorId: vendor.id, deletedAt: null },
    orderBy: { createdAt: 'desc' },
    include: PRODUCT_INCLUDE,
  })) as ProductRow[];
  return products.map(toProductDto);
}

/* -------------------------------- reviews -------------------------------- */

/**
 * Product review.
 *
 * Only buyers may review, and only once per product — an unverified review
 * stream is worth nothing to a gifter deciding what to send.
 */
export async function createReview(
  userId: string,
  productId: string,
  input: CreateReviewInput,
): Promise<ProductReviewDto> {
  const purchase = await prisma.orderItem.findFirst({
    where: {
      productId,
      order: { buyerId: userId, status: { in: ['PAID', 'PROCESSING', 'FULFILLED'] } },
    },
    select: { orderId: true },
  });
  if (!purchase) {
    throw new AppError('FORBIDDEN', { message: 'You can review a gift once you have bought it.' });
  }

  // Upsert rather than create: editing an earlier review is the natural reading
  // of "review this again", and the unique index forbids a second row anyway.
  const review = await prisma.productReview.upsert({
    where: { productId_authorId: { productId, authorId: userId } },
    create: {
      productId,
      authorId: userId,
      orderId: purchase.orderId,
      rating: input.rating,
      title: input.title ?? null,
      body: input.body ?? null,
    },
    update: {
      rating: input.rating,
      title: input.title ?? null,
      body: input.body ?? null,
    },
    include: {
      author: {
        select: { id: true, username: true, profile: { select: { displayName: true, avatarUrl: true } } },
      },
    },
  });

  await refreshRatings(productId);

  return {
    id: review.id,
    productId: review.productId,
    rating: review.rating,
    title: review.title,
    body: review.body,
    author: {
      id: review.author.id,
      displayName: review.author.profile?.displayName ?? review.author.username,
      avatarUrl: review.author.profile?.avatarUrl ?? null,
    },
    createdAt: review.createdAt.toISOString(),
  };
}

/**
 * Recomputes the cached rating for a product and its vendor.
 * Kept as one function so the two aggregates cannot drift apart.
 */
async function refreshRatings(productId: string): Promise<void> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { vendorId: true },
  });
  if (!product) return;

  const productAgg = await prisma.productReview.aggregate({
    where: { productId },
    _avg: { rating: true },
    _count: { _all: true },
  });
  await prisma.product.update({
    where: { id: productId },
    data: {
      rating: productAgg._avg.rating ?? null,
      reviewCount: productAgg._count._all,
    },
  });

  const vendorAgg = await prisma.productReview.aggregate({
    where: { product: { vendorId: product.vendorId } },
    _avg: { rating: true },
    _count: { _all: true },
  });
  await prisma.vendor.update({
    where: { id: product.vendorId },
    data: {
      rating: vendorAgg._avg.rating ?? null,
      ratingCount: vendorAgg._count._all,
    },
  });
}

export async function listReviews(productId: string, limit = 30): Promise<ProductReviewDto[]> {
  const reviews = await prisma.productReview.findMany({
    where: { productId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      author: { select: { id: true, username: true, profile: { select: { displayName: true, avatarUrl: true } } } },
    },
  });

  return reviews.map((review) => ({
    id: review.id,
    productId: review.productId,
    rating: review.rating,
    title: review.title,
    body: review.body,
    author: {
      id: review.author.id,
      displayName: review.author.profile?.displayName ?? review.author.username,
      avatarUrl: review.author.profile?.avatarUrl ?? null,
    },
    createdAt: review.createdAt.toISOString(),
  }));
}

export { refreshRatings };
