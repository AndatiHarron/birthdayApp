import { toMajor, toMinor, type ProductDto } from '@bday/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { Button, Chip, Field, InlineError, Loading, Row, Screen, Section, T, Toggle } from '../../src/components/ui';
import { api, errorMessage, fieldError } from '../../src/lib/api';
import { pickAndUploadImage } from '../../src/lib/media';
import { colors, radius, spacing } from '../../src/theme';

interface Category {
  id: string;
  slug: string;
  label: string;
  emoji: string | null;
}

/** Create or edit a listing. New and edited listings go to admin review. */
export default function VendorProduct() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const queryClient = useQueryClient();
  const categories = useQuery({ queryKey: ['categories'], queryFn: () => api.get<Category[]>('/categories') });
  const existing = useQuery({ queryKey: ['vendor-products'], queryFn: () => api.get<ProductDto[]>('/vendor/products'), enabled: Boolean(id), select: (rows) => rows.find((row) => row.id === id) });

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('');
  const [deliveryFee, setDeliveryFee] = useState('');
  const [deliveryEstimate, setDeliveryEstimate] = useState('');
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [tags, setTags] = useState('');
  const [personalizable, setPersonalizable] = useState(false);
  const [city, setCity] = useState('');
  const [area, setArea] = useState('');

  useEffect(() => {
    const product = existing.data;
    if (!product) return;
    setName(product.name);
    setDescription(product.description);
    setImages(product.images);
    setPrice(String(toMajor(product.priceMinor, 'KES')));
    setStock(product.stock == null ? '' : String(product.stock));
    setDeliveryFee(product.deliveryFeeMinor ? String(toMajor(product.deliveryFeeMinor, 'KES')) : '');
    setDeliveryEstimate(product.deliveryEstimate ?? '');
    setCategoryIds(product.categoryIds);
    setTags(product.tags.join(', '));
    setPersonalizable(product.isPersonalizable);
    setCity(product.location?.city ?? '');
    setArea(product.location?.area ?? '');
  }, [existing.data]);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        description: description.trim(),
        images,
        priceMinor: toMinor(Number(price), 'KES'),
        currency: 'KES',
        categoryIds,
        tags: tags.split(',').map((tag) => tag.trim().toLowerCase()).filter(Boolean),
        stock: stock === '' ? null : Number(stock),
        deliveryEstimate: deliveryEstimate.trim() || null,
        deliveryFeeMinor: deliveryFee ? toMinor(Number(deliveryFee), 'KES') : null,
        isPersonalizable: personalizable,
        city: city.trim() || null,
        area: area.trim() || null,
      };
      return id ? api.patch(`/vendor/products/${id}`, body) : api.post('/vendor/products', body);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['vendor-products'] });
      Alert.alert(id ? 'Saved' : 'Submitted', 'Your listing will appear once it’s approved.');
      router.back();
    },
  });
  const archive = useMutation({ mutationFn: () => api.delete(`/vendor/products/${id}`), onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['vendor-products'] }); router.back(); }, onError: (error) => Alert.alert('Error', errorMessage(error)) });

  if (id && existing.isLoading) return <Loading />;

  return (
    <Screen>
      <Stack.Screen options={{ title: id ? 'Edit product' : 'New product' }} />
      <InlineError error={save.error} />
      <ScrollView horizontal contentContainerStyle={{ gap: spacing.sm, marginBottom: spacing.lg }}>
        {images.map((url) => (
          <Pressable key={url} onLongPress={() => setImages(images.filter((image) => image !== url))}>
            <Image source={{ uri: url }} style={{ width: 96, height: 96, borderRadius: radius.md }} />
          </Pressable>
        ))}
        <Pressable onPress={() => void pickAndUploadImage('wishlist').then((url) => url && setImages([...images, url]))} style={{ width: 96, height: 96, borderRadius: radius.md, backgroundColor: colors.surfaceMuted, alignItems: 'center', justifyContent: 'center' }}>
          <T>📷 Add</T>
        </Pressable>
      </ScrollView>
      {fieldError(save.error, 'images') ? <T color={colors.danger}>{fieldError(save.error, 'images')}</T> : null}
      <Field label="Product name" value={name} onChangeText={setName} error={fieldError(save.error, 'name')} />
      <Field label="Description" multiline value={description} onChangeText={setDescription} error={fieldError(save.error, 'description')} />
      <Row gap={spacing.md}>
        <View style={{ flex: 1 }}><Field label="Price (KES)" keyboardType="decimal-pad" value={price} onChangeText={setPrice} error={fieldError(save.error, 'priceMinor')} /></View>
        <View style={{ flex: 1 }}><Field label="Stock (blank = made to order)" keyboardType="number-pad" value={stock} onChangeText={setStock} /></View>
      </Row>
      <Row gap={spacing.md}>
        <View style={{ flex: 1 }}><Field label="Delivery fee (KES)" keyboardType="decimal-pad" value={deliveryFee} onChangeText={setDeliveryFee} /></View>
        <View style={{ flex: 1 }}><Field label="Delivery time" value={deliveryEstimate} onChangeText={setDeliveryEstimate} placeholder="Same day" /></View>
      </Row>
      <Section title="Category">
        <Row wrap>
          {categories.data?.map((category) => (
            <Chip key={category.id} label={category.label} emoji={category.emoji} selected={categoryIds.includes(category.id)} onPress={() => setCategoryIds(categoryIds.includes(category.id) ? categoryIds.filter((value) => value !== category.id) : [...categoryIds, category.id])} />
          ))}
        </Row>
        {fieldError(save.error, 'categoryIds') ? <T color={colors.danger}>{fieldError(save.error, 'categoryIds')}</T> : null}
      </Section>
      <Field label="Tags (comma separated)" value={tags} onChangeText={setTags} placeholder="for_her, chocolate, romantic" hint="Use for_her, for_him, family, friends or colleagues to appear on those shelves." style={{ marginTop: spacing.md }} />
      <Row gap={spacing.md}>
        <View style={{ flex: 1 }}><Field label="City" value={city} onChangeText={setCity} /></View>
        <View style={{ flex: 1 }}><Field label="Area" value={area} onChangeText={setArea} /></View>
      </Row>
      <Toggle label="Can be personalised" description="Buyers can add text, e.g. a name on a cake." value={personalizable} onChange={setPersonalizable} />
      <Button title={id ? 'Save changes' : 'Submit for review'} loading={save.isPending} disabled={!name.trim() || !Number(price) || images.length === 0 || categoryIds.length === 0} onPress={() => save.mutate()} style={{ marginTop: spacing.lg }} />
      {id ? <Button variant="danger" title="Archive listing" onPress={() => Alert.alert('Archive this product?', undefined, [{ text: 'Cancel', style: 'cancel' }, { text: 'Archive', style: 'destructive', onPress: () => archive.mutate() }])} style={{ marginTop: spacing.md }} /> : null}
    </Screen>
  );
}
