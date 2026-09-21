import type { CurrentUser, DeliveryAddressDto } from '@bday/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { Stack, router } from 'expo-router';
import { Alert, Linking, Share, View } from 'react-native';
import { Button, Card, Divider, InfoRow, InlineError, Row, Screen, Section, T, Toggle } from '../../src/components/ui';
import { api } from '../../src/lib/api';
import { useAuth } from '../../src/lib/auth';
import { WEB_URL } from '../../src/lib/config';
import { colors, radius, spacing } from '../../src/theme';

/**
 * The link-in-bio page: one link for an Instagram or TikTok bio that shows a
 * countdown and wishlist, and can take gifts from anyone holding it.
 */
export default function PublicPageSettings() {
  const { user, setUser } = useAuth();
  const privacy = user?.privacy;
  const url = `${WEB_URL}/@${user?.username ?? ''}`;
  const message = `My birthday wishlist: ${url}`;
  const addresses = useQuery({ queryKey: ['addresses'], queryFn: () => api.get<DeliveryAddressDto[]>('/addresses') });

  const save = useMutation({
    mutationFn: (patch: { publicPage?: boolean; publicGifting?: boolean }) => api.put<CurrentUser>('/users/me/privacy', patch),
    onSuccess: (updated) => setUser(updated),
  });

  const live = privacy?.publicPage ?? false;
  const gifting = privacy?.publicGifting ?? false;
  const needsAddress = gifting && addresses.data?.length === 0;

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Your birthday page' }} />

      <Card>
        <T variant="heading">One link for your bio</T>
        <T color={colors.textMuted} style={{ marginTop: 4 }}>
          Put this in your Instagram or TikTok bio. Anyone who opens it sees your countdown and wishlist — no account needed.
        </T>
        <View style={{ backgroundColor: colors.surfaceMuted, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md }}>
          <T variant="label" color={live ? colors.brand : colors.textFaint}>
            {url}
          </T>
        </View>
        <InlineError error={save.error} />
        <Toggle
          label="Publish my page"
          description={live ? 'Your page is live.' : 'Off — the link shows nothing.'}
          value={live}
          onChange={(value) => save.mutate({ publicPage: value, ...(value ? {} : { publicGifting: false }) })}
        />
      </Card>

      {live ? (
        <>
          <Section title="Share it">
            <Card>
              <View style={{ gap: spacing.sm }}>
                <Button icon="copy" title="Copy link" variant="secondary" onPress={() => void Clipboard.setStringAsync(url).then(() => Alert.alert('Copied', 'Paste it into your bio.'))} />
                <Button icon="chat" title="WhatsApp" variant="secondary" onPress={() => void Linking.openURL(`whatsapp://send?text=${encodeURIComponent(message)}`).catch(() => Alert.alert('WhatsApp is not installed'))} />
                <Button icon="share" title="More…" variant="secondary" onPress={() => void Share.share({ message, url })} />
              </View>
            </Card>
          </Section>

          <Section title="Gifts from the link">
            <Card>
              <Toggle
                label="Anyone with my link can gift me"
                description="Followers and friends of friends can claim things from your wishlist. Leave this off to keep gifting to people you are connected with."
                value={gifting}
                onChange={(value) => save.mutate({ publicGifting: value })}
              />
              <Divider />
              <InfoRow icon="shield" color={colors.textMuted}>
                Buyers never see your address, phone or birth year. Deliveries go to your saved address.
              </InfoRow>
              <InfoRow icon="secret" color={colors.textMuted}>
                You still never see who claimed what — the surprise holds.
              </InfoRow>
              {needsAddress ? (
                <>
                  <Divider />
                  <InfoRow icon="alert" color={colors.danger}>
                    Add a delivery address, or gifts bought from your link cannot be sent to you.
                  </InfoRow>
                  <Button small title="Add address" onPress={() => router.push('/settings/account')} style={{ marginTop: spacing.sm, alignSelf: 'flex-start' }} />
                </>
              ) : null}
            </Card>
          </Section>
        </>
      ) : null}

      <T variant="caption" color={colors.textFaint} style={{ marginTop: spacing.xl }} center>
        Your page shows your name, photo, city, bio, birthday countdown and wishlist. It never shows your phone number, email, age or address.
      </T>
    </Screen>
  );
}
