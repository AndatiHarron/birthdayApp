import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable } from 'react-native';
import { Button, Field, Icon, InlineError, Row, Screen, T } from '../src/components/ui';
import { api } from '../src/lib/api';
import { colors, spacing } from '../src/theme';

/** Review a product you bought (spec §17). The API only accepts verified buyers. */
export default function Review() {
  const { productId } = useLocalSearchParams<{ productId: string }>();
  const queryClient = useQueryClient();
  const [rating, setRating] = useState(5);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const submit = useMutation({
    mutationFn: () => api.post(`/products/${productId}/reviews`, { rating, title: title.trim() || null, body: body.trim() || null }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['reviews', productId] });
      router.back();
    },
  });

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Write a review' }} />
      <InlineError error={submit.error} />
      <T variant="label" color={colors.textMuted}>
        Rating
      </T>
      <Row style={{ marginVertical: spacing.md }}>
        {[1, 2, 3, 4, 5].map((value) => (
          <Pressable key={value} onPress={() => setRating(value)} accessibilityLabel={`${value} stars`}>
            <Icon name="star" size={36} color={value <= rating ? colors.gold : colors.border} fill={value <= rating ? colors.gold : 'none'} />
          </Pressable>
        ))}
      </Row>
      <Field label="Title" value={title} onChangeText={setTitle} />
      <Field label="Your review" multiline value={body} onChangeText={setBody} />
      <Button title="Submit review" loading={submit.isPending} onPress={() => submit.mutate()} />
    </Screen>
  );
}
