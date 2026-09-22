import * as ImagePicker from 'expo-image-picker';
import { Alert } from 'react-native';
import { api, errorMessage } from './api';

type Kind = 'avatar' | 'cover' | 'wishlist' | 'card' | 'memory' | 'chat' | 'wish';

export interface PickedMedia {
  url: string;
  /** GIFs stay their own kind so the wish wall can label and loop them. */
  kind: 'IMAGE' | 'GIF' | 'VIDEO';
  durationSeconds: number | null;
}

/**
 * Picks a photo, an animated GIF or a short video for a birthday wish, and
 * uploads it. Videos are capped so a wish stays watchable in one screen.
 */
export async function pickAndUploadWishMedia(options: { video?: boolean; camera?: boolean; maxSeconds?: number } = {}): Promise<PickedMedia | null> {
  const maxSeconds = options.maxSeconds ?? 60;
  const permission = options.camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    Alert.alert(options.camera ? 'Camera access needed' : 'Photos access needed', 'Allow access in Settings to add this to your wish.');
    return null;
  }
  const config: ImagePicker.ImagePickerOptions = {
    mediaTypes: options.video ? ['videos'] : ['images'],
    quality: 0.8,
    videoMaxDuration: maxSeconds,
  };
  const result = options.camera ? await ImagePicker.launchCameraAsync(config) : await ImagePicker.launchImageLibraryAsync(config);
  if (result.canceled || !result.assets[0]) return null;

  const asset = result.assets[0];
  const isVideo = asset.type === 'video';
  const mime = asset.mimeType ?? (isVideo ? 'video/mp4' : 'image/jpeg');
  if (isVideo && asset.duration != null && asset.duration / 1000 > maxSeconds + 1) {
    Alert.alert('Video too long', `Keep it under ${maxSeconds} seconds so it plays in one go.`);
    return null;
  }

  try {
    const uploaded = await api.upload('wish', {
      uri: asset.uri,
      name: asset.fileName ?? `wish-${Date.now()}.${isVideo ? 'mp4' : mime.split('/')[1] ?? 'jpg'}`,
      type: mime,
    });
    return {
      url: uploaded.url,
      kind: isVideo ? 'VIDEO' : mime === 'image/gif' ? 'GIF' : 'IMAGE',
      durationSeconds: asset.duration != null ? Math.max(1, Math.round(asset.duration / 1000)) : null,
    };
  } catch (error) {
    Alert.alert('Upload failed', errorMessage(error));
    return null;
  }
}

/** Lets the user pick a photo, uploads it, and returns its public URL. */
export async function pickAndUploadImage(kind: Kind, options: { allowsEditing?: boolean } = {}): Promise<string | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    Alert.alert('Photos access needed', 'Allow photo access in Settings to add a picture.');
    return null;
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: options.allowsEditing ?? kind === 'avatar',
    aspect: kind === 'avatar' ? [1, 1] : undefined,
    quality: 0.8,
  });
  if (result.canceled || !result.assets[0]) return null;
  const asset = result.assets[0];
  try {
    const uploaded = await api.upload(kind, {
      uri: asset.uri,
      name: asset.fileName ?? `photo-${Date.now()}.jpg`,
      type: asset.mimeType ?? 'image/jpeg',
    });
    return uploaded.url;
  } catch (error) {
    Alert.alert('Upload failed', errorMessage(error));
    return null;
  }
}

export async function uploadFile(kind: 'voice' | 'memory' | 'chat', file: { uri: string; name: string; type: string }): Promise<string> {
  const uploaded = await api.upload(kind, file);
  return uploaded.url;
}
