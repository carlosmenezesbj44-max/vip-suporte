import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Button, StyleSheet } from 'react-native';
import { api, saveToken } from '../lib/api';

export default function LoginScreen({ navigation, route }: any) {
  const [email, setEmail] = useState(route?.params?.registeredEmail ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (route?.params?.registeredEmail) setEmail(route.params.registeredEmail);
  }, [route?.params?.registeredEmail]);

  async function handleLogin() {
    setError(null);
    setLoading(true);
    try {
      const { data } = await api.post('/auth/login', { email, password });
      await saveToken(data.accessToken);
      navigation.replace('TicketList', { user: data.user });
    } catch (err: any) {
      setError(
        err?.response?.data?.message ??
          (err?.response
            ? 'Falha ao entrar. Verifique suas credenciais.'
            : 'Não foi possível conectar ao servidor. Confirme que o celular está na mesma rede e que o backend está ligado.'),
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Canal Direto</Text>
      <Text style={styles.subtitle}>Entre para acompanhar seus chamados</Text>
      {route?.params?.registeredEmail ? <Text style={styles.success}>Cadastro criado. Entre com sua senha para continuar.</Text> : null}
      <TextInput
        style={styles.input}
        placeholder="E-mail"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={styles.input}
        placeholder="Senha"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button title={loading ? 'Entrando...' : 'Entrar'} onPress={handleLogin} disabled={loading} />
      <View style={styles.registerButton}><Button title="Criar conta de cliente" onPress={() => navigation.navigate('Register')} /></View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#fff' },
  title: { fontSize: 28, fontWeight: 'bold', marginBottom: 4 },
  subtitle: { fontSize: 14, color: '#555', marginBottom: 24 },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 6,
    padding: 10,
    marginBottom: 12,
  },
  error: { color: 'crimson', marginBottom: 12 },
  success: { color: '#19845d', marginBottom: 14, fontSize: 13 },
  registerButton: { marginTop: 12 },
});
