import type { Visibility, WishlistDto } from '@bday/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Linking, Share, View } from 'react-native';
import { Button, Card, Chip, ErrorState, Field, InlineError, Loading, Row, Screen, Section, T } from '../../src/components/ui';
import { api, errorMessage } from '../../src/lib/api';
import { colors, spacing } from '../../src/theme';

interface ShareInfo {
  shareUrl: string;
  qrDataUrl: string;
  message: string;
  visibility: Visibility;
}

/** Wishlist visibility and sharing (spec §12): WhatsApp, SMS, email, link, QR. */
export default function WishlistSettings() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const wishlist = useQuery({ queryKey: ['wishlist', id], queryFn: () => api.get<WishlistDto>(`/wishlists/${id}`) });
  const share = useQuery({ queryKey: ['wishlist-share', id], queryFn: () => api.get<ShareInfo>(`/wishlists/${id}/share`) });
  const [title, setTitle] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('FRIENDS');

  useEffect(() => {
    if (wishlist.data) {
      setTitle(wishlist.data.title);
      setVisibility(wishlist.data.visibility);
    }
  }, [wishlist.data]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['wishlist', id] });
    void queryClient.invalidateQueries({ queryKey: ['wishlist-share', id] });
    void queryClient.invalidateQueries({ queryKey: ['my-wishlists'] });
  };

  const save = useMutation({ mutationFn: () => api.patch(`/wishlists/${id}`, { title: title.trim(), visibility }), onSuccess: invalidate });
  const rotate = useMutation({ mutationFn: () => api.post(`/wishlists/${id}/share/rotate`), onSuccess: invalidate, onError: (error) => Alert.alert('Error', errorMessage(error)) });
  const createList = useMutation({
    mutationFn: () => api.post<WishlistDto>('/wishlists', { title: 'New wishlist', visibility: 'FRIENDS' }),
    onSuccess: (created) => {
      invalidate();
      router.replace({ pathname: '/wishlist/settings', params: { id: created.id } });
    },
    onError: (error) => Alert.alert('Could not create', errorMessage(error)),
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`/wishlists/${id}`),
    onSuccess: () => {
      invalidate();
      router.back();
    },
    onError: (error) => Alert.alert('Could not delete', errorMessage(error)),
  });

  if (wishlist.isLoading) return <Loading />;
  if (!wishlist.data) return <ErrorState error={wishlist.error} />;
  const message = share.data?.message ?? '';
  const url = share.data?.shareUrl ?? '';

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Wishlist settings' }} />
      <InlineError error={save.error} />
      <Field label="Name" value={title} onChangeText={setTitle} />
      <T variant="label" color={colors.textMuted} style={{ marginBottom: 6 }}>
        Who can see it
      </T>
      <Row wrap>
        <Chip icon="globe" label="Anyone with the link" selected={visibility === 'PUBLIC'} onPress={() => setVisibility('PUBLIC')} />
        <Chip icon="users" label="Friends" selected={visibility === 'FRIENDS'} onPress={() => setVisibility('FRIENDS')} />
        <Chip icon="lock" label="Only me" selected={visibility === 'PRIVATE'} onPress={() => setVisibility('PRIVATE')} />
      </Row>
      <T variant="caption" color={colors.textMuted} style={{ marginTop: 6 }}>
        Your global wishlist privacy setting also applies — the stricter of the two wins.
      </T>
      <Button title="Save" loading={save.isPending} onPress={() => save.mutate()} style={{ marginTop: spacing.lg }} />

      <Section title="Share">
        <Card style={{ alignItems: 'center' }}>
          {share.data?.qrDataUrl ? <Image source={{ uri: share.data.qrDataUrl }} style={{ width: 200, height: 200 }} /> : <Loading />}
          <T variant="caption" color={colors.textMuted} style={{ marginVertical: spacing.sm }} center>
            {url}
          </T>
          <View style={{ gap: spacing.sm, width: '100%' }}>
            <Button icon="chat" title="WhatsApp" variant="secondary" onPress={() => void Linking.openURL(`whatsapp://send?text=${encodeURIComponent(message)}`).catch(() => Alert.alert('WhatsApp is not installed'))} />
            <Button icon="chat" title="SMS" variant="secondary" onPress={() => void Linking.openURL(`sms:?&body=${encodeURIComponent(message)}`)} />
            <Button icon="mail" title="Email" variant="secondary" onPress={() => void Linking.openURL(`mailto:?subject=${encodeURIComponent('My birthday wishlist')}&body=${encodeURIComponent(message)}`)} />
            <Button icon="list" title="Copy link" variant="secondary" onPress={() => void Clipboard.setStringAsync(url).then(() => Alert.alert('Link copied'))} />
            <Button icon="share" title="More…" variant="secondary" onPress={() => void Share.share({ message, url })} />
          </View>
        </Card>
        <Button small variant="ghost" title="Reset link (old links stop working)" loading={rotate.isPending} onPress={() => rotate.mutate()} style={{ marginTop: spacing.md }} />
      </Section>

      <Section title="More">
        <Row wrap>
          <Button small variant="secondary" title="＋ New wishlist" loading={createList.isPending} onPress={() => createList.mutate()} />
          {!wishlist.data.isDefault ? (
            <Button small variant="danger" title="Delete wishlist" onPress={() => Alert.alert('Delete this wishlist?', 'Its items will be removed.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => remove.mutate() }])} />
          ) : null}
        </Row>
      </Section>
    </Screen>
  );
}
