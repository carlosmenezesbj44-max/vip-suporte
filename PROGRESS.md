# Canal Direto — Status do Projeto

Documento de acompanhamento do desenvolvimento do app de atendimento próprio
para o provedor de internet. Última atualização: 02/10/2026.

## 1. Objetivo do projeto

Criar um app de atendimento próprio do provedor, substituindo/complementando
canais genéricos, com foco inicial em uma **central de tickets/suporte**:

- Clientes abrem chamados (sem conexão, lentidão, financeiro, equipamento, etc.)
- Atendentes e técnicos visualizam a fila, assumem e resolvem os chamados
- Integração com o **IXC Soft** (sistema de gestão do provedor) para vincular
  o chamado ao cadastro/contrato real do cliente

## 2. Decisões tomadas

| Decisão | Escolha |
|---|---|
| Canal inicial | Central de tickets/suporte (não chat/WhatsApp) |
| Plataformas | Web + Mobile desde o início |
| Público | Clientes **e** equipe interna (atendentes/técnicos) no mesmo app, com papéis diferentes |
| Stack | Next.js (web) + React Native/Expo (mobile) + NestJS (backend) |
| Banco de dados | PostgreSQL (via Prisma ORM) |
| Integração externa | IXC Soft (sistema de gestão do provedor), via API REST |

## 3. Arquitetura

Monorepo com npm workspaces:

```
canal-direto/
  apps/
    api/      -> Backend NestJS + Prisma + PostgreSQL
    web/      -> Painel web (Next.js) — clientes e atendentes
    mobile/   -> App mobile (Expo / React Native) — clientes e técnicos
  packages/
    shared/   -> Tipos e enums compartilhados (User, Ticket, status, categorias, etc.)
  docker-compose.yml  -> Sobe o PostgreSQL local via Docker
```

### Backend (`apps/api`)

- **Autenticação**: JWT (login por e-mail/senha), com 4 papéis de usuário:
  `CUSTOMER`, `AGENT`, `TECHNICIAN`, `ADMIN`.
- **Usuários**: cadastro (`POST /api/users`) e listagem restrita a
  atendentes/admin.
- **Tickets**: abertura, listagem (clientes veem só os próprios; atendentes
  veem a fila toda), detalhe, atualização de status/prioridade/responsável,
  e histórico de mensagens dentro do chamado.
- **Chat em tempo real (WebSocket/Socket.IO)**: cada chamado é uma "sala"
  (`ticket:<id>`); mensagens novas e mudanças de status chegam instantaneamente
  para todos conectados àquele chamado (cliente e atendente/técnico), sem
  precisar recarregar a página.
- **Integração IXC**: módulo que consulta a API REST do IXC Soft
  (`/webservice/v1/cliente`) por CPF/CNPJ ao abrir um chamado, vinculando o
  ticket ao contrato real do cliente (`ixcCustomerId`). Falhas na integração
  não bloqueiam a abertura do chamado (modo tolerante a falhas).
- **Banco de dados**: schema Prisma com tabelas `users`, `tickets` e
  `ticket_messages`, já migrado para o Postgres local.

### Web (`apps/web`)

- Tela de login
- Dashboard: fila de chamados (atendentes) ou lista pessoal (clientes)
- Abertura de novo chamado (título, categoria, descrição, CPF/CNPJ)
- Detalhe do chamado: **chat em tempo real** (WebSocket) com histórico,
  indicador de conexão ("● ao vivo"), e troca de status (atendentes)

### Mobile (`apps/mobile`)

- Mesmas telas do web (login, lista de chamados, novo chamado, detalhe com
  chat em tempo real via WebSocket), adaptadas para uso em campo por
  clientes e técnicos.

## 4. O que já está pronto e funcionando

- [x] Estrutura completa do monorepo criada
- [x] Dependências instaladas (`npm install`)
- [x] PostgreSQL rodando via Docker (`canal-direto-postgres`)
- [x] Schema do banco migrado com sucesso (`npm run prisma:migrate` →
      migração `init` aplicada)
- [ ] Pacote `shared` compilado (`npm run build:shared`) — **passo em
      andamento**, necessário antes de rodar a API pela primeira vez
- [ ] API rodando localmente (`npm run dev:api`) — em teste no momento
- [ ] Painel web rodando (`npm run dev:web`)
- [ ] App mobile rodando (`npm run dev:mobile`)
- [ ] Primeiro usuário de teste criado (cliente e atendente)
- [ ] Integração com IXC testada com credenciais reais do provedor

## 5. Pendências conhecidas / próximos passos técnicos

1. **Rodar `npm install` novamente** na raiz do projeto — foram adicionadas
   as dependências de WebSocket (`socket.io`, `@nestjs/websockets`,
   `@nestjs/platform-socket.io` na API e `socket.io-client` no web/mobile)
   para o chat em tempo real.
2. Terminar de validar a subida da API (ajuste recente: build do pacote
   `shared` precisa rodar antes da API, pois o Node não executa `.ts`
   diretamente).
3. Validar subida do web e do mobile apontando para a API local, e testar o
   chat em tempo real entre duas abas/dispositivos diferentes (um cliente e
   um atendente no mesmo chamado).
4. Criar o primeiro usuário `ADMIN` ou `AGENT` (hoje o cadastro público
   permite informar o papel — recomenda-se restringir isso em produção).
5. Configurar `IXC_API_URL` e `IXC_API_TOKEN` reais no `.env` da API e
   validar a consulta de cliente por CPF/CNPJ.
6. Ajustar os campos lidos da resposta do IXC
   (`apps/api/src/ixc/ixc.service.ts`) conforme o formato real retornado
   pela API do provedor (pode variar por versão do IXC).

## 6. Funcionalidades sugeridas para próximas etapas (ainda não implementadas)

- Anexar fotos/arquivos aos chamados
- Notificações push (mobile) e por e-mail quando o status mudar
- Login unificado com as credenciais do cliente no IXC (sem senha própria)
- Painel de métricas para administradores (SLA, tempo médio de resolução)
- App do técnico com funcionalidades específicas de campo (ex: checklist de
  visita, geolocalização)

## 7. Ambiente local (para referência)

- Banco de dados: PostgreSQL 16 via Docker, container
  `canal-direto-postgres`, porta `5432`, usuário/senha `postgres`/`postgres`,
  banco `canal_direto`.
- API: porta `3333`, prefixo `/api`.
- Variáveis de ambiente de exemplo em `apps/api/.env.example` e
  `apps/web/.env.example` (copiar para `.env` / `.env.local` e preencher).
