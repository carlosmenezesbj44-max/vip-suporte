'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { attachAuthInterceptor, api } from '@/lib/api';
import { clearSession, getCurrentUser, updateCurrentUser } from '@/lib/auth';
import { getTicketsSocket } from '@/lib/socket';
import type { AuthenticatedUser, Ticket } from '@canal-direto/shared';
import { TicketChannel, TicketDepartment, ticketDepartmentOrder, TicketStatus, UserRole } from '@canal-direto/shared';

attachAuthInterceptor();

const statusLabels: Record<string, string> = {
  OPEN: 'Aberto', IN_PROGRESS: 'Em atendimento', WAITING_CUSTOMER: 'Aguardando cliente', RESOLVED: 'Resolvido', CLOSED: 'Encerrado',
};
const categoryLabels: Record<string, string> = {
  CONNECTION_DOWN: 'Sem conexão', SLOW_CONNECTION: 'Internet lenta', BILLING: 'Financeiro', EQUIPMENT: 'Equipamento', CONTRACT: 'Contrato', OTHER: 'Outro',
};
const channelLabels: Record<string, string> = { PORTAL: 'Portal', WHATSAPP: 'WhatsApp', PHONE: 'Telefone', EMAIL: 'E-mail', OTHER: 'Outro' };
const departmentLabels: Record<string, string> = { COMMERCIAL: 'Comercial', FINANCE: 'Financeiro', SUPPORT_N1: 'Suporte N1', SUPPORT_N2: 'Suporte N2', FIELD: 'Campo' };

function latestTicketTransfer(ticket: Ticket) {
  return ticket.transfers?.reduce<NonNullable<Ticket['transfers']>[number] | undefined>((latest, transfer) => !latest || new Date(transfer.createdAt) > new Date(latest.createdAt) ? transfer : latest, undefined);
}

function hasPendingSectorTransfer(ticket: Ticket) {
  const transfer = latestTicketTransfer(ticket);
  return ticket.status === TicketStatus.OPEN && !ticket.assignedToId && !!transfer
    && transfer.fromDepartment !== transfer.toDepartment && transfer.toDepartment === ticket.department;
}

