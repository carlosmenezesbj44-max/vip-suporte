'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent, KeyboardEvent } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { attachAuthInterceptor, api } from '@/lib/api';
import { clearSession, getCurrentUser, updateCurrentUser } from '@/lib/auth';
import { getTicketsSocket } from '@/lib/socket';
import '../../settings/diagnostic-flow/flow.css';
import type { AuthenticatedUser, ConnectionDiagnostic, DiagnosticCheck, Ticket, TicketAttachment, TicketMessage, TicketTransfer } from '@canal-direto/shared';
import { AgentAvailability, TicketCategory, TicketDepartment, ticketDepartmentOrder, TicketStatus, UserRole } from '@canal-direto/shared';

attachAuthInterceptor();

const statusLabels: Record<string, string> = {
  OPEN: 'Aberto', IN_PROGRESS: 'Em atendimento', WAITING_CUSTOMER: 'Aguardando cliente', RESOLVED: 'Resolvido', CLOSED: 'Encerrado',
};
const categoryLabels: Record<string, string> = {
  CONNECTION_DOWN: 'Sem conexão', SLOW_CONNECTION: 'Internet lenta', BILLING: 'Financeiro', EQUIPMENT: 'Equipamento', CONTRACT: 'Contrato', OTHER: 'Outro',
};
const priorityLabels: Record<string, string> = { LOW: 'Baixa', MEDIUM: 'Média', HIGH: 'Alta', URGENT: 'Urgente' };
const departmentLabels: Record<string, string> = { COMMERCIAL: 'Comercial', FINANCE: 'Financeiro', SUPPORT_N1: 'Suporte N1', SUPPORT_N2: 'Suporte N2', FIELD: 'Campo' };
const roleLabels: Record<string, string> = { ADMIN: 'Administrador', AGENT: 'Atendente', TECHNICIAN: 'Técnico' };
const diagnosticLabels = { billing: 'Financeiro', pppoe: 'PPPoE', optical: 'ONU / potência óptica', incident: 'Incidentes' } as const;

function DiagnosticResult({ title, check }: { title: string; check: DiagnosticCheck }) {
  const statusLabel = { OK: 'Normal', WARNING: 'Atenção', CRITICAL: 'Crítico', UNAVAILABLE: 'Indisponível' }[check.status];
  return <div className={`diagnostic-check diagnostic-${check.status.toLowerCase()}`}>
    <div><strong>{title}</strong><span>{statusLabel}</span></div>
    <p>{check.summary}</p>
    {check.details.length > 0 && <ul>{check.details.map((detail, index) => <li key={`${title}-${index}`}>{detail}</li>)}</ul>}
  </div>;
}

type TicketDetail = Ticket & {
  customer?: { id?: string; name?: string };
  assignedTo?: { id?: string; name?: string } | null;
  messages: TicketMessage[];
  transfers?: TicketTransfer[];
};
type TeamMember = { id: string; name: string; role: UserRole; isActive: boolean };

