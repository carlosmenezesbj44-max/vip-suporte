import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import LoginScreen from '../screens/LoginScreen';
import TicketListScreen from '../screens/TicketListScreen';
import NewTicketScreen from '../screens/NewTicketScreen';
import TicketDetailScreen from '../screens/TicketDetailScreen';
import RegisterScreen from '../screens/RegisterScreen';
import TicketConfirmationScreen from '../screens/TicketConfirmationScreen';

const Stack = createNativeStackNavigator();

export default function AppNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="NewTicket">
        <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
        <Stack.Screen name="Register" component={RegisterScreen} options={{ title: 'Criar conta de cliente' }} />
        <Stack.Screen name="TicketList" component={TicketListScreen} options={{ title: 'Chamados' }} />
        <Stack.Screen name="NewTicket" component={NewTicketScreen} options={{ title: 'Novo chamado' }} />
        <Stack.Screen name="TicketConfirmation" component={TicketConfirmationScreen} options={{ headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="TicketDetail" component={TicketDetailScreen} options={{ title: 'Detalhe do chamado' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
