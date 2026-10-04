'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { saveSession } from '@/lib/auth';

export default function LoginPage() {
  const router = useRouter();
  const [registered, setRegistered] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => setRegistered(new URLSearchParams(window.location.search).has('registered')), []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { data } = await api.post('/auth/login', { email, password });
      saveSession(data.accessToken, data.user);
      router.push('/dashboard');
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Falha ao entrar. Verifique suas credenciais.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="container">
      <div className="auth-brand"><span className="brand-mark">C</span><span>canal<span className="brand-light">direto</span></span></div>
      <section className="auth-card login-card">
      <div className="auth-icon">↗</div>
      <div className="eyebrow">PORTAL DE ATENDIMENTO</div>
      <h1>Bem-vindo de volta</h1>
      <p>Entre para abrir chamados e falar com nossa equipe.</p>
      {registered && <div className="success-message">Cadastro realizado. Agora entre com seu e-mail e senha.</div>}
      <form onSubmit={handleSubmit} className="auth-form">
        <label>E-mail<input
          type="email"
          placeholder="E-mail"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        /></label>
        <label>Senha<input
          type="password"
          placeholder="Senha"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        /></label>
        {error && <p style={{ color: 'crimson' }}>{error}</p>}
        <button className="primary-action full-action" type="submit" disabled={loading}>
          {loading ? 'Entrando...' : 'Entrar'}
        </button>
      </form>
      <div className="auth-switch">Ainda não tem conta? <Link href="/register">Cadastre-se aqui</Link></div>
      </section>
      <div className="auth-footnote">Atendimento direto, simples e sempre por perto.</div>
    </div>
  );
}
