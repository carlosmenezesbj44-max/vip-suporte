'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  DEFAULT_DIAGNOSTIC_FLOW,
  DiagnosticFlowField,
  DiagnosticFlowOperator,
  TicketDepartment,
  ticketDepartmentOrder,
  UserRole,
} from '@canal-direto/shared';
import type { AuthenticatedUser, DiagnosticFlowRule } from '@canal-direto/shared';
import { api, attachAuthInterceptor } from '@/lib/api';
import { clearSession, getCurrentUser } from '@/lib/auth';
import '../diagnostic-flow/flow.css';

attachAuthInterceptor();

const departmentLabels: Record<TicketDepartment, string> = {
  COMMERCIAL: 'Comercial', FINANCE: 'Financeiro', SUPPORT_N1: 'Suporte N1', SUPPORT_N2: 'Suporte N2', FIELD: 'Campo',
};
const fieldLabels: Record<DiagnosticFlowField, string> = {
  POSSIBLE_INCIDENT: 'Possível incidente coletivo',
  OVERDUE_INVOICES: 'Quantidade de contas vencidas',
  ALL_ACTIVE_OFFLINE: 'Todos os logins ativos estão offline',
  RX_DBM: 'Potência óptica RX (dBm)',
  ANY_PPPOE_ONLINE: 'Existe login PPPoE online',
};
const operatorLabels: Record<DiagnosticFlowOperator, string> = {
  IS_TRUE: 'é verdadeiro', IS_FALSE: 'é falso', GT: 'é maior que', GTE: 'é maior ou igual a', LT: 'é menor que', LTE: 'é menor ou igual a',
};
const booleanFields: DiagnosticFlowField[] = ['POSSIBLE_INCIDENT', 'ALL_ACTIVE_OFFLINE', 'ANY_PPPOE_ONLINE'];
const booleanOperators: DiagnosticFlowOperator[] = ['IS_TRUE', 'IS_FALSE'];
const numberOperators: DiagnosticFlowOperator[] = ['GT', 'GTE', 'LT', 'LTE'];

function makeRule(): DiagnosticFlowRule {
  return {
    id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `rule-${Date.now()}`,
    name: 'Nova etapa', enabled: true, field: 'POSSIBLE_INCIDENT', operator: 'IS_TRUE', threshold: null,
    department: TicketDepartment.SUPPORT_N1, message: 'Continue a triagem com o cliente antes de encaminhar.',
  };
}

