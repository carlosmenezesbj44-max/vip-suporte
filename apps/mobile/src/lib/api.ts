import axios from 'axios';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';

const configuredApiUrl = (Constants.expoConfig?.extra as any)?.apiUrl as string | undefined;
const expoHost = Constants.expoConfig?.hostUri?.split(':')[0];
const localApiUrl = configuredApiUrl ?? 'http://localhost:3333/api';

// Em Expo Go, localhost aponta para o próprio celular. Durante o modo de
// desenvolvimento, usa o mesmo host do Metro para alcançar a API no computador.
export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ??
  (expoHost && /localhost|127\.0\.0\.1/.test(localApiUrl)
    ? `http://${expoHost}:3333/api`
    : localApiUrl);

export const api = axios.create({ baseURL: API_URL });

api.interceptors.request.use(async (config) => {
  const token = await AsyncStorage.getItem('token');
  if (token) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export async function saveToken(token: string) {
  await AsyncStorage.setItem('token', token);
}

export async function clearToken() {
  await AsyncStorage.removeItem('token');
}
