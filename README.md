# Controle de Validade

Sistema para mercadinho cadastrar produtos com data de vencimento e ser avisado do que vence nos próximos
**5, 7, 10, 15 ou 30 dias** (ou qualquer número de dias), para fazer promoção antes de perder a mercadoria.
Registra vendas e perdas e gera um **relatório mensal de perdas**, comparando com o mês anterior e com o
período **antes do sistema** ("reduziu as perdas em X%").

Projeto de extensão universitária.

| Parte | Tecnologia |
| --- | --- |
| API | Node.js 22 + TypeScript + Express 5 |
| Banco | PostgreSQL 16 (migrations em SQL) |
| Fotos | MinIO (compatível com S3), bucket privado |
| E-mail | SMTP via nodemailer (Mailpit no desenvolvimento) |
| Telas | HTML/CSS/JavaScript puro, servido pelo nginx |
| Testes | `node:test` + supertest + PGlite (Postgres em memória, sem Docker) |

## Subindo tudo com Docker

```bash
cp .env.example .env        # preencha os campos <...> (senhas e segredos)
docker compose up -d --build
```

| Serviço | Endereço |
| --- | --- |
| Sistema | http://localhost:8080 |
| E-mails enviados (Mailpit) | http://localhost:8025 |
| Console do MinIO | http://localhost:9001 |

No primeiro start a API roda as migrations, cria o bucket de fotos e cria o administrador com
`ADMIN_EMAIL`/`ADMIN_PASSWORD` do `.env`. **Porta ocupada por outro projeto?** Troque `FRONT_PORT`,
`POSTGRES_PORT`, `MINIO_PORT` e as demais portas no `.env`.

```
                 ┌───────────── docker compose ─────────────┐
navegador ──►  front (nginx :80)  ──/api──►  api (Node :3000)
               telas + cabeçalhos             │      │       │
               de segurança              postgres  minio  mailpit/SMTP
```

## Desenvolvimento sem Docker na API

```bash
npm install
docker compose up -d postgres minio mailpit   # só a infraestrutura
npm run dev                                   # API + telas em http://localhost:3000
```

| Comando | O que faz |
| --- | --- |
| `npm run dev` | API com recarga automática (usa `DATABASE_URL`, `S3_*` do `.env`) |
| `npm test` | todos os testes (não precisa de Docker) |
| `npm run typecheck` | confere os tipos do TypeScript |
| `npm run build` / `npm start` | compila e roda a versão de produção |

## Segurança: o middleware de acesso

Toda rota da API passa pelo controle de acesso, em duas etapas:

1. **`authenticate`**: lê o token do header `Authorization: Bearer <token>` (Postman, apps) ou do cookie
   `httpOnly` (navegador), valida a assinatura **e consulta o banco**, para saber se o usuário ainda existe,
   está ativo e não teve a sessão revogada. Desativar alguém ou trocar a senha ou o papel derruba as sessões
   na hora.
2. **`authorize('permissão')`**: declarado em cada rota, confere se o papel pode fazer aquilo. O mapa fica em
   [`src/lib/permissions.ts`](src/lib/permissions.ts). Todo acesso negado vai para a auditoria.

O teste [`test/security.test.ts`](test/security.test.ts) percorre **todas as rotas** e falha se alguma
ficar sem `authorize()` (ou sem a marcação explícita `publicRoute`), ou se responder sem token.

Outras camadas: helmet/CSP, rate limit (login: 10 erros a cada 15 min; "esqueci a senha": 5 pedidos),
proteção CSRF por `Origin` + cookie `SameSite=Strict`, validação com zod, senhas com bcrypt, links de
convite e de redefinição de uso único (no banco fica só o hash), upload conferido pelos bytes do arquivo,
fotos fora da área pública, SQL sempre parametrizado e front sem `innerHTML`.

| | Funcionário | Administrador |
| --- | :---: | :---: |
| Painel, vencimentos, produtos e lotes | ✓ | ✓ |
| Cadastrar/editar produtos e entradas | ✓ | ✓ |
| Promoção, venda e perda | ✓ | ✓ |
| Excluir produtos e lotes, categorias | | ✓ |
| Relatório e linha de base | | ✓ |
| Usuários e auditoria | | ✓ |

## Usuários novos e e-mail

