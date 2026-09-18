import { isSupportedCurrency, toMinor, type UnfurledProduct } from '@bday/shared';
import { load, type CheerioAPI } from 'cheerio';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';
import { cacheGet, cacheSet } from '../lib/redis';
import { safeFetchText } from '../lib/safeFetch';

/**
 * Product link previews (spec §11 "paste product URL").
 *
 * Reads, in order of reliability: schema.org Product JSON-LD, Open Graph /
 * product meta tags, then plain HTML. Everything extracted is a suggestion —
 * the client shows it in an editable form before anything is saved.
 */

const CURRENCY_SYMBOLS: Record<string, string> = {
  KSH: 'KES',
  'KSH.': 'KES',
  KES: 'KES',
  $: 'USD',
  US$: 'USD',
  '€': 'EUR',
  '£': 'GBP',
  '₦': 'NGN',
  R: 'ZAR',
  USH: 'UGX',
  TSH: 'TZS',
};

export function parsePrice(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) && raw >= 0 ? raw : null;
  const cleaned = raw.replace(/[^\d.,]/g, '');
  if (!cleaned) return null;
  // "8,500.00" and "8.500,00" both occur; the last separator is the decimal
  // point only when it is followed by exactly two digits.
  const lastSeparator = Math.max(cleaned.lastIndexOf('.'), cleaned.lastIndexOf(','));
  const decimals = lastSeparator >= 0 ? cleaned.length - lastSeparator - 1 : 0;
  const normalised =
    lastSeparator >= 0 && decimals === 2
      ? `${cleaned.slice(0, lastSeparator).replace(/[.,]/g, '')}.${cleaned.slice(lastSeparator + 1)}`
      : cleaned.replace(/[.,]/g, '');
  const value = Number(normalised);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function normaliseCurrency(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const upper = raw.trim().toUpperCase();
  if (isSupportedCurrency(upper)) return upper;
  return CURRENCY_SYMBOLS[upper] ?? null;
}

function absoluteUrl(value: string | undefined | null, base: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, base);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

interface JsonLdProduct {
  name?: string;
  description?: string;
  image?: string | string[] | { url?: string };
  brand?: { name?: string } | string;
  offers?: JsonLdOffer | JsonLdOffer[];
}
interface JsonLdOffer {
  price?: string | number;
  lowPrice?: string | number;
  priceCurrency?: string;
  seller?: { name?: string };
}

function findJsonLdProduct($: CheerioAPI): JsonLdProduct | null {
  const blocks = $('script[type="application/ld+json"]').toArray();
  for (const block of blocks) {
    try {
      const parsed: unknown = JSON.parse($(block).contents().text());
      const queue: unknown[] = Array.isArray(parsed) ? [...parsed] : [parsed];
      while (queue.length > 0) {
        const node = queue.shift();
        if (!node || typeof node !== 'object') continue;
        const record = node as Record<string, unknown>;
        const type = record['@type'];
        if (type === 'Product' || (Array.isArray(type) && type.includes('Product'))) return record as JsonLdProduct;
        if (Array.isArray(record['@graph'])) queue.push(...(record['@graph'] as unknown[]));
      }
    } catch {
      // Malformed JSON-LD is common; try the next block.
    }
  }
  return null;
}

export function extractProduct(html: string, pageUrl: string): UnfurledProduct {
  const $ = load(html);
  const meta = (selector: string) => $(selector).attr('content')?.trim() || null;

  const product = findJsonLdProduct($);
  const offer = Array.isArray(product?.offers) ? product?.offers[0] : product?.offers;

  const name =
    product?.name?.trim() || meta('meta[property="og:title"]') || meta('meta[name="twitter:title"]') || $('title').first().text().trim() || null;

  const description =
    product?.description?.trim() || meta('meta[property="og:description"]') || meta('meta[name="description"]') || null;

  const jsonImage = Array.isArray(product?.image)
    ? product?.image[0]
    : typeof product?.image === 'object'
      ? product?.image?.url
      : product?.image;
  const imageUrl = absoluteUrl(
    jsonImage || meta('meta[property="og:image"]') || meta('meta[name="twitter:image"]') || $('link[rel="image_src"]').attr('href'),
    pageUrl,
  );

  const priceMajor =
    parsePrice(offer?.price ?? offer?.lowPrice) ??
    parsePrice(meta('meta[property="product:price:amount"]')) ??
    parsePrice(meta('meta[property="og:price:amount"]')) ??
    parsePrice($('[itemprop="price"]').first().attr('content') ?? null);

  const currency =
    normaliseCurrency(offer?.priceCurrency) ??
    normaliseCurrency(meta('meta[property="product:price:currency"]')) ??
    normaliseCurrency(meta('meta[property="og:price:currency"]')) ??
    normaliseCurrency($('[itemprop="priceCurrency"]').first().attr('content') ?? null);

  const merchant =
    meta('meta[property="og:site_name"]') ||
    (typeof offer?.seller === 'object' ? offer?.seller?.name ?? null : null) ||
    new URL(pageUrl).hostname.replace(/^www\./, '');

  const priceMinor =
    priceMajor != null && currency && isSupportedCurrency(currency) ? toMinor(priceMajor, currency) : null;

  return {
    name: name ? name.slice(0, 140) : null,
    description: description ? description.slice(0, 1000) : null,
    imageUrl,
    priceMinor,
    currency: priceMinor != null ? currency : null,
    merchant: merchant ? merchant.slice(0, 80) : null,
    productUrl: pageUrl,
  };
}

export async function unfurlProductUrl(url: string): Promise<UnfurledProduct> {
  const cacheKey = `unfurl:${url}`;
  const cached = await cacheGet<UnfurledProduct>(cacheKey);
  if (cached) return cached;

  try {
    const response = await safeFetchText(url);
    if (response.status >= 400) throw new AppError('URL_UNFURL_FAILED');
    if (response.contentType && !/html|xml/i.test(response.contentType)) throw new AppError('URL_UNFURL_FAILED');
    const product = extractProduct(response.body, response.finalUrl);
    if (!product.name && !product.imageUrl) throw new AppError('URL_UNFURL_FAILED');
    await cacheSet(cacheKey, product, 6 * 3600);
    return product;
  } catch (error) {
    logger.info({ err: error, url }, 'unfurl failed');
    throw error instanceof AppError ? error : new AppError('URL_UNFURL_FAILED', { cause: error });
  }
}
