import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Alert } from 'react-native';
import { Avatar, Button, EmptyState, ErrorState, Loading, Screen, T } from '../../src/components/ui';
import { api, errorMessage } from '../../src/lib/api';
import { useAuth } from '../../src/lib/auth';
import { colors, spacing } from '../../src/theme';

interface InvitePreview {
  code: string;
  inviter: { displayName: string; avatarUrl: string | null } | null;
  expired: boolean;
  alreadyAccepted: boolean;
}

/** Accepting an invitation link or QR code (spec §8). */
export default function AcceptInvite() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const { status } = useAuth();
  const queryClient = useQueryClient();
  const preview = useQuery({ queryKey: ['invite', code], queryFn: () => api.get<InvitePreview>(`/invites/${code}`) });
  const accept = useMutation({
    mutationFn: () => api.post('/auth/invites/redeem', { code }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['friends'] });
      void queryClient.invalidateQueries({ queryKey: ['birthdays'] });
      Alert.alert('Connected!');
      router.replace('/(tabs)');
    },
    onError: (error) => Alert.alert('Invite not accepted', errorMessage(error)),
  });

  if (preview.isLoading) return <Loading />;
  if (!preview.data) return <ErrorState error={preview.error} />;
  const invite = preview.data;

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Invitation' }} />
      {invite.expired || invite.alreadyAccepted ? (
        <EmptyState icon="hourglass" title={invite.alreadyAccepted ? 'This invite was already used' : 'This invite has expired'} />
      ) : (
        <>
          {invite.inviter ? <Avatar name={invite.inviter.displayName} uri={invite.inviter.avatarUrl} size={88} /> : null}
          <T variant="title" style={{ marginTop: spacing.lg }}>
            {invite.inviter?.displayName ?? 'A friend'} wants to celebrate your birthday
          </T>
          <T color={colors.textMuted} style={{ marginVertical: spacing.md }}>Connect to share birthdays, wishlists and surprises.</T>
          {status === 'signed-in' ? (
            <Button title="Accept invitation" loading={accept.isPending} onPress={() => accept.mutate()} />
          ) : (
            <Button title="Create an account to accept" onPress={() => router.replace('/(auth)/sign-up')} />
          )}
        </>
      )}
    </Screen>
  );
}
