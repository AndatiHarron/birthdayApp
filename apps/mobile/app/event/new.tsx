import type { EventDto, WishlistDto } from '@bday/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Stack, router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { FriendPicker } from '../../src/components/FriendPicker';
import { Button, Chip, Field, InlineError, Row, Screen, Section, T, Toggle } from '../../src/components/ui';
import { api, fieldError } from '../../src/lib/api';
import { pickAndUploadImage } from '../../src/lib/media';
import { colors, radius, spacing } from '../../src/theme';

/** Create a birthday event (spec §30). */
export default function NewEvent() {
  const wishlists = useQuery({ queryKey: ['my-wishlists'], queryFn: () => api.get<WishlistDto[]>('/wishlists/mine') });
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(() => new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10));
  const [time, setTime] = useState('18:00');
  const [venueName, setVenueName] = useState('');
  const [venueAddress, setVenueAddress] = useState('');
  const [cover, setCover] = useState<string | null>(null);
  const [wishlistId, setWishlistId] = useState<string | null>(null);
  const [guests, setGuests] = useState<string[]>([]);
  const [extraGuests, setExtraGuests] = useState('');
  const [plusOnes, setPlusOnes] = useState(false);
  const [chat, setChat] = useState(true);

  const startsAt = (() => {
    const parsed = new Date(`${date}T${time}:00`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  })();

  const create = useMutation({
    mutationFn: () =>
      api.post<EventDto>('/events', {
        name: name.trim(),
        description: description.trim() || null,
        startsAt: startsAt!.toISOString(),
        venueName: venueName.trim() || null,
        venueAddress: venueAddress.trim() || null,
        coverImageUrl: cover,
        wishlistId,
        guestUserIds: guests,
        guestNames: extraGuests.split(',').map((guest) => guest.trim()).filter(Boolean),
        allowPlusOnes: plusOnes,
        createGroupChat: chat,
      }),
    onSuccess: (event) => router.replace(`/event/${event.id}`),
  });

  return (
    <Screen>
      <Stack.Screen options={{ title: 'New event' }} />
      <InlineError error={create.error} />
      <Pressable onPress={() => void pickAndUploadImage('card').then((url) => url && setCover(url))} style={{ height: 150, borderRadius: radius.lg, backgroundColor: colors.brandSoft, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg }}>
        {cover ? <Image source={{ uri: cover }} style={{ width: '100%', height: '100%' }} contentFit="cover" /> : <T color={colors.brandDark}>Add a cover photo</T>}
      </Pressable>
      <Field label="Event name" value={name} onChangeText={setName} placeholder="Sarah’s 30th" error={fieldError(create.error, 'name')} />
      <Row gap={spacing.md}>
        <View style={{ flex: 1 }}><Field label="Date (YYYY-MM-DD)" value={date} onChangeText={setDate} /></View>
        <View style={{ width: 110 }}><Field label="Time" value={time} onChangeText={setTime} placeholder="18:00" /></View>
      </Row>
      <Field label="Venue" value={venueName} onChangeText={setVenueName} placeholder="The Alchemist, Westlands" />
      <Field label="Address" value={venueAddress} onChangeText={setVenueAddress} />
      <Field label="Description" multiline value={description} onChangeText={setDescription} />
      {wishlists.data?.length ? (
        <>
          <T variant="label" color={colors.textMuted} style={{ marginBottom: 6 }}>Gift registry</T>
          <Row wrap style={{ marginBottom: spacing.md }}>
            <Chip label="None" selected={!wishlistId} onPress={() => setWishlistId(null)} />
            {wishlists.data.map((list) => <Chip key={list.id} label={list.title} selected={wishlistId === list.id} onPress={() => setWishlistId(list.id)} />)}
          </Row>
        </>
      ) : null}
      <Toggle label="Guests can bring a plus-one" value={plusOnes} onChange={setPlusOnes} />
      <Toggle label="Create an event group chat" value={chat} onChange={setChat} />
      <Section title="Invite friends">
        <FriendPicker selected={guests} onChange={setGuests} />
        <Field label="Guests without the app (comma separated)" value={extraGuests} onChangeText={setExtraGuests} placeholder="Grandma, Uncle Joe" hint="You’ll get a personal RSVP link to share with each." style={{ marginTop: spacing.md }} />
      </Section>
      <Button title="Create event" loading={create.isPending} disabled={!name.trim() || !startsAt} onPress={() => create.mutate()} style={{ marginTop: spacing.xl }} />
    </Screen>
  );
}
