'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { AuthenticatedUser } from '@canal-direto/shared';
import { UserRole } from '@canal-direto/shared';
import { api, attachAuthInterceptor } from '@/lib/api';
import { clearSession, getCurrentUser } from '@/lib/auth';
import '../diagnostic-flow/flow.css';
import './communication-flows.css';

type NodeType = 'START' | 'SEND_MESSAGE' | 'IDENTIFY_INTENT' | 'DIAGNOSE_CONNECTION' | 'TRANSFER' | 'END';
type FlowNode = { id: string; type: NodeType; title: string; text?: string; x: number; y: number; messageKind?: string; attempts?: number; errorMessage?: string; exhaustedMessage?: string; fallbackFlowId?: string; department?: string };
type FlowEdge = { id: string; source: string; target: string; sourcePort?: string; label?: string };
type CommunicationFlow = { id: string; name: string; country: string; intent: string; enabled: boolean; nodes: FlowNode[]; edges: FlowEdge[] };
type NodeDrag = { id: string; pointerId: number; startX: number; startY: number; nodeX: number; nodeY: number };
type BlockDraft = { node: FlowNode; edges: FlowEdge[] };

const types: { type: NodeType; title: string; summary: string; color: string; icon: string }[] = [
  { type: 'START', title: 'Entrada', summary: 'Início da conversa', color: 'green', icon: '⇩' },
  { type: 'SEND_MESSAGE', title: 'Enviar mensagem', summary: 'Enviar texto ao cliente', color: 'blue', icon: '▰' },
  { type: 'IDENTIFY_INTENT', title: 'Identificar intenção', summary: 'Perguntar e direcionar', color: 'purple', icon: '⚑' },
  { type: 'DIAGNOSE_CONNECTION', title: 'Diagnóstico de conexão', summary: 'Verificações automáticas IXC', color: 'teal', icon: '⌁' },
  { type: 'TRANSFER', title: 'Transferir atendimento', summary: 'Encaminhar para setor', color: 'orange', icon: '⇢' },
  { type: 'END', title: 'Finalizar fluxo', summary: 'Encerrar automação', color: 'gray', icon: '■' },
];
const departments = [{ id: 'COMMERCIAL', name: 'Comercial' }, { id: 'FINANCE', name: 'Financeiro' }, { id: 'SUPPORT_N1', name: 'Suporte N1' }, { id: 'SUPPORT_N2', name: 'Suporte N2' }, { id: 'FIELD', name: 'Campo' }];
const uid = () => typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `flow-${Date.now()}-${Math.random().toString(16).slice(2)}`;

