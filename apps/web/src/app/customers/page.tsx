'use client';

import { type FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, attachAuthInterceptor } from '@/lib/api';
import { clearSession, getCurrentUser } from '@/lib/auth';
import { UserRole } from '@canal-direto/shared';
import type { AuthenticatedUser } from '@canal-direto/shared';

attachAuthInterceptor();

type Customer = {
  id: string; name: string; email: string; phone: string | null; createdAt: string;
  ticketsCreated: { id: string; protocol: string; title: string; status: string; createdAt: string }[];
  _count: { ticketsCreated: number };
};
type IxcCustomerResult = {
  id: string; razaoSocial: string; cpfCnpj: string; situacaoContrato: string; login?: string;
  enderecos: string[];
  cadastrosIxc: { id: string; nome: string; situacao: string | null; contratos: { id: string; situacao: string | null; situacaoInternet: string | null; endereco: string | null; logins: IxcLoginResult[] }[]; loginsSemContrato: IxcLoginResult[] }[];
  financeiro: { disponivel: boolean; contasEmAberto: number | null; contasVencidas: number | null; valorEmAberto: number | null; valorVencido: number | null };
  consultadoEm: string;
};
type IxcLoginResult = {
  id: string; login: string; ativo: string | null; online: string | null;
  onu: { consultaDisponivel: boolean; identificada: boolean; numero: string | null; tipo: string | null; sinalRx: string | null; sinalTx: string | null; atualizadoEm: string | null; distancia: string | null };
};

function formatPhone(phone: string | null) {
  if (!phone) return '—';
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return phone;
}

function formatCpf(cpf: string) {
  const digits = cpf.replace(/\D/g, '');
  return digits.length === 11 ? `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}` : cpf;
}