export default function DashboardPage() {
  const router = useRouter();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('TODOS');
  const [queueAlertFilter, setQueueAlertFilter] = useState<'ALL' | 'WAITING' | 'TRANSFERRED'>('ALL');
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [agents, setAgents] = useState<Array<{ id: string; name: string; role: UserRole }>>([]);
  const [assigneeFilter, setAssigneeFilter] = useState('TODOS');
  const [channelFilter, setChannelFilter] = useState('TODOS');
  const [departmentFilter, setDepartmentFilter] = useState('TODOS');
  const ticketsRef = useRef<Ticket[]>([]);
  const socketRef = useRef<ReturnType<typeof getTicketsSocket> | null>(null);
  const isAgent = user?.role === UserRole.AGENT || user?.role === UserRole.TECHNICIAN || user?.role === UserRole.ADMIN;

  useEffect(() => { ticketsRef.current = tickets; }, [tickets]);

  useEffect(() => {
    const currentUser = getCurrentUser();
    setUser(currentUser);
    if (!currentUser) { router.push('/'); return; }
    api.get('/tickets')
      .then(({ data }) => setTickets(data))
      .catch(() => setError('Não foi possível carregar os chamados. Tente novamente.'))
      .finally(() => setLoading(false));
    let stillMounted = true;
    api.get('/auth/me').then(({ data }) => {
      if (!stillMounted) return;
      setUser(data);
      updateCurrentUser(data);
      if ([UserRole.ADMIN, UserRole.AGENT, UserRole.TECHNICIAN].includes(data.role)) {
        api.get('/users').then(({ data: users }) => { if (stillMounted) setAgents(users); }).catch(() => { if (stillMounted) setAgents([]); });
      } else setAgents([]);
    }).catch(() => {
      // Mantém a sessão em cache se a atualização do perfil estiver indisponível.
      if (currentUser.role !== UserRole.CUSTOMER) {
        api.get('/users').then(({ data }) => { if (stillMounted) setAgents(data); }).catch(() => { if (stillMounted) setAgents([]); });
      }
    });
    return () => { stillMounted = false; };
  }, []);

  useEffect(() => {
    if (!user) return;
    const socket = getTicketsSocket();
    socketRef.current = socket;
    const joinVisibleTickets = () => {
      ticketsRef.current.forEach((ticket) => socket.emit('joinTicket', ticket.id));
      api.get('/tickets').then(({ data }) => {
        setTickets(data);
        data.forEach((ticket: Ticket) => socket.emit('joinTicket', ticket.id));
      }).catch(() => undefined);
    };
    const handleTicketUpdated = (updated: Ticket) => {
      setTickets((current) => current.map((ticket) => ticket.id === updated.id ? { ...ticket, ...updated } : ticket));
    };
    const handleTicketCreated = (created: Ticket) => {
      setTickets((current) => current.some((ticket) => ticket.id === created.id) ? current : [created, ...current]);
    };
    const syncOnFocus = () => {
      if (document.visibilityState === 'visible') joinVisibleTickets();
    };

    socket.on('connect', joinVisibleTickets);
    socket.on('ticketUpdated', handleTicketUpdated);
    socket.on('ticketCreated', handleTicketCreated);
    document.addEventListener('visibilitychange', syncOnFocus);
    const refreshInterval = window.setInterval(() => {
      if (document.visibilityState === 'visible') joinVisibleTickets();
    }, 5_000);
    if (socket.connected) joinVisibleTickets();

    return () => {
      socket.off('connect', joinVisibleTickets);
      socket.off('ticketUpdated', handleTicketUpdated);
      socket.off('ticketCreated', handleTicketCreated);
      document.removeEventListener('visibilitychange', syncOnFocus);
      window.clearInterval(refreshInterval);
      socketRef.current = null;
    };
  }, [user]);

  useEffect(() => {
    const socket = socketRef.current;
    if (socket?.connected) tickets.forEach((ticket) => socket.emit('joinTicket', ticket.id));
  }, [tickets]);

  const filteredTickets = useMemo(() => {
    let result = tickets;
    if (filter === 'TODOS' && isAgent) result = result.filter((ticket) => ticket.status !== TicketStatus.CLOSED);
    else if (filter === 'FILA_ESPERA') result = result.filter((ticket) => ticket.status === TicketStatus.OPEN || ticket.status === TicketStatus.WAITING_CUSTOMER);
    else if (filter === 'FILA_ANDAMENTO') result = result.filter((ticket) => ticket.status === TicketStatus.IN_PROGRESS);
    else if (filter !== 'TODOS') result = result.filter((ticket) => ticket.status === filter);
    if (queueAlertFilter === 'WAITING') result = result.filter((ticket) => !ticket.assignedToId && ticket.status === TicketStatus.OPEN);
    else if (queueAlertFilter === 'TRANSFERRED') result = result.filter(hasPendingSectorTransfer);
    if (assigneeFilter === 'SEM_RESPONSAVEL') result = result.filter((ticket) => !ticket.assignedToId);
    else if (assigneeFilter !== 'TODOS') result = result.filter((ticket) => ticket.assignedToId === assigneeFilter);
    if (channelFilter !== 'TODOS') result = result.filter((ticket) => (ticket.channel || 'PORTAL') === channelFilter);
    if (departmentFilter !== 'TODOS') result = result.filter((ticket) => ticket.department === departmentFilter);
    return result;
  }, [assigneeFilter, channelFilter, departmentFilter, filter, isAgent, queueAlertFilter, tickets]);

  async function assignTicket(ticket: Ticket, assignedToId: string | null) {
    try {
      const { data } = await api.patch(`/tickets/${ticket.id}`, { assignedToId });
      setTickets((current) => current.map((item) => item.id === ticket.id ? { ...item, ...data } : item));
    } catch {
      setError('Não foi possível atualizar o responsável. Tente novamente.');
    }
  }

  function handleLogout() { clearSession(); router.push('/'); }
  const openCount = tickets.filter((ticket) => ticket.status === TicketStatus.OPEN).length;
  const inProgressCount = tickets.filter((ticket) => ticket.status === TicketStatus.IN_PROGRESS).length;
  const waitingCount = tickets.filter((ticket) => ticket.status === TicketStatus.OPEN || ticket.status === TicketStatus.WAITING_CUSTOMER).length;
  const waitingUnassignedCount = tickets.filter((ticket) => !ticket.assignedToId && ticket.status === TicketStatus.OPEN).length;
  const transferredUnassignedCount = tickets.filter(hasPendingSectorTransfer).length;
  const activeQueue = filter === 'FILA_ESPERA' || filter === TicketStatus.OPEN || filter === TicketStatus.WAITING_CUSTOMER
    ? 'FILA_ESPERA'
    : filter === 'FILA_ANDAMENTO' || filter === TicketStatus.IN_PROGRESS ? 'FILA_ANDAMENTO' : '';
  const ticketsHeading = !isAgent ? 'Seus chamados' : activeQueue === 'FILA_ESPERA' ? 'Atendimento em espera' : activeQueue === 'FILA_ANDAMENTO' ? 'Atendimento em andamento' : 'Chamados recentes';

  return (
    <div className="workspace">
      <aside className="sidebar">
        <Link href="/dashboard" className="brand"><span className="brand-mark">C</span><span>canal<span className="brand-light">direto</span><small>ATENDIMENTO</small></span></Link>
        <div className="nav-label">MENU PRINCIPAL</div>
        <Link href="/dashboard" onClick={() => setFilter('TODOS')} className={`nav-item${filter === 'TODOS' ? ' active' : ''}`} aria-current={filter === 'TODOS' ? 'page' : undefined} title="Visão geral"><span className="nav-icon">▦</span> Visão geral</Link>
        {isAgent && <>
          <button type="button" className={`nav-item queue-nav-item${activeQueue === 'FILA_ESPERA' ? ' active' : ''}`} onClick={() => setFilter('FILA_ESPERA')} aria-pressed={activeQueue === 'FILA_ESPERA'} aria-label={`Atendimento em espera: ${waitingCount} chamados`} title="Atendimento em espera"><span className="nav-icon">◷</span><span className="nav-copy">Atendimento em espera</span><span className="nav-count">{loading ? '—' : waitingCount}</span></button>
          <button type="button" className={`nav-item queue-nav-item${activeQueue === 'FILA_ANDAMENTO' ? ' active' : ''}`} onClick={() => setFilter('FILA_ANDAMENTO')} aria-pressed={activeQueue === 'FILA_ANDAMENTO'} aria-label={`Atendimento em andamento: ${inProgressCount} chamados`} title="Atendimento em andamento"><span className="nav-icon">↗</span><span className="nav-copy">Atendimento em andamento</span><span className="nav-count">{loading ? '—' : inProgressCount}</span></button>
          <Link href="/customers" className="nav-item" title="Clientes"><span className="nav-icon">♙</span> Clientes</Link>
          <Link href="/settings" className="nav-item" title="Configurações"><span className="nav-icon">⚙</span> Configurações</Link>
        </>}
        {!isAgent && <Link href="/tickets/new" className="nav-item"><span className="nav-icon">＋</span> Novo chamado</Link>}
        <div className="sidebar-bottom"><div className="profile-avatar">{user?.name?.slice(0, 1).toUpperCase() || 'U'}</div><div className="profile-copy"><strong>{user?.name || 'Usuário'}</strong><span>{isAgent ? 'Equipe de atendimento' : 'Área do cliente'}</span></div><button className="icon-button logout" onClick={handleLogout} title="Sair">↗</button></div>
      </aside>

      <main className="main-area">
        <header className="topbar"><div className="breadcrumb">Atendimento <span>/</span> {isAgent ? 'Visão geral' : 'Meus chamados'}</div><div className="topbar-right"><span className="online-dot"/> Sistema operacional <div className="top-avatar">{user?.name?.slice(0, 1).toUpperCase() || 'U'}</div></div></header>
        <div className="content-area">
          <div className="page-heading"><div><div className="eyebrow">{isAgent ? 'CENTRAL DE ATENDIMENTO' : 'PORTAL DO CLIENTE'}</div><h1>{isAgent ? 'Visão geral' : 'Olá, ' + (user?.name?.split(' ')[0] || 'cliente')}</h1><p>{isAgent ? 'Acompanhe e gerencie as solicitações dos seus clientes.' : 'Acompanhe suas solicitações e fale com nossa equipe.'}</p></div>{!isAgent && <Link className="primary-action" href="/tickets/new"><span>＋</span> Abrir chamado</Link>}</div>

          <section className="stats-grid">
            <article className="stat-card"><div className="stat-top"><span>Total de chamados</span><span className="stat-icon purple">▤</span></div><strong>{loading ? '—' : tickets.length}</strong><small>Solicitações registradas</small></article>
            <article className="stat-card"><div className="stat-top"><span>Abertos</span><span className="stat-icon amber">◷</span></div><strong>{loading ? '—' : openCount}</strong><small>Aguardando atendimento</small></article>
            <article className="stat-card"><div className="stat-top"><span>Em atendimento</span><span className="stat-icon blue">↗</span></div><strong>{loading ? '—' : inProgressCount}</strong><small>Com a equipe técnica</small></article>
            <article className="stat-card"><div className="stat-top"><span>Resolvidos</span><span className="stat-icon green">✓</span></div><strong>{loading ? '—' : tickets.filter((ticket) => ticket.status === TicketStatus.RESOLVED || ticket.status === TicketStatus.CLOSED).length}</strong><small>Concluídos</small></article>
          </section>

          <section className="panel tickets-panel">
            <div className="panel-heading"><div><h2>{isAgent ? 'Caixa de entrada' : ticketsHeading}</h2><p>{isAgent ? 'Chamados compartilhados da equipe, com canal, setor e responsável.' : 'Histórico e atualizações das suas solicitações.'}</p></div><div className="table-controls"><label className="select-wrap"><span>◉</span><select value={filter} onChange={(event) => { setFilter(event.target.value); setQueueAlertFilter('ALL'); }}><option value="TODOS">{isAgent ? 'Atendimentos ativos' : 'Todos os status'}</option>{isAgent && <><option value="FILA_ESPERA">Atendimento em espera</option><option value="FILA_ANDAMENTO">Atendimento em andamento</option></>}{Object.values(TicketStatus).map((status) => <option value={status} key={status}>{statusLabels[status]}</option>)}</select></label>{isAgent && <><label className="select-wrap"><select aria-label="Filtrar por setor" value={departmentFilter} onChange={(event) => setDepartmentFilter(event.target.value)}><option value="TODOS">Todos os setores</option>{ticketDepartmentOrder.map((department) => <option value={department} key={department}>{departmentLabels[department]}</option>)}</select></label><label className="select-wrap"><select aria-label="Filtrar por atendente" value={assigneeFilter} onChange={(event) => setAssigneeFilter(event.target.value)}><option value="TODOS">Todos atendentes</option><option value="SEM_RESPONSAVEL">Sem responsável</option>{agents.map((agent) => <option value={agent.id} key={agent.id}>{agent.name}</option>)}</select></label><label className="select-wrap"><select aria-label="Filtrar por canal" value={channelFilter} onChange={(event) => setChannelFilter(event.target.value)}><option value="TODOS">Todos canais</option>{Object.values(TicketChannel).map((channel) => <option key={channel} value={channel}>{channelLabels[channel]}</option>)}</select></label></>}<button className="icon-button refresh-button" onClick={() => { setLoading(true); api.get('/tickets').then(({ data }) => setTickets(data)).catch(() => setError('Falha ao atualizar chamados.')).finally(() => setLoading(false)); }} title="Atualizar">↻</button></div></div>
            {isAgent && !loading && (waitingUnassignedCount > 0 || transferredUnassignedCount > 0) && <div className="queue-alerts" aria-label="Alertas da fila">
              {waitingUnassignedCount > 0 && <button type="button" className={`queue-alert queue-alert-waiting${queueAlertFilter === 'WAITING' ? ' is-selected' : ''}`} onClick={() => { setFilter('FILA_ESPERA'); setAssigneeFilter('TODOS'); setQueueAlertFilter(queueAlertFilter === 'WAITING' ? 'ALL' : 'WAITING'); }}><span className="queue-alert-icon">◷</span><span><strong>{waitingUnassignedCount} {waitingUnassignedCount === 1 ? 'chamado aguardando' : 'chamados aguardando'}</strong><small>Sem atendente atribuído · clique para ver</small></span><b>→</b></button>}
              {transferredUnassignedCount > 0 && <button type="button" className={`queue-alert queue-alert-transfer${queueAlertFilter === 'TRANSFERRED' ? ' is-selected' : ''}`} onClick={() => { setFilter('FILA_ESPERA'); setAssigneeFilter('TODOS'); setQueueAlertFilter(queueAlertFilter === 'TRANSFERRED' ? 'ALL' : 'TRANSFERRED'); }}><span className="queue-alert-icon">⇄</span><span><strong>{transferredUnassignedCount} {transferredUnassignedCount === 1 ? 'transferência pendente' : 'transferências pendentes'}</strong><small>Chegou a um setor · aguardando atribuição</small></span><b>→</b></button>}
            </div>}
            {error && <div className="inline-error">{error}</div>}
            {loading ? <div className="empty-state"><div className="loader"/><strong>Carregando chamados</strong><span>Buscando as solicitações mais recentes.</span></div> : filteredTickets.length === 0 ? <div className="empty-state"><div className="empty-icon">▤</div><strong>{activeQueue ? `Nenhum atendimento ${activeQueue === 'FILA_ESPERA' ? 'em espera' : 'em andamento'}` : tickets.length ? 'Nenhum chamado neste filtro' : 'Sua fila está tranquila'}</strong><span>{activeQueue ? 'Novos chamados aparecerão aqui quando entrarem nessa etapa.' : tickets.length ? 'Altere os filtros para ver outras solicitações.' : 'Quando um cliente abrir um chamado, ele aparecerá aqui.'}</span>{!tickets.length && <Link href={isAgent ? '/customers' : '/tickets/new'} className="subtle-link">{isAgent ? 'Ver área de clientes →' : 'Abrir primeiro chamado →'}</Link>}</div> : <div className="table-scroll"><table className="ticket-table"><thead><tr><th>PROTOCOLO</th><th>ASSUNTO</th><th>CLIENTE</th><th>SETOR</th><th>CANAL</th><th>RESPONSÁVEL</th><th>CATEGORIA</th><th>STATUS</th><th>ABERTO EM</th><th/></tr></thead><tbody>{filteredTickets.map((ticket: Ticket & { customer?: { name: string }; assignedTo?: { name: string } }) => { const transferPending = hasPendingSectorTransfer(ticket); const waitingForAgent = !ticket.assignedToId && ticket.status === TicketStatus.OPEN; return <tr key={ticket.id} className={transferPending ? 'ticket-row-transferred' : waitingForAgent ? 'ticket-row-waiting' : ''}><td><Link className="protocol-link" href={`/tickets/${ticket.id}`}>{ticket.protocol}</Link></td><td><Link className="subject-link" href={`/tickets/${ticket.id}`}>{ticket.title}</Link><span className="row-subtitle">Prioridade {ticket.priority === 'MEDIUM' ? 'média' : ticket.priority.toLowerCase()}</span>{transferPending ? <span className="queue-row-alert queue-row-transfer">⇄ Transferido para {departmentLabels[ticket.department]} · aguardando atribuição</span> : waitingForAgent ? <span className="queue-row-alert queue-row-waiting">◷ Aguardando atendente</span> : null}</td><td><div className="customer-cell"><span className="mini-avatar">{ticket.customer?.name?.slice(0, 1).toUpperCase() || 'C'}</span><span>{ticket.customer?.name || 'Você'}</span></div></td><td><span className="department-badge">{departmentLabels[ticket.department || TicketDepartment.COMMERCIAL]}</span></td><td>{channelLabels[ticket.channel || 'PORTAL'] || 'Portal'}</td><td>{isAgent ? <><select className="row-assignee" aria-label={`Responsável do chamado ${ticket.protocol}`} value={ticket.assignedToId || ''} onChange={(event) => void assignTicket(ticket, event.target.value || null)}><option value="">Sem responsável</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select>{!ticket.assignedToId && <button className="take-ticket" onClick={() => void assignTicket(ticket, user!.id)}>Assumir</button>}</> : ticket.assignedTo?.name || '—'}</td><td>{categoryLabels[ticket.category] || ticket.category}</td><td><span className={`status-pill status-${ticket.status.toLowerCase()}`}><i/>{statusLabels[ticket.status] || ticket.status}</span></td><td>{new Date(ticket.createdAt).toLocaleDateString('pt-BR')}</td><td><Link className="row-arrow" href={`/tickets/${ticket.id}`}>→</Link></td></tr>;})}</tbody></table></div>}
            {tickets.length > 0 && <div className="panel-footer">Exibindo <strong>{filteredTickets.length}</strong> de <strong>{tickets.length}</strong> chamados</div>}
          </section>
          <footer className="page-footer">Canal Direto <span>·</span> Atendimento próximo e sem complicação</footer>
        </div>
      </main>
    </div>
  );
}
