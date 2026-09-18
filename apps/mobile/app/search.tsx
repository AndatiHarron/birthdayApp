import type { GlobalSearchResponse } from '@bday/shared';
import { useQuery } from '@tanstack/react-query';
import { Stack, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, TextInput } from 'react-native';
import { ProductCard } from '../src/components/gifting';
import { Avatar, Card, EmptyState, ErrorState, Loading, Row, Screen, Section, T } from '../src/components/ui';
import { api } from '../src/lib/api';
import { colors, radius, spacing } from '../src/theme';

/** Global search (spec §37): people, gifts, wishlists, events and shops. */
export default function Search() {
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setTerm(q.trim()), 350);
    return () => clearTimeout(timer);
  }, [q]);

  const results = useQuery({
    queryKey: ['search', term],
    queryFn: () => api.get<GlobalSearchResponse>('/search', { q: term, limit: 8 }),
    enabled: term.length >= 2,
  });
  const data = results.data;
  const empty = data && !data.people.length && !data.products.length && !data.wishlists.length && !data.events.length && !data.vendors.length;

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Search' }} />
      <TextInput
        autoFocus
        placeholder="People, gifts, shops, events…"
        placeholderTextColor={colors.textFaint}
        value={q}
        onChangeText={setQ}
        style={{ minHeight: 50, backgroundColor: colors.surface, borderRadius: radius.pill, paddingHorizontal: spacing.lg, borderWidth: 1, borderColor: colors.border, fontSize: 16, color: colors.text }}
      />
      {results.isFetching ? <Loading /> : null}
      {results.error ? <ErrorState error={results.error} /> : null}
      {empty ? <EmptyState emoji="🔍" title="No results" message="Try a name, @username, phone number or gift." /> : null}
      {data?.people.length ? (
        <Section title="People">
          {data.people.map((person) => (
            <Card key={person.id} onPress={() => router.push(`/person/${person.id}`)} style={{ marginBottom: spacing.sm }}>
              <Row gap={spacing.md}>
                <Avatar name={person.displayName} uri={person.avatarUrl} />
                <T variant="label" style={{ flex: 1 }}>
                  {person.displayName} <T color={colors.textMuted}>@{person.username}</T>
                </T>
                {person.friendship?.status === 'ACCEPTED' ? <T variant="caption" color={colors.success}>Friends</T> : null}
              </Row>
            </Card>
          ))}
        </Section>
      ) : null}
      {data?.products.length ? (
        <Section title="Gifts">
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.md }}>
            {data.products.map((product) => (
              <ProductCard key={product.id} product={product} width={150} onPress={() => router.push(`/product/${product.id}`)} />
            ))}
          </ScrollView>
        </Section>
      ) : null}
      {data?.wishlists.length ? (
        <Section title="Wishlists">
          {data.wishlists.map((wishlist) => (
            <Card key={wishlist.id} onPress={() => router.push(`/wishlist-share/${wishlist.shareSlug}`)} style={{ marginBottom: spacing.sm }}>
              <T variant="label">💝 {wishlist.title}</T>
              <T color={colors.textMuted}>by {wishlist.owner}</T>
            </Card>
          ))}
        </Section>
      ) : null}
      {data?.events.length ? (
        <Section title="Events">
          {data.events.map((event) => (
            <Card key={event.id} onPress={() => router.push(`/event/${event.id}`)} style={{ marginBottom: spacing.sm }}>
              <T variant="label">🎉 {event.name}</T>
              <T color={colors.textMuted}>{new Date(event.startsAt).toLocaleString()}</T>
            </Card>
          ))}
        </Section>
      ) : null}
      {data?.vendors.length ? (
        <Section title="Shops">
          {data.vendors.map((vendor) => (
            <Card key={vendor.id} style={{ marginBottom: spacing.sm }}>
              <T variant="label">🏪 {vendor.name}</T>
              <T color={colors.textMuted}>{[vendor.area, vendor.city].filter(Boolean).join(', ')}{vendor.rating ? ` · ⭐ ${vendor.rating.toFixed(1)}` : ''}</T>
            </Card>
          ))}
        </Section>
      ) : null}
    </Screen>
  );
}
