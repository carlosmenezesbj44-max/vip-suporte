'use client';

import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { UserRole } from '@canal-direto/shared';
import type { AuthenticatedUser } from '@canal-direto/shared';
import { api, attachAuthInterceptor } from '@/lib/api';
import { clearSession, getCurrentUser } from '@/lib/auth';

attachAuthInterceptor();

type TeamMember = { id: string; name: string; email: string; phone?: string | null; role: UserRole; isActive: boolean; createdAt: string };
type ChannelType = 'WHATSAPP' | 'PHONE' | 'EMAIL' | 'OTHER';
type SupportChannel = { id: string; name: string; type: ChannelType; address: string; enabled: boolean };
type CommunicationFlowOption = { id: string; name: string; enabled: boolean };
type SettingsData = {
  general: { companyName: string; supportEmail: string; supportPhone: string; timezone: string };
  security: { passwordMinLength: number; sessionDurationDays: number };
  channels: SupportChannel[];
  communicationFlows: CommunicationFlowOption[];
  channelFlowAssignments: Record<string, string | null>;
};
type IxcStatus = { baseUrl: string | null; tokenConfigured: boolean; source?: 'database' | 'environment' | 'none' };

const roleLabels: Record<string, string> = { ADMIN: 'Administrador', AGENT: 'Atendente', TECHNICIAN: 'Técnico', CUSTOMER: 'Cliente' };
const channelLabels: Record<ChannelType, string> = { WHATSAPP: 'WhatsApp', PHONE: 'Telefone', EMAIL: 'E-mail', OTHER: 'Outro' };
const sections = [
  { id: 'geral', label: 'Geral', icon: '◉' }, { id: 'equipe', label: 'Atendentes', icon: '♙' },
  { id: 'canais', label: 'Canais', icon: '⌁' }, { id: 'integracoes', label: 'Integrações', icon: '⇄' },
  { id: 'seguranca', label: 'Segurança', icon: '◇' },
];

const emptySettings: SettingsData = {
  general: { companyName: '', supportEmail: '', supportPhone: '', timezone: 'America/Recife' },
  security: { passwordMinLength: 8, sessionDurationDays: 7 }, channels: [], communicationFlows: [], channelFlowAssignments: {},
};