export default function DiagnosticFlowPage() {
  const router = useRouter();
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [rules, setRules] = useState<DiagnosticFlowRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const currentUser = getCurrentUser();
    setUser(currentUser);
    setSessionReady(true);
    if (!currentUser) { router.push('/'); return; }
    if (currentUser.role !== UserRole.ADMIN) { router.push('/settings'); return; }
    api.get('/settings/diagnostic-flow')
      .then(({ data }) => setRules(data.rules?.length ? data.rules : DEFAULT_DIAGNOSTIC_FLOW))
      .catch((requestError) => setError(requestError?.response?.data?.message || 'Não foi possível carregar o fluxo salvo.'))
      .finally(() => setLoading(false));
  }, [router]);

  function updateRule(id: string, patch: Partial<DiagnosticFlowRule>) {
    setRules((current) => current.map((rule) => rule.id === id ? { ...rule, ...patch } : rule));
    setNotice('');
  }

  function moveRule(index: number, direction: -1 | 1) {
    const destination = index + direction;
    if (destination < 0 || destination >= rules.length) return;
    setRules((current) => {
      const reordered = [...current];
      [reordered[index], reordered[destination]] = [reordered[destination], reordered[index]];
      return reordered;
    });
    setNotice('');
  }

  function changeField(rule: DiagnosticFlowRule, field: DiagnosticFlowField) {
    const isBoolean = booleanFields.includes(field);
    updateRule(rule.id, {
      field,
      operator: isBoolean ? 'IS_TRUE' : 'LT',
      threshold: isBoolean ? null : field === 'RX_DBM' ? -27 : 0,
    });
  }

  async function saveFlow() {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const { data } = await api.patch('/settings/diagnostic-flow', { rules });
      setRules(data.rules);
      setNotice('Fluxo salvo. As próximas consultas usarão esta ordem e estas regras.');
    } catch (saveError: any) {
      const message = saveError?.response?.data?.message;
      setError(Array.isArray(message) ? message.join(' ') : message || 'Não foi possível salvar o fluxo.');
    } finally {
      setSaving(false);
    }
  }

  function handleLogout() { clearSession(); router.push('/'); }
  if (!sessionReady || !user || user.role !== UserRole.ADMIN) return <div className="workspace"><main className="main-area"><div className="settings-loading"><div className="loader"/><span>Carregando fluxo de atendimento</span></div></main></div>;

  return <div className="workspace">
    <aside className="sidebar">
      <Link href="/dashboard" className="brand"><span className="brand-mark">C</span><span>canal<span className="brand-light">direto</span><small>ATENDIMENTO</small></span></Link>
      <div className="nav-label">MENU PRINCIPAL</div>
      <Link href="/dashboard" className="nav-item"><span className="nav-icon">▦</span> Visão geral</Link>
      <Link href="/customers" className="nav-item"><span className="nav-icon">♙</span> Clientes</Link>
      <Link href="/settings" className="nav-item"><span className="nav-icon">⚙</span> Configurações</Link>
      <Link href="/settings/diagnostic-rules" className="nav-item active" aria-current="page"><span className="nav-icon">⌁</span> Regras do diagnóstico</Link>
      <Link href="/settings/communication-flows" className="nav-item"><span className="nav-icon">⇢</span> Fluxo de comunicação</Link>
      <div className="sidebar-bottom"><div className="profile-avatar">{user.name.slice(0, 1).toUpperCase()}</div><div className="profile-copy"><strong>{user.name}</strong><span>Administrador</span></div><button className="icon-button logout" onClick={handleLogout} title="Sair" aria-label="Sair">↗</button></div>
    </aside>
    <main className="main-area">
      <header className="topbar"><div className="breadcrumb"><Link href="/dashboard">Atendimento</Link><span>/</span><Link href="/settings">Configurações</Link><span>/</span>Regras do diagnóstico</div><div className="topbar-right"><span className="online-dot"/> Editor de fluxo <div className="top-avatar">{user.name.slice(0, 1).toUpperCase()}</div></div></header>
      <div className="content-area settings-content diagnostic-flow-content">
        <div className="page-heading settings-heading"><div><div className="eyebrow">AUTOMAÇÃO DO SUPORTE</div><h1>Regras do diagnóstico</h1><p>Defina a ordem das verificações e para onde encaminhar chamados de “Sem conexão”.</p></div><span className="settings-save-state"><span className="settings-state-dot state-ready"/>Edição habilitada</span></div>
        <section className="flow-intro panel"><div className="flow-intro-icon">⇢</div><div><strong>A primeira regra atendida define a sugestão</strong><p>O diagnóstico consulta financeiro, PPPoE, potência óptica e chamados recentes. As regras são avaliadas de cima para baixo; use as setas para mudar a prioridade.</p></div></section>
        <section className="settings-card flow-builder-card">
          <div className="settings-heading-row"><div className="settings-section-title"><div><span className="settings-eyebrow">REGRAS E ENCAMINHAMENTO</span><h2>Etapas do fluxo</h2><p>Crie condições e escolha o setor e a orientação sugerida para cada caso.</p></div></div><button className="settings-primary" onClick={() => { setRules((current) => [...current, makeRule()]); setNotice(''); }}>＋ Criar etapa</button></div>
          {loading ? <div className="settings-list-state"><div className="loader"/><span>Carregando fluxo salvo…</span></div> : error && !rules.length ? <div className="settings-empty" role="alert"><strong>Fluxo indisponível</strong><span>{error}</span><button className="settings-secondary" onClick={() => window.location.reload()}>Tentar novamente</button></div> : <>
            <div className="flow-rules-list">{rules.map((rule, index) => {
              const numeric = !booleanFields.includes(rule.field);
              const operators = numeric ? numberOperators : booleanOperators;
              return <article className={`flow-rule-card${rule.enabled ? '' : ' flow-rule-disabled'}`} key={rule.id}>
                <header className="flow-rule-header"><span className="flow-rule-number">{String(index + 1).padStart(2, '0')}</span><label className="flow-rule-enabled"><input type="checkbox" checked={rule.enabled} onChange={(event) => updateRule(rule.id, { enabled: event.target.checked })}/><span>{rule.enabled ? 'Ativa' : 'Desativada'}</span></label><div className="flow-rule-order"><button type="button" className="settings-secondary" disabled={index === 0} onClick={() => moveRule(index, -1)} aria-label="Mover etapa para cima">↑</button><button type="button" className="settings-secondary" disabled={index === rules.length - 1} onClick={() => moveRule(index, 1)} aria-label="Mover etapa para baixo">↓</button></div><button type="button" className="flow-rule-remove" onClick={() => { setRules((current) => current.filter((item) => item.id !== rule.id)); setNotice(''); }} disabled={rules.length <= 1}>Remover</button></header>
                <div className="flow-rule-grid">
                  <label className="settings-field">Nome desta etapa<input value={rule.name} maxLength={100} onChange={(event) => updateRule(rule.id, { name: event.target.value })} placeholder="Ex.: Potência crítica"/></label>
                  <label className="settings-field">Verificar<select value={rule.field} onChange={(event) => changeField(rule, event.target.value as DiagnosticFlowField)}>{Object.entries(fieldLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
                  <label className="settings-field">Condição<select value={rule.operator} onChange={(event) => updateRule(rule.id, { operator: event.target.value as DiagnosticFlowOperator })}>{operators.map((operator) => <option key={operator} value={operator}>{operatorLabels[operator]}</option>)}</select></label>
                  {numeric && <label className="settings-field">Limite<input type="number" step={rule.field === 'RX_DBM' ? '0.1' : '1'} value={rule.threshold ?? 0} onChange={(event) => updateRule(rule.id, { threshold: Number(event.target.value) })}/><small>{rule.field === 'RX_DBM' ? 'Exemplo: -27 dBm' : 'Quantidade de contas'}</small></label>}
                  <label className="settings-field">Encaminhar para<select value={rule.department} onChange={(event) => updateRule(rule.id, { department: event.target.value as TicketDepartment })}>{ticketDepartmentOrder.map((department) => <option key={department} value={department}>{departmentLabels[department]}</option>)}</select></label>
                  <label className="settings-field flow-message-field">Orientação apresentada ao atendente<textarea value={rule.message} maxLength={500} rows={2} onChange={(event) => updateRule(rule.id, { message: event.target.value })} placeholder="Explique a próxima ação sugerida"/></label>
                </div>
                <div className="flow-rule-preview"><span>SE</span><strong>{fieldLabels[rule.field]} {operatorLabels[rule.operator]}{numeric ? ` ${rule.threshold ?? 0}` : ''}</strong><i>→</i><span>{departmentLabels[rule.department]}</span></div>
              </article>;
            })}</div>
            {error && <div className="settings-inline-error" role="alert">{error}</div>}
            <div className="flow-builder-footer"><span>{notice || 'As mudanças só entram em vigor depois de salvar.'}</span><button type="button" className="settings-secondary" disabled={saving} onClick={() => { setRules(DEFAULT_DIAGNOSTIC_FLOW.map((rule) => ({ ...rule }))); setError(''); setNotice('Modelo inicial restaurado; salve para aplicar.'); }}>Restaurar modelo inicial</button><button type="button" className="settings-primary" disabled={saving || loading || !rules.length} onClick={() => void saveFlow()}>{saving ? 'Salvando…' : 'Salvar fluxo'}</button></div>
          </>}
        </section>
        <footer className="page-footer">Canal Direto <span>·</span> Atendimento próximo e sem complicação</footer>
      </div>
    </main>
  </div>;
}
