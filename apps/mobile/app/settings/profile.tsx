import { INTEREST_CATALOG, type CurrentUser, type PublicProfile } from '@bday/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { BirthdayPicker } from '../../src/components/DatePicker';
import { Avatar, Button, Card, Chip, Field, InlineError, Loading, Row, Screen, Section, T } from '../../src/components/ui';
import { api, fieldError } from '../../src/lib/api';
import { useAuth } from '../../src/lib/auth';
import { pickAndUploadImage } from '../../src/lib/media';
import { colors, spacing } from '../../src/theme';
import { interestIcon } from '../../src/lib/icons';

const list = (value: string) => value.split(',').map((item) => item.trim()).filter(Boolean);

/** Profile, birthday, interests and gift preferences (spec §5). */
export default function EditProfile() {
  const { user, setUser } = useAuth();
  const queryClient = useQueryClient();
  const profile = useQuery({ queryKey: ['profile', user?.id], queryFn: () => api.get<PublicProfile>(`/users/${user!.id}`), enabled: Boolean(user) });

  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [bio, setBio] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [city, setCity] = useState('');
  const [birthday, setBirthday] = useState<{ month: number; day: number; year: number | null }>({ month: 1, day: 1, year: null });
  const [interests, setInterests] = useState<string[]>([]);
  const [colorsFav, setColorsFav] = useState('');
  const [brands, setBrands] = useState('');
  const [dislikes, setDislikes] = useState('');
  const [allergies, setAllergies] = useState('');
  const [shirt, setShirt] = useState('');
  const [shoe, setShoe] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!user) return;
    setDisplayName(user.displayName);
    setUsername(user.username);
    setAvatarUrl(user.avatarUrl);
    if (user.birthday) setBirthday({ month: user.birthday.month, day: user.birthday.day, year: user.birthday.year });
  }, [user]);

  useEffect(() => {
    const data = profile.data;
    if (!data) return;
    setBio(data.bio ?? '');
    setInterests(data.interests.map((interest) => interest.slug));
    const prefs = data.giftPreferences;
    if (prefs) {
      setColorsFav(prefs.favoriteColors.join(', '));
      setBrands(prefs.favoriteBrands.join(', '));
      setDislikes(prefs.dislikes.join(', '));
      setAllergies(prefs.allergies.join(', '));
      setShirt(prefs.sizes.shirt ?? '');
      setShoe(prefs.sizes.shoe ?? '');
      setNotes(prefs.notes ?? '');
    }
  }, [profile.data]);

  const save = useMutation({
    mutationFn: () =>
      api.patch<CurrentUser>('/users/me', {
        displayName: displayName.trim(),
        ...(username !== user?.username ? { username: username.trim().toLowerCase() } : {}),
        bio: bio.trim() || null,
        avatarUrl,
        city: city.trim() || undefined,
        birthday,
        interests,
        giftPreferences: {
          favoriteColors: list(colorsFav),
          favoriteBrands: list(brands),
          dislikes: list(dislikes),
          allergies: list(allergies),
          sizes: { ...(shirt ? { shirt } : {}), ...(shoe ? { shoe } : {}) },
          notes: notes.trim() || null,
        },
      }),
    onSuccess: (updated) => {
      setUser(updated);
      void queryClient.invalidateQueries({ queryKey: ['me'] });
      void queryClient.invalidateQueries({ queryKey: ['profile'] });
      router.back();
    },
  });

  if (!user || profile.isLoading) return <Loading />;

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Edit profile' }} />
      <InlineError error={save.error} />
      <Pressable onPress={() => void pickAndUploadImage('avatar').then((url) => url && setAvatarUrl(url))} style={{ alignItems: 'center', marginBottom: spacing.lg }}>
        <Avatar name={displayName || '?'} uri={avatarUrl} size={96} />
        <T variant="label" color={colors.brand} style={{ marginTop: spacing.sm }}>Change photo</T>
      </Pressable>
      <Field label="Name" value={displayName} onChangeText={setDisplayName} error={fieldError(save.error, 'displayName')} />
      <Field label="Username" autoCapitalize="none" value={username} onChangeText={setUsername} error={fieldError(save.error, 'username')} />
      <Field label="Bio" multiline value={bio} onChangeText={setBio} maxLength={280} />
      <Field label="City" value={city} onChangeText={setCity} placeholder="Nairobi" hint="Used to find gifts that can be delivered near you." />

      <Section title="Birthday">
        <Card><BirthdayPicker value={birthday} onChange={setBirthday} /></Card>
      </Section>

      <Section title="Interests">
        <Row wrap>
          {INTEREST_CATALOG.map((interest) => (
            <Chip key={interest.slug} label={interest.label} icon={interestIcon(interest.slug)} selected={interests.includes(interest.slug)} onPress={() => setInterests(interests.includes(interest.slug) ? interests.filter((slug) => slug !== interest.slug) : [...interests, interest.slug])} />
          ))}
        </Row>
      </Section>

      <Section title="Gift preferences">
        <T variant="caption" color={colors.textMuted} style={{ marginBottom: spacing.md }}>Friends see these to pick better gifts.</T>
        <Row gap={spacing.md}>
          <View style={{ flex: 1 }}><Field label="Shirt size" value={shirt} onChangeText={setShirt} /></View>
          <View style={{ flex: 1 }}><Field label="Shoe size" value={shoe} onChangeText={setShoe} /></View>
        </Row>
        <Field label="Favourite colours" value={colorsFav} onChangeText={setColorsFav} placeholder="Lilac, black" />
        <Field label="Favourite brands" value={brands} onChangeText={setBrands} />
        <Field label="Not a fan of" value={dislikes} onChangeText={setDislikes} placeholder="Scented candles" />
        <Field label="Allergies" value={allergies} onChangeText={setAllergies} />
        <Field label="Anything else" multiline value={notes} onChangeText={setNotes} />
      </Section>

      <Button title="Save" loading={save.isPending} disabled={!displayName.trim()} onPress={() => save.mutate()} style={{ marginTop: spacing.xl }} />
    </Screen>
  );
}
