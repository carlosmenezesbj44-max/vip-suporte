'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError(''); setLoading(true);
    try {
      await api.post('/users', { name, phone, email, password });
      router.push('/?registered=1');
    } catch (err: any) {
      setError(err?.response?.data?.message instanceof Array ? err.response.data.message.join(' ') : err?.response?.data?.message || 'Não foi possível criar sua conta. Verifique seus dados.');
    } finally { setLoading(false); }
  }

  return <main className="auth-shell"><div className="auth-brand"><span className="brand-mark">C</span><span>canal<span className="brand-light">direto</span></span></div><section className="auth-card"><div className="auth-icon">♙</div><div className="eyebrow">PORTAL DO CLIENTE</div><h1>Crie sua conta</h1><p>Cadastre-se para abrir chamados e acompanhar seu atendimento.</p><form onSubmit={submit} className="auth-form"><label>Nome completo<input required value={name} onChange={(event) => setName(event.target.value)} placeholder="Como podemos chamar você?" autoComplete="name"/></label><label>Telefone<input required value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="(00) 00000-0000" autoComplete="tel" inputMode="tel"/></label><label>E-mail<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="voce@email.com" autoComplete="email"/></label><label>Senha<input required minLength={6} type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Pelo menos 6 caracteres" autoComplete="new-password"/></label>{error && <div className="inline-error">{error}</div>}<button className="primary-action full-action" type="submit" disabled={loading}>{loading ? 'Criando sua conta…' : 'Criar conta'}</button></form><div className="auth-switch">Já tem cadastro? <Link href="/">Entrar na sua conta</Link></div></section><div className="auth-footnote">Seus dados são usados para identificar e acompanhar seus atendimentos.</div></main>;
}