export default function CommunicationFlowsPage() {
  const router = useRouter();
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [ready, setReady] = useState(false);
  const [flows, setFlows] = useState<CommunicationFlow[]>([]);
  const [activeId, setActiveId] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [connectFromId, setConnectFromId] = useState('');
  const [disconnectFromId, setDisconnectFromId] = useState('');
  const [showToolbox, setShowToolbox] = useState(true);
  const [isEditingBlock, setIsEditingBlock] = useState(false);
  const [blockDraft, setBlockDraft] = useState<BlockDraft | null>(null);
  const nodeDrag = useRef<NodeDrag | null>(null);
  const savedFlows = useRef<CommunicationFlow[]>([]);
  const flow = flows.find((item) => item.id === activeId);
  const selected = flow?.nodes.find((node) => node.id === selectedId);
  const editingNode = blockDraft?.node;
  const visibleFlows = useMemo(() => flows.filter((item) => item.name.toLowerCase().includes(query.toLowerCase())), [flows, query]);
  const nodeById = (id: string) => flow?.nodes.find((node) => node.id === id);

  useEffect(() => {
    attachAuthInterceptor();
    const current = getCurrentUser(); setUser(current); setReady(true);
    if (!current) { router.push('/'); return; }
    if (current.role !== UserRole.ADMIN) { router.push('/settings'); return; }
    api.get('/settings/communication-flows').then(({ data }) => {
      const loaded = (data.flows || []) as CommunicationFlow[];
      savedFlows.current = loaded; setFlows(loaded); setActiveId(loaded[0]?.id || ''); setSelectedId(loaded[0]?.nodes?.[0]?.id || '');
    }).catch((e) => setError(e?.response?.data?.message || 'Não foi possível carregar os fluxos.')).finally(() => setLoading(false));
  }, [router]);

  function updateFlow(patch: Partial<CommunicationFlow>) { if (flow) setFlows((prev) => prev.map((item) => item.id === flow.id ? { ...item, ...patch } : item)); setNotice(''); }
  function updateNode(id: string, patch: Partial<FlowNode>) { if (flow) updateFlow({ nodes: flow.nodes.map((node) => node.id === id ? { ...node, ...patch } : node) }); }
  function openBlockEditor(node: FlowNode) {
    setSelectedId(node.id);
    setBlockDraft({ node: { ...node }, edges: (flow?.edges || []).filter((edge) => edge.source === node.id).map((edge) => ({ ...edge })) });
    setConnectFromId('');
    setIsEditingBlock(true);
  }
  function updateBlockDraft(patch: Partial<FlowNode>) {
    setBlockDraft((current) => current ? { ...current, node: { ...current.node, ...patch } } : current);
    setNotice(''); setError('');
  }
  function updateBlockDraftEdge(id: string, patch: Partial<FlowEdge>) {
    setBlockDraft((current) => current ? { ...current, edges: current.edges.map((edge) => edge.id === id ? { ...edge, ...patch } : edge) } : current);
    setNotice(''); setError('');
  }
  function beginNodeDrag(event: ReactPointerEvent<HTMLElement>, node: FlowNode) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    nodeDrag.current = { id: node.id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, nodeX: node.x, nodeY: node.y };
    setSelectedId(node.id);
    setIsEditingBlock(false);
    setBlockDraft(null);
  }
  function moveNodeDrag(event: ReactPointerEvent<HTMLElement>) {
    const drag = nodeDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const maxX = 2500;
    const maxY = 4000;
    updateNode(drag.id, {
      x: Math.max(0, Math.min(maxX, drag.nodeX + event.clientX - drag.startX)),
      y: Math.max(0, Math.min(maxY, drag.nodeY + event.clientY - drag.startY)),
    });
  }
  function endNodeDrag(event: ReactPointerEvent<HTMLElement>) {
    if (nodeDrag.current?.pointerId === event.pointerId) nodeDrag.current = null;
  }
  function updateEdge(id: string, patch: Partial<FlowEdge>) { if (flow) updateFlow({ edges: flow.edges.map((edge) => edge.id === id ? { ...edge, ...patch } : edge) }); }
  function disconnectEdge(edgeId: string) {
    if (!flow) return;
    const edge = flow.edges.find((item) => item.id === edgeId);
    updateFlow({ edges: flow.edges.filter((item) => item.id !== edgeId) });
    if (isEditingBlock && edge?.source === selectedId) setBlockDraft((current) => current ? { ...current, edges: current.edges.filter((item) => item.id !== edgeId) } : current);
    setDisconnectFromId('');
  }
  function connectNode(sourceId: string, targetId: string) {
    if (!flow || sourceId === targetId || flow.edges.some((edge) => edge.source === sourceId && edge.target === targetId)) return;
    const edge = { id: uid(), source: sourceId, target: targetId, label: '' };
    updateFlow({ edges: [...flow.edges, edge] });
    if (isEditingBlock && selectedId === sourceId) setBlockDraft((current) => current ? { ...current, edges: [...current.edges, edge] } : current);
    setConnectFromId('');
  }
  function addFlow() {
    const start: FlowNode = { id: uid(), type: 'START', title: 'Entrada do atendimento', text: 'Quando o cliente inicia uma conversa', x: 265, y: 35 };
    const welcome: FlowNode = { id: uid(), type: 'SEND_MESSAGE', title: 'Enviar mensagem', text: 'Olá, {{nome_usuario}}! Como podemos ajudar?', x: 180, y: 220, messageKind: 'TEXT' };
    const intent: FlowNode = { id: uid(), type: 'IDENTIFY_INTENT', title: 'Identificar intenção', text: 'O que você precisa resolver hoje?', x: 180, y: 445, attempts: 3, errorMessage: 'Não entendi. Pode escolher uma opção?', exhaustedMessage: 'Vou chamar um atendente.' };
    const created: CommunicationFlow = { id: uid(), name: 'Novo fluxo', country: 'Brasil', intent: '', enabled: true, nodes: [start, welcome, intent], edges: [{ id: uid(), source: start.id, target: welcome.id }, { id: uid(), source: welcome.id, target: intent.id }] };
    setFlows((prev) => [...prev, created]); setActiveId(created.id); setSelectedId(start.id); setIsEditingBlock(false); setBlockDraft(null); setNotice('');
  }
  function addNode(type: NodeType) {
    if (!flow) return;
    const info = types.find((item) => item.type === type)!;
    const node: FlowNode = { id: uid(), type, title: info.title, text: type === 'SEND_MESSAGE' ? 'Digite a mensagem que o cliente receberá.' : info.summary, x: 80 + (flow.nodes.length % 3) * 350, y: 180 + Math.floor(flow.nodes.length / 3) * 205, messageKind: 'TEXT', attempts: 3, errorMessage: 'Não consegui entender. Tente novamente.', exhaustedMessage: 'Vou encaminhar sua solicitação.' };
    updateFlow({ nodes: [...flow.nodes, node] }); setSelectedId(node.id);
  }
  function removeNode(id: string) {
    if (!flow || flow.nodes.find((node) => node.id === id)?.type === 'START') return;
    updateFlow({ nodes: flow.nodes.filter((node) => node.id !== id), edges: flow.edges.filter((edge) => edge.source !== id && edge.target !== id) });
    setSelectedId(flow.nodes.find((node) => node.id !== id)?.id || '');
    setIsEditingBlock(false);
    setBlockDraft(null);
    setConnectFromId('');
    setDisconnectFromId('');
  }
  function addEdge() {
    if (!flow || !selected || flow.nodes.length < 2) return;
    setConnectFromId(selected.id);
  }
  async function save() {
    setSaving(true); setError(''); setNotice('');
    try { const { data } = await api.patch('/settings/communication-flows', { flows }); savedFlows.current = data.flows; setFlows(data.flows); setNotice('Fluxos salvos.'); }
    catch (e: any) { const message = e?.response?.data?.message; setError(Array.isArray(message) ? message.join(' ') : message || 'Não foi possível salvar.'); }
    finally { setSaving(false); }
  }
  async function saveBlock() {
    if (!flow || !blockDraft) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const savedFlow = savedFlows.current.find((item) => item.id === flow.id);
      const baseFlow = savedFlow || flow;
      const nodeIdsNeeded = new Set(blockDraft.edges.map((edge) => edge.target));
      const extraNodes = flow.nodes.filter((node) => nodeIdsNeeded.has(node.id) && !baseFlow.nodes.some((savedNode) => savedNode.id === node.id));
      const nodes = [...baseFlow.nodes, ...extraNodes].map((node) => node.id === blockDraft.node.id ? { ...node, ...blockDraft.node } : node);
      const updatedFlow: CommunicationFlow = {
        ...baseFlow,
        nodes,
        edges: [...baseFlow.edges.filter((edge) => edge.source !== blockDraft.node.id), ...blockDraft.edges],
      };
      const nextFlows = savedFlow
        ? savedFlows.current.map((item) => item.id === updatedFlow.id ? updatedFlow : item)
        : [...savedFlows.current, updatedFlow];
      const { data } = await api.patch('/settings/communication-flows', { flows: nextFlows });
      savedFlows.current = data.flows;
      const savedResult = (data.flows as CommunicationFlow[]).find((item) => item.id === updatedFlow.id)!;
      const savedNode = savedResult.nodes.find((node) => node.id === blockDraft.node.id)!;
      const savedOutgoingEdges = savedResult.edges.filter((edge) => edge.source === blockDraft.node.id);
      setFlows((current) => current.map((item) => item.id !== updatedFlow.id ? item : {
        ...item,
        nodes: item.nodes.some((node) => node.id === savedNode.id)
          ? item.nodes.map((node) => node.id === savedNode.id ? savedNode : node)
          : [...item.nodes, savedNode],
        edges: [...item.edges.filter((edge) => edge.source !== blockDraft.node.id), ...savedOutgoingEdges],
      }));
      setBlockDraft({ node: { ...savedResult.nodes.find((node) => node.id === blockDraft.node.id)! }, edges: savedResult.edges.filter((edge) => edge.source === blockDraft.node.id).map((edge) => ({ ...edge })) });
      setNotice('Bloco salvo.');
    } catch (e: any) {
      const message = e?.response?.data?.message;
      setError(Array.isArray(message) ? message.join(' ') : message || 'Não foi possível salvar este bloco.');
    } finally { setSaving(false); }
  }
  function logout() { clearSession(); router.push('/'); }
  const canvasWidth = flow ? Math.max(1300, ...flow.nodes.map((node) => node.x + (node.type === 'START' ? 190 : 370))) + (connectFromId || disconnectFromId ? 260 : 0) : 1300;
  const canvasHeight = flow ? Math.max(760, ...flow.nodes.map((node) => node.y + 210)) : 760;
  if (!ready || !user || user.role !== UserRole.ADMIN) return <div className="workspace"><main className="main-area"><div className="settings-loading"><div className="loader"/><span>Carregando fluxos…</span></div></main></div>;

  return <div className="workspace">
    <aside className="sidebar"><Link href="/dashboard" className="brand"><span className="brand-mark">C</span><span>canal<span className="brand-light">direto</span><small>ATENDIMENTO</small></span></Link><div className="nav-label">MENU PRINCIPAL</div><Link href="/dashboard" className="nav-item"><span className="nav-icon">▦</span> Visão geral</Link><Link href="/customers" className="nav-item"><span className="nav-icon">♙</span> Clientes</Link><Link href="/settings" className="nav-item active"><span className="nav-icon">⚙</span> Configurações</Link><Link href="/settings/communication-flows" className="nav-item active" aria-current="page"><span className="nav-icon">⇢</span> Fluxo de comunicação</Link><Link href="/settings/diagnostic-rules" className="nav-item"><span className="nav-icon">⌁</span> Diagnóstico técnico</Link><div className="sidebar-bottom"><div className="profile-avatar">{user.name.slice(0, 1).toUpperCase()}</div><div className="profile-copy"><strong>{user.name}</strong><span>Administrador</span></div><button className="icon-button logout" onClick={logout} title="Sair" aria-label="Sair">↗</button></div></aside>
    <main className="main-area"><header className="topbar"><div className="breadcrumb"><Link href="/settings">Configurações</Link><span>/</span>Fluxo de comunicação</div><div className="topbar-right"><span className="online-dot"/> Editor de fluxo<div className="top-avatar">{user.name.slice(0, 1).toUpperCase()}</div></div></header>
      <div className="content-area settings-content communication-content">
        <div className="page-heading settings-heading"><div><div className="eyebrow">AUTOMAÇÃO DO ATENDIMENTO</div><h1>Fluxo de comunicação</h1><p>Monte o caminho de entrada do cliente com mensagens, identificação de intenção e encaminhamento.</p></div><button className="settings-primary" onClick={addFlow}>＋ Adicionar fluxo</button></div>
        {error && <div className="settings-inline-error" role="alert">{error}</div>}
        {loading ? <div className="settings-list-state"><div className="loader"/><span>Carregando fluxos…</span></div> : <>
          <section className="settings-card communication-list"><div className="communication-list-tools"><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="⌕  Busque um fluxo…"/><span>{visibleFlows.length} fluxo(s)</span></div><div className="communication-table"><div className="communication-table-head"><span>Nome</span><span>País</span><span>Intenção</span><span>Status</span></div>{visibleFlows.map((item) => <button key={item.id} className={`communication-row${item.id === activeId ? ' selected' : ''}`} onClick={() => { setActiveId(item.id); setSelectedId(item.nodes[0]?.id || ''); setIsEditingBlock(false); }}><strong>{item.name}</strong><span>🇧🇷 {item.country}</span><span>{item.intent || 'Sem intenção cadastrada'}</span><i>{item.enabled ? 'Ativo' : 'Pausado'}</i></button>)}</div></section>
          {flow && <section className="settings-card communication-editor"><div className="communication-editor-head"><div><span className="settings-eyebrow">EDITOR VISUAL</span><h2>{flow.name || 'Fluxo sem nome'}</h2><p>Arraste os blocos, use o + para conectar e a caneta para editar.</p></div><button className="settings-primary" disabled={saving} onClick={() => void save()}>{saving ? 'Salvando…' : 'Salvar alterações'}</button></div>
            <div className="flow-meta"><label className="settings-field">Nome do fluxo<input value={flow.name} onChange={(e) => updateFlow({ name: e.target.value })}/></label><label className="settings-field">Intenção resumida<input value={flow.intent} onChange={(e) => updateFlow({ intent: e.target.value })} placeholder="Ex.: pessoas que precisam de suporte"/></label><label className="flow-enabled"><input type="checkbox" checked={flow.enabled} onChange={(e) => updateFlow({ enabled: e.target.checked })}/> Fluxo ativo</label></div>
            <div className="flow-workspace"><div className={`flow-workbench${showToolbox ? '' : ' toolbox-hidden'}`}><div className="flow-canvas-toolbar"><span>Área de trabalho</span><button type="button" className="settings-secondary" onClick={() => setShowToolbox((visible) => !visible)} aria-expanded={showToolbox}>{showToolbox ? '⟨ Ocultar etapas' : '＋ Adicionar etapa'}</button></div><div className="flow-canvas-wrap"><div className="flow-canvas" style={{ width: canvasWidth, minHeight: canvasHeight }}>
              <svg className="flow-wires" width={canvasWidth} height={canvasHeight} aria-hidden="true"><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L6,3 z" fill="#8c91a4"/></marker></defs>{flow.edges.map((edge) => { const from = nodeById(edge.source), to = nodeById(edge.target); if (!from || !to) return null; const fromCenter = from.type === 'START' ? 85 : 170; const toCenter = to.type === 'START' ? 85 : 170; const x1 = from.x + fromCenter, y1 = from.y + (from.type === 'START' ? 128 : 140), x2 = to.x + toCenter, y2 = to.y; const mid = Math.max(y1 + 36, (y1 + y2) / 2); return <g key={edge.id}><path d={`M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`} markerEnd="url(#arrow)"/><title>{edge.label || 'Próxima etapa'}</title></g>; })}</svg>
                {flow.nodes.map((node, index) => {
                  const info = types.find((item) => item.type === node.type)!;
                  const targets = flow.nodes.filter((target) => target.id !== node.id);
                  const connections = flow.edges.filter((edge) => edge.source === node.id || edge.target === node.id);
                  const isConnecting = connectFromId === node.id;
                  const isDisconnecting = disconnectFromId === node.id;
                  const showConnectionMenu = isConnecting || isDisconnecting;
                  return <div key={node.id} role="group" tabIndex={0} aria-label={`${node.title}. Arraste para mover. Enter para editar.`} className={`flow-node-card ${info.color}${selectedId === node.id ? ' focused' : ''}${showConnectionMenu ? ' connect-open' : ''}`} style={{ left: node.x, top: node.y, zIndex: showConnectionMenu ? 100 : 1 }} onPointerDown={(event) => beginNodeDrag(event, node)} onPointerMove={moveNodeDrag} onPointerUp={endNodeDrag} onPointerCancel={endNodeDrag} onClick={() => { setSelectedId(node.id); setIsEditingBlock(false); setBlockDraft(null); }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedId(node.id); setIsEditingBlock(false); setBlockDraft(null); } }} title="Arraste para mover este bloco">
                    <div className="flow-node-actions" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
                      <button type="button" className="flow-node-connect" aria-label={`Conectar uma próxima etapa após ${node.title}`} title="Conectar etapa" onClick={() => { setSelectedId(node.id); setIsEditingBlock(false); setBlockDraft(null); setDisconnectFromId(''); setConnectFromId(isConnecting ? '' : node.id); }}>＋</button>
                      <button type="button" className="flow-node-disconnect" aria-label={`Desconectar uma etapa de ${node.title}`} title="Desconectar etapa" disabled={!connections.length} onClick={() => { setSelectedId(node.id); setIsEditingBlock(false); setBlockDraft(null); setConnectFromId(''); setDisconnectFromId(isDisconnecting ? '' : node.id); }}>−</button>
                      <button type="button" className="flow-node-delete" aria-label={`Excluir bloco ${node.title}`} title={node.type === 'START' ? 'A etapa de entrada é obrigatória' : 'Excluir bloco'} disabled={node.type === 'START'} onClick={() => removeNode(node.id)}>×</button>
                    </div>
                    <button type="button" className="flow-node-edit" aria-label={`Editar bloco ${node.title}`} title="Editar bloco" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); openBlockEditor(node); }}>✎</button>
                    {isConnecting && <div className={`flow-connect-menu${node.x < 250 ? ' to-right' : ''}`} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}><strong>Escolha o próximo bloco</strong>{targets.length ? targets.map((target) => { const targetType = types.find((item) => item.type === target.type)!; const linked = flow.edges.some((edge) => edge.source === node.id && edge.target === target.id); return <button type="button" key={target.id} disabled={linked} onClick={() => connectNode(node.id, target.id)}><i className={targetType.color}>{targetType.icon}</i><span>{target.title}</span>{linked ? <small>Conectado</small> : <b>→</b>}</button>; }) : <small>Adicione outro bloco ao fluxo para conectar.</small>}</div>}
                    {isDisconnecting && <div className={`flow-connect-menu flow-disconnect-menu${node.x < 250 ? ' to-right' : ''}`} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}><strong>Escolha a conexão para remover</strong>{connections.map((edge) => { const source = nodeById(edge.source), target = nodeById(edge.target); if (!source || !target) return null; return <button type="button" key={edge.id} onClick={() => disconnectEdge(edge.id)}><i className="disconnect-icon">×</i><span>{source.title} → {target.title}</span><b>−</b></button>; })}</div>}
                    <span className="flow-node-stage">Estágio {index + 1}</span><span className="flow-node-title"><i>{info.icon}</i>{node.title}</span><span className="flow-node-copy">{node.text || info.summary}</span>{node.type === 'IDENTIFY_INTENT' && <span className="flow-node-hint">Pergunta · {node.attempts || 3} tentativas</span>}
                  </div>;
                })}
              </div></div>
              {showToolbox && <aside className="flow-toolbox"><h3>Adicionar etapa</h3><p>Inclua blocos no canvas e conecte as etapas.</p>{types.filter((item) => item.type !== 'START').map((item) => <button key={item.type} onClick={() => addNode(item.type)}><span className={`toolbox-icon ${item.color}`}>{item.icon}</span><span><strong>{item.title}</strong><small>{item.summary}</small></span><b>＋</b></button>)}<div className="flow-toolbox-tip">Dica: clique em um bloco para configurar conteúdo, tentativas e destino.</div></aside>}
            </div>
            {editingNode && isEditingBlock && <section className="flow-edit-panel flow-edit-popover"><div className="flow-edit-title"><div><span className="settings-eyebrow">CONFIGURAÇÃO DO BLOCO</span><h3>{editingNode.title}</h3></div><button type="button" className="flow-close-editor" aria-label="Fechar edição" onClick={() => { setIsEditingBlock(false); setBlockDraft(null); }}>×</button>{editingNode.type !== 'START' && <button className="flow-delete-node" onClick={() => { removeNode(editingNode.id); setBlockDraft(null); }}>Remover bloco</button>}</div><div className="flow-edit-grid"><label className="settings-field">Título<input value={editingNode.title} onChange={(e) => updateBlockDraft({ title: e.target.value })}/></label>{editingNode.type !== 'START' && <label className="settings-field">Texto / pergunta<textarea rows={3} value={editingNode.text || ''} onChange={(e) => updateBlockDraft({ text: e.target.value })}/></label>}
              {editingNode.type === 'SEND_MESSAGE' && <label className="settings-field">Tipo de mensagem<select value={editingNode.messageKind || 'TEXT'} onChange={(e) => updateBlockDraft({ messageKind: e.target.value })}><option value="TEXT">Texto</option><option value="IMAGE">Imagem (em breve)</option></select></label>}
              {editingNode.type === 'IDENTIFY_INTENT' && <><label className="settings-field">Quantidade de tentativas<input type="number" min={1} max={10} value={editingNode.attempts || 3} onChange={(e) => updateBlockDraft({ attempts: Number(e.target.value) })}/></label><label className="settings-field">Mensagem de erro<textarea rows={2} value={editingNode.errorMessage || ''} onChange={(e) => updateBlockDraft({ errorMessage: e.target.value })}/></label><label className="settings-field">Mensagem após máximo de tentativas<textarea rows={2} value={editingNode.exhaustedMessage || ''} onChange={(e) => updateBlockDraft({ exhaustedMessage: e.target.value })}/></label><label className="settings-field">Fluxo após máximo de tentativas<select value={editingNode.fallbackFlowId || ''} onChange={(e) => updateBlockDraft({ fallbackFlowId: e.target.value })}><option value="">Continuar para atendente / destino conectado</option>{flows.filter((item) => item.id !== flow.id).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></>}
              {editingNode.type === 'TRANSFER' && <label className="settings-field">Setor de destino<select value={editingNode.department || 'SUPPORT_N1'} onChange={(e) => updateBlockDraft({ department: e.target.value })}>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>}
              {editingNode.type === 'START' && <p className="flow-start-note">Este é o ponto inicial: o fluxo será iniciado quando o cliente começar o atendimento.</p>}
              <div className="flow-connections"><div className="flow-edit-title"><div><span className="settings-eyebrow">CONEXÕES</span><p>Escolha qual etapa será executada depois deste bloco.</p></div><button className="settings-secondary" onClick={addEdge}>＋ Conectar etapa</button></div>{blockDraft.edges.map((edge) => <div className="flow-edge-editor" key={edge.id}><input value={edge.label || ''} onChange={(e) => updateBlockDraftEdge(edge.id, { label: e.target.value })} placeholder="Rótulo da saída (ex.: Financeiro)"/><select value={edge.target} onChange={(e) => updateBlockDraftEdge(edge.id, { target: e.target.value })}>{flow.nodes.filter((node) => node.id !== editingNode.id).map((node) => <option key={node.id} value={node.id}>{node.title}</option>)}</select><button onClick={() => setBlockDraft((current) => current ? { ...current, edges: current.edges.filter((item) => item.id !== edge.id) } : current)} aria-label="Remover conexão">×</button></div>)}{!blockDraft.edges.length && <span className="flow-no-connections">Nenhuma saída conectada.</span>}</div>
              <div className="flow-block-save"><span>{error || notice || 'Salve para aplicar este bloco e suas conexões.'}</span><button type="button" className="settings-primary" disabled={saving} onClick={() => void saveBlock()}>{saving ? 'Salvando…' : 'Salvar bloco'}</button></div>
            </div></section>}
            </div>
            {(notice || error) && <div className={error ? 'settings-inline-error' : 'flow-save-notice'} role={error ? 'alert' : 'status'}>{error || notice}</div>}
            <div className="flow-save-footer"><button className="settings-secondary" onClick={() => { const name = window.prompt('Nome do fluxo', flow.name); if (name?.trim()) updateFlow({ name: name.trim() }); }}>Renomear</button><button className="settings-secondary danger" onClick={() => { if (flows.length > 1 && window.confirm(`Excluir o fluxo “${flow.name}”?`)) { const rest = flows.filter((item) => item.id !== flow.id); setFlows(rest); setActiveId(rest[0].id); setSelectedId(rest[0].nodes[0]?.id || ''); } }}>Excluir fluxo</button><span>{notice || 'As alterações entram em vigor após salvar.'}</span><button className="settings-primary" disabled={saving} onClick={() => void save()}>{saving ? 'Salvando…' : 'Salvar fluxo'}</button></div>
          </section>}
        </>}
      </div>
    </main>
  </div>;
}
