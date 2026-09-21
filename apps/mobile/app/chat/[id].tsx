import { RealtimeEvent, type ChatMessageDto, type ConversationDto, type Paginated } from '@bday/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { VoicePlayer, VoiceRecorder } from '../../src/components/VoiceRecorder';
import { Button, Field, Icon, Loading, Row, T } from '../../src/components/ui';
import { api, errorMessage } from '../../src/lib/api';
import { useAuth } from '../../src/lib/auth';
import { pickAndUploadImage } from '../../src/lib/media';
import { emitTyping, useRealtimeRoom } from '../../src/lib/realtime';
import { colors, radius, spacing } from '../../src/theme';

type Pages = InfiniteData<Paginated<ChatMessageDto>, string | undefined>;

/** Chat with text, photos, voice notes and polls (spec §29). */
export default function Chat() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const conversation = useQuery({ queryKey: ['conversation', id], queryFn: () => api.get<ConversationDto>(`/conversations/${id}`) });
  const messages = useInfiniteQuery({
    queryKey: ['messages', id],
    queryFn: ({ pageParam }) => api.get<Paginated<ChatMessageDto>>(`/conversations/${id}/messages`, { cursor: pageParam, limit: 40 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const [text, setText] = useState('');
  const [typing, setTyping] = useState<string | null>(null);
  const [panel, setPanel] = useState<'none' | 'voice' | 'poll'>('none');
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState('');
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const upsert = (message: ChatMessageDto) =>
    queryClient.setQueryData<Pages>(['messages', id], (current) => {
      if (!current) return current;
      const exists = current.pages.some((page) => page.items.some((item) => item.id === message.id));
      const pages = current.pages.map((page, index) => ({
        ...page,
        items: exists ? page.items.map((item) => (item.id === message.id ? message : item)) : index === 0 ? [message, ...page.items] : page.items,
      }));
      return { ...current, pages };
    });

  useRealtimeRoom('conversation', id, {
    [RealtimeEvent.CHAT_MESSAGE_CREATED]: (envelope) => {
      const payload = envelope.payload as ChatMessageDto & { deleted?: boolean };
      if (payload.deleted) void messages.refetch();
      else upsert(payload);
      void api.post(`/conversations/${id}/read`).catch(() => undefined);
    },
    [RealtimeEvent.CHAT_TYPING]: (envelope) => {
      const payload = envelope.payload as { userId: string; isTyping: boolean };
      if (payload.userId === user?.id) return;
      const member = conversation.data?.members.find((entry) => entry.id === payload.userId);
      setTyping(payload.isTyping ? member?.displayName ?? 'Someone' : null);
    },
  });

  useEffect(() => {
    void api.post(`/conversations/${id}/read`).then(() => queryClient.invalidateQueries({ queryKey: ['conversations'] })).catch(() => undefined);
  }, [id, queryClient]);

  const send = useMutation({
    mutationFn: (body: { kind: 'TEXT' | 'IMAGE' | 'VOICE'; body?: string; mediaUrl?: string; durationSeconds?: number }) =>
      api.post<ChatMessageDto>(`/conversations/${id}/messages`, { ...body, clientId: `c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` }),
    onSuccess: upsert,
    onError: (error) => Alert.alert('Not sent', errorMessage(error)),
  });
  const poll = useMutation({
    mutationFn: () => api.post<ChatMessageDto>(`/conversations/${id}/polls`, { question: pollQuestion.trim(), options: pollOptions.split(',').map((option) => option.trim()).filter(Boolean) }),
    onSuccess: (message) => {
      upsert(message);
      setPanel('none');
      setPollQuestion('');
      setPollOptions('');
    },
    onError: (error) => Alert.alert('Poll not created', errorMessage(error)),
  });
  const vote = useMutation({ mutationFn: (input: { pollId: string; optionId: string }) => api.post<ChatMessageDto>(`/polls/${input.pollId}/vote`, { optionIds: [input.optionId] }), onSuccess: upsert });

  function onChange(value: string) {
    setText(value);
    emitTyping(id, true);
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => emitTyping(id, false), 2000);
  }

  function submitText() {
    const body = text.trim();
    if (!body) return;
    setText('');
    emitTyping(id, false);
    send.mutate({ kind: 'TEXT', body });
  }

  const items = messages.data?.pages.flatMap((page) => page.items) ?? [];
  const isSurprise = conversation.data?.type === 'SURPRISE_GROUP';

  return (
    <SafeAreaView edges={['bottom']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen
        options={{
          title: conversation.data?.title ?? 'Chat',
          headerRight: () =>
            conversation.data?.groupGiftId ? <Button small variant="ghost" icon="gift" title="Gift" onPress={() => router.push(`/group-gift/${conversation.data!.groupGiftId}`)} /> : conversation.data?.eventId ? <Button small variant="ghost" title="Event" onPress={() => router.push(`/event/${conversation.data!.eventId}`)} /> : null,
        }}
      />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
        {isSurprise ? (
          <View style={{ backgroundColor: colors.goldSoft, padding: spacing.sm }}>
            <T variant="caption" center>Secret planning group — the birthday person can’t see this chat.</T>
          </View>
        ) : null}
        {messages.isLoading ? <Loading /> : null}
        <FlatList
          inverted
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: spacing.md }}
          onEndReached={() => messages.hasNextPage && void messages.fetchNextPage()}
          renderItem={({ item }) => {
            const mine = item.sender?.id === user?.id;
            if (item.kind === 'SYSTEM') {
              return <T variant="caption" color={colors.textMuted} center style={{ marginVertical: spacing.sm }}>{item.body}</T>;
            }
            return (
              <View style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '82%', marginVertical: 3 }}>
                {!mine ? <T variant="caption" color={colors.textMuted}>{item.sender?.displayName}</T> : null}
                <View style={{ backgroundColor: mine ? colors.brand : colors.surface, borderRadius: radius.lg, padding: spacing.md, borderWidth: mine ? 0 : 1, borderColor: colors.border }}>
                  {item.kind === 'IMAGE' && item.mediaUrl ? <Image source={{ uri: item.mediaUrl }} style={{ width: 220, height: 220, borderRadius: radius.md }} contentFit="cover" /> : null}
                  {item.kind === 'VOICE' && item.mediaUrl ? <VoicePlayer url={item.mediaUrl} durationSeconds={item.durationSeconds} /> : null}
                  {item.poll ? (
                    <View style={{ gap: 6, minWidth: 220 }}>
                      <T variant="label" color={mine ? colors.white : colors.text}>{item.poll.question}</T>
                      {item.poll.options.map((option) => (
                        <Pressable key={option.id} onPress={() => vote.mutate({ pollId: item.poll!.id, optionId: option.id })} style={{ padding: 8, borderRadius: radius.sm, backgroundColor: option.votedByMe ? colors.brandSoft : colors.surfaceMuted }}>
                          <Row style={{ justifyContent: 'space-between' }}>
                            <Row gap={6}>{option.votedByMe ? <Icon name="check" size={14} color={colors.success} /> : null}<T>{option.label}</T></Row>
                            <T variant="label">{option.voteCount}</T>
                          </Row>
                        </Pressable>
                      ))}
                    </View>
                  ) : item.body && item.kind !== 'POLL' ? (
                    <T color={mine ? colors.white : colors.text}>{item.body}</T>
                  ) : null}
                  {!item.body && !item.mediaUrl && !item.poll ? <T color={mine ? colors.white : colors.textMuted} style={{ fontStyle: 'italic' }}>Message deleted</T> : null}
                </View>
                <T variant="caption" color={colors.textFaint} style={{ alignSelf: mine ? 'flex-end' : 'flex-start' }}>
                  {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </T>
              </View>
            );
          }}
        />
        {typing ? <T variant="caption" color={colors.textMuted} style={{ paddingHorizontal: spacing.lg }}>{typing} is typing…</T> : null}
        {panel === 'voice' ? (
          <View style={{ padding: spacing.md }}>
            <VoiceRecorder onRecorded={(voice) => { if (voice) { send.mutate({ kind: 'VOICE', mediaUrl: voice.url, durationSeconds: voice.durationSeconds }); setPanel('none'); } }} />
          </View>
        ) : null}
        {panel === 'poll' ? (
          <View style={{ padding: spacing.md, backgroundColor: colors.surface }}>
            <Field label="Question" value={pollQuestion} onChangeText={setPollQuestion} placeholder="Which gift should we get?" />
            <Field label="Options (comma separated)" value={pollOptions} onChangeText={setPollOptions} placeholder="AirPods, Watch, Spa day" />
            <Button small title="Create poll" loading={poll.isPending} disabled={!pollQuestion.trim() || pollOptions.split(',').filter((option) => option.trim()).length < 2} onPress={() => poll.mutate()} />
          </View>
        ) : null}
        <Row style={{ padding: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface }}>
          <Pressable accessibilityLabel="Send photo" onPress={() => void pickAndUploadImage('chat').then((url) => url && send.mutate({ kind: 'IMAGE', mediaUrl: url }))} style={{ padding: 8 }}>
            <Icon name="camera" size={22} color={colors.textMuted} />
          </Pressable>
          <Pressable accessibilityLabel="Voice note" onPress={() => setPanel(panel === 'voice' ? 'none' : 'voice')} style={{ padding: 8 }}>
            <Icon name="mic" size={22} color={colors.textMuted} />
          </Pressable>
          <Pressable accessibilityLabel="Poll" onPress={() => setPanel(panel === 'poll' ? 'none' : 'poll')} style={{ padding: 8 }}>
            <Icon name="chart" size={22} color={colors.textMuted} />
          </Pressable>
          <TextInput value={text} onChangeText={onChange} placeholder="Message" placeholderTextColor={colors.textFaint} multiline style={{ flex: 1, minHeight: 40, maxHeight: 120, backgroundColor: colors.surfaceMuted, borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingVertical: 8, color: colors.text }} />
          <Button small title="Send" disabled={!text.trim()} onPress={submitText} />
        </Row>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
