---
version: 1.0
updatedAt: 2026-11-19
title: "OAuth 2.0 do Zero: Papéis, Grants e Tokens"
summary: OAuth 2.0 medido no fio contra um Keycloak 26.8.2 local, só com curl, jq e openssl. Os quatro papéis, cliente público contra confidencial, authorization code com PKCE S256 passo a passo, client credentials, device code (RFC 8628), rotação de refresh token com detecção de reuso, o que o OAuth 2.1 removeu (implicit, ROPC, redirect curinga) e o ataque por trás de cada remoção, escopo contra audience, JWT (RFC 9068) contra token opaco, introspecção (RFC 7662) e revogação (RFC 7009) cronometradas, reuso de code revogando os tokens emitidos e invalid_grant, invalid_client e invalid_scope provocados de propósito.
---
## Objective

OAuth 2.0 deixa uma aplicação chamar uma API em nome de alguém sem nunca ver a
senha dessa pessoa: um authorization server emite access tokens e a API os
confere. As bibliotecas escondem isso atrás de um bloco de configuração, então
esta lição faz tudo na mão contra um authorization server de verdade, o
Keycloak em Docker (melhor que um servidor feito à mão: as respostas, manias
incluídas, são de servidor de produção): papéis, tipos de cliente, todos os
grants, rotação de refresh, o que o OAuth 2.1 removeu e o ataque por trás de
cada remoção, escopo contra audience, JWT contra opaco, introspecção,
revogação e erros provocados. curl, jq e openssl; um arquivo Node é a API.
Versions: Keycloak 26.8.2 (`quay.io/keycloak/keycloak:26.8.2`, `start-dev`),
curl 8.7.1, jq 1.7.1, OpenSSL 4.0.3, Node 22.23.4.

## Use Cases

- Escolher o grant certo para SPA, app mobile, job agendado, CLI ou TV.
- Ler `invalid_grant` ou `invalid_client` num log e saber a causa.
- Revisar o cadastro de um cliente: redirect URIs, PKCE, tempo de vida.
- Decidir se a API valida JWT localmente ou chama a introspecção.

## Deep Dive

### Quatro papéis, dois tipos de cliente

| Papel | Quem | No laboratório |
|---|---|---|
| Resource owner | o usuário que pode conceder acesso | `alice` |
| Client | a aplicação que quer o acesso | `spa`, `worker`, `tv`, `legacy` |
| Authorization server (AS) | autentica, pede consentimento, emite tokens | Keycloak, realm `demo` em `:6180` |
| Resource server (RS) | a API que aceita tokens | `reports-api` |

Um cliente **confidencial** consegue guardar segredo (um backend: o `worker`
manda `worker-secret`). Um cliente **público** não: o que vai dentro de uma
SPA, de um binário mobile ou de uma CLI pode ser lido, então `spa` e `tv` não
têm segredo e dependem de PKCE e de redirect URI exata. Os endpoints vêm do
documento de discovery; `$B` abaixo é `http://localhost:6180/realms/demo/protocol/openid-connect`.

### Authorization code com PKCE, passo a passo (medido)

O PKCE (RFC 7636) amarra o code à instância do cliente que o pediu: o cliente
guarda um `code_verifier` aleatório e manda só o SHA-256 dele, o
`code_challenge`. A receita primeiro reproduz o vetor de teste do RFC
(Apêndice B: o verifier `dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk` deu
`E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM`, igual ao RFC) e depois roda:

```bash
VERIFIER=$(openssl rand 32 | openssl base64 -A | tr '+/' '-_' | tr -d '=')
CHALLENGE=$(printf %s "$VERIFIER" | openssl dgst -sha256 -binary | openssl base64 -A | tr '+/' '-_' | tr -d '=')
# 1) front channel: o navegador vai ao AS, a alice entra no formulário do Keycloak
GET $B/auth?response_type=code&client_id=spa&redirect_uri=http%3A%2F%2Flocalhost%3A6181%2Fcb
      &scope=reports.read&state=$STATE&code_challenge=$CHALLENGE&code_challenge_method=S256
# 2) back channel: o cliente troca o code mais o verifier
curl -s $B/token -d grant_type=authorization_code -d client_id=spa \
  -d redirect_uri=http://localhost:6181/cb -d code=$CODE -d code_verifier=$VERIFIER
```