function errorMessage(error: unknown, fallback: string) {
  const response = (error as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
  if (Array.isArray(response)) return response.join(' ');
  return response || fallback;
}

function SettingsSidebar({ user, onLogout }: { user: AuthenticatedUser | null; onLogout: () => void }) {
  return <aside className="sidebar">
    <Link href="/dashboard" className="brand"><span className="brand-mark">C</span><span>canal<span className="brand-light">direto</span><small>ATENDIMENTO</small></span></Link>
    <div className="nav-label">MENU PRINCIPAL</div>
    <Link href="/dashboard" className="nav-item"><span className="nav-icon">▦</span> Visão geral</Link>
    <Link href="/customers" className="nav-item"><span className="nav-icon">♙</span> Clientes</Link>
    <Link href="/settings" className="nav-item active" aria-current="page"><span className="nav-icon">⚙</span> Configurações</Link>
    <Link href="/settings/communication-flows" className="nav-item"><span className="nav-icon">⇢</span> Fluxo de comunicação</Link>
    <Link href="/settings/diagnostic-rules" className="nav-item"><span className="nav-icon">⌁</span> Diagnóstico técnico</Link>
    <div className="sidebar-bottom"><div className="profile-avatar">{user?.name?.slice(0, 1).toUpperCase() || 'U'}</div><div className="profile-copy"><strong>{user?.name || 'Usuário'}</strong><span>{user ? roleLabels[user.role] : 'Equipe de atendimento'}</span></div><button className="icon-button logout" onClick={onLogout} title="Sair" aria-label="Sair">↗</button></div>
  </aside>;
}

function SectionTitle({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <div className="settings-section-title"><div><span className="settings-eyebrow">{eyebrow}</span><h2>{title}</h2><p>{description}</p></div></div>;
}

function SaveFeedback({ message, error }: { message: string; error?: boolean }) {
  if (!message) return null;
  return <p className={`settings-feedback${error ? ' is-error' : ''}`} role={error ? 'alert' : 'status'}>{message}</p>;
}

export default function SettingsPage() {
  const router = useRouter();
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [settings, setSettings] = useState<SettingsData>(emptySettings);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsError, setSettingsError] = useState('');
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [teamLoading, setTeamLoading] = useState(true);
  const [teamError, setTeamError] = useState('');
  const [ixcStatus, setIxcStatus] = useState<IxcStatus | null>(null);
  const [ixcLoading, setIxcLoading] = useState(true);
  const [ixcError, setIxcError] = useState('');
  const [activeSection, setActiveSection] = useState('geral');
  const [saving, setSaving] = useState('');
  const [feedback, setFeedback] = useState<Record<string, { message: string; error?: boolean }>>({});
  const [teamEditor, setTeamEditor] = useState<TeamMember | null | false>(false);
  const [channelEditor, setChannelEditor] = useState<SupportChannel | null | false>(false);
  const [teamFormError, setTeamFormError] = useState('');
  const [channelFormError, setChannelFormError] = useState('');
  const [ixcBaseUrl, setIxcBaseUrl] = useState('');
  const [ixcToken, setIxcToken] = useState('');
  const teamDialogRef = useRef<HTMLElement>(null);
  const channelDialogRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const hadDialogRef = useRef(false);

  const admin = user?.role === UserRole.ADMIN;
  const setNotice = (key: string, message: string, error = false) => setFeedback((prev) => ({ ...prev, [key]: { message, error } }));
  const loadSettings = useCallback(async () => {
    setSettingsLoading(true); setSettingsError('');
    try { const { data } = await api.get('/settings'); setSettings({ ...emptySettings, ...data, general: { ...emptySettings.general, ...data.general }, security: { ...emptySettings.security, ...data.security }, channels: data.channels || [], communicationFlows: data.communicationFlows || [], channelFlowAssignments: data.channelFlowAssignments || {} }); }
    catch (error) { setSettingsError(errorMessage(error, 'Não foi possível carregar as configurações.')); }
    finally { setSettingsLoading(false); }
  }, []);
  const loadTeam = useCallback(async () => {
    setTeamLoading(true); setTeamError('');
    try { const { data } = await api.get('/users'); setMembers(data); }
    catch (error) { setTeamError(errorMessage(error, 'Não foi possível carregar a equipe.')); }
    finally { setTeamLoading(false); }
  }, []);
  const loadChannels = useCallback(async () => {
    const { data } = await api.get('/settings');
    setSettings((prev) => ({ ...prev, channels: data.channels || [] }));
  }, []);
  const loadIxc = useCallback(async () => {
    setIxcLoading(true); setIxcError('');
    try { const { data } = await api.get('/ixc/status'); setIxcStatus(data); setIxcBaseUrl(data.baseUrl || ''); }
    catch { setIxcError('Não foi possível consultar o status da integração IXC.'); }
    finally { setIxcLoading(false); }
  }, []);

  useEffect(() => {
    const currentUser = getCurrentUser(); setUser(currentUser); setSessionReady(true);
    if (!currentUser) { router.push('/'); return; }
    if (![UserRole.ADMIN, UserRole.AGENT, UserRole.TECHNICIAN].includes(currentUser.role)) { router.push('/dashboard'); return; }
    void loadSettings(); void loadTeam(); void loadIxc();
  }, [router, loadSettings, loadTeam, loadIxc]);

  useEffect(() => {
    const updateActiveSection = () => {
      const marker = window.scrollY + 145; let current = sections[0].id;
      for (const section of sections) { const element = document.getElementById(section.id); if (element && element.getBoundingClientRect().top + window.scrollY <= marker) current = section.id; }
      setActiveSection(current);
    };
    window.addEventListener('scroll', updateActiveSection, { passive: true }); window.addEventListener('hashchange', updateActiveSection); updateActiveSection();
    return () => { window.removeEventListener('scroll', updateActiveSection); window.removeEventListener('hashchange', updateActiveSection); };
  }, []);

  useEffect(() => {
    const dialog = teamEditor !== false ? teamDialogRef.current : channelEditor !== false ? channelDialogRef.current : null;
    if (!dialog) return;
    hadDialogRef.current = true;
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')).filter((element) => element.offsetParent !== null);
    focusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (teamEditor !== false) setTeamEditor(false); else setChannelEditor(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const elements = focusable();
      if (!elements.length) { event.preventDefault(); return; }
      const first = elements[0]; const last = elements[elements.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [teamEditor, channelEditor]);

  useEffect(() => {
    if (teamEditor === false && channelEditor === false && hadDialogRef.current) {
      hadDialogRef.current = false;
      returnFocusRef.current?.focus();
    }
  }, [teamEditor, channelEditor]);

  function handleLogout() { clearSession(); router.push('/'); }
  async function saveGeneral(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (settingsError || settingsLoading) return; setSaving('general');
    try { const { data } = await api.patch('/settings/general', settings.general); setSettings((prev) => ({ ...prev, general: { ...prev.general, ...data } })); setNotice('general', 'Dados gerais salvos.'); }
    catch (error) { setNotice('general', errorMessage(error, 'Não foi possível salvar os dados gerais.'), true); }
    finally { setSaving(''); }
  }
  async function saveSecurity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (settingsError || settingsLoading) return; setSaving('security');
    try { const { data } = await api.patch('/settings/security', settings.security); setSettings((prev) => ({ ...prev, security: { ...prev.security, ...data } })); setNotice('security', 'Política de segurança salva.'); }
    catch (error) { setNotice('security', errorMessage(error, 'Não foi possível salvar a política de segurança.'), true); }
    finally { setSaving(''); }
  }
  async function saveTeam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setTeamFormError(''); setSaving('team-form');
    const form = new FormData(event.currentTarget); const editing = teamEditor === false || teamEditor === null ? null : teamEditor;
    if (editing?.isActive && form.get('isActive') !== 'on' && !window.confirm(`Desativar a conta de ${editing.name}?`)) { setSaving(''); return; }
    const body: Record<string, string | boolean> = {
      name: String(form.get('name') || '').trim(), email: String(form.get('email') || '').trim(), phone: String(form.get('phone') || '').trim(), role: String(form.get('role') || 'AGENT'),
    };
    const password = String(form.get('password') || ''); if (password) body.password = password;
    if (editing) body.isActive = form.get('isActive') === 'on';
    try {
      if (editing) await api.patch(`/users/team/${editing.id}`, body); else await api.post('/users/team', body);
      await loadTeam(); setTeamEditor(false); setNotice('team', editing ? 'Membro atualizado.' : 'Membro criado.');
    } catch (error) { setTeamFormError(errorMessage(error, 'Não foi possível salvar este membro.')); }
    finally { setSaving(''); }
  }
  async function saveChannel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setChannelFormError(''); setSaving('channel-form');
    if (settingsLoading || settingsError) { setChannelFormError('As configurações não carregaram. Tente novamente antes de salvar o canal.'); setSaving(''); return; }
    const form = new FormData(event.currentTarget); const editing = channelEditor === false || channelEditor === null ? null : channelEditor;
    if (editing?.enabled && form.get('enabled') !== 'on' && !window.confirm(`Desativar o canal “${editing.name}”?`)) { setSaving(''); return; }
    const body = { name: String(form.get('name') || '').trim(), type: String(form.get('type') || 'WHATSAPP') as ChannelType, address: String(form.get('address') || '').trim(), enabled: form.get('enabled') === 'on' };
    try {
      if (editing) await api.patch(`/settings/channels/${editing.id}`, body); else await api.post('/settings/channels', body);
      setChannelEditor(false); setNotice('channels', editing ? 'Canal atualizado.' : 'Canal criado.');
      try { await loadChannels(); } catch { setNotice('channels', 'Canal salvo, mas a lista não foi atualizada. Recarregue as configurações.', true); }
    } catch (error) { setChannelFormError(errorMessage(error, 'Não foi possível salvar este canal.')); }
    finally { setSaving(''); }
  }
  async function toggleChannel(channel: SupportChannel) {
    if (settingsLoading || settingsError) { setNotice('channels', 'As configurações não carregaram. Tente novamente antes de alterar o canal.', true); return; }
    const action = channel.enabled ? 'desativar' : 'ativar';
    if (channel.enabled && !window.confirm(`Deseja desativar o canal “${channel.name}”?`)) return;
    setSaving(`channel-${channel.id}`);
    try { await api.patch(`/settings/channels/${channel.id}`, { enabled: !channel.enabled }); await loadChannels(); setNotice('channels', `Canal ${channel.enabled ? 'desativado' : 'ativado'}.`); }
    catch (error) { setNotice('channels', errorMessage(error, `Não foi possível ${action} o canal.`), true); }
    finally { setSaving(''); }
  }
  async function saveChannelFlowAssignments() {
    setSaving('channel-flow-assignments');
    try {
      const { data } = await api.patch('/settings/channel-flow-assignments', { assignments: settings.channelFlowAssignments });
      setSettings((current) => ({ ...current, channelFlowAssignments: data.assignments || {} }));
      setNotice('channels', 'Fluxos associados aos canais foram salvos.');
    } catch (error) {
      setNotice('channels', errorMessage(error, 'Não foi possível salvar os fluxos dos canais.'), true);
    } finally { setSaving(''); }
  }
  async function toggleMember(member: TeamMember) {
    const action = member.isActive ? 'desativar' : 'reativar';
    if (member.isActive && !window.confirm(`Desativar a conta de ${member.name}?`)) return;
    setSaving(`member-${member.id}`);
    try { await api.patch(`/users/team/${member.id}`, { isActive: !member.isActive }); await loadTeam(); setNotice('team', `Conta ${member.isActive ? 'desativada' : 'reativada'}.`); }
    catch (error) { setNotice('team', errorMessage(error, `Não foi possível ${action} a conta.`), true); }
    finally { setSaving(''); }
  }
  async function saveIxc(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving('ixc');
    try {
      const body: { baseUrl: string; token?: string } = { baseUrl: ixcBaseUrl.trim() };
      if (ixcToken.trim()) body.token = ixcToken.trim();
      await api.put('/ixc/config', body); setIxcToken(''); await loadIxc(); setNotice('ixc', 'Configuração IXC salva com segurança no servidor.');
    } catch { setNotice('ixc', 'Não foi possível salvar a configuração IXC. Verifique o endereço e tente novamente.', true); }
    finally { setSaving(''); }
  }
  async function testIxc() {
    setSaving('ixc-test');
    try { const { data } = await api.post('/ixc/test'); setNotice('ixc', data?.message || (data?.connected ? 'Conexão com o IXC validada.' : 'O IXC não confirmou a conexão.'), !data?.connected); }
    catch { setNotice('ixc', 'Falha no teste de conexão. Confira o endereço e a credencial no servidor.', true); }
    finally { setSaving(''); }
  }

  if (!sessionReady || !user || ![UserRole.ADMIN, UserRole.AGENT, UserRole.TECHNICIAN].includes(user.role)) return <div className="workspace"><main className="main-area"><div className="settings-loading"><div className="loader"/><span>Carregando configurações</span></div></main></div>;

  return <div className="workspace">
    <SettingsSidebar user={user} onLogout={handleLogout}/>
    <main className="main-area">
      <header className="topbar"><div className="breadcrumb">Atendimento <span>/</span> Configurações</div><div className="topbar-right"><span className="online-dot"/> Painel de atendimento <div className="top-avatar">{user.name.slice(0, 1).toUpperCase()}</div></div></header>
      <div className="content-area settings-content">
        <div className="page-heading settings-heading"><div><div className="eyebrow">ADMINISTRAÇÃO DO SISTEMA</div><h1>Configurações</h1><p>Gerencie as preferências, acessos, canais e integrações do atendimento.</p></div><div className="settings-save-state"><span className={`settings-state-dot${admin ? ' state-ready' : ''}`}/>{admin ? 'Edição habilitada' : 'Somente leitura'}</div></div>

        <section className="settings-health" aria-label="Resumo do estado das integrações"><div className="health-symbol">⌁</div><div className="health-copy"><span className="settings-eyebrow">INTEGRAÇÕES</span><strong>{ixcLoading ? 'IXC · verificando configuração…' : ixcError ? 'IXC · status indisponível' : ixcStatus?.tokenConfigured ? 'IXC · credencial configurada' : 'IXC · credencial pendente'}</strong><span>{ixcError ? 'Confira a conexão com a API e atualize o painel.' : ixcStatus?.tokenConfigured ? 'Credencial protegida no servidor; teste a conexão para confirmar o acesso.' : 'Adicione a URL e a credencial de API na seção Integrações.'}</span></div><a href="#integracoes" className="settings-text-link">Ver integração <span>→</span></a></section>

        <div className="settings-layout">
          <nav className="settings-index" aria-label="Seções de configuração"><span className="settings-index-label">NESTA PÁGINA</span>{sections.map((section, index) => <a key={section.id} href={`#${section.id}`} className={`settings-index-link${activeSection === section.id ? ' selected' : ''}`} aria-current={activeSection === section.id ? 'location' : undefined} onClick={() => setActiveSection(section.id)}><span className="settings-index-icon">{section.icon}</span><span>{section.label}</span><small>0{index + 1}</small></a>)}<div className="settings-index-note"><span>ⓘ</span>{admin ? 'As alterações são salvas no sistema e aplicadas à equipe.' : 'Você pode consultar as configurações; somente administradores podem alterá-las.'}</div></nav>

          <div className="settings-sections">
            <section id="geral" className="settings-card">
              <SectionTitle eyebrow="CONTA E PREFERÊNCIAS" title="Geral" description="Informações de contato e região usadas pelo painel."/>
              {settingsError && <div className="settings-inline-error" role="alert">{settingsError} <button className="settings-link-button" onClick={() => void loadSettings()}>Tentar novamente</button></div>}
              {settingsLoading ? <div className="settings-list-state"><div className="loader"/><span>Carregando preferências…</span></div> : <form className="settings-form-grid" onSubmit={saveGeneral}>
                <label className="settings-field">Nome da empresa<input value={settings.general.companyName} onChange={(e) => setSettings((s) => ({ ...s, general: { ...s.general, companyName: e.target.value } }))} disabled={!admin || !!settingsError || settingsLoading} required maxLength={120} placeholder="Ex.: Canal Direto"/></label>
                <label className="settings-field">E-mail de suporte<input type="email" value={settings.general.supportEmail} onChange={(e) => setSettings((s) => ({ ...s, general: { ...s.general, supportEmail: e.target.value } }))} disabled={!admin || !!settingsError || settingsLoading} maxLength={160} placeholder="suporte@empresa.com.br"/></label>
                <label className="settings-field">Telefone de suporte<input value={settings.general.supportPhone} onChange={(e) => setSettings((s) => ({ ...s, general: { ...s.general, supportPhone: e.target.value } }))} disabled={!admin || !!settingsError || settingsLoading} maxLength={30} placeholder="(00) 00000-0000"/></label>
                <label className="settings-field">Fuso horário<input value={settings.general.timezone} onChange={(e) => setSettings((s) => ({ ...s, general: { ...s.general, timezone: e.target.value } }))} disabled={!admin || !!settingsError || settingsLoading} required maxLength={80} placeholder="America/Recife"/><small>Use um identificador IANA, por exemplo America/Recife.</small></label>
                <div className="settings-form-footer"><SaveFeedback message={feedback.general?.message || ''} error={feedback.general?.error}/>{admin && <button className="settings-primary" type="submit" disabled={saving === 'general' || !!settingsError || settingsLoading}>{saving === 'general' ? 'Salvando…' : 'Salvar alterações'}</button>}</div>
              </form>}
            </section>

            <section id="equipe" className="settings-card">
              <div className="settings-heading-row"><SectionTitle eyebrow="PESSOAS E ACESSO" title="Atendentes e equipe" description="Crie uma conta individual para cada pessoa. O nome da conta aparece nas mensagens e no responsável pelo chamado."/>{admin && <button className="settings-primary" onClick={(event) => { returnFocusRef.current = event.currentTarget; setTeamFormError(''); setTeamEditor(null); }}>＋ Cadastrar atendente</button>}</div>
              <SaveFeedback message={feedback.team?.message || ''} error={feedback.team?.error}/>
              {teamError ? <div className="settings-empty"><strong>Lista indisponível</strong><span>{teamError}</span><button className="settings-secondary" onClick={() => void loadTeam()}>Tentar novamente</button></div> : teamLoading ? <div className="settings-list-state"><div className="loader"/><span>Carregando equipe…</span></div> : members.length === 0 ? <div className="settings-empty"><span className="settings-empty-icon">♙</span><strong>Nenhum membro de suporte cadastrado</strong><span>Crie a primeira conta de atendente, técnico ou administrador.</span></div> : <div className="settings-team-list">{members.map((member) => <article className={`settings-team-member${member.isActive ? '' : ' member-disabled'}`} key={member.id}><span className="settings-member-avatar">{member.name.slice(0, 1).toUpperCase()}</span><span className="settings-member-info"><strong>{member.name}{member.id === user.id && <small className="you-badge">Você</small>}</strong><span>{member.email}{member.phone ? ` · ${member.phone}` : ''}</span></span><span className={`settings-role role-${member.role.toLowerCase()}`}>{roleLabels[member.role]}</span><span className={`settings-status ${member.isActive ? 'status-connected' : 'status-unverified'}`}><i/>{member.isActive ? 'Ativo' : 'Inativo'}</span>{admin && <div className="settings-row-actions"><button className="settings-secondary" onClick={(event) => { returnFocusRef.current = event.currentTarget; setTeamFormError(''); setTeamEditor(member); }}>Editar</button><button className="settings-link-button" disabled={saving === `member-${member.id}`} onClick={() => void toggleMember(member)}>{saving === `member-${member.id}` ? 'Salvando…' : member.isActive ? 'Desativar' : 'Reativar'}</button></div>}</article>)}</div>}
            </section>

            <section id="canais" className="settings-card">
              <div className="settings-heading-row"><SectionTitle eyebrow="ORIGEM DOS ATENDIMENTOS" title="Canais" description="Cadastre os endereços usados pela equipe para atender clientes."/>{admin && <button className="settings-primary" disabled={settingsLoading || !!settingsError} onClick={(event) => { returnFocusRef.current = event.currentTarget; setChannelFormError(''); setChannelEditor(null); }}>＋ Novo canal</button>}</div>
              <p className="settings-channel-disclaimer">Cadastrar um número ou endereço organiza o canal neste painel. O recebimento e envio de mensagens dependem da integração com o provedor.</p>
              <SaveFeedback message={feedback.channels?.message || ''} error={feedback.channels?.error}/>
              <div className="settings-channel-list"><article className="settings-channel-row"><span className="channel-mark channel-portal">⌂</span><span className="settings-channel-copy"><strong>Portal do cliente</strong><small>Chamados enviados pelo portal e aplicativo.</small></span><span className="settings-status status-connected"><i/> Disponível</span></article>
                {settingsLoading ? <div className="settings-list-state"><div className="loader"/><span>Carregando canais…</span></div> : settingsError ? <div className="settings-empty settings-empty-compact" role="alert"><strong>Não foi possível carregar os canais</strong><span>{settingsError}</span><button className="settings-secondary" onClick={() => void loadSettings()}>Tentar novamente</button></div> : settings.channels.length === 0 ? <div className="settings-empty settings-empty-compact"><strong>Nenhum canal cadastrado</strong><span>Adicione WhatsApp, telefone, e-mail ou outro canal.</span></div> : settings.channels.map((channel) => <article className={`settings-channel-row${channel.enabled ? '' : ' member-disabled'}`} key={channel.id}><span className={`channel-mark ${channel.type === 'WHATSAPP' ? 'channel-whatsapp' : channel.type === 'PHONE' ? 'channel-phone' : channel.type === 'EMAIL' ? 'channel-email' : ''}`}>{channel.type === 'WHATSAPP' ? '◉' : channel.type === 'PHONE' ? '⌕' : channel.type === 'EMAIL' ? '✉' : '⌁'}</span><span className="settings-channel-copy"><strong>{channel.name} <small className="channel-type-label">{channelLabels[channel.type]}</small></strong><small>{channel.address || 'Endereço não informado'} · conector externo necessário</small></span><span className={`settings-status ${channel.enabled ? 'status-pending' : 'status-unverified'}`}><i/>{channel.enabled ? 'Cadastrado' : 'Desativado'}</span>{admin && <div className="settings-row-actions"><button className="settings-secondary" disabled={!!settingsError} onClick={(event) => { returnFocusRef.current = event.currentTarget; setChannelFormError(''); setChannelEditor(channel); }}>Editar</button><button className="settings-link-button" disabled={!!settingsError || saving === `channel-${channel.id}`} onClick={() => void toggleChannel(channel)}>{saving === `channel-${channel.id}` ? 'Salvando…' : channel.enabled ? 'Desativar' : 'Ativar'}</button></div>}</article>)}</div>
              <div className="settings-channel-flow-card"><div className="settings-heading-row"><SectionTitle eyebrow="AUTOMAÇÃO POR ORIGEM" title="Fluxos destinados a cada canal" description="Escolha qual fluxo inicia quando o cliente entra por cada canal."/>{admin && <button className="settings-primary" onClick={() => void saveChannelFlowAssignments()} disabled={settingsLoading || !!settingsError || saving === 'channel-flow-assignments' || !settings.communicationFlows.some((flow) => flow.enabled)}>{saving === 'channel-flow-assignments' ? 'Salvando…' : 'Salvar associações'}</button>}</div>
                {!settings.communicationFlows.some((flow) => flow.enabled) ? <div className="settings-empty settings-empty-compact"><strong>Nenhum fluxo ativo disponível</strong><span>Crie e ative um fluxo em “Fluxo de comunicação” para associá-lo aos canais.</span><Link className="subtle-link" href="/settings/communication-flows">Abrir fluxos →</Link></div> : <div className="channel-flow-list">{[{ id: 'PORTAL', name: 'Portal do cliente / Aplicativo', detail: 'Entrada de chamados pelo app e portal', enabled: true }, ...settings.channels].map((channel) => <label className="channel-flow-row" key={channel.id}><span><strong>{channel.name}</strong><small>{'detail' in channel ? channel.detail : `${channelLabels[channel.type]} · ${channel.address}`}</small></span><select aria-label={`Fluxo destinado a ${channel.name}`} disabled={!admin || !channel.enabled} value={settings.channelFlowAssignments[channel.id] || ''} onChange={(event) => setSettings((current) => ({ ...current, channelFlowAssignments: { ...current.channelFlowAssignments, [channel.id]: event.target.value || null } }))}><option value="">Sem fluxo associado</option>{settings.communicationFlows.filter((flow) => flow.enabled).map((flow) => <option value={flow.id} key={flow.id}>{flow.name}</option>)}</select></label>)}</div>}
                <p className="settings-channel-disclaimer">A associação fica salva no sistema. O recebimento de mensagens externas ainda depende de configurar o conector do canal.</p>
              </div>
            </section>

            <section id="integracoes" className="settings-card">
              <SectionTitle eyebrow="SISTEMAS CONECTADOS" title="Integrações" description="Configure e teste o acesso ao ERP IXC. A credencial é guardada e usada somente no servidor."/>
              <article className="ixc-card"><div className="ixc-card-top"><div className="ixc-brand"><span className="ixc-mark">IX</span><div><strong>IXC Provedor</strong><small>ERP · cadastro de assinantes</small></div></div><span className={`settings-status ${ixcStatus?.tokenConfigured ? 'status-connected' : 'status-unverified'}`}><i/>{ixcLoading ? 'Consultando…' : ixcError ? 'Status indisponível' : ixcStatus?.tokenConfigured ? 'Credencial salva' : 'Credencial pendente'}</span></div>
                {ixcError && <div className="settings-inline-error" role="alert">{ixcError} <button className="settings-link-button" onClick={() => void loadIxc()}>Tentar novamente</button></div>}
                <div className="ixc-details"><div><span>Endereço do Webservice</span><code>{ixcLoading ? 'Consultando…' : ixcStatus?.baseUrl || 'Não configurado'}</code></div><div><span>Credencial da API</span><strong className="secret-protected">{ixcLoading ? 'Consultando status…' : ixcStatus?.tokenConfigured ? '•••••••••• · credencial salva' : 'Não configurada'}</strong><small>O token nunca é retornado pela API nem preenchido no campo.</small></div></div>
                {admin ? <form className="settings-ixc-form" onSubmit={saveIxc}><label className="settings-field">URL base do IXC<input type="url" value={ixcBaseUrl} onChange={(e) => setIxcBaseUrl(e.target.value)} required placeholder="https://seu-host/webservice/v1" autoComplete="url"/></label><label className="settings-field">Token da API<input type="password" value={ixcToken} onChange={(e) => setIxcToken(e.target.value)} placeholder={ixcStatus?.tokenConfigured ? 'Deixe em branco para manter a credencial atual' : 'Informe ID:token'} autoComplete="new-password"/><small>Campo sempre vazio ao abrir. Token em branco mantém a credencial salva.</small></label><div className="settings-form-footer"><SaveFeedback message={feedback.ixc?.message || ''} error={feedback.ixc?.error}/><div className="settings-button-group"><button className="settings-secondary" type="button" onClick={() => void testIxc()} disabled={saving === 'ixc-test' || saving === 'ixc' || !ixcStatus?.tokenConfigured}>{saving === 'ixc-test' ? 'Testando…' : 'Testar conexão'}</button><button className="settings-primary" type="submit" disabled={saving === 'ixc' || saving === 'ixc-test' || ixcLoading}>{saving === 'ixc' ? 'Salvando…' : 'Salvar integração'}</button></div></div></form> : <div className="ixc-notice"><span>ⓘ</span><p>Somente administradores podem alterar integrações.</p></div>}
              </article>
            </section>

            <section id="seguranca" className="settings-card settings-security">
              <SectionTitle eyebrow="CONTROLE DE ACESSO" title="Segurança" description="Defina os requisitos de senha e a duração das sessões da equipe."/>
              {settingsError && <div className="settings-inline-error" role="alert">Política não carregada; os valores padrão não podem ser salvos. <button className="settings-link-button" onClick={() => void loadSettings()}>Tentar novamente</button></div>}
              {settingsLoading ? <div className="settings-list-state"><div className="loader"/><span>Carregando política…</span></div> : <form className="settings-security-form" onSubmit={saveSecurity}><label className="settings-field">Tamanho mínimo da senha<input type="number" min={8} max={64} value={settings.security.passwordMinLength} disabled={!admin || !!settingsError || settingsLoading} onChange={(e) => setSettings((s) => ({ ...s, security: { ...s.security, passwordMinLength: Number(e.target.value) } }))}/><small>Permitido de 8 a 64 caracteres.</small></label><label className="settings-field">Duração da sessão (dias)<input type="number" min={1} max={30} value={settings.security.sessionDurationDays} disabled={!admin || !!settingsError || settingsLoading} onChange={(e) => setSettings((s) => ({ ...s, security: { ...s.security, sessionDurationDays: Number(e.target.value) } }))}/><small>Permitido de 1 a 30 dias; vale para novos logins.</small></label><div className="settings-form-footer"><SaveFeedback message={feedback.security?.message || ''} error={feedback.security?.error}/>{admin && <button className="settings-primary" type="submit" disabled={saving === 'security' || !!settingsError || settingsLoading}>{saving === 'security' ? 'Salvando…' : 'Salvar política'}</button>}</div></form>}
              <div className="settings-access-list"><div className="settings-access-row"><span className="access-mark">A</span><div><strong>Administrador</strong><small>Gerencia as configurações e os atendimentos.</small></div></div><div className="settings-access-row"><span className="access-mark">AT</span><div><strong>Atendente e técnico</strong><small>Consulta configurações e usa ferramentas operacionais.</small></div></div><div className="settings-access-row"><span className="access-mark access-customer">C</span><div><strong>Cliente</strong><small>Acessa o próprio portal e seus chamados.</small></div></div></div>
              <div className="current-access"><span>Seu papel nesta sessão</span><strong>{roleLabels[user.role]}</strong></div>
            </section>
          </div>
        </div>
        <footer className="page-footer">Canal Direto <span>·</span> Atendimento próximo e sem complicação</footer>
      </div>
    </main>

    {teamEditor !== false && <div className="settings-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setTeamEditor(false); }}><section ref={teamDialogRef} className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="team-dialog-title" tabIndex={-1}><div className="settings-modal-heading"><div><span className="settings-eyebrow">ACESSO AO PAINEL</span><h2 id="team-dialog-title">{teamEditor ? 'Editar membro' : 'Cadastrar atendente'}</h2></div><button className="settings-modal-close" onClick={() => setTeamEditor(false)} aria-label="Fechar">×</button></div><form className="settings-modal-form" onSubmit={saveTeam}><label className="settings-field">Nome completo<input name="name" required maxLength={120} defaultValue={teamEditor ? teamEditor.name : ''} autoFocus/></label><label className="settings-field">E-mail de acesso<input name="email" type="email" required maxLength={160} defaultValue={teamEditor ? teamEditor.email : ''}/></label><label className="settings-field">Telefone<input name="phone" type="tel" maxLength={30} defaultValue={teamEditor ? teamEditor.phone || '' : ''}/></label><label className="settings-field">Papel<select name="role" defaultValue={teamEditor ? teamEditor.role : 'AGENT'}><option value="ADMIN">Administrador</option><option value="AGENT">Atendente</option><option value="TECHNICIAN">Técnico</option></select></label><label className="settings-field">{teamEditor ? 'Nova senha (opcional)' : 'Senha inicial'}<input name="password" type="password" minLength={settings.security.passwordMinLength} required={!teamEditor} autoComplete="new-password" placeholder={teamEditor ? 'Deixe em branco para manter' : `Mínimo de ${settings.security.passwordMinLength} caracteres`}/>{teamEditor && <small>Preencha apenas para redefinir a senha.</small>}</label>{teamEditor && <label className="settings-check"><input name="isActive" type="checkbox" defaultChecked={teamEditor.isActive}/> Conta ativa</label>}<SaveFeedback message={teamFormError} error={!!teamFormError}/><div className="settings-modal-actions"><button type="button" className="settings-secondary" onClick={() => setTeamEditor(false)}>Cancelar</button><button className="settings-primary" type="submit" disabled={saving === 'team-form'}>{saving === 'team-form' ? 'Salvando…' : teamEditor ? 'Salvar alterações' : 'Cadastrar atendente'}</button></div></form></section></div>}

    {channelEditor !== false && <div className="settings-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setChannelEditor(false); }}><section ref={channelDialogRef} className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="channel-dialog-title" tabIndex={-1}><div className="settings-modal-heading"><div><span className="settings-eyebrow">CANAL DE ATENDIMENTO</span><h2 id="channel-dialog-title">{channelEditor ? 'Editar canal' : 'Novo canal'}</h2></div><button className="settings-modal-close" onClick={() => setChannelEditor(false)} aria-label="Fechar">×</button></div><form className="settings-modal-form" onSubmit={saveChannel}><label className="settings-field">Nome de exibição<input name="name" required maxLength={100} defaultValue={channelEditor ? channelEditor.name : ''} placeholder="Ex.: WhatsApp comercial" autoFocus/></label><label className="settings-field">Tipo<select name="type" defaultValue={channelEditor ? channelEditor.type : 'WHATSAPP'}><option value="WHATSAPP">WhatsApp</option><option value="PHONE">Telefone</option><option value="EMAIL">E-mail</option><option value="OTHER">Outro</option></select></label><label className="settings-field">Número ou endereço<input name="address" required maxLength={200} defaultValue={channelEditor ? channelEditor.address : ''} placeholder="Ex.: +55 81 99999-0000"/></label><label className="settings-check"><input name="enabled" type="checkbox" defaultChecked={channelEditor ? channelEditor.enabled : true}/> Canal ativo no painel</label><p className="settings-form-hint">O cadastro não conecta o provedor automaticamente. As mensagens só serão recebidas após configurar a integração correspondente.</p><SaveFeedback message={channelFormError} error={!!channelFormError}/><div className="settings-modal-actions"><button type="button" className="settings-secondary" onClick={() => setChannelEditor(false)}>Cancelar</button><button className="settings-primary" type="submit" disabled={saving === 'channel-form'}>{saving === 'channel-form' ? 'Salvando…' : channelEditor ? 'Salvar alterações' : 'Criar canal'}</button></div></form></section></div>}
  </div>;
}