function formatMoney(value: number | null) {
  return value === null ? 'Indisponível' : value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function describeOnu(onu: IxcLoginResult['onu']) {
  if (!onu.consultaDisponivel && !onu.identificada) return 'ONU: dados indisponíveis no IXC';
  if (!onu.identificada) return 'ONU: não vinculada a este acesso';
  const parts = [onu.numero ? `ONU ${onu.numero}` : onu.tipo || 'ONU cadastrada'];
  parts.push(`RX ${onu.sinalRx || 'sem leitura'}`, `TX ${onu.sinalTx || 'sem leitura'}`);
  if (onu.distancia) parts.push(`${onu.distancia} m`);
  if (onu.atualizadoEm) {
    const date = new Date(onu.atualizadoEm);
    parts.push(`sinal em ${Number.isNaN(date.getTime()) ? onu.atualizadoEm : date.toLocaleString('pt-BR')}`);
  }
  return parts.join(' · ');
}

export default function CustomersPage() {
  const router = useRouter();
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [search, setSearch] = useState('');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [ixcSearchTerm, setIxcSearchTerm] = useState('');
  const [ixcCustomers, setIxcCustomers] = useState<IxcCustomerResult[]>([]);
  const [ixcSelectedCustomerId, setIxcSelectedCustomerId] = useState('');
  const [ixcSearchLoading, setIxcSearchLoading] = useState(false);
  const [ixcSearchError, setIxcSearchError] = useState('');
  const [ixcSearched, setIxcSearched] = useState(false);

  async function loadCustomers(term = '', showLoading = true) {
    if (showLoading) setLoading(true);
    setError('');
    try { const { data } = await api.get('/users/customers', { params: term ? { search: term } : {} }); setCustomers(data); }
    catch { setError('Não foi possível buscar clientes. Confira sua conexão e tente novamente.'); }
    finally { setLoading(false); }
  }

  async function searchIxcCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = ixcSearchTerm.trim();
    if (query.length < 3) {
      setIxcSearchError('Digite um CPF, telefone ou nome com pelo menos 3 caracteres.');
      setIxcCustomers([]);
      setIxcSearched(false);
      return;
    }
    setIxcSearchLoading(true);
    setIxcSearchError('');
    setIxcCustomers([]);
    setIxcSelectedCustomerId('');
    setIxcSearched(false);
    try {
      const { data } = await api.post('/ixc/customer/search', { query });
      const results = Array.isArray(data) ? data : data ? [data] : [];
      setIxcCustomers(results);
      setIxcSelectedCustomerId(results[0]?.id ?? '');
      setIxcSearched(true);
    } catch (searchError) {
      const responseMessage = (searchError as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
      setIxcSearchError(Array.isArray(responseMessage)
        ? responseMessage.join(' ')
        : responseMessage || 'Não foi possível consultar o IXC. Confira a integração e tente novamente.');
    } finally {
      setIxcSearchLoading(false);
    }
  }

  useEffect(() => {
    const currentUser = getCurrentUser();
    setUser(currentUser);
    setSessionReady(true);
    if (!currentUser) { router.push('/'); return; }
    if (![UserRole.ADMIN, UserRole.AGENT, UserRole.TECHNICIAN].includes(currentUser.role)) { router.push('/dashboard'); }
  }, []);

  useEffect(() => {
    if (!sessionReady || !user || ![UserRole.ADMIN, UserRole.AGENT, UserRole.TECHNICIAN].includes(user.role)) return;
    const timer = setTimeout(() => loadCustomers(search), 300);
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') loadCustomers(search, false);
    };
    const interval = window.setInterval(refreshIfVisible, 15000);
    window.addEventListener('focus', refreshIfVisible);
    return () => {
      clearTimeout(timer);
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshIfVisible);
    };
  }, [search, sessionReady, user]);

  const ticketsCount = customers.reduce((sum, customer) => sum + customer._count.ticketsCreated, 0);
  const activeCount = customers.filter((customer) => customer.ticketsCreated.some((ticket) => !['RESOLVED', 'CLOSED'].includes(ticket.status))).length;
  const ixcCustomer = ixcCustomers.find((customer) => customer.id === ixcSelectedCustomerId) ?? ixcCustomers[0] ?? null;

  return <div className="workspace"><aside className="sidebar"><Link href="/dashboard" className="brand"><span className="brand-mark">C</span><span>canal<span className="brand-light">direto</span><small>ATENDIMENTO</small></span></Link><div className="nav-label">MENU PRINCIPAL</div><Link href="/dashboard" className="nav-item"><span className="nav-icon">▦</span> Visão geral</Link><Link href="/customers" className="nav-item active"><span className="nav-icon">♙</span> Clientes</Link><Link href="/settings" className="nav-item"><span className="nav-icon">⚙</span> Configurações</Link><div className="sidebar-bottom"><div className="profile-avatar">{user?.name?.slice(0, 1).toUpperCase() || 'U'}</div><div className="profile-copy"><strong>{user?.name || 'Usuário'}</strong><span>Equipe de atendimento</span></div><button className="icon-button logout" onClick={() => { clearSession(); router.push('/'); }} title="Sair">↗</button></div></aside>
    <main className="main-area"><header className="topbar"><div className="breadcrumb">Atendimento <span>/</span> Clientes</div><div className="topbar-right"><span className="online-dot"/> Sistema operacional <div className="top-avatar">{user?.name?.slice(0, 1).toUpperCase() || 'U'}</div></div></header><div className="content-area"><div className="page-heading"><div><div className="eyebrow">RELACIONAMENTO</div><h1>Clientes</h1><p>Encontre rapidamente uma pessoa pelo nome, telefone ou CPF e veja o histórico de atendimento.</p></div><span className="directory-icon">♙</span></div>
    <section className="panel ixc-customer-search"><div className="panel-heading"><div><h2>Buscar assinante no IXC</h2><p>Consulte os cadastros do provedor por CPF, telefone ou nome completo.</p></div></div><form className="ixc-cpf-form" onSubmit={searchIxcCustomer}><label htmlFor="ixc-search-term">CPF, telefone ou nome completo</label><div className="ixc-cpf-controls"><input id="ixc-search-term" value={ixcSearchTerm} onChange={(event) => setIxcSearchTerm(event.target.value)} placeholder="CPF, telefone ou nome do assinante" inputMode="search" autoComplete="off" maxLength={100}/><button className="settings-primary" type="submit" disabled={ixcSearchLoading || ixcSearchTerm.trim().length < 3}>{ixcSearchLoading ? 'Consultando…' : 'Buscar no IXC'}</button></div><small>A consulta mostra dados do cadastro. Ela não cria conta nem libera acesso ao aplicativo.</small></form>
      {ixcSearchError && <div className="inline-error" role="alert">{ixcSearchError}</div>}
      {ixcSearched && !ixcCustomers.length && <div className="ixc-cpf-empty" role="status">Nenhum assinante encontrado. Confira os dados e tente novamente.</div>}
      {ixcCustomers.length > 1 && <div className="ixc-result-picker"><label htmlFor="ixc-result-choice">Resultados encontrados ({ixcCustomers.length})</label><select id="ixc-result-choice" value={ixcSelectedCustomerId} onChange={(event) => setIxcSelectedCustomerId(event.target.value)}>{ixcCustomers.map((customer) => <option key={customer.id} value={customer.id}>{customer.razaoSocial} · {customer.cpfCnpj ? formatCpf(customer.cpfCnpj) : `IXC ${customer.id}`}</option>)}</select></div>}
      {ixcCustomer && <article className="ixc-customer-result" aria-live="polite">
        <div className="ixc-customer-result-heading"><span className="mini-avatar large-avatar">{ixcCustomer.razaoSocial.slice(0, 1).toUpperCase() || 'C'}</span><div><strong>{ixcCustomer.razaoSocial || 'Assinante sem nome informado'}</strong><small>Cadastro localizado no IXC · consultado em {new Date(ixcCustomer.consultadoEm).toLocaleString('pt-BR')}</small></div></div>
        <dl>
          <div><dt>CPF</dt><dd>{formatCpf(ixcCustomer.cpfCnpj)}</dd></div>
          <div><dt>Código IXC</dt><dd>{ixcCustomer.id || '—'}</dd></div>
          <div><dt>Contrato</dt><dd>{ixcCustomer.situacaoContrato || 'Não informado'}</dd></div>
          <div><dt>Endereço</dt><dd>{ixcCustomer.enderecos.length ? ixcCustomer.enderecos.join(' / ') : 'Não informado no IXC'}</dd></div>
          <div><dt>Contas em aberto</dt><dd>{ixcCustomer.financeiro.contasEmAberto === null ? 'Indisponível' : `${ixcCustomer.financeiro.contasEmAberto} · ${formatMoney(ixcCustomer.financeiro.valorEmAberto)}`}</dd></div>
          <div><dt>Contas vencidas</dt><dd>{ixcCustomer.financeiro.contasVencidas === null ? 'Indisponível' : `${ixcCustomer.financeiro.contasVencidas} · ${formatMoney(ixcCustomer.financeiro.valorVencido)}`}</dd></div>
        </dl>
        <section className="ixc-contracts" aria-label="Cadastros, contratos e logins do assinante">
          <h3>Cadastros e acessos · {ixcCustomer.cadastrosIxc.length} cadastro{ixcCustomer.cadastrosIxc.length === 1 ? '' : 's'} no IXC</h3>
          {ixcCustomer.cadastrosIxc.map((registration) => <section className="ixc-registration-card" key={registration.id}>
            <header><div><strong>{registration.nome}</strong><small>Cadastro IXC #{registration.id}</small></div><span>{registration.situacao || 'Situação não informada'}</span></header>
            {registration.contratos.map((contract) => <section className="ixc-contract-card" key={`${registration.id}-${contract.id || 'sem-id'}`}>
              <header><strong>Contrato {contract.id ? `#${contract.id}` : ''}</strong><span>{contract.situacao || 'Situação não informada'}</span></header>
              <p>Internet: <strong>{contract.situacaoInternet || 'Situação não informada'}</strong>{contract.endereco ? ` · ${contract.endereco}` : ''}</p>
              {contract.logins.length ? <div className="ixc-login-list">{contract.logins.map((access, index) => <div className="ixc-login-row" key={access.id || `${access.login}-${index}`}><strong>{access.login || 'Login sem identificação'}</strong><span>Acesso: {access.ativo === 'Sim' ? 'Ativo' : access.ativo === 'Não' ? 'Inativo' : access.ativo || 'Sem status'}</span><span>Conexão: {access.online === 'Sim' ? 'Online' : access.online === 'Não' ? 'Offline' : access.online || 'Sem status'}</span><small className="ixc-onu-line">{describeOnu(access.onu)}</small></div>)}</div> : <p className="ixc-access-empty">Nenhum login associado a este contrato.</p>}
            </section>)}
            {registration.loginsSemContrato.length > 0 && <section className="ixc-contract-card"><header><strong>Logins sem vínculo de contrato</strong></header><div className="ixc-login-list">{registration.loginsSemContrato.map((access, index) => <div className="ixc-login-row" key={access.id || `${access.login}-${index}`}><strong>{access.login || 'Login sem identificação'}</strong><span>Acesso: {access.ativo === 'Sim' ? 'Ativo' : access.ativo === 'Não' ? 'Inativo' : access.ativo || 'Sem status'}</span><span>Conexão: {access.online === 'Sim' ? 'Online' : access.online === 'Não' ? 'Offline' : access.online || 'Sem status'}</span><small className="ixc-onu-line">{describeOnu(access.onu)}</small></div>)}</div></section>}
            {registration.contratos.length === 0 && registration.loginsSemContrato.length === 0 && <p className="ixc-access-empty">Nenhum contrato ou login localizado neste cadastro.</p>}
          </section>)}
        </section>
        {!ixcCustomer.financeiro.disponivel && <small className="ixc-data-note">O IXC não permitiu consultar as contas a receber. Confira as permissões do usuário da API.</small>}
      </article>}
    </section>
    <section className="stats-grid customer-stats"><article className="stat-card"><div className="stat-top"><span>Clientes encontrados</span><span className="stat-icon purple">♙</span></div><strong>{loading ? '—' : customers.length}</strong><small>{search ? 'Correspondências da busca' : 'No cadastro'}</small></article><article className="stat-card"><div className="stat-top"><span>Chamados registrados</span><span className="stat-icon blue">▤</span></div><strong>{loading ? '—' : ticketsCount}</strong><small>Entre os clientes exibidos</small></article><article className="stat-card"><div className="stat-top"><span>Com chamados ativos</span><span className="stat-icon amber">◷</span></div><strong>{loading ? '—' : activeCount}</strong><small>Aguardando ou em atendimento</small></article></section>
    <section className="panel directory-panel"><div className="panel-heading directory-heading"><div><h2>Lista de clientes</h2><p>Quem se cadastrar pelo app móvel aparece aqui automaticamente. Pesquise por nome ou telefone.</p></div><label className="search-box"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nome ou telefone..." aria-label="Buscar por nome ou telefone"/>{search && <button type="button" onClick={() => setSearch('')} aria-label="Limpar busca">×</button>}</label></div>
    {error && <div className="inline-error">{error}</div>}{loading ? <div className="empty-state"><div className="loader"/><strong>Buscando clientes</strong></div> : customers.length === 0 ? <div className="empty-state"><div className="empty-icon">♙</div><strong>{search ? 'Nenhum cliente encontrado' : 'Nenhum cliente cadastrado ainda'}</strong><span>{search ? 'Confira a grafia do nome ou tente outro número.' : 'Quando clientes criarem uma conta, eles aparecerão aqui.'}</span>{!search && <Link href="/register" className="subtle-link">Abrir cadastro do cliente →</Link>}</div> : <div className="table-scroll"><table className="ticket-table customer-table"><thead><tr><th>CLIENTE</th><th>TELEFONE</th><th>E-MAIL</th><th>CHAMADOS</th><th>ÚLTIMA SOLICITAÇÃO</th><th/></tr></thead><tbody>{customers.map((customer) => { const recent = customer.ticketsCreated[0]; return <tr key={customer.id}><td><div className="customer-cell"><span className="mini-avatar large-avatar">{customer.name.slice(0, 1).toUpperCase()}</span><div><strong className="customer-name">{customer.name}</strong><span className="row-subtitle">Cliente desde {new Date(customer.createdAt).toLocaleDateString('pt-BR')}</span></div></div></td><td>{formatPhone(customer.phone)}</td><td>{customer.email}</td><td><span className="count-badge">{customer._count.ticketsCreated}</span></td><td>{recent ? <Link className="protocol-link" href={`/tickets/${recent.id}`}>{recent.protocol}</Link> : <span className="muted">Sem chamados</span>}</td><td>{recent && <Link className="row-arrow" href={`/tickets/${recent.id}`} aria-label="Abrir chamado recente">→</Link>}</td></tr>; })}</tbody></table></div>}
    {!loading && customers.length > 0 && <div className="panel-footer">Exibindo <strong>{customers.length}</strong> cliente{customers.length === 1 ? '' : 's'}{search ? ` para “${search}”` : ''}{customers.length >= 100 ? ' · limite de 100 resultados' : ''}</div>}</section><footer className="page-footer">Canal Direto <span>·</span> Atendimento próximo e sem complicação</footer></div></main></div>;
}