O administrador **convida** a pessoa (nome, e-mail, papel). Ela recebe um e-mail com um link (válido por
72 h, uso único) para criar a própria senha. Ninguém além dela conhece a senha. "Esqueci minha senha" usa o
mesmo mecanismo (link de 1 h). No Docker os e-mails vão para o Mailpit. Para enviar de verdade, preencha
`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER` e `SMTP_PASS` no `.env`.

## API

Toda listagem é **paginada**: `?page=1&pageSize=20` (máximo **100** por requisição). Resposta:

```json
{ "items": [...], "page": 1, "pageSize": 20, "total": 57, "totalPages": 3 }
```

### Busca de vencimentos

```
GET /api/lots?days=5                vencem de hoje até daqui a 5 dias
GET /api/lots?days=10               ... até 10 dias (qualquer valor de 0 a 365)
GET /api/lots?expired=true          já vencidos
GET /api/lots?expired=true&days=7   vencidos + os que vencem em até 7 dias
```

Filtros combináveis: `q` (nome ou código de barras), `categoryId`, `productId`, `perishable`, `promo`,
`state` (`open`, `closed`, `all`) e `sort` (`expiry`, `-expiry`, `name`, `quantity`).

### Rotas

| Método e rota | Permissão |
| --- | --- |
| `POST /api/auth/login` · `logout` · `forgot-password` · `set-password` | pública |
| `GET /api/auth/me` · `POST /api/auth/change-password` | logado |
| `GET /api/dashboard` | `lots:read` |
| `GET /api/lots` · `GET /api/lots/:id` · `GET /api/lots/:id/movements` | `lots:read` |
| `POST /api/lots` · `PATCH /api/lots/:id` · `POST/DELETE /api/lots/:id/promo` | `lots:write` |
| `POST /api/lots/:id/movements` (venda, perda, ajuste) | `movements:write` |
| `DELETE /api/lots/:id` | `lots:delete` |
| `GET /api/products` · `GET /api/products/:id` · `GET /api/files/:nome` | `products:read` |
| `POST /api/products` · `PATCH /api/products/:id` | `products:write` |
| `DELETE /api/products/:id` | `products:delete` |
| `GET /api/categories` / `POST`, `PATCH`, `DELETE` | `categories:read` / `categories:write` |
| `GET /api/reports/monthly` (`.csv`) · `GET /api/reports/settings` | `reports:read` |
| `PUT /api/reports/settings` | `settings:write` |
| `GET/POST /api/users` · `PATCH /api/users/:id` · `POST /api/users/:id/invite` | `users:manage` |
| `GET /api/audit` | `audit:read` |
| `GET /api/health` | pública (healthcheck do Docker) |

## Como o relatório mede a redução de perdas

- **Perda** = quantidade perdida × preço de custo do lote (o dinheiro que saiu do caixa).
- **Recuperado** = vendas feitas com o lote em promoção, mercadoria que provavelmente viraria perda.
- **Linha de base**: em *Relatório*, o administrador informa quanto o mercadinho perdia por mês **antes** do
  sistema. Os meses a partir do primeiro registro são comparados com esse valor. Meses anteriores aparecem
  como "antes do sistema", sem percentual.

Dica para o trabalho: registre a linha de base logo no início e use o sistema por 2 ou 3 meses antes de
tirar o percentual.

## Produção

- Defina senhas fortes e um `JWT_SECRET` novo no `.env`. **Nunca** versione o `.env` (ele está no `.gitignore`).
- Coloque um proxy com HTTPS na frente do serviço `front` e ajuste `APP_URL` para o endereço público.
  O cookie fica `Secure` automaticamente quando a requisição chega por HTTPS.
- Configure um SMTP real e remova as portas do Postgres e do MinIO do compose se não forem necessárias.
- **Backup**: volumes `postgres-data` (banco) e `minio-data` (fotos).

## Estrutura

```
docker-compose.yml        postgres, minio, mailpit, api, front
docker/                   Dockerfile da API, Dockerfile do front, nginx.conf
src/
  server.ts               inicia: conecta, migra, cria bucket e admin
  app.ts                  ordem dos middlewares e mapa de rotas (públicas x protegidas)
  config.ts               variáveis de ambiente validadas com zod
  db/                     conexão (Postgres/PGlite) e migrations SQL
  middleware/             authenticate/authorize, CSRF, upload, erros
  routes/                 auth, users, categories, products, lots, dashboard, reports, files, audit
  lib/                    permissões, paginação, e-mail, tokens, MinIO, datas, validação
public/                   telas (index.html, css, js/views)
test/                     segurança, usuários, catálogo, unitários, front, força bruta
```
