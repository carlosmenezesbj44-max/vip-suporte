import React, { useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { api, saveToken } from '../lib/api';
import { TicketCategory } from '@canal-direto/shared';

const CATEGORY_LABELS: Record<TicketCategory, string> = {
  [TicketCategory.CONNECTION_DOWN]: 'Sem conexão',
  [TicketCategory.SLOW_CONNECTION]: 'Internet lenta',
  [TicketCategory.BILLING]: 'Financeiro',
  [TicketCategory.EQUIPMENT]: 'Equipamento',
  [TicketCategory.CONTRACT]: 'Contrato',
  [TicketCategory.OTHER]: 'Outro',
};

type IxcMatch = { id: string; name: string; documentHint: string | null; contractStatus: string | null };

export default function NewTicketScreen({ navigation }: any) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<TicketCategory>(TicketCategory.CONNECTION_DOWN);
  const [searchTerm, setSearchTerm] = useState('');
  const [matches, setMatches] = useState<IxcMatch[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<IxcMatch | null>(null);
  const [searchedTerm, setSearchedTerm] = useState('');
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function searchCustomer() {
    const query = searchTerm.trim();
    if (query.length < 3) {
      setError('Digite seu CPF, telefone ou nome completo para consultar.');
      return;
    }
    setSearching(true);
    setError(null);
    setMatches([]);
    setSelectedCustomer(null);
    setSearchedTerm('');
    try {
      const { data } = await api.post('/ixc/customer/verify', { query });
      setMatches(data);
      setSearchedTerm(query);
      if (!data.length) setError('Não encontramos esse cadastro no IXC. Confira os dados e tente novamente.');
    } catch (err: any) {
      const apiMessage = err?.response?.data?.message;
      setError(apiMessage ?? (err?.request
        ? 'Não foi possível conectar ao servidor. Confira se o celular está na mesma rede Wi‑Fi do atendimento e tente novamente.'
        : 'Não foi possível consultar o IXC. Tente novamente mais tarde.'));
    } finally {
      setSearching(false);
    }
  }

  async function handleSubmit() {
    if (!selectedCustomer || !searchedTerm || loading) return;
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.post('/portal/tickets', {
        title: title.trim(),
        description: description.trim(),
        category,
        ixcSearchTerm: searchedTerm,
        ixcCustomerId: selectedCustomer.id,
      });
      await saveToken(data.accessToken);
      if (data.reused) {
        Alert.alert('Chamado em andamento', `Encontramos o chamado ${data.protocol} ainda aberto. Vamos continuar a conversa existente.`);
      }
      navigation.replace('TicketDetail', { id: data.id });
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Falha ao abrir o chamado.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Como podemos ajudar?</Text>
      <Text style={styles.subtitle}>Informe CPF, telefone ou nome completo. Vamos confirmar seu cadastro no IXC antes de abrir o chamado.</Text>

      <View style={styles.lookupCard}>
        <Text style={styles.sectionTitle}>Identificar assinante</Text>
        <TextInput
          style={styles.input}
          placeholder="CPF, telefone ou nome completo"
          value={searchTerm}
          onChangeText={(value) => {
            setSearchTerm(value);
            setMatches([]);
            setSelectedCustomer(null);
            setSearchedTerm('');
            setError(null);
          }}
          autoCapitalize="words"
          autoCorrect={false}
          returnKeyType="search"
          onSubmitEditing={() => void searchCustomer()}
          editable={!searching && !loading}
        />
        <TouchableOpacity style={[styles.searchButton, searching && styles.buttonDisabled]} onPress={() => void searchCustomer()} disabled={searching || loading}>
          {searching ? <ActivityIndicator color="#fff"/> : <Text style={styles.searchButtonText}>Buscar no IXC</Text>}
        </TouchableOpacity>

        {matches.length > 0 && <View style={styles.results}>
          <Text style={styles.resultsLabel}>{matches.length === 1 ? 'Cadastro encontrado' : 'Selecione seu cadastro'}</Text>
          {matches.map((customer) => {
            const selected = selectedCustomer?.id === customer.id;
            return <TouchableOpacity key={customer.id} style={[styles.customerOption, selected && styles.customerOptionSelected]} onPress={() => setSelectedCustomer(customer)}>
              <View style={styles.customerInitial}><Text style={styles.customerInitialText}>{customer.name.slice(0, 1).toUpperCase()}</Text></View>
              <View style={styles.customerCopy}><Text style={styles.customerName}>{customer.name}</Text><Text style={styles.customerMeta}>{customer.documentHint || 'Cadastro localizado no IXC'}{customer.contractStatus ? ` · ${customer.contractStatus}` : ''}</Text></View>
              <Text style={styles.radio}>{selected ? '●' : '○'}</Text>
            </TouchableOpacity>;
          })}
        </View>}
      </View>

      {selectedCustomer && <View style={styles.ticketForm}>
        <View style={styles.confirmed}><Text style={styles.confirmedMark}>✓</Text><View style={styles.confirmedCopy}><Text style={styles.confirmedTitle}>Cadastro confirmado</Text><Text style={styles.confirmedName}>{selectedCustomer.name}</Text></View></View>
        <Text style={styles.sectionTitle}>Sobre o problema</Text>
        <TextInput style={styles.input} placeholder="Assunto do chamado" value={title} onChangeText={setTitle} maxLength={120}/>
        <View style={styles.pickerWrap}><Picker selectedValue={category} onValueChange={(value) => setCategory(value)}>{Object.entries(CATEGORY_LABELS).map(([value, label]) => <Picker.Item key={value} label={label} value={value}/>)}</Picker></View>
        <TextInput style={[styles.input, styles.description]} placeholder="Descreva o problema" multiline value={description} onChangeText={setDescription} textAlignVertical="top" maxLength={2000}/>
      </View>}

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {selectedCustomer && <TouchableOpacity style={[styles.submitButton, (loading || !title.trim() || !description.trim()) && styles.buttonDisabled]} onPress={() => void handleSubmit()} disabled={loading || !title.trim() || !description.trim()}>
        {loading ? <ActivityIndicator color="#fff"/> : <Text style={styles.submitButtonText}>Abrir chamado</Text>}
      </TouchableOpacity>}
      {selectedCustomer && <Text style={styles.queueNote}>Depois de aberto, seu chamado aparecerá na fila de atendimentos em espera.</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f7f8fc' },
  content: { padding: 18, paddingBottom: 32 },
  title: { fontSize: 23, fontWeight: '800', color: '#202b42' },
  subtitle: { marginTop: 5, marginBottom: 18, color: '#778198', fontSize: 13 },
  lookupCard: { padding: 15, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e7e9f0', borderRadius: 12 },
  sectionTitle: { marginBottom: 10, color: '#303b53', fontSize: 14, fontWeight: '700' },
  input: { minHeight: 46, paddingHorizontal: 12, borderWidth: 1, borderColor: '#dfe3eb', borderRadius: 8, marginBottom: 10, backgroundColor: '#fff', color: '#303b53', fontSize: 14 },
  searchButton: { minHeight: 45, borderRadius: 8, justifyContent: 'center', alignItems: 'center', backgroundColor: '#6b45e8' },
  searchButtonText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  buttonDisabled: { opacity: 0.55 },
  results: { marginTop: 16 },
  resultsLabel: { marginBottom: 8, color: '#7f899e', fontSize: 12, fontWeight: '600' },
  customerOption: { minHeight: 66, flexDirection: 'row', alignItems: 'center', padding: 10, borderWidth: 1, borderColor: '#e8eaf0', borderRadius: 9, marginBottom: 7, backgroundColor: '#fff' },
  customerOptionSelected: { borderColor: '#8a70ef', backgroundColor: '#faf8ff' },
  customerInitial: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', marginRight: 10, backgroundColor: '#f0ebff' },
  customerInitialText: { color: '#6347d5', fontSize: 13, fontWeight: '700' },
  customerCopy: { flex: 1 },
  customerName: { color: '#303b53', fontSize: 13, fontWeight: '700' },
  customerMeta: { marginTop: 4, color: '#858ea1', fontSize: 11 },
  radio: { marginLeft: 8, color: '#684de0', fontSize: 19 },
  ticketForm: { marginTop: 14, padding: 15, borderWidth: 1, borderColor: '#e7e9f0', borderRadius: 12, backgroundColor: '#fff' },
  confirmed: { flexDirection: 'row', alignItems: 'center', padding: 10, marginBottom: 16, borderRadius: 8, backgroundColor: '#f0faf5' },
  confirmedMark: { marginRight: 9, color: '#278258', fontSize: 18, fontWeight: '700' },
  confirmedCopy: { flex: 1 },
  confirmedTitle: { color: '#278258', fontSize: 11, fontWeight: '700' },
  confirmedName: { marginTop: 2, color: '#364b40', fontSize: 13, fontWeight: '600' },
  pickerWrap: { minHeight: 48, justifyContent: 'center', borderWidth: 1, borderColor: '#dfe3eb', borderRadius: 8, marginBottom: 10, overflow: 'hidden' },
  description: { height: 110, paddingTop: 12 },
  error: { marginTop: 12, padding: 10, borderRadius: 7, overflow: 'hidden', backgroundColor: '#fff1f0', color: '#b13d3d', fontSize: 12, lineHeight: 18 },
  submitButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: 14, borderRadius: 8, backgroundColor: '#6b45e8' },
  submitButtonText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  queueNote: { marginTop: 9, color: '#858ea1', fontSize: 11, lineHeight: 16, textAlign: 'center' },
});