function MessageAttachment({ ticketId, attachment }: { ticketId: string; attachment: TicketAttachment }) {
  const [previewUrl, setPreviewUrl] = useState('');
  const isImage = attachment.mimeType.startsWith('image/');
  useEffect(() => {
    if (!isImage || attachment.size > 12 * 1024 * 1024) return;
    let active = true;
    let objectUrl = '';
    api.get(`/tickets/${ticketId}/attachments/${attachment.id}`, { responseType: 'blob' }).then(({ data }) => {
      objectUrl = URL.createObjectURL(data);
      if (active) setPreviewUrl(objectUrl);
      else URL.revokeObjectURL(objectUrl);
    }).catch(() => undefined);
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [attachment.id, attachment.size, isImage, ticketId]);

  async function download() {
    try {
      const { data } = await api.get(`/tickets/${ticketId}/attachments/${attachment.id}`, { responseType: 'blob' });
      const url = URL.createObjectURL(data);
      const link = document.createElement('a');
      link.href = url;
      link.download = attachment.name;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      window.alert('Não foi possível baixar este arquivo. Tente novamente.');
    }
  }

  return <div className="message-attachment">
    {isImage && previewUrl ? <button type="button" className="message-image-button" onClick={() => void download()} aria-label={`Baixar ${attachment.name}`}><img className="message-image" src={previewUrl} alt={attachment.name}/></button> : null}
    <button type="button" className="message-file-link" onClick={() => void download()}><span aria-hidden="true">↓</span><span>{attachment.name}</span><small>{Math.max(1, Math.round(attachment.size / 1024))} KB</small></button>
  </div>;
}

function initials(name = '') {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'U';
}

function formatDate(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export default function TicketDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [diagnostic, setDiagnostic] = useState<ConnectionDiagnostic | null>(null);
  const [diagnosticLoading, setDiagnosticLoading] = useState(false);
  const [diagnosticError, setDiagnosticError] = useState('');
  const [queueTickets, setQueueTickets] = useState<Array<Ticket & { customer?: { name?: string }; lastMessage?: string }>>([]);
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueLoadFailed, setQueueLoadFailed] = useState(false);
  const [queueSearch, setQueueSearch] = useState('');
  const [newMessage, setNewMessage] = useState('');
  const [selectedAttachment, setSelectedAttachment] = useState<File | null>(null);
  const [sendingAttachment, setSendingAttachment] = useState(false);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [connected, setConnected] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [claimingTicket, setClaimingTicket] = useState(false);
  const [updatingDepartment, setUpdatingDepartment] = useState(false);
  const [transferNote, setTransferNote] = useState('');
  const [selectedDepartment, setSelectedDepartment] = useState<TicketDepartment>(TicketDepartment.COMMERCIAL);
  const [selectedAssigneeId, setSelectedAssigneeId] = useState('');
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [teamMembersFailed, setTeamMembersFailed] = useState(false);
  const [presenceSaving, setPresenceSaving] = useState(false);
  const [presenceError, setPresenceError] = useState('');
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const conversationBodyRef = useRef<HTMLDivElement>(null);
  const shouldFollowConversationRef = useRef(true);
  const forceScrollAfterSendRef = useRef(false);

  const isAgent = user?.role === UserRole.AGENT || user?.role === UserRole.TECHNICIAN || user?.role === UserRole.ADMIN;
  const activeQueueTickets = useMemo(() => queueTickets.filter((item) => item.status !== TicketStatus.CLOSED), [queueTickets]);
  const filteredQueueTickets = useMemo(() => {
    const query = queueSearch.trim().toLocaleLowerCase('pt-BR');
    if (!query) return activeQueueTickets;
    return activeQueueTickets.filter((item) => [item.customer?.name, item.title, item.protocol].some((value) => value?.toLocaleLowerCase('pt-BR').includes(query)));
  }, [activeQueueTickets, queueSearch]);
  const loadTicket = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get(`/tickets/${params.id}`);
      setTicket({ ...data, messages: data.messages ?? [] });
      setSelectedDepartment(data.department || TicketDepartment.COMMERCIAL);
      setSelectedAssigneeId('');
    } catch {
      setError('Não foi possível carregar este chamado. Verifique sua conexão e tente novamente.');
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  const syncTicketConversation = useCallback(async () => {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    try {
      const { data } = await api.get(`/tickets/${params.id}`);
      setTicket((previous) => previous ? { ...previous, ...data, messages: data.messages ?? [] } : { ...data, messages: data.messages ?? [] });
    } catch { /* Socket reconnection or the next refresh will retry without clearing the conversation. */ }
  }, [params.id]);

  const runConnectionDiagnostic = useCallback(async () => {
    if (!ticket?.id || !ticket.ixcCustomerId) return;
    setDiagnosticLoading(true);
    setDiagnosticError('');
    try {
      const { data } = await api.post(`/tickets/${ticket.id}/diagnostic`);
      setDiagnostic(data);
    } catch (diagnosticFailure: any) {
      const message = diagnosticFailure?.response?.data?.message;
      setDiagnosticError(Array.isArray(message) ? message.join(' ') : message || 'Não foi possível consultar o diagnóstico. Confira o vínculo e as permissões da API do IXC.');
      setDiagnostic(null);
    } finally {
      setDiagnosticLoading(false);
    }
  }, [ticket?.id, ticket?.ixcCustomerId]);

  useEffect(() => {
    if (!isAgent || ticket?.category !== TicketCategory.CONNECTION_DOWN || !ticket.ixcCustomerId) return;
    void runConnectionDiagnostic();
  }, [isAgent, runConnectionDiagnostic, ticket?.category, ticket?.ixcCustomerId]);

  useEffect(() => {
    const currentUser = getCurrentUser();
    setUser(currentUser);
    if (!currentUser) {
      router.push('/');
      return;
    }
    if ([UserRole.AGENT, UserRole.TECHNICIAN, UserRole.ADMIN].includes(currentUser.role)) {
      api.get('/auth/me').then(({ data }) => {
        setUser(data);
        updateCurrentUser(data);
      }).catch(() => undefined);
    }
    void loadTicket();

    // Mantém a sala deste chamado conectada para receber novas mensagens e mudanças de status.
    const socket = getTicketsSocket();
    function handleConnect() {
      setConnected(true);
      socket.emit('joinTicket', params.id);
      void syncTicketConversation();
      if (isAgent) api.get('/tickets').then(({ data }) => setQueueTickets(data)).catch(() => undefined);
    }
    function handleDisconnect() { setConnected(false); }
    function handleNewMessage(message: TicketMessage) {
      const preview = message.message || (message.attachments?.[0] ? `📎 ${message.attachments[0].name}` : 'Nova mensagem');
      setQueueTickets((previous) => previous.map((item) => item.id === message.ticketId ? { ...item, lastMessage: preview } : item));
      if (message.ticketId === params.id) setTicket((previous) => {
          if (!previous || previous.messages.some((item) => item.id === message.id)) return previous;
          return { ...previous, messages: [...previous.messages, message] };
        });
    }
    function handleTicketUpdated(updated: Ticket) {
      setQueueTickets((previous) => previous.map((item) => item.id === updated.id ? { ...item, ...updated } : item));
      if (updated.id === params.id) setTicket((previous) => previous ? { ...previous, ...updated } : previous);
    }
    function handleTicketCreated(created: Ticket & { customer?: { name?: string } }) {
      if (isAgent) setQueueTickets((previous) => previous.some((item) => item.id === created.id) ? previous : [created, ...previous]);
    }

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('newMessage', handleNewMessage);
    socket.on('ticketUpdated', handleTicketUpdated);
    socket.on('ticketCreated', handleTicketCreated);
    if (socket.connected) handleConnect();

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('newMessage', handleNewMessage);
      socket.off('ticketUpdated', handleTicketUpdated);
      socket.off('ticketCreated', handleTicketCreated);
    };
  }, [isAgent, loadTicket, params.id, router, syncTicketConversation]);

  useEffect(() => {
    const refreshConversation = () => { void syncTicketConversation(); };
    const interval = window.setInterval(refreshConversation, 5_000);
    document.addEventListener('visibilitychange', refreshConversation);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refreshConversation);
    };
  }, [syncTicketConversation]);

  useEffect(() => {
    if (!isAgent) return;
    setQueueLoading(true);
    setQueueLoadFailed(false);
    api.get('/tickets').then(({ data }) => setQueueTickets(data)).catch(() => { setQueueTickets([]); setQueueLoadFailed(true); }).finally(() => setQueueLoading(false));
  }, [isAgent]);

  useEffect(() => {
    if (!isAgent) return;
    const syncQueue = () => {
      if (document.visibilityState !== 'visible') return;
      api.get('/tickets').then(({ data }) => {
        setQueueTickets(data);
        setQueueLoadFailed(false);
      }).catch(() => setQueueLoadFailed(true));
    };
    const interval = window.setInterval(syncQueue, 5_000);
    document.addEventListener('visibilitychange', syncQueue);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', syncQueue);
    };
  }, [isAgent]);

  useEffect(() => {
    if (!isAgent) return;
    const socket = getTicketsSocket();
    queueTickets.forEach((item) => socket.emit('joinTicket', item.id));
  }, [isAgent, queueTickets]);

  useEffect(() => {
    if (!isAgent) return;
    api.get('/users')
      .then(({ data }) => { setTeamMembers(data.filter((member: TeamMember) => member.isActive)); setTeamMembersFailed(false); })
      .catch(() => { setTeamMembers([]); setTeamMembersFailed(true); });
  }, [isAgent]);

  // Posiciona no fim ao abrir outro chamado, mas não altera a posição quando
  // uma nova mensagem chega. Depois da abertura, a rolagem fica sob controle do usuário.
  useEffect(() => {
    if (conversationBodyRef.current) {
      conversationBodyRef.current.scrollTop = conversationBodyRef.current.scrollHeight;
      shouldFollowConversationRef.current = true;
    }
  }, [ticket?.id]);

  useEffect(() => {
    const conversation = conversationBodyRef.current;
    if (!conversation || !ticket?.messages?.length) return;

    if (forceScrollAfterSendRef.current || shouldFollowConversationRef.current) {
      forceScrollAfterSendRef.current = false;
      requestAnimationFrame(() => {
        const currentConversation = conversationBodyRef.current;
        if (!currentConversation) return;
        currentConversation.scrollTo({ top: currentConversation.scrollHeight, behavior: 'smooth' });
        shouldFollowConversationRef.current = true;
      });
    }
  }, [ticket?.messages?.length]);

  async function sendMessage() {
    const message = newMessage.trim();
    if ((!message && !selectedAttachment) || ticket?.status === TicketStatus.CLOSED || sendingAttachment || sendingMessage) return;
    forceScrollAfterSendRef.current = true;
    if (selectedAttachment) {
      setSendingAttachment(true);
      const form = new FormData();
      form.append('file', selectedAttachment);
      form.append('message', message);
      try {
        await api.post(`/tickets/${params.id}/attachments`, form, { headers: { 'Content-Type': 'multipart/form-data' } });
        setNewMessage('');
        setSelectedAttachment(null);
        if (attachmentInputRef.current) attachmentInputRef.current.value = '';
      } catch (uploadError: any) {
        const responseMessage = uploadError?.response?.data?.message;
        setError(Array.isArray(responseMessage) ? responseMessage.join(' ') : responseMessage || 'Não foi possível enviar o arquivo. Confira o formato e o tamanho.');
      } finally {
        setSendingAttachment(false);
      }
      return;
    }
    setSendingMessage(true);
    setError('');
    try {
      // Persist with an HTTP response so the composer never silently discards
      // a message when the chat socket is disconnected or has not joined yet.
      await api.post(`/tickets/${params.id}/messages`, { message });
      setNewMessage('');
      await syncTicketConversation();
    } catch (sendError: any) {
      const responseMessage = sendError?.response?.data?.message;
      setError(Array.isArray(responseMessage) ? responseMessage.join(' ') : responseMessage || 'Não foi possível enviar a mensagem. Confira a conexão e tente novamente.');
    } finally {
      setSendingMessage(false);
    }
  }

  function handleSendMessage(event: FormEvent) {
    event.preventDefault();
    void sendMessage();
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  }

  async function handleStatusChange(status: TicketStatus) {
    if (!ticket || status === ticket.status) return;
    setUpdatingStatus(true);
    setError('');
    try {
      const { data } = await api.patch(`/tickets/${params.id}`, { status });
      setTicket((previous) => previous ? { ...previous, ...data } : previous);
      setQueueTickets((previous) => previous.map((item) => item.id === data.id ? { ...item, ...data } : item));
      if (status === TicketStatus.CLOSED) router.replace('/dashboard');
    } catch {
      setError('Não foi possível atualizar o status. Tente novamente.');
    } finally {
      setUpdatingStatus(false);
    }
  }

  async function handleFinishTicket() {
    if (!ticket || ticket.status === TicketStatus.CLOSED || updatingStatus) return;
    if (!window.confirm(`Finalizar o atendimento do protocolo ${ticket.protocol}?`)) return;
    await handleStatusChange(TicketStatus.CLOSED);
  }

  async function handleDepartmentChange(department: TicketDepartment, assignedToId?: string, note = transferNote) {
    if (!ticket || (department === ticket.department && (assignedToId || null) === (ticket.assignedToId || null))) return;
    setUpdatingDepartment(true);
    setError('');
    try {
      const { data } = await api.patch(`/tickets/${params.id}`, {
        department,
        assignedToId: assignedToId || null,
        transferNote: note.trim() || undefined,
      });
      setTicket((previous) => previous ? { ...previous, ...data, messages: previous.messages } : previous);
      setSelectedDepartment(department);
      setSelectedAssigneeId('');
      setTransferNote('');
    } catch {
      setError('Não foi possível encaminhar o chamado. Tente novamente.');
    } finally {
      setUpdatingDepartment(false);
    }
  }

  async function handleClaimTicket() {
    if (!ticket || !user || claimingTicket) return;
    setClaimingTicket(true);
    setError('');
    try {
      const { data } = await api.patch(`/tickets/${params.id}`, {
        assignedToId: user.id,
        status: TicketStatus.IN_PROGRESS,
      });
      setTicket((previous) => previous ? { ...previous, ...data, messages: previous.messages } : previous);
    } catch {
      setError('Não foi possível assumir este chamado. Tente novamente.');
    } finally {
      setClaimingTicket(false);
    }
  }

  async function handleTransferTicket() {
    if (!ticket || updatingDepartment) return;
    if (selectedDepartment === ticket.department && (selectedAssigneeId || null) === (ticket.assignedToId || null)) return;
    await handleDepartmentChange(selectedDepartment, selectedAssigneeId || undefined);
  }

  async function handleAvailabilityChange(availability: AgentAvailability) {
    if (!user || presenceSaving) return;
    setPresenceSaving(true);
    setPresenceError('');
    try {
      const { data } = await api.patch('/users/me/profile', { availability });
      setUser((previous) => {
        if (!previous) return previous;
        const updated = { ...previous, ...data };
        updateCurrentUser(updated);
        return updated;
      });
    } catch {
      setPresenceError('Não foi possível atualizar seu status.');
    } finally {
      setPresenceSaving(false);
    }
  }

  async function handleAvatarSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !user) return;
    if (!file.type.startsWith('image/') || file.size > 6 * 1024 * 1024) {
      setPresenceError('Escolha uma imagem de até 6 MB.');
      return;
    }
    setPresenceSaving(true);
    setPresenceError('');
    const objectUrl = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = objectUrl;
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('Imagem inválida'));
      });
      const canvas = document.createElement('canvas');
      const size = 192;
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Não foi possível processar a foto');
      const cropSize = Math.min(image.naturalWidth, image.naturalHeight);
      context.drawImage(image, (image.naturalWidth - cropSize) / 2, (image.naturalHeight - cropSize) / 2, cropSize, cropSize, 0, 0, size, size);
      let avatarData = canvas.toDataURL('image/jpeg', 0.75);
      if (avatarData.length > 85000) avatarData = canvas.toDataURL('image/jpeg', 0.5);
      if (avatarData.length > 90000) {
        const smaller = document.createElement('canvas');
        smaller.width = 128;
        smaller.height = 128;
        smaller.getContext('2d')?.drawImage(canvas, 0, 0, 128, 128);
        avatarData = smaller.toDataURL('image/jpeg', 0.55);
      }
      const { data } = await api.patch('/users/me/profile', { avatarData });
      setUser((previous) => {
        if (!previous) return previous;
        const updated = { ...previous, ...data };
        updateCurrentUser(updated);
        return updated;
      });
    } catch {
      setPresenceError('Não foi possível salvar esta foto. Tente outra imagem.');
    } finally {
      URL.revokeObjectURL(objectUrl);
      setPresenceSaving(false);
    }
  }

  function handleLogout() { clearSession(); router.push('/'); }

  return (
    <div className="workspace">
      <aside className="sidebar">
        <Link href="/dashboard" className="brand"><span className="brand-mark">C</span><span>canal<span className="brand-light">direto</span><small>ATENDIMENTO</small></span></Link>
        <div className="nav-label">MENU PRINCIPAL</div>
        <Link href="/dashboard" className="nav-item"><span className="nav-icon">▦</span> Visão geral</Link>
        {isAgent && <Link href="/customers" className="nav-item"><span className="nav-icon">♙</span> Clientes</Link>}
        {isAgent && <Link href="/settings" className="nav-item"><span className="nav-icon">⚙</span> Configurações</Link>}
        {!isAgent && <Link href="/tickets/new" className="nav-item"><span className="nav-icon">＋</span> Novo chamado</Link>}
        <div className="sidebar-bottom"><div className="profile-avatar">{initials(user?.name)}</div><div className="profile-copy"><strong>{user?.name || 'Usuário'}</strong><span>{isAgent ? 'Equipe de atendimento' : 'Área do cliente'}</span></div><button className="icon-button logout" onClick={handleLogout} title="Sair" aria-label="Sair">↗</button></div>
      </aside>

      <main className="main-area">
        <header className="topbar"><div className="breadcrumb"><Link href="/dashboard">Atendimento</Link><span>/</span><Link href="/dashboard">{isAgent ? 'Fila de chamados' : 'Meus chamados'}</Link><span>/</span>Detalhes</div><div className="topbar-right"><span className="online-dot"/> Sistema operacional <div className="top-avatar">{initials(user?.name)}</div></div></header>
        <div className="content-area ticket-content">
          <Link href="/dashboard" className="ticket-back">← <span>{isAgent ? 'Voltar para a fila' : 'Voltar aos meus chamados'}</span></Link>

          {loading ? (
            <section className="ticket-loading panel" aria-live="polite"><div className="loader"/><strong>Carregando chamado</strong><span>Buscando detalhes e conversa.</span></section>
          ) : error && !ticket ? (
            <section className="ticket-load-error panel"><div className="ticket-state-icon">!</div><h1>Não foi possível abrir o chamado</h1><p>{error}</p><button className="primary-action" onClick={() => void loadTicket()}>Tentar novamente</button></section>
          ) : ticket ? (
            <>
              <section className="ticket-overview panel">
                <div className="ticket-overview-main">
                  <div className="ticket-kicker">CHAMADO <span>·</span> {ticket.protocol}</div>
                  <h1>{ticket.title}</h1>
                  <div className="ticket-tags">
                    <span className={`status-pill status-${ticket.status.toLowerCase()}`}><i/>{statusLabels[ticket.status] || ticket.status}</span>
                    <span className="ticket-tag"><span className="tag-mark">⌕</span>{categoryLabels[ticket.category] || ticket.category}</span>
                    <span className="ticket-tag ticket-department-tag">{departmentLabels[ticket.department || TicketDepartment.COMMERCIAL]}</span>
                    <span className={`priority-tag priority-${ticket.priority.toLowerCase()}`}><i/>{priorityLabels[ticket.priority] || ticket.priority}</span>
                  </div>
                </div>
                <div className={`ticket-live ${connected ? 'is-connected' : ''}`}><span className="live-dot"/><span>{connected ? 'Conectado ao vivo' : 'Reconectando'}</span></div>
              </section>

              {error && <div className="inline-error ticket-error" role="alert">{error}</div>}

              <div className={`ticket-layout ${isAgent ? 'ticket-layout-agent' : ''}`}>
                {isAgent && <nav className="ticket-queue-panel panel" aria-label="Fila de chamados">
                  <div className="queue-heading"><div><span className="queue-eyebrow">ATENDIMENTO</span><h2>Fila de chamados</h2></div><span className="queue-total">{activeQueueTickets.length}</span></div>
                  <div className="agent-presence-card">
                    <input ref={avatarInputRef} className="agent-avatar-input" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void handleAvatarSelected(event)}/>
                    <button type="button" className="agent-avatar-button" onClick={() => avatarInputRef.current?.click()} title="Alterar foto do atendente" aria-label="Alterar foto do atendente"><span className={`agent-avatar-presence presence-${user?.availability || AgentAvailability.AVAILABLE}`}>{user?.avatarData ? <img src={user.avatarData} alt=""/> : initials(user?.name)}</span><span className="agent-avatar-edit">＋</span></button>
                    <div className="agent-presence-copy"><strong>{user?.name || 'Atendente'}</strong><label htmlFor="agent-presence-select">Sua disponibilidade</label><select id="agent-presence-select" value={user?.availability || AgentAvailability.AVAILABLE} disabled={presenceSaving} onChange={(event) => void handleAvailabilityChange(event.target.value as AgentAvailability)}><option value={AgentAvailability.AVAILABLE}>● Online</option><option value={AgentAvailability.AWAY}>● Ausente</option><option value={AgentAvailability.UNAVAILABLE}>● Indisponível</option></select></div>
                  </div>
                  {presenceError && <div className="agent-presence-error" role="alert">{presenceError}</div>}
                  <label className="queue-search"><span aria-hidden="true">⌕</span><input type="search" value={queueSearch} onChange={(event) => setQueueSearch(event.target.value)} placeholder="Buscar cliente ou chamado" aria-label="Buscar cliente, assunto ou protocolo"/>{queueSearch && <button type="button" onClick={() => setQueueSearch('')} aria-label="Limpar busca">×</button>}</label>
                  <div className="queue-current"><span className="queue-current-dot"/><span>{ticket.status === TicketStatus.CLOSED ? 'Visualizando chamado encerrado' : 'Visualizando chamado'}</span></div>
                  <div className="queue-items">{queueLoading && activeQueueTickets.length === 0 ? <div className="queue-empty">Carregando fila de atendimento...</div> : queueLoadFailed ? <div className="queue-empty" role="alert">Não foi possível carregar a fila. Atualize a página para tentar novamente.</div> : activeQueueTickets.length === 0 ? <div className="queue-empty">Nenhum chamado ativo na fila.</div> : filteredQueueTickets.length === 0 ? <div className="queue-empty">Nenhum chamado encontrado para “{queueSearch}”.</div> : filteredQueueTickets.map((item) => <Link key={item.id} href={`/tickets/${item.id}`} className={`queue-item ${item.id === ticket.id ? 'queue-item-active' : ''}`} aria-current={item.id === ticket.id ? 'page' : undefined}><span className="queue-item-status"/><span className="queue-item-copy"><strong>{item.customer?.name || 'Cliente'}</strong><span>{item.title}</span><small>{item.lastMessage || item.protocol}</small></span><span className={`queue-item-priority priority-${item.priority.toLowerCase()}`}>{priorityLabels[item.priority]?.slice(0, 1)}</span></Link>)}</div>
                  <Link href="/dashboard" className="queue-back-link">← Ver todos os chamados</Link>
                </nav>}
                <section className="panel conversation-panel">
                  <div className="conversation-heading"><div><h2>Conversa</h2><p>Mensagens sobre esta solicitação</p></div><span className="message-count">{ticket.messages.length} {ticket.messages.length === 1 ? 'mensagem' : 'mensagens'}</span></div>
                  <div
                    className="conversation-body"
                    ref={conversationBodyRef}
                    onScroll={(event) => {
                      const element = event.currentTarget;
                      shouldFollowConversationRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
                    }}
                  >
                    {ticket.messages.length === 0 ? (
                      <div className="conversation-empty"><div className="empty-icon">⌁</div><strong>Conversa iniciada</strong><span>Envie uma mensagem para continuar o atendimento.</span></div>
                    ) : ticket.messages.map((msg) => {
                      const author = (msg as any).author?.name ?? (msg as any).authorName ?? (msg.authorId === user?.id ? user?.name : undefined) ?? 'Usuário';
                      const ownMessage = msg.authorId === user?.id;
                      return (
                        <article key={msg.id} className={`message-row ${ownMessage ? 'message-own' : ''}`}>
                          {!ownMessage && <div className="message-avatar">{initials(author)}</div>}
                          <div className="message-content"><div className="message-meta"><strong>{ownMessage ? 'Você' : author}</strong><time dateTime={msg.createdAt}>{formatDate(msg.createdAt)}</time></div><div className="message-bubble">{msg.message && <div>{msg.message}</div>}{msg.attachments?.map((attachment) => <MessageAttachment key={attachment.id} ticketId={params.id} attachment={attachment}/>)}</div></div>
                          {ownMessage && <div className="message-avatar message-avatar-own">{initials(author)}</div>}
                        </article>
                      );
                    })}
                  </div>
                  {ticket.status === TicketStatus.CLOSED ? <div className="closed-conversation-notice"><strong>Atendimento encerrado</strong><span>Esta conversa foi finalizada. O histórico continua disponível para consulta.</span></div> : <form onSubmit={handleSendMessage} className="message-composer">
                    <input ref={attachmentInputRef} className="message-attachment-input" type="file" accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,text/plain,application/zip,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.android.package-archive" onChange={(event) => { const file = event.target.files?.[0]; if (file && file.size > 100 * 1024 * 1024) { setError('O arquivo deve ter até 100 MB.'); event.target.value = ''; return; } setSelectedAttachment(file || null); }}/>
                    {selectedAttachment && <div className="composer-selected-file"><span>📎 {selectedAttachment.name}</span><button type="button" onClick={() => { setSelectedAttachment(null); if (attachmentInputRef.current) attachmentInputRef.current.value = ''; }} aria-label="Remover arquivo">×</button></div>}
                    <textarea aria-label="Escreva uma mensagem" placeholder="Escreva uma mensagem..." rows={3} value={newMessage} onChange={(event) => setNewMessage(event.target.value)} onKeyDown={handleComposerKeyDown}/>
                    <div className="composer-footer"><div className="composer-tools"><button className="attach-file-button" type="button" onClick={() => attachmentInputRef.current?.click()} disabled={sendingAttachment || sendingMessage} aria-label="Anexar arquivo ou foto">📎 <span>Anexar arquivo ou foto</span></button><span>Enter para enviar <b>·</b> Shift + Enter para pular linha</span></div><button className="send-message" type="submit" disabled={(!newMessage.trim() && !selectedAttachment) || sendingAttachment || sendingMessage}><span>{sendingMessage ? 'Enviando…' : sendingAttachment ? 'Enviando…' : 'Enviar mensagem'}</span><b>↑</b></button></div>
                  </form>}
                </section>

                <aside className="ticket-details-column">
                  <section className="panel ticket-description-card"><div className="detail-card-heading"><span className="detail-icon">▤</span><h2>Sobre o chamado</h2></div><p className="ticket-description">{ticket.description || 'Nenhuma descrição informada.'}</p><div className="detail-divider"/><div className="detail-facts"><div><span>Aberto em</span><strong>{formatDate(ticket.createdAt)}</strong></div><div><span>Cliente</span><strong>{ticket.customer?.name || (isAgent ? 'Cliente' : user?.name || 'Você')}</strong></div>{ticket.assignedTo?.name && <div><span>Responsável</span><strong>{ticket.assignedTo.name}</strong></div>}</div></section>

                  {isAgent && <>
                    {ticket.category === TicketCategory.CONNECTION_DOWN && <section className="panel connection-diagnostic-card">
                      <div className="detail-card-heading"><span className="detail-icon diagnostic-icon">⌁</span><h2>Diagnóstico automático</h2></div>
                      {!ticket.ixcCustomerId ? <p className="diagnostic-message">Este chamado não está vinculado a um cadastro IXC; não é possível consultar PPPoE, financeiro ou ONU.</p> : <>
                        {diagnosticLoading && <p className="diagnostic-message" role="status">Consultando financeiro, PPPoE, ONU e chamados recentes…</p>}
                        {diagnosticError && <p className="diagnostic-error" role="alert">{diagnosticError}</p>}
                        {diagnostic && <>
                          <div className={`diagnostic-recommendation recommendation-${diagnostic.recommendation.toLowerCase()}`}><span>Encaminhamento sugerido · {departmentLabels[diagnostic.routeDepartment]}</span><strong>{diagnostic.recommendationText}</strong><small>{diagnostic.matchedRule ? `Regra aplicada: ${diagnostic.matchedRule} · ` : ''}Atualizado {formatDate(diagnostic.checkedAt)}</small></div>
                          <div className="diagnostic-checks">{(['billing', 'pppoe', 'optical', 'incident'] as const).map((key) => <DiagnosticResult key={key} title={diagnosticLabels[key]} check={diagnostic[key]}/>)}</div>
                          <button type="button" className="diagnostic-route-button" onClick={() => void handleDepartmentChange(diagnostic.routeDepartment, undefined, `Fluxo de diagnóstico${diagnostic.matchedRule ? ` · ${diagnostic.matchedRule}` : ''}`)} disabled={updatingDepartment || ticket.status === TicketStatus.CLOSED || ticket.department === diagnostic.routeDepartment}>{ticket.department === diagnostic.routeDepartment ? `Já está em ${departmentLabels[diagnostic.routeDepartment]}` : `Transferir para ${departmentLabels[diagnostic.routeDepartment]}`}</button>
                        </>}
                        <button type="button" className="diagnostic-refresh" onClick={() => void runConnectionDiagnostic()} disabled={diagnosticLoading}>{diagnosticLoading ? 'Consultando…' : diagnostic ? 'Executar novamente' : 'Executar diagnóstico'}</button>
                      </>}
                    </section>}
                    <section className="panel ticket-status-card"><div className="detail-card-heading"><span className="detail-icon status-icon">◷</span><h2>Gerenciar atendimento</h2></div>
                      {!ticket.assignedToId && <button type="button" className="ticket-claim-button" onClick={() => void handleClaimTicket()} disabled={claimingTicket}><span>{claimingTicket ? 'Assumindo chamado...' : 'Atender chamado'}</span><b>✓</b></button>}
                      {ticket.assignedToId && <div className="ticket-claimed-notice">Atendido por <strong>{ticket.assignedTo?.name || (ticket.assignedToId === user?.id ? 'você' : 'outro atendente')}</strong></div>}
                      <label htmlFor="ticket-status">Status do chamado</label><select id="ticket-status" value={ticket.status} disabled={updatingStatus} onChange={(event) => void handleStatusChange(event.target.value as TicketStatus)}>{Object.values(TicketStatus).map((status) => <option key={status} value={status}>{statusLabels[status] || status}</option>)}</select>{updatingStatus && <span className="status-saving">Salvando alteração...</span>}
                      {ticket.status !== TicketStatus.CLOSED ? <button type="button" className="ticket-finish-button" onClick={() => void handleFinishTicket()} disabled={updatingStatus}><span>{updatingStatus ? 'Finalizando atendimento…' : 'Finalizar atendimento'}</span><b>✓</b></button> : <div className="ticket-finished-notice">✓ Atendimento finalizado</div>}
                      <label htmlFor="ticket-department">Transferir para setor</label><select id="ticket-department" value={selectedDepartment} disabled={updatingDepartment} onChange={(event) => setSelectedDepartment(event.target.value as TicketDepartment)}>{ticketDepartmentOrder.map((department) => <option key={department} value={department}>{departmentLabels[department]}</option>)}</select>
                      <label htmlFor="ticket-assignee">Atendente que receberá <span>(opcional)</span></label><select id="ticket-assignee" value={selectedAssigneeId} disabled={updatingDepartment || teamMembersFailed} onChange={(event) => setSelectedAssigneeId(event.target.value)}><option value="">Fila do setor — atendente assume depois</option>{teamMembers.map((member) => <option key={member.id} value={member.id}>{member.name} · {roleLabels[member.role] || 'Atendente'}</option>)}</select>
                      {teamMembersFailed && <span className="transfer-destination-hint is-error">Não foi possível carregar a lista de atendentes.</span>}
                      <div className="transfer-destination-preview"><span>Destino da transferência</span><strong>{departmentLabels[selectedDepartment]} <i>·</i> {selectedAssigneeId ? teamMembers.find((member) => member.id === selectedAssigneeId)?.name || 'Atendente selecionado' : 'Fila do setor'}</strong></div>
                      <label htmlFor="ticket-transfer-note">Observação da transferência <span>(opcional)</span></label><textarea id="ticket-transfer-note" className="ticket-transfer-note" rows={3} maxLength={1000} value={transferNote} disabled={updatingDepartment} onChange={(event) => setTransferNote(event.target.value)} placeholder="Explique o motivo ou deixe contexto para o próximo setor" />
                      {selectedDepartment === ticket.department && (selectedAssigneeId || null) === (ticket.assignedToId || null) && <span className="transfer-destination-hint">O chamado já está neste setor com este responsável. Altere o setor ou o atendente para encaminhar.</span>}
                      <button type="button" className="ticket-transfer-button" onClick={() => void handleTransferTicket()} disabled={updatingDepartment || (selectedDepartment === ticket.department && (selectedAssigneeId || null) === (ticket.assignedToId || null)) || teamMembersFailed}><span>{updatingDepartment ? 'Transferindo...' : 'Confirmar transferência'}</span><b>→</b></button>
                    </section>
                    <section className="panel ticket-transfer-history"><div className="detail-card-heading"><span className="detail-icon">↗</span><h2>Histórico de setores</h2></div>
                      <div className="ticket-transfer-entry"><span className="transfer-entry-dot"/><div><strong>Chamado aberto em {departmentLabels[TicketDepartment.COMMERCIAL]}</strong><small>{formatDate(ticket.createdAt)}</small></div></div>
                      {(ticket.transfers || []).map((transfer) => <div className="ticket-transfer-entry" key={transfer.id}><span className="transfer-entry-dot"/><div><strong>{departmentLabels[transfer.fromDepartment]} → {departmentLabels[transfer.toDepartment]}</strong><small>{transfer.transferredBy?.name || 'Atendente'} · {formatDate(transfer.createdAt)}</small>{transfer.transferredTo?.name && <small>Responsável no destino: {transfer.transferredTo.name}</small>}{transfer.note && <p>{transfer.note}</p>}</div></div>)}
                      {(!ticket.transfers || ticket.transfers.length === 0) && <p className="transfer-history-empty">Nenhuma transferência registrada ainda.</p>}
                    </section>
                  </>}
                </aside>
              </div>
            </>
          ) : null}
          <footer className="page-footer">Canal Direto <span>·</span> Atendimento próximo e sem complicação</footer>
        </div>
      </main>
    </div>
  );
}
