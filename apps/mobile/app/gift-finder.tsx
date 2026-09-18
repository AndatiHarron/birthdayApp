import { toMinor, type GiftRefinement, type GiftSuggestionResponse } from '@bday/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { money } from '../src/components/gifting';
import { Avatar, Button, Card, Chip, InlineError, Loading, Row, T } from '../src/components/ui';
import { api } from '../src/lib/api';
import { useRecipient } from '../src/lib/recipient';
import { colors, radius, spacing } from '../src/theme';

const REFINEMENT_LABELS: Record<GiftRefinement, string> = {
  CHEAPER: '💸 Show cheaper',
  PREMIUM: '💎 Show premium',
  ROMANTIC: '❤️ Something romantic',
  FUNNY: '😂 Something funny',
  UNEXPECTED: '🤯 Something unexpected',
  MORE_LIKE_THIS: '➕ More like these',
  SURPRISE_ME: '🎲 Surprise me',
};

interface Turn {
  role: 'user' | 'assistant';
  text?: string;
  response?: GiftSuggestionResponse;
}

/** Smart gift finder (spec §19, §47): a conversation grounded in real gifts. */
export default function GiftFinder() {
  const params = useLocalSearchParams<{ userId?: string; birthdayId?: string; name?: string }>();
  const { recipient } = useRecipient(params);
  const status = useQuery({ queryKey: ['ai-status'], queryFn: () => api.get<{ available: boolean }>('/ai/status') });
  const [prompt, setPrompt] = useState('');
  const [budget, setBudget] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const conversationId = useRef<string | undefined>(undefined);
  const scroll = useRef<ScrollView>(null);

  const ask = useMutation({
    mutationFn: (input: { prompt?: string; refinement?: GiftRefinement }) =>
      api.post<GiftSuggestionResponse>('/ai/gift-suggestions', {
        ...(recipient?.birthdayId ? { trackedBirthdayId: recipient.birthdayId } : recipient?.userId ? { recipientUserId: recipient.userId } : {}),
        prompt: input.prompt,
        refinement: input.refinement,
        budgetMaxMinor: budget ? toMinor(Number(budget.replace(/,/g, '')), 'KES') : undefined,
        currency: 'KES',
        conversationId: conversationId.current,
        limit: 5,
      }),
    onMutate: (input) => {
      setTurns((current) => [...current, { role: 'user', text: input.prompt ?? REFINEMENT_LABELS[input.refinement!] }]);
      setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 50);
    },
    onSuccess: (response) => {
      conversationId.current = response.conversationId;
      setTurns((current) => [...current, { role: 'assistant', response }]);
      setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 100);
    },
  });

  function submit() {
    const text = prompt.trim();
    if (!text && !recipient) return;
    setPrompt('');
    ask.mutate({ prompt: text || `Birthday gift ideas for ${recipient?.name}` });
  }

  const last = [...turns].reverse().find((turn) => turn.response)?.response;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ title: '✨ Smart gift finder' }} />
      <ScrollView ref={scroll} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}>
        {recipient ? (
          <Row gap={spacing.md} style={{ marginBottom: spacing.lg }}>
            <Avatar name={recipient.name} uri={recipient.avatarUrl} />
            <T variant="heading">Ideas for {recipient.name}</T>
          </Row>
        ) : null}
        {status.data && !status.data.available ? (
          <Card style={{ backgroundColor: colors.goldSoft, borderColor: colors.goldSoft, marginBottom: spacing.md }}>
            <T>The AI assistant isn’t configured on this server yet. Browse gift shelves or wishlists in the meantime.</T>
          </Card>
        ) : null}
        {turns.length === 0 ? (
          <Card>
            <T variant="heading">Tell me about them</T>
            <T color={colors.textMuted} style={{ marginTop: 4 }}>
              For example: “I need a birthday gift for my brother. He’s 28, loves gaming and football, and I have KES 7,000.”
            </T>
          </Card>
        ) : null}
        {turns.map((turn, index) =>
          turn.role === 'user' ? (
            <View key={index} style={{ alignSelf: 'flex-end', backgroundColor: colors.brand, borderRadius: radius.lg, padding: spacing.md, marginVertical: spacing.sm, maxWidth: '85%' }}>
              <T color={colors.white}>{turn.text}</T>
            </View>
          ) : (
            <View key={index} style={{ marginVertical: spacing.sm }}>
              <T style={{ marginBottom: spacing.sm }}>{turn.response?.intro}</T>
              {turn.response?.suggestions.map((suggestion) => (
                <Card key={`${index}-${suggestion.rank}`} style={{ marginBottom: spacing.sm }} onPress={() => (suggestion.product ? router.push(`/product/${suggestion.product.id}`) : undefined)}>
                  <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <T variant="heading" style={{ flex: 1 }}>
                      {suggestion.rank}. {suggestion.name}
                    </T>
                    <T variant="label" color={colors.brand}>
                      {money(suggestion.product?.priceMinor ?? suggestion.estimatedPriceMinor, suggestion.currency)}
                    </T>
                  </Row>
                  <T color={colors.textMuted} style={{ marginTop: 4 }}>
                    {suggestion.reason}
                  </T>
                  {suggestion.wishlistItemId ? <T variant="caption" color={colors.pink}>💝 It’s on their wishlist</T> : null}
                  {suggestion.product ? (
                    <T variant="caption" color={colors.success} style={{ marginTop: 4 }}>
                      🛍️ Available from {suggestion.product.vendor.name} — tap to buy
                    </T>
                  ) : null}
                </Card>
              ))}
              <T variant="caption" color={colors.textFaint}>
                {turn.response?.quotaRemaining} suggestions left today
              </T>
            </View>
          ),
        )}
        {ask.isPending ? <Loading label="Thinking of gifts…" /> : null}
        <InlineError error={ask.error} />
        {last ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, marginTop: spacing.md }}>
            {last.followUps.concat(['ROMANTIC', 'FUNNY']).filter((value, i, all) => all.indexOf(value) === i).map((refinement) => (
              <Chip key={refinement} label={REFINEMENT_LABELS[refinement]} onPress={() => ask.mutate({ refinement })} />
            ))}
          </ScrollView>
        ) : null}
      </ScrollView>
      <View style={{ padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface, gap: spacing.sm }}>
        <Row>
          <TextInput placeholder="Budget KES (optional)" keyboardType="number-pad" value={budget} onChangeText={setBudget} placeholderTextColor={colors.textFaint} style={{ flex: 1, minHeight: 40, borderRadius: radius.md, backgroundColor: colors.surfaceMuted, paddingHorizontal: spacing.md, color: colors.text }} />
        </Row>
        <Row>
          <TextInput
            placeholder={recipient ? `Anything else about ${recipient.name.split(' ')[0]}?` : 'Who is the gift for?'}
            value={prompt}
            onChangeText={setPrompt}
            onSubmitEditing={submit}
            placeholderTextColor={colors.textFaint}
            multiline
            style={{ flex: 1, minHeight: 44, maxHeight: 120, borderRadius: radius.md, backgroundColor: colors.surfaceMuted, paddingHorizontal: spacing.md, paddingVertical: 10, color: colors.text }}
          />
          <Button small title="Ask" loading={ask.isPending} disabled={!prompt.trim() && !recipient} onPress={submit} />
        </Row>
      </View>
    </View>
  );
}