```text
code_verifier=pIquw3rtSqFhHsWVnlL6mFJL2YEHN03n_neFwa_LEDw
code_challenge=R7BrEvR4VtCoDcdQ1jtEdJx9Z7A3lkxca7-oxkLr3jU
Location: http://localhost:6181/cb?state=58cf628b1d9794160ed90c7e9b5c18dd&session_state=rCx8-RYUpdRpNVqMqVRCoXIk&iss=http%3A%2F%2Flocalhost%3A6180%2Frealms%2Fdemo&code=bf29521c-cefb-c672-32bc-e2a707da3dee.rCx8-...
state matches
{"access_token":"eyJhbGciOiJSUzI1NiIs...","expires_in":300,"refresh_expires_in":1800,"refresh_token":"eyJhbGciOiJIUzUxMiIs...","token_type":"Bearer","scope":"reports.read",...}
{"exp":1795049542,"iat":1795049242,"auth_time":1795049242,"jti":"onrtac:6c02...","iss":"http://localhost:6180/realms/demo","aud":"reports-api","sub":"0efb9582-...","typ":"Bearer","azp":"spa","sid":"rCx8-...","scope":"reports.read"}
```

O code passa pelo navegador e pode vazar; os tokens só andam no back channel.
`state` é a defesa do cliente contra CSRF e tem que voltar idêntico; o `iss`
no redirect é o RFC 9207 (defesa contra mix-up). O access token é um JWT para
a audience `reports-api`, emitido para (`azp`) `spa`, válido por 300 segundos.
Sem `id_token`: `openid` não foi pedido, então isto é OAuth puro, não OIDC.

### Quebrando de propósito: redirect URI, PKCE, reuso de code (medido)

```text
authorize with redirect_uri=/cb2 (not registered)  -> HTTP 400, no redirect, page says "Invalid parameter: redirect_uri"
authorize without code_challenge                   -> /cb?error=invalid_request&error_description=Missing+parameter%3A+code_challenge_method
authorize with code_challenge_method=plain         -> /cb?error=invalid_request&error_description=Invalid+parameter%3A+code+challenge+method+is+not+matching+the+configured+one
token with a wrong code_verifier                   -> {"error":"invalid_grant","error_description":"PKCE verification failed: Code mismatch"}
 ...then the right verifier on the same code       -> {"error":"invalid_grant","error_description":"Code not valid"}
token with redirect_uri=/other                     -> {"error":"invalid_grant","error_description":"Incorrect redirect_uri"}
replay a code that was already exchanged           -> {"error":"invalid_grant","error_description":"Code not valid"}
first access token after the replay                -> introspection {"active":false}
```

Uma redirect URI não cadastrada não recebe nada, nem o erro; um verifier
errado queima o code; um code reutilizado ainda revoga os tokens já emitidos
a partir dele, como pede a seção 4.1.2 do RFC 6749: outra pessoa tem o code.

### Client credentials: nenhum usuário (medido)

```text
$ curl -s -u worker:worker-secret $B/token -d grant_type=client_credentials -d scope=reports.read
{"expires_in":300,"refresh_expires_in":0,"token_type":"Bearer","scope":"reports.read",...}   # no refresh_token
header  {"alg":"RS256","typ" : "at+jwt","kid" : "-O9ROeSgIbWUhOjGxuXYQkiMhpbk3AatwFerlTR9JFk"}
payload {"exp":1795049436,"iat":1795049136,"jti":"trrtcc:1c24...","iss":"http://localhost:6180/realms/demo","aud":"reports-api","sub":"464b2aef-...","azp":"worker","scope":"reports.read","client_id":"worker",...}
wrong secret          -> {"error":"unauthorized_client","error_description":"Invalid client or Invalid client credentials"} HTTP 401
unknown client_id     -> {"error":"invalid_client","error_description":"Invalid client or Invalid client credentials"} HTTP 401
scope=reports.delete  -> {"error":"invalid_scope","error_description":"Invalid scopes: reports.delete"} HTTP 400
public client `spa`   -> {"error":"unauthorized_client","error_description":"Public client not allowed to retrieve service account"} HTTP 401
```

O cliente é o próprio resource owner (`sub` é a service account dele) e não
recebe refresh token: quando expira, pede de novo. Mania medida: o RFC 6749
(seção 5.2) manda `invalid_client` em falha de autenticação do cliente, mas o
Keycloak 26.8.2 responde `unauthorized_client` a segredo errado. Monitore os dois.

### Device authorization grant, RFC 8628 (medido)

```text
$ curl -s $B/auth/device -d client_id=tv -d scope=reports.read
{"device_code":"pYtgfmYMU_csfd...","user_code":"LFMR-WJXE","verification_uri":"http://localhost:6180/realms/demo/device","verification_uri_complete":"...?user_code=LFMR-WJXE","expires_in":600,"interval":5}
poll (grant_type=urn:ietf:params:oauth:grant-type:device_code) -> {"error":"authorization_pending",...} HTTP 400
poll again right away                                           -> {"error":"slow_down","error_description":"Slow down"} HTTP 400
alice opens the URI, signs in, accepts the consent screen       -> "Device Login Successful"
poll after 5 s                                                  -> {"access_token":"eyJhbGciOiJSUzI1NiIs...", ...}
```

