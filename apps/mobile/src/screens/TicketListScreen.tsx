import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Button } from 'react-native';
import { api } from '../lib/api';
import type { Ticket } from '@canal-direto/shared';

export default function TicketListScreen({ navigation }: any) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const { data } = await api.get('/tickets');
    setTickets(data);
    setLoading(false);
  }

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', load);
    return unsubscribe;
  }, [navigation]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Meus chamados</Text>
        <Button title="Novo" onPress={() => navigation.navigate('NewTicket')} />
      </View>
      <FlatList
        data={tickets}
        keyExtractor={(item) => item.id}
        refreshing={loading}
        onRefresh={load}
        ListEmptyComponent={<Text>Nenhum chamado encontrado.</Text>}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            onPress={() => navigation.navigate('TicketDetail', { id: item.id })}
          >
            <Text style={styles.protocol}>{item.protocol}</Text>
            <Text style={styles.cardTitle}>{item.title}</Text>
            <Text style={styles.badge}>{item.status}</Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#fff' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  title: { fontSize: 22, fontWeight: 'bold' },
  card: { padding: 12, borderWidth: 1, borderColor: '#eee', borderRadius: 8, marginBottom: 8 },
  protocol: { fontSize: 12, color: '#777' },
  cardTitle: { fontSize: 16, fontWeight: '600', marginVertical: 2 },
  badge: { fontSize: 12, color: '#1458ff' },
});
