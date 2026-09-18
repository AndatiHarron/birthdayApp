import { toMajor, toMinor, type SupportedCurrency, type UnfurledProduct, type WishlistItemDto, type WishlistItemPriority } from '@bday/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Button, Card, Chip, Field, InlineError, Row, Screen, Section, T } from '../../src/components/ui';
import { api, fieldError } from '../../src/lib/api';
import { pickAndUploadImage } from '../../src/lib/media';
import { colors, radius, spacing } from '../../src/theme';

const PRIORITIES: Array<{ value: WishlistItemPriority; label: string }> = [
  { value: 'MUST_HAVE', label: '❤️ Must have' },
  { value: 'HIGH', label: '⭐ High' },
  { value: 'NICE_TO_HAVE', label: '🙂 Nice to have' },
];

/** Add or edit a wish — manually or by pasting a product link (spec §11). */
export default function WishlistItemForm() {
  const { wishlistId, itemId } = useLocalSearchParams<{ wishlistId?: string; itemId?: string }>();
  const queryClient = useQueryClient();
  const existing = useQuery({ queryKey: ['wishlist-item', itemId], queryFn: () => api.get<WishlistItemDto>(`/wishlist/items/${itemId}`), enabled: Boolean(itemId) });

  const [link, setLink] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState<SupportedCurrency>('KES');
  const [productUrl, setProductUrl] = useState('');
  const [merchant, setMerchant] = useState('');
  const [priority, setPriority] = useState<WishlistItemPriority>('NICE_TO_HAVE');
  const [size, setSize] = useState('');
  const [color, setColor] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState('');

  useEffect(() => {
    const item = existing.data;
    if (!item) return;
    setName(item.name);
    setDescription(item.description ?? '');
    setImageUrl(item.imageUrl);
    setCurrency(item.currency as SupportedCurrency);
    setPrice(item.priceMinor != null ? String(toMajor(item.priceMinor, item.currency as SupportedCurrency)) : '');
    setProductUrl(item.productUrl ?? '');
    setMerchant(item.merchant ?? '');
    setPriority(item.priority);
    setSize(item.size ?? '');
    setColor(item.color ?? '');
    setQuantity(item.quantity);
    setNotes(item.notes ?? '');
  }, [existing.data]);

  const unfurl = useMutation({
    mutationFn: (url: string) => api.post<UnfurledProduct>('/wishlist/unfurl', { url }),
    onSuccess: (product) => {
      // Suggestions only — everything stays editable before saving.
      if (product.name) setName(product.name);
      if (product.description) setDescription(product.description);
      if (product.imageUrl) setImageUrl(product.imageUrl);
      if (product.priceMinor != null && product.currency) {
        setCurrency(product.currency as SupportedCurrency);
        setPrice(String(toMajor(product.priceMinor, product.currency as SupportedCurrency)));
      }
      if (product.merchant) setMerchant(product.merchant);
      setProductUrl(product.productUrl);
    },
  });

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        description: description.trim() || null,
        imageUrl,
        priceMinor: price ? toMinor(Number(price.replace(/,/g, '')), currency) : null,
        currency,
        productUrl: productUrl.trim() || null,
        merchant: merchant.trim() || null,
        priority,
        size: size.trim() || null,
        color: color.trim() || null,
        quantity,
        notes: notes.trim() || null,
      };
      return itemId ? api.patch(`/wishlist/items/${itemId}`, body) : api.post('/wishlist/items', { ...body, wishlistId: wishlistId || undefined });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['wishlist'] });
      void queryClient.invalidateQueries({ queryKey: ['my-wishlists'] });
      router.back();
    },
  });

  return (
    <Screen>
      <Stack.Screen options={{ title: itemId ? 'Edit wish' : 'Add a wish' }} />
      {!itemId ? (
        <Card style={{ backgroundColor: colors.brandSoft, borderColor: colors.brandSoft, marginBottom: spacing.lg }}>
          <T variant="heading" color={colors.brandDark}>
            🔗 Paste a product link
          </T>
          <T color={colors.brandDark} style={{ marginBottom: spacing.md }}>
            We’ll fill in the name, photo and price for you.
          </T>
          <Field label="Link" autoCapitalize="none" keyboardType="url" value={link} onChangeText={setLink} placeholder="https://…" />
          <Button small title="Fetch details" loading={unfurl.isPending} disabled={!/^https?:\/\//i.test(link.trim())} onPress={() => unfurl.mutate(link.trim())} />
          <InlineError error={unfurl.error} />
        </Card>
      ) : null}

      <InlineError error={save.error} />
      <Pressable onPress={() => void pickAndUploadImage('wishlist').then((url) => url && setImageUrl(url))} style={{ height: 180, borderRadius: radius.lg, backgroundColor: colors.surfaceMuted, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg }}>
        {imageUrl ? <Image source={{ uri: imageUrl }} style={{ width: '100%', height: '100%' }} contentFit="cover" /> : <T color={colors.textMuted}>📷 Add a photo</T>}
      </Pressable>

      <Field label="What would you like?" value={name} onChangeText={setName} error={fieldError(save.error, 'name')} />
      <Row gap={spacing.md}>
        <View style={{ flex: 1 }}>
          <Field label={`Price (${currency})`} keyboardType="decimal-pad" value={price} onChangeText={setPrice} />
        </View>
        <View style={{ width: 110 }}>
          <Field label="Quantity" keyboardType="number-pad" value={String(quantity)} onChangeText={(value) => setQuantity(Math.max(1, Math.min(99, Number(value) || 1)))} />
        </View>
      </Row>
      <Row wrap style={{ marginBottom: spacing.md }}>
        {(['KES', 'USD', 'UGX', 'TZS'] as SupportedCurrency[]).map((code) => (
          <Chip key={code} label={code} selected={currency === code} onPress={() => setCurrency(code)} />
        ))}
      </Row>

      <Section title="Priority" style={{ marginTop: spacing.sm }}>
        <Row wrap>
          {PRIORITIES.map((option) => (
            <Chip key={option.value} label={option.label} selected={priority === option.value} onPress={() => setPriority(option.value)} />
          ))}
        </Row>
      </Section>

      <Section title="Details">
        <Row gap={spacing.md}>
          <View style={{ flex: 1 }}>
            <Field label="Size" value={size} onChangeText={setSize} />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Colour" value={color} onChangeText={setColor} />
          </View>
        </Row>
        <Field label="Description" multiline value={description} onChangeText={setDescription} />
        <Field label="Shop / preferred vendor" value={merchant} onChangeText={setMerchant} />
        <Field label="Product link" autoCapitalize="none" keyboardType="url" value={productUrl} onChangeText={setProductUrl} error={fieldError(save.error, 'productUrl')} />
        <Field label="Notes for gifters" multiline value={notes} onChangeText={setNotes} placeholder="The 128GB version, please 🙏" />
      </Section>

      <Button title={itemId ? 'Save changes' : 'Add to wishlist'} loading={save.isPending} disabled={!name.trim()} onPress={() => save.mutate()} style={{ marginTop: spacing.lg }} />
    </Screen>
  );
}
