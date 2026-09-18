import type { DeliveryAddressDto, DeliveryAddressInput } from '@bday/shared';
import type { DeliveryAddress } from '@prisma/client';
import { AppError } from '../lib/errors';
import { prisma } from '../lib/prisma';

/** Saved delivery addresses (spec §18). Soft-deleted so past orders keep context. */

export function toAddressDto(address: DeliveryAddress): DeliveryAddressDto {
  return {
    id: address.id,
    label: address.label,
    recipientName: address.recipientName,
    phone: address.phone,
    addressLine1: address.addressLine1,
    addressLine2: address.addressLine2,
    city: address.city,
    area: address.area,
    country: address.countryCode,
    latitude: address.latitude,
    longitude: address.longitude,
    instructions: address.instructions,
    isDefault: address.isDefault,
  };
}

export async function listAddresses(userId: string): Promise<DeliveryAddressDto[]> {
  const rows = await prisma.deliveryAddress.findMany({
    where: { userId, deletedAt: null },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
  });
  return rows.map(toAddressDto);
}

export async function createAddress(userId: string, input: DeliveryAddressInput): Promise<DeliveryAddressDto> {
  const row = await prisma.$transaction(async (tx) => {
    const count = await tx.deliveryAddress.count({ where: { userId, deletedAt: null } });
    if (count >= 20) {
      throw new AppError('CONFLICT', { message: 'You can save up to 20 addresses.' });
    }
    // The first address is the default whether or not the client asked.
    const isDefault = input.isDefault || count === 0;
    if (isDefault) {
      await tx.deliveryAddress.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } });
    }
    return tx.deliveryAddress.create({
      data: {
        userId,
        label: input.label,
        recipientName: input.recipientName,
        phone: input.phone ?? null,
        addressLine1: input.addressLine1,
        addressLine2: input.addressLine2 ?? null,
        city: input.city,
        area: input.area ?? null,
        countryCode: input.countryCode,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        instructions: input.instructions ?? null,
        isDefault,
      },
    });
  });
  return toAddressDto(row);
}

export async function updateAddress(
  userId: string,
  addressId: string,
  input: Partial<DeliveryAddressInput>,
): Promise<DeliveryAddressDto> {
  const existing = await prisma.deliveryAddress.findFirst({ where: { id: addressId, userId, deletedAt: null } });
  if (!existing) throw new AppError('NOT_FOUND', { message: 'That address could not be found.' });

  const row = await prisma.$transaction(async (tx) => {
    if (input.isDefault) {
      await tx.deliveryAddress.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } });
    }
    return tx.deliveryAddress.update({
      where: { id: addressId },
      data: {
        ...(input.label !== undefined ? { label: input.label } : {}),
        ...(input.recipientName !== undefined ? { recipientName: input.recipientName } : {}),
        ...(input.phone !== undefined ? { phone: input.phone ?? null } : {}),
        ...(input.addressLine1 !== undefined ? { addressLine1: input.addressLine1 } : {}),
        ...(input.addressLine2 !== undefined ? { addressLine2: input.addressLine2 ?? null } : {}),
        ...(input.city !== undefined ? { city: input.city } : {}),
        ...(input.area !== undefined ? { area: input.area ?? null } : {}),
        ...(input.countryCode !== undefined ? { countryCode: input.countryCode } : {}),
        ...(input.latitude !== undefined ? { latitude: input.latitude ?? null } : {}),
        ...(input.longitude !== undefined ? { longitude: input.longitude ?? null } : {}),
        ...(input.instructions !== undefined ? { instructions: input.instructions ?? null } : {}),
        ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
      },
    });
  });
  return toAddressDto(row);
}

export async function deleteAddress(userId: string, addressId: string): Promise<void> {
  const result = await prisma.deliveryAddress.updateMany({
    where: { id: addressId, userId, deletedAt: null },
    data: { deletedAt: new Date(), isDefault: false },
  });
  if (result.count === 0) throw new AppError('NOT_FOUND', { message: 'That address could not be found.' });
}
