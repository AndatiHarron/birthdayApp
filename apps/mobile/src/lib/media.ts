import * as ImagePicker from 'expo-image-picker';
import { Alert } from 'react-native';
import { api, errorMessage } from './api';

type Kind = 'avatar' | 'wishlist' | 'card' | 'memory' | 'chat';

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
