import { GIFT_SHELVES, type Paginated, type ProductDto } from '@bday/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ProductCard } from '../../src/components/gifting';
import { Button, Chip, EmptyState, ErrorState, Row, T } from '../../src/components/ui';
import { api } from '../../src/lib/api';
import { colors, radius, spacing } from '../../src/theme';
import { shelfIcon } from '../../src/lib/icons';

/** Gift discovery (spec §46): shelves, search, filters and the AI finder. */
export default function Gifts() {
  const [shelf, setShelf] = useState<string>('popular');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [city, setCity] = useState('');
  const [sort, setSort] = useState<'RELEVANCE' | 'PRICE_ASC' | 'PRICE_DESC' | 'RATING'>('RELEVANCE');

  const products = useInfiniteQuery({
    queryKey: ['products', shelf, search, city, sort],
    queryFn: ({ pageParam }) =>
      api.get<Paginated<ProductDto>>('/products', {
        shelf: search ? undefined : shelf,
        q: search || undefined,
        city: city || undefined,
        sort,
        cursor: pageParam,
        limit: 20,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = products.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        numColumns={2}
        columnWrapperStyle={{ gap: spacing.md, paddingHorizontal: spacing.lg }}
        contentContainerStyle={{ gap: spacing.lg, paddingBottom: spacing.xxl }}
        onEndReached={() => products.hasNextPage && !products.isFetchingNextPage && void products.fetchNextPage()}
        onEndReachedThreshold={0.4}
        refreshing={products.isRefetching}
        onRefresh={() => void products.refetch()}
        ListHeaderComponent={
          <View style={{ padding: spacing.lg, paddingBottom: 0 }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <T variant="title">Gifts</T>
              <Row>
                <Button small variant="secondary" icon="package" title="Orders" onPress={() => router.push('/orders')} />
              </Row>
            </Row>
            <Pressable onPress={() => router.push('/gift-finder')} style={{ marginTop: spacing.md, backgroundColor: colors.brandSoft, borderRadius: radius.lg, padding: spacing.lg }}>
              <T variant="heading" color={colors.brandDark}>
                Smart gift finder
              </T>
              <T color={colors.brandDark}>“A gift for my brother, 28, loves gaming, KES 7,000” — ask in your own words.</T>
            </Pressable>
            <TextInput
              placeholder="Search gifts, cakes, flowers…"
              placeholderTextColor={colors.textFaint}
              value={q}
              onChangeText={setQ}
              onSubmitEditing={() => setSearch(q.trim())}
              returnKeyType="search"
              style={{ marginTop: spacing.md, minHeight: 48, backgroundColor: colors.surface, borderRadius: radius.pill, paddingHorizontal: spacing.lg, borderWidth: 1, borderColor: colors.border, fontSize: 15, color: colors.text }}
            />
            {!search ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingVertical: spacing.md }}>
                {GIFT_SHELVES.map((item) => (
                  <Chip key={item.key} label={item.key.startsWith('under') ? `KES ${item.label}` : item.label} icon={shelfIcon(item.key)} selected={shelf === item.key} onPress={() => setShelf(item.key)} />
                ))}
              </ScrollView>
            ) : (
              <Row style={{ marginVertical: spacing.md }}>
                <T color={colors.textMuted} style={{ flex: 1 }}>
                  Results for “{search}”
                </T>
                <Chip label="Clear" onPress={() => { setSearch(''); setQ(''); }} />
              </Row>
            )}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingBottom: spacing.md }}>
              {(['RELEVANCE', 'PRICE_ASC', 'PRICE_DESC', 'RATING'] as const).map((option) => (
                <Chip key={option} label={{ RELEVANCE: 'Best match', PRICE_ASC: 'Price ↑', PRICE_DESC: 'Price ↓', RATING: 'Top rated' }[option]} selected={sort === option} onPress={() => setSort(option)} />
              ))}
              {['Nairobi', 'Westlands', 'Kilimani', 'Mombasa'].map((place) => (
                <Chip key={place} icon="mapPin" label={place} selected={city === place} onPress={() => setCity(city === place ? '' : place)} />
              ))}
            </ScrollView>
            {products.error && items.length === 0 ? <ErrorState error={products.error} onRetry={() => void products.refetch()} /> : null}
            {products.isLoading ? <ActivityIndicator color={colors.brand} style={{ marginTop: spacing.xl }} /> : null}
            {!products.isLoading && items.length === 0 && !products.error ? (
              <EmptyState icon="bag" title="No gifts here yet" message="Try another shelf, or ask the smart gift finder." />
            ) : null}
          </View>
        }
        renderItem={({ item }) => (
          <View style={{ flex: 1 }}>
            <ProductCard product={item} width="fill"onPress={() => router.push(`/product/${item.id}`)} />
          </View>
        )}
        ListFooterComponent={products.isFetchingNextPage ? <ActivityIndicator color={colors.brand} /> : null}
      />
    </SafeAreaView>
  );
}
