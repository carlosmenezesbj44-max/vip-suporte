# Canal Direto

App de atendimento próprio para provedor de internet: central de tickets/suporte
para clientes e equipe de atendimento/técnicos, com integração ao **IXC Soft**.

## Estrutura do monorepo

```
apps/
  api/      -> Backend NestJS + Prisma + PostgreSQL
  web/      -> Painel web (Next.js) — clientes e atendentes
  mobile/   -> App mobile (Expo / React Native) — clientes e técnicos
packages/
  shared/   -> Tipos e enums compartilhados entre api, web e mobile
```

## Pré-requisitos

- Node.js 18+
- PostgreSQL rodando localmente (ou acessível via `DATABASE_URL`)
- Conta/token de API no IXC Soft (para a integração de clientes)

## Primeiros passos

1. Instale as dependências na raiz do monorepo:

   ```bash
   npm install
   ```

2. Configure as variáveis de ambiente:

   ```bash
   cp apps/api/.env.example apps/api/.env
   cp apps/web/.env.example apps/web/.env.local
   ```

   Edite `apps/api/.env` com a `DATABASE_URL`, `JWT_SECRET` e as credenciais
   da API do IXC (`IXC_API_URL`, `IXC_API_TOKEN`).

3. Gere o client do Prisma e rode as migrações:

   ```bash
   npm run prisma:generate
   npm run prisma:migrate
   ```

4. Suba a API:

   ```bash
   npm run dev:api
   ```

5. Em outro terminal, suba o painel web:

   ```bash
   npm run dev:web
   ```

6. Em outro terminal, suba o app mobile (Expo):

   ```bash
   npm run dev:mobile
   ```

### Iniciar banco, API e painel web com um comando

Com Docker Compose disponível, use na raiz do projeto:

```bash
npm run dev
```

O comando inicia o PostgreSQL, aplica as migrações e abre a API em
`http://localhost:3333/api` e o painel em `http://localhost:3000`. Para
encerrar API e painel, pressione `Ctrl+C`; o banco continua rodando. Se o
Docker Compose não estiver disponível, o comando usa um PostgreSQL que já
esteja rodando em `localhost:5432`.

Para subir os três serviços empacotados em containers, use `docker compose up
--build` (requer o plugin Docker Compose v2). A configuração de desenvolvimento
em containers pode ser iniciada com `docker compose --profile development up
--build`.

## Publicação na Cloudflare

O painel Next.js é publicado em Cloudflare Workers com o adaptador OpenNext.
Na configuração do Worker conectado ao GitHub, use:

- **Root directory:** `/` (raiz do monorepo, onde está o `package-lock.json`).
- **Build command:** deixe vazio.
- **Deploy command:** `npm run deploy --workspace=apps/web`.
- **Build variable:** `NEXT_PUBLIC_API_URL=https://api.seu-dominio.com/api`.

O comando de deploy compila o pacote compartilhado e o painel para Workers. O
endereço da API é incorporado no painel durante a compilação; o script valida
que seja HTTPS e público para evitar publicar links para `localhost`.

Este Worker publica somente o painel web. A API NestJS e o PostgreSQL precisam
de uma implantação própria. A API requer Node.js em container e PostgreSQL
acessível pela internet; ela pode ficar em um host Node ou em Cloudflare
Containers (plano Workers Paid), que exige um Worker de roteamento adicional.
Configure na API `DATABASE_URL`, `JWT_SECRET`, `SETTINGS_ENCRYPTION_KEY`,
`IXC_API_URL`, `IXC_API_TOKEN` e `PORT`. Anexos hoje são gravados no disco local
da API (`UPLOAD_DIR`); em hospedagem com disco efêmero, mova-os para armazenamento
persistente, como Cloudflare R2, antes de depender deles em produção.

Para o app móvel acessar o serviço em qualquer rede, configure `EXPO_PUBLIC_API_URL`
com o mesmo endereço público da API e gere um APK novo. O APK atualmente
configurado no projeto ainda aponta para o IP local `192.168.0.102`.

## Papéis de usuário

- `CUSTOMER`: abre chamados e acompanha o próprio histórico.
- `AGENT` / `TECHNICIAN`: vê a fila geral de chamados, assume, altera status e prioridade.
- `ADMIN`: acesso total.

Clientes podem criar a própria conta no portal web (`/register`) ou no app
móvel, com nome, telefone, e-mail e senha. A equipe entra em **Clientes** no
menu do painel para pesquisar por nome ou telefone e consultar os chamados
recentes. A lista atualiza automaticamente enquanto a página estiver aberta.
Telefones são armazenados somente com dígitos para que a busca funcione mesmo
quando o atendente digita espaços, parênteses ou hífens.

O primeiro usuário pode ser criado via `POST /api/users` (endpoint público de
cadastro). Para criar um atendente/admin, chame o mesmo endpoint informando
`"role": "AGENT"` (ou `ADMIN`) no corpo da requisição — recomenda-se restringir
esse campo em produção.

## Integração com o IXC Soft

O módulo [`apps/api/src/ixc/ixc.service.ts`](apps/api/src/ixc/ixc.service.ts)
consulta a API REST do IXC (`/webservice/v1/cliente`) por CPF/CNPJ ao abrir um
chamado, vinculando o ticket ao cadastro/contrato real do cliente
(`ixcCustomerId`). Ajuste os campos retornados (`registro.razao`,
`registro.cnpj_cpf`, etc.) conforme a versão da API do seu provedor, caso
necessário.

Configure `IXC_API_URL` com a URL base terminada em `/webservice/v1` e
`IXC_API_TOKEN` com a credencial `ID_DO_USUARIO:TOKEN` fornecida pelo IXC. O
serviço codifica a credencial em Base64 para autenticação HTTP Basic.

## Próximos passos sugeridos

- Autenticação/SSO a partir do login do cliente no IXC (evitar senha própria).
- Notificações push (mobile) e por e-mail quando o status do ticket mudar.
- Anexar fotos/arquivos aos chamados.
- Painel de métricas (SLA, tempo médio de resolução) para administradores.
