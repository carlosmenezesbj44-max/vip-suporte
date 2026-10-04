import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Image, View, Text, FlatList, TextInput, Button, StyleSheet, TouchableOpacity } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL, api } from '../lib/api';
import { getTicketsSocket } from '../lib/socket';
import { TicketStatus, type Ticket, type TicketAttachment, type TicketMessage } from '@canal-direto/shared';

type PendingAttachment = { uri: string; name: string; mimeType?: string | null; size?: number | null };

function AttachmentPreview({ ticketId, attachment }: { ticketId: string; attachment: TicketAttachment }) {
  const [uri, setUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const loadingRef = useRef(false);
  const isImage = attachment.mimeType.startsWith('image/');

  const openAttachment = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      let localUri = uri;
      if (!localUri) {
        const token = await AsyncStorage.getItem('token');
        const directory = FileSystem.cacheDirectory || FileSystem.documentDirectory;
        if (!directory) throw new Error('Armazenamento temporário indisponível');
        const result = await FileSystem.downloadAsync(
          `${API_URL}/tickets/${ticketId}/attachments/${attachment.id}`,
          `${directory}ticket-attachment-${attachment.id}`,
          token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
        );
        localUri = result.uri;
        setUri(localUri);
      }
      if (!isImage) {
        if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(localUri, { mimeType: attachment.mimeType, dialogTitle: attachment.name });
        else Alert.alert('Arquivo pronto', `Salvo temporariamente em ${localUri}`);
      }
    } catch {
      Alert.alert('Falha ao abrir arquivo', 'Confira sua conexão e tente novamente.');
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [attachment.id, attachment.mimeType, attachment.name, isImage, loading, ticketId, uri]);

  useEffect(() => {
    if (isImage && !uri && !loading) void openAttachment();
  }, [isImage, loading, openAttachment, uri]);

  if (isImage) {
    return uri
      ? <TouchableOpacity onPress={() => void openAttachment()}><Image source={{ uri }} style={styles.attachmentImage} resizeMode="cover"/></TouchableOpacity>
      : <View style={styles.attachmentLoading}><ActivityIndicator size="small"/><Text style={styles.attachmentName}>Carregando foto…</Text></View>;
  }
  return <TouchableOpacity style={styles.attachmentFile} onPress={() => void openAttachment()} disabled={loading}>
    {loading ? <ActivityIndicator size="small"/> : <Text style={styles.attachmentIcon}>↓</Text>}
    <Text style={styles.attachmentName} numberOfLines={1}>{attachment.name}</Text>
  </TouchableOpacity>;
}