A TV mostra o `user_code`, a alice aprova no celular, a TV faz polling;
`slow_down` quer dizer "some 5 segundos ao intervalo" (RFC 8628, seção 3.5).
Ponto fraco: o atacante inicia um fluxo e manda o código para a vítima
(device code phishing), então a tela de consentimento precisa dizer qual app
pede; deixe o grant desligado em cliente que não precisa dele.

### Refresh token e rotação (medido)

O realm tem `revokeRefreshToken=true` e `refreshTokenMaxReuse=0`: cada refresh
devolve um refresh token novo e o antigo morre.

```text
refresh with RT1 -> new pair, RT2 differs: yes
replay RT1       -> {"error":"invalid_grant","error_description":"Maximum allowed refresh token reuse exceeded"} HTTP 400
RT2 after the replay: {"active":false}  AT2: {"active":false}
use RT2          -> {"error":"invalid_grant","error_description":"Session doesn't have required client"}
```

O AS não distingue ladrão de usuário, então mata a família inteira, RT2
incluído: é a detecção de reuso da seção 4.14.2 do RFC 9700. O OAuth 2.1 exige
refresh token de cliente público de uso único ou preso ao remetente.

### O que o OAuth 2.1 removeu, e por quê (medido)

O OAuth 2.1 (draft-ietf-oauth-v2-1-17, ainda rascunho) traz o RFC 9700 para o
núcleo: PKCE por padrão, redirect com comparação exata, sem implicit, sem
password grant, sem token em query string. O Keycloak ainda aceita os hábitos
antigos num cliente que os habilita, como o `legacy`:

```text
implicit (response_type=token):
Location: http://localhost:6181/cb#state=26bb69b0faaae21e&iss=...&access_token=<JWT>&token_type=Bearer&expires_in=900
wildcard redirect: legacy registered http://localhost:6181/*, attacker sends redirect_uri=http://localhost:6181/user-content/mallory.html
Location: http://localhost:6181/user-content/mallory.html?state=26bb69b0faaae21e&iss=...&code=a027f1d9-0280-f627-47fd-e5f1b95a46...
ROPC (grant_type=password): the client itself holds alice's password
{"token_type":"Bearer","expires_in":300,"scope":"email profile","has_refresh":true}
wrong password -> {"error":"invalid_grant","error_description":"Invalid user credentials"} HTTP 400
```

- **Implicit**: o token fica no fragmento da URL, exposto a scripts da página,
  histórico e extensões, sem PKCE para amarrá-lo. Code + PKCE substituiu.
- **Redirect curinga**: qualquer página sob o prefixo (upload de usuário, um
  open redirect) recebe o code. O cadastro exato do `spa` respondeu 400.
- **ROPC**: o app vê a senha crua, então nada de MFA, passkey ou federação, o
  usuário aprende a digitar senha em app de terceiro e o token endpoint vira
  um oráculo de adivinhação de senha (`Invalid user credentials`).

### Escopo contra audience

Escopo diz **o que** o token permite (`reports.read`); audience diz **qual
API** pode aceitá-lo (`aud: reports-api`). Aqui o escopo carrega um mapper de
audience, e o token do `worker` sem ele voltou com `"scope":""` e sem `aud`.
Uma API que só confere a assinatura aceita tokens emitidos para qualquer outra
API do mesmo AS: confira `iss`, `aud`, `exp` e depois o escopo.

### JWT contra opaco: introspecção e revogação (medido)

Um access token JWT (RFC 9068, `typ: at+jwt`, ligado aqui pelo atributo de
cliente `access.token.header.type.rfc9068`) é conferido localmente com as
chaves públicas do AS. Um token opaco é um identificador que só o AS resolve,
pela introspecção (RFC 7662). Um resource server em Node 22 (`node:crypto`,
`fetch`, sem pacotes) faz as duas coisas no mesmo token e o revoga (RFC 7009):

```text
local JWT check : 0.024 ms/op -> true
introspection   : 2.322 ms/op -> active=true
POST /revoke    : HTTP 200
after revoke    : local=true introspection active=false
revoke garbage  : HTTP 200
introspection body (active token):
{"active":true,"client_id":"worker","token_type":"Bearer","scope":"reports.read","aud":"reports-api","sub":"464b2aef-...","exp":1795049531,"iss":"http://localhost:6180/realms/demo"}
```

