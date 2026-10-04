'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { attachAuthInterceptor, api } from '@/lib/api';
import { TicketCategory } from '@canal-direto/shared';

attachAuthInterceptor();

const CATEGORY_LABELS: Record<TicketCategory, string> = {
  [TicketCategory.CONNECTION_DOWN]: 'Sem conexão',
  [TicketCategory.SLOW_CONNECTION]: 'Internet lenta',
  [TicketCategory.BILLING]: 'Financeiro',
  [TicketCategory.EQUIPMENT]: 'Equipamento',
  [TicketCategory.CONTRACT]: 'Contrato',
  [TicketCategory.OTHER]: 'Outro',
};

export default function NewTicketPage() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<TicketCategory>(TicketCategory.CONNECTION_DOWN);
  const [cpfCnpj, setCpfCnpj] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { data } = await api.post('/tickets', { title, description, category, cpfCnpj });
      router.push(`/tickets/${data.id}`);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Falha ao abrir o chamado.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page">
      <h1>Abrir novo chamado</h1>
      <form onSubmit={handleSubmit} style={{ maxWidth: 480 }}>
        <input placeholder="Título" value={title} onChange={(e) => setTitle(e.target.value)} required />
        <select value={category} onChange={(e) => setCategory(e.target.value as TicketCategory)}>
          {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <textarea
          placeholder="Descreva o problema"
          rows={5}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          required
        />
        <input
          placeholder="CPF/CNPJ (para localizar seu contrato)"
          value={cpfCnpj}
          onChange={(e) => setCpfCnpj(e.target.value)}
        />
        {error && <p style={{ color: 'crimson' }}>{error}</p>}
        <button type="submit" disabled={loading}>
          {loading ? 'Enviando...' : 'Abrir chamado'}
        </button>
      </form>
    </div>
  );
}
