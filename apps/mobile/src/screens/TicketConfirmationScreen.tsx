import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export default function TicketConfirmationScreen({ navigation, route }: any) {
  const protocol = route?.params?.protocol;
  return (
    <View style={styles.container}>
      <View style={styles.mark}><Text style={styles.check}>✓</Text></View>
      <Text style={styles.title}>Chamado aberto</Text>
      <Text style={styles.description}>Seu atendimento foi enviado e já está na fila de espera.</Text>
      {protocol ? <View style={styles.protocolCard}><Text style={styles.protocolLabel}>PROTOCOLO</Text><Text style={styles.protocol}>{protocol}</Text></View> : null}
      <TouchableOpacity style={styles.button} onPress={() => navigation.replace('NewTicket')}>
        <Text style={styles.buttonText}>Voltar ao início</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, backgroundColor: '#f7f8fc' },
  mark: { width: 68, height: 68, alignItems: 'center', justifyContent: 'center', borderRadius: 34, backgroundColor: '#e8f8ef' },
  check: { color: '#21865c', fontSize: 36, fontWeight: '700' },
  title: { marginTop: 20, color: '#202b42', fontSize: 24, fontWeight: '800' },
  description: { marginTop: 8, color: '#778198', fontSize: 14, lineHeight: 21, textAlign: 'center' },
  protocolCard: { alignItems: 'center', width: '100%', padding: 16, marginTop: 24, borderWidth: 1, borderColor: '#e4e7ef', borderRadius: 12, backgroundColor: '#fff' },
  protocolLabel: { color: '#858ea1', fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  protocol: { marginTop: 6, color: '#6347d5', fontSize: 20, fontWeight: '800' },
  button: { minHeight: 48, width: '100%', alignItems: 'center', justifyContent: 'center', marginTop: 28, borderRadius: 8, backgroundColor: '#6b45e8' },
  buttonText: { color: '#fff', fontSize: 14, fontWeight: '700' },
});