export default function TicketDetailScreen({ route, navigation }: any) {
  const { id } = route.params;
  const [ticket, setTicket] = useState<(Ticket & { messages: TicketMessage[] }) | null>(null);
  const [newMessage, setNewMessage] = useState('');
  const [selectedFile, setSelectedFile] = useState<PendingAttachment | null>(null);
  const [sending, setSending] = useState(false);
  const [rating, setRating] = useState<number | null>(null);
  const [satisfactionComment, setSatisfactionComment] = useState('');
  const [sendingRating, setSendingRating] = useState(false);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Awaited<ReturnType<typeof getTicketsSocket>> | null>(null);

  const load = useCallback(async () => {
    const { data } = await api.get(`/tickets/${id}`);
    setTicket(data);
  }, [id]);

  useEffect(() => {
    load();

    let isMounted = true;

    (async () => {
      const socket = await getTicketsSocket();
      if (!isMounted) return;
      socketRef.current = socket;

      function handleConnect() {
        setConnected(true);
        socket.emit('joinTicket', id);
        void load().catch(() => undefined);
      }

      function handleNewMessage(message: TicketMessage) {
        setTicket((prev) => prev && prev.messages.some((item) => item.id === message.id)
          ? prev
          : prev ? { ...prev, messages: [...(prev.messages ?? []), message] } : prev);
      }

      function handleTicketUpdated(updated: Ticket) {
        setTicket((prev) => (prev ? { ...prev, ...updated } : prev));
      }

      socket.on('connect', handleConnect);
      socket.on('newMessage', handleNewMessage);
      socket.on('ticketUpdated', handleTicketUpdated);
      socket.on('disconnect', () => setConnected(false));

      if (socket.connected) {
        handleConnect();
      }
    })();

    return () => {
      isMounted = false;
      socketRef.current?.off('connect');
      socketRef.current?.off('newMessage');
      socketRef.current?.off('ticketUpdated');
    };
  }, [id, load]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (AppState.currentState === 'active') void load().catch(() => undefined);
    }, 5_000);
    return () => clearInterval(interval);
  }, [load]);

  async function chooseFile() {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['image/*', 'application/pdf', 'text/plain', 'application/zip', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.android.package-archive'],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (!result.canceled) setSelectedFile(result.assets[0]);
  }

  async function takePhoto() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permissão necessária', 'Autorize o acesso à câmera para tirar uma foto no chamado.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 0.85,
    });
    const photo = result.assets?.[0];
    if (result.canceled || !photo) return;
    setSelectedFile({
      uri: photo.uri,
      name: photo.fileName || `foto-${Date.now()}.jpg`,
      mimeType: photo.mimeType || 'image/jpeg',
      size: photo.fileSize,
    });
  }

  async function handleSend() {
    if ((!newMessage.trim() && !selectedFile) || sending) return;
    if (selectedFile) {
      setSending(true);
      try {
        const form = new FormData();
        form.append('file', { uri: selectedFile.uri, name: selectedFile.name, type: selectedFile.mimeType || 'application/octet-stream' } as any);
        form.append('message', newMessage.trim());
        const { data } = await api.post(`/tickets/${id}/attachments`, form, { headers: { 'Content-Type': 'multipart/form-data' } });
        setTicket((prev) => prev && prev.messages.some((item) => item.id === data.id) ? prev : prev ? { ...prev, messages: [...prev.messages, data] } : prev);
        setSelectedFile(null);
        setNewMessage('');
      } catch (error: any) {
        const responseMessage = error?.response?.data?.message;
        Alert.alert('Não foi possível enviar', Array.isArray(responseMessage) ? responseMessage.join('\n') : responseMessage || 'Confira o tamanho e o formato do arquivo.');
      } finally {
        setSending(false);
      }
      return;
    }
    const messageText = newMessage.trim();
    setSending(true);
    try {
      // Use the acknowledged HTTP route for persistence. Socket emits are
      // fire-and-forget, so a disconnected mobile client could clear the draft
      // without the server ever receiving it (and the flow would never advance).
      const { data } = await api.post(`/tickets/${id}/messages`, { message: messageText });
      setTicket((prev) => prev && prev.messages.some((item) => item.id === data.id)
        ? prev
        : prev ? { ...prev, messages: [...(prev.messages ?? []), data] } : prev);
      setNewMessage('');
      // Refresh the full transcript as a fallback for missed socket events,
      // including the bot's final handoff notice from the previous flow step.
      await load();
    } catch (error: any) {
      const responseMessage = error?.response?.data?.message;
      Alert.alert('Mensagem não enviada', Array.isArray(responseMessage) ? responseMessage.join('\n') : responseMessage || 'Confira a conexão e tente novamente.');
    } finally {
      setSending(false);
    }
  }

  async function handleSubmitSatisfaction() {
    if (!rating || sendingRating) return;
    setSendingRating(true);
    try {
      const { data } = await api.post(`/tickets/${id}/satisfaction`, { rating, comment: satisfactionComment.trim() });
      setTicket((current) => current ? { ...current, ...data } : current);
    } catch (error: any) {
      const responseMessage = error?.response?.data?.message;
      Alert.alert('Não foi possível enviar a avaliação', Array.isArray(responseMessage) ? responseMessage.join('\n') : responseMessage || 'Confira sua conexão e tente novamente.');
    } finally {
      setSendingRating(false);
    }
  }

  if (!ticket) {
    return (
      <View style={styles.container}>
        <Text>Carregando...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>
        {ticket.protocol} — {ticket.title}
      </Text>
      <Text style={styles.badge}>
        {ticket.status} · {ticket.category} · {connected ? '● ao vivo' : '○ conectando...'}
      </Text>
      <Text style={styles.description}>{ticket.description}</Text>

      {ticket.status === TicketStatus.CLOSED && (
        <View style={styles.satisfactionCard}>
          {ticket.satisfactionSubmittedAt ? (
            <>
              <Text style={styles.satisfactionTitle}>Obrigado pela avaliação!</Text>
              <Text style={styles.satisfactionCopy}>Sua opinião ajuda a melhorar nosso atendimento.</Text>
            </>
          ) : (
            <>
              <Text style={styles.satisfactionTitle}>Atendimento encerrado</Text>
              <Text style={styles.satisfactionCopy}>Como foi sua experiência com nosso atendimento?</Text>
              <View style={styles.ratingRow} accessibilityRole="radiogroup" accessibilityLabel="Nota de satisfação">
                {[1, 2, 3, 4, 5].map((value) => (
                  <TouchableOpacity key={value} onPress={() => setRating(value)} accessibilityRole="radio" accessibilityState={{ selected: rating === value }} accessibilityLabel={`${value} ${value === 1 ? 'estrela' : 'estrelas'}`} style={styles.ratingButton}>
                    <Text style={[styles.ratingStar, rating !== null && value <= rating && styles.ratingStarSelected]}>★</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TextInput
                style={styles.satisfactionInput}
                placeholder="Quer deixar um comentário? (opcional)"
                value={satisfactionComment}
                onChangeText={setSatisfactionComment}
                multiline
                maxLength={2000}
              />
              <Button title={sendingRating ? 'Enviando…' : 'Enviar avaliação'} onPress={() => void handleSubmitSatisfaction()} disabled={!rating || sendingRating} />
            </>
          )}
        </View>
      )}

      <Text style={styles.sectionTitle}>Conversa</Text>
      <FlatList
        data={ticket.messages}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={styles.messageItem}>
            <Text style={styles.messageAuthor}>{(item as any).author?.name ?? 'Usuário'}</Text>
            {!!item.message && <Text>{item.message}</Text>}
            {item.attachments?.map((attachment) => <AttachmentPreview key={attachment.id} ticketId={id} attachment={attachment}/>)}
          </View>
        )}
      />

      {ticket.status !== TicketStatus.CLOSED && selectedFile && <View style={styles.selectedFile}><Text style={styles.attachmentName} numberOfLines={1}>{selectedFile.name}</Text><TouchableOpacity onPress={() => setSelectedFile(null)}><Text style={styles.removeFile}>×</Text></TouchableOpacity></View>}
      {ticket.status !== TicketStatus.CLOSED && <View style={styles.sendRow}>
        <TouchableOpacity style={styles.attachButton} onPress={() => void chooseFile()} disabled={sending}><Text style={styles.attachButtonText}>＋</Text></TouchableOpacity>
        <TouchableOpacity style={styles.attachButton} onPress={() => void takePhoto()} disabled={sending} accessibilityLabel="Tirar foto"><Text style={styles.cameraButtonText}>📷</Text></TouchableOpacity>
        <TextInput
          style={styles.input}
          placeholder="Escreva uma mensagem..."
          value={newMessage}
          onChangeText={setNewMessage}
        />
        <Button title={sending ? 'Enviando…' : 'Enviar'} onPress={() => void handleSend()} disabled={sending || (!newMessage.trim() && !selectedFile)} />
      </View>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#fff' },
  title: { fontSize: 18, fontWeight: 'bold', marginBottom: 4 },
  badge: { fontSize: 12, color: '#1458ff', marginBottom: 8 },
  description: { marginBottom: 16 },
  satisfactionCard: { padding: 14, marginBottom: 14, borderRadius: 12, backgroundColor: '#f3f1ff', borderWidth: 1, borderColor: '#ded8ff' },
  satisfactionTitle: { fontSize: 16, fontWeight: '700', color: '#30236f', marginBottom: 5 },
  satisfactionCopy: { color: '#514b68', marginBottom: 8 },
  ratingRow: { flexDirection: 'row', justifyContent: 'center', marginVertical: 5 },
  ratingButton: { paddingHorizontal: 8, paddingVertical: 2 },
  ratingStar: { fontSize: 34, color: '#c8c4d5' },
  ratingStarSelected: { color: '#f2ad22' },
  satisfactionInput: { minHeight: 64, maxHeight: 120, borderWidth: 1, borderColor: '#d8d4e4', borderRadius: 8, padding: 9, marginVertical: 9, backgroundColor: '#fff', textAlignVertical: 'top' },
  sectionTitle: { fontSize: 14, fontWeight: '600', marginBottom: 8 },
  messageItem: { padding: 8, backgroundColor: '#fafafa', borderRadius: 6, marginBottom: 6 },
  messageAuthor: { fontWeight: '600', fontSize: 12 },
  sendRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  input: { flex: 1, borderWidth: 1, borderColor: '#ccc', borderRadius: 6, padding: 8, marginRight: 8 },
  attachButton: { width: 40, height: 42, alignItems: 'center', justifyContent: 'center', marginRight: 7, borderRadius: 7, backgroundColor: '#f0ebff' },
  attachButtonText: { color: '#6249df', fontSize: 26, lineHeight: 30 },
  cameraButtonText: { color: '#6249df', fontSize: 18 },
  selectedFile: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 9, marginBottom: 7, borderRadius: 7, backgroundColor: '#f4f2fc' },
  removeFile: { paddingHorizontal: 8, color: '#6b45e8', fontSize: 20 },
  attachmentImage: { width: 190, height: 150, marginTop: 8, borderRadius: 8, backgroundColor: '#eee' },
  attachmentLoading: { flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 8 },
  attachmentFile: { flexDirection: 'row', alignItems: 'center', padding: 9, marginTop: 8, borderRadius: 7, backgroundColor: '#f0ebff' },
  attachmentIcon: { marginRight: 8, color: '#6249df', fontSize: 18, fontWeight: '700' },
  attachmentName: { flex: 1, color: '#36425a', fontSize: 12 },
});
