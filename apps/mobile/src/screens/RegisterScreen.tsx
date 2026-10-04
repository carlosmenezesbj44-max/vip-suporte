import React, { useState } from 'react';
import { View, Text, TextInput, Button, StyleSheet, ScrollView } from 'react-native';
import { api } from '../lib/api';

export default function RegisterScreen({ navigation }: any) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleRegister() {
    setError('');
    setLoading(true);
    try {
      await api.post('/users', { name: name.trim(), phone, email: email.trim().toLowerCase(), password });
      navigation.replace('Login', { registeredEmail: email.trim().toLowerCase() });
    } catch (err: any) {
      const message = err?.response?.data?.message;
      setError(Array.isArray(message) ? message.join('\n') : message || 'Não foi possível criar a conta. Confira os dados e tente novamente.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.mark}>C</Text>
      <Text style={styles.title}>Criar conta</Text>
      <Text style={styles.subtitle}>Cadastre-se para falar com nossa equipe e acompanhar seus chamados.</Text>
      <Text style={styles.label}>Nome completo</Text>
      <TextInput style={styles.input} placeholder="Seu nome" autoCapitalize="words" value={name} onChangeText={setName} />
      <Text style={styles.label}>Telefone</Text>
      <TextInput style={styles.input} placeholder="(00) 00000-0000" keyboardType="phone-pad" value={phone} onChangeText={setPhone} />
      <Text style={styles.label}>E-mail</Text>
      <TextInput style={styles.input} placeholder="voce@email.com" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} />
      <Text style={styles.label}>Senha</Text>
      <TextInput style={styles.input} placeholder="Mínimo de 6 caracteres" secureTextEntry value={password} onChangeText={setPassword} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.submit}><Button title={loading ? 'Criando conta...' : 'Criar conta'} onPress={handleRegister} disabled={loading || !name.trim() || !phone.trim() || !email.trim() || password.length < 6} /></View>
      <View style={styles.back}><Button title="Já tenho cadastro · Voltar ao login" onPress={() => navigation.goBack()} /></View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, justifyContent: 'center', padding: 24, backgroundColor: '#f7f7fb' },
  mark: { alignSelf: 'center', textAlign: 'center', textAlignVertical: 'center', height: 48, width: 48, overflow: 'hidden', borderRadius: 14, backgroundColor: '#5738e5', color: '#fff', fontSize: 25, fontWeight: 'bold', marginBottom: 16 },
  title: { fontSize: 25, fontWeight: 'bold', color: '#192239', textAlign: 'center' },
  subtitle: { fontSize: 13, color: '#778196', lineHeight: 20, textAlign: 'center', marginTop: 7, marginBottom: 22 },
  label: { fontSize: 12, fontWeight: '600', color: '#4c566d', marginBottom: 6 },
  input: { height: 46, borderWidth: 1, borderColor: '#e3e6ed', borderRadius: 8, paddingHorizontal: 12, marginBottom: 15, backgroundColor: '#fff', fontSize: 14 },
  submit: { marginTop: 5, overflow: 'hidden', borderRadius: 8 },
  back: { marginTop: 10 },
  error: { color: '#b7463e', fontSize: 12, marginBottom: 12 },
});