A introspecção foi umas 100 vezes mais lenta mesmo em localhost, mas só ela
enxerga a revogação: depois do `/revoke` a checagem local seguiu `true` até o
`exp`. O 200 para lixo é proposital (RFC 7009, seção 2.2): o token está morto
de qualquer jeito. O RFC 9068 exige `iss`, `exp`, `aud`, `sub`, `client_id`,
`iat`, `jti`: o do `worker` tem todos; o de usuário do `spa` não tem
`client_id` (tem `azp`), então o Keycloak não segue o RFC 9068 por padrão.

### Erros OAuth que você vai ver

| Erro | Endpoint | Provocado aqui por |
|---|---|---|
| `invalid_request` | authorize, token | falta de `code_challenge` |
| `invalid_client` | token, introspect | `client_id` desconhecido; segredo errado do RS na introspecção |
| `unauthorized_client` | token | cliente público pedindo client credentials; no Keycloak, também segredo errado |
| `invalid_grant` | token | code reutilizado, queimado ou divergente; verifier errado; refresh reutilizado; senha errada no ROPC |
| `invalid_scope` | token | `scope=reports.delete` |
| `authorization_pending`, `slow_down` | token (device) | polling antes da aprovação, polling rápido demais |

### Qual grant para qual cenário

| Cenário | Grant | Tipo de cliente |
|---|---|---|
| Web app com backend | authorization code + PKCE | confidencial |
| SPA | code + PKCE, de preferência via BFF para os tokens ficarem no servidor | público (ou BFF confidencial) |
| App mobile ou desktop | code + PKCE, navegador do sistema | público |
| Serviço a serviço, cron, batch | client credentials | confidencial |
| TV, CLI, IoT sem navegador | device authorization (RFC 8628) | público |
| "Formulário de usuário e senha no meu app" | nenhum: migrar para code + PKCE (ROPC saiu no 2.1) | n/a |

### Para onde ir

OAuth só delega acesso. O próximo concept, OIDC, acrescenta `id_token`,
`nonce` e discovery, que transformam isso em login; o seguinte disseca o JWT
(`alg`, `kid`, JWKS, ataques). O concept de autorização do MCP roda este mesmo
fluxo code + PKCE, mais resource indicators, contra um servidor MCP.

## Trade-offs

- **JWT contra token opaco.** JWT valida em microssegundos, mas não dá para
  recolher antes do `exp`; o opaco custa uma introspecção (e cache), mas
  revoga na hora. Meio-termo comum: JWT de 5 minutos e refresh revogável.
- **Rotação estrita contra rede instável.** A detecção de reuso pega refresh
  roubado, mas um app mobile que perde a resposta e tenta de novo com o token
  antigo desloga o usuário. Uma folga de reuso (`refreshTokenMaxReuse > 0` no
  Keycloak) ajuda e enfraquece a detecção.
- **PKCE mais segredo contra só PKCE.** Cliente confidencial usa os dois (o
  PKCE barra injeção de code, o segredo autentica); público só tem o PKCE.
- **Escopo grosso contra fino.** `reports.read` é fácil de consentir; regra
  por registro pertence ao modelo de autorização da API, não aos escopos.

## Documentation Links

- [RFC 6749, The OAuth 2.0 Authorization Framework, IETF](https://datatracker.ietf.org/doc/html/rfc6749) (doc)
- [RFC 7636, Proof Key for Code Exchange (PKCE), IETF](https://datatracker.ietf.org/doc/html/rfc7636) (doc)
- [RFC 8628, OAuth 2.0 Device Authorization Grant, IETF](https://datatracker.ietf.org/doc/html/rfc8628) (doc)
- [RFC 7009, OAuth 2.0 Token Revocation, IETF](https://datatracker.ietf.org/doc/html/rfc7009) (doc)
- [RFC 7662, OAuth 2.0 Token Introspection, IETF](https://datatracker.ietf.org/doc/html/rfc7662) (doc)
- [RFC 9068, JWT Profile for OAuth 2.0 Access Tokens, IETF](https://datatracker.ietf.org/doc/html/rfc9068) (doc)
- [RFC 9700, Best Current Practice for OAuth 2.0 Security, IETF](https://datatracker.ietf.org/doc/html/rfc9700) (doc)
- [RFC 9207, OAuth 2.0 Authorization Server Issuer Identification, IETF](https://datatracker.ietf.org/doc/html/rfc9207) (doc)
- [The OAuth 2.1 Authorization Framework (draft), IETF](https://datatracker.ietf.org/doc/draft-ietf-oauth-v2-1/) (doc)
- [Securing applications and services with OpenID Connect, Keycloak](https://www.keycloak.org/securing-apps/oidc-layers) (doc)
- [Keycloak Server Administration Guide, Keycloak](https://www.keycloak.org/docs/latest/server_admin/index.html) (doc)
