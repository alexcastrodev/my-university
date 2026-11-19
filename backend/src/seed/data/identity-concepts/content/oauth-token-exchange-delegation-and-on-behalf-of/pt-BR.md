---
version: 1.0
updatedAt: 2026-11-19
---
## Objective

Um usuário chama o serviço A com um access token, e A precisa de dados do
serviço B. A tentação é repassar o token. Esta lição mostra no fio por que isso
falha (e por que é proibido quando funciona) e depois mede as respostas reais
num realm do Keycloak: a credencial do próprio A, a troca de token (RFC 8693)
como impersonation e como delegation, em que o token carrega uma claim `act`
aninhada nomeando A. Testa o que o servidor recusa (ampliar escopo, audience
errada, solicitante errado, subject expirado), ignora (`resource`) e não sabe
fazer (uma cadeia de delegação). O on-behalf-of do Microsoft Entra é só
documentação (sem tenant). Ferramentas: curl, jq, Node 22.
Versions: Keycloak 26.8.2 (`quay.io/keycloak/keycloak:26.8.2`, `start-dev`,
`--features=token-exchange-delegation,parameterized-scopes`), curl 8.7.1,
jq 1.7.1, Node 22.23.4. Só documentação: Microsoft Entra ID, Microsoft.Identity.Web 4.18.0.

## Use Cases

- Revisar um serviço que copia o cabeçalho `Authorization` recebido para suas chamadas, e escolher entre credencial de serviço, impersonation e delegation.
- Ler `act` num token ou log de auditoria; desenhar a chamada downstream de um servidor MCP, gateway ou BFF.

## Deep Dive

### O problema, medido: A não pode repassar o token

Realm `demo`: alice entra pelo cliente público `web` (password grant, atalho do
laboratório para dispensar o navegador; o fluxo com PKCE está na lição de OAuth) e
o token dela é restrito à audience do serviço A (`svc-a`). O serviço B (`svc-b`) é
um resource server em Node que confere assinatura, `iss`, `exp`, `aud` e `scope`
(RFC 9700 seção 2.3: o resource server DEVE recusar um token que não era para ele).

```text
alice's token : {"sub":"a568...","aud":["svc-a","account"],"azp":"web","scope":"a.use profile email"}
A forwards it : {"error":"invalid_token","detail":"aud [\"svc-a\",\"account\"] does not contain svc-b"} HTTP 401
```

A recusa é o caso bom. Se B pulasse a checagem de `aud`, ou se o token da alice
incluísse `svc-b`, o token repassado funcionaria: B não distingue A de alice, A
pode reutilizá-lo onde essa audience for aceita, e todo escopo da alice fica
exposto a cada serviço que A chama. (A lição de segurança do MCP trata de passthrough e confused deputy.)

### Resposta 1: A usa a própria credencial (client credentials)

```text
B sees A's own token: {"ok":true,"sub":"e151...","azp":"svc-a","aud":["svc-b","account"],"act_chain":[]} HTTP 200
```

Serve para trabalhos sem usuário (batch, refresh de cache). Numa requisição de usuário perde o
usuário: `sub` é a conta de serviço de A, então B não aplica regras por usuário nem registra quem
pediu, e A passa a ter uma autoridade que nenhum usuário consentiu.

### Resposta 2: troca de token, forma impersonation (RFC 8693)

Um grant no token endpoint: A apresenta o token do usuário e pede outro. Parâmetros
como a RFC 8693 e o Keycloak os usam:

| Parâmetro | Significado | Standard exchange do Keycloak |
|---|---|---|
| `subject_token`, `subject_token_type` | o token do usuário e seu tipo | só access tokens |
| `audience` / `resource` | nome / URI do destino | `audience` sim, `resource` ignorado |
| `scope`, `requested_token_type` | o que se quer | escopos opcionais do solicitante; access, ID ou refresh |
| `actor_token`, `actor_token_type` | quem age (delegation) | access token do ator |

O standard token exchange V2 (suportado desde o Keycloak 26.2, ligado por padrão)
exige um interruptor no solicitante, que precisa ser confidencial: atributo
`standard.token.exchange.enabled=true` em `svc-a`. A se autentica e envia o token da alice:

```bash
curl -s -u svc-a:a-secret $B/token -d grant_type=urn:ietf:params:oauth:grant-type:token-exchange \
  -d subject_token=$ALICE -d subject_token_type=urn:ietf:params:oauth:token-type:access_token \
  -d audience=svc-b -d scope=b.read
```

```text
{"expires_in":20,"token_type":"Bearer","scope":"b.read profile email","issued_token_type":"urn:ietf:params:oauth:token-type:access_token",...}
new token : {"sub":"a568...","aud":"svc-b","azp":"svc-a","scope":"b.read profile email"}
B sees    : {"ok":true,"sub":"a568...","azp":"svc-a","aud":"svc-b","act_chain":[]} HTTP 200
```

`sub` é a alice, `aud` é exatamente B, `azp` é A: **impersonation**. B vê a alice e o
único rastro de A é `azp`, que não é uma claim de delegação. `expires_in` é 20
porque o token da alice vive 20 s (atributo do cliente `web`) enquanto o padrão de
`svc-a` é 300 s: o token trocado não sobrevive ao subject (mudança do Keycloak
recente, segundo o guia de upgrade; antes um cliente podia re-trocar para sempre).

### O que o servidor recusa, ignora e permite (medido)

`svc-x` é um cliente confidencial com a troca desligada.

| Requisição | Resposta |
|---|---|
| audience `svc-nope` | `invalid_client`, "Audience not found" |
| subject token cujo `aud` não tem `svc-a` | `access_denied` (403), "Client is not within the token audience" |
| `svc-x` ou o `web` público como solicitante | `invalid_request`, "Standard token exchange is not enabled for the requested client" |
| secret errado; `scope` desconhecido | `unauthorized_client`; `invalid_scope` |
| token lixo, ou token da alice após 20 s | `invalid_request`, "Invalid token" (sem "expired" separado) |
| `resource=http://svc-b/` no lugar de `audience` | HTTP 200, `resource` ignorado; `aud` veio do escopo |

A RFC 8693 seção 2.2.2 pede `invalid_target` para destino desconhecido; o Keycloak
26.8.2 nunca devolveu esse erro. A doc diz que `resource` ainda não é suportado, e o
laboratório mostra que ele é descartado sem erro: nunca conte com ele.

### Downscoping: o padrão permite ampliar, um executor impede (medido)

Doc do Keycloak: por padrão a troca "can be used to request extra scopes and audiences
that are not present in the initial subject_token" (`scope` escolhe entre os escopos
opcionais do solicitante). Com o executor desligado, o token da alice só tinha `a.use` e A pediu C:

```text
exchange audience=svc-c scope=c.read -> {"sub":"a568...","aud":"svc-c","azp":"svc-a","scope":"c.read profile email"}
```

A alice nunca teve `c.read`; A o fabricou (a RFC 8693 não obriga a estreitar: é política
do servidor). O controle é o client policy executor `downscope-assertion-grant-enforcer`
(um profile e uma policy com condição `any-client`, via `PUT /admin/realms/demo/client-policies/profiles`
e `/policies`). Com ele ligado:

```text
subject b.read b.write, ask b.read   -> {"aud":"svc-b","scope":"b.read profile email"}   (narrowing allowed)
subject b.read only,    ask b.write  -> {"error":"invalid_scope","error_description":"Scopes [b.write] not present in the initial access token [a.use, profile, b.read, email]"}
subject b.read, no scope parameter   -> {"error":"invalid_request","error_description":"Requested audience not available: svc-b"}
```

Última linha: `audience` só filtra as audiences que os escopos de A já produziriam, nunca acrescenta.
Ligue o executor para todo solicitante, como se liga o PKCE.

### Resposta 3: delegation, `may_act` na entrada, `act` na saída (preview do Keycloak, medido)

Com delegation o novo token diz "alice, por meio de A". A RFC 8693 usa duas claims:
`may_act` no subject token (alice autoriza A) e `act` no token emitido (A está agindo).
No Keycloak 26.8 isso é **preview**, e o laboratório precisou de quatro coisas que a doc
lista e que falham em silêncio quando faltam:

(1) Admin permissions (FGAP V2) ligadas, com uma permissão em `Users`, escopo `delegate`,
policy = cliente `svc-a`. (2) Um cliente de login com **Consent required** (`portal`,
code flow). (3) Um login pedindo `scope=openid b.read delegation:client:svc-a`.
(4) A alice aceita uma tela de consentimento (nunca guardado: perguntado a cada login).

Sem a permissão o log disse `WARN ... Client 'svc-a' is not allowed to
delegate as user 'alice'` e o login seguiu com sucesso, sem `may_act`. Com ela:

```text
portal token: {"sub":"a568...","aud":["svc-a","svc-b"],"azp":"portal","scope":"openid b.read a.use profile email delegation:client:svc-a",
               "may_act":{"sub":"e151...","client_id":"svc-a"}}
```

A obtém o próprio token (`client_credentials`, `$A_OWN`) e repete a troca acima com o
token do portal como `subject_token`, mais `actor_token=$A_OWN` e
`actor_token_type=urn:ietf:params:oauth:token-type:access_token`:

```text
new token : {"sub":"a568...","aud":"svc-b","azp":"svc-a","scope":"b.read profile email","act":{"sub":"e151...","client_id":"svc-a"}}
B sees    : {"ok":true,"sub":"a568...","azp":"svc-a","aud":"svc-b","act_chain":["svc-a"]} HTTP 200
```

Mesma alice, mesma audience, mas B sabe que A é o ator e pode registrar ou limitá-lo. Sem
refresh token e sem `sid` (sessão transitória). Recusas medidas:

| Requisição | Resposta |
|---|---|
| subject token com `may_act`, sem `actor_token` | `invalid_request`, "Subject token with a delegation claim is not allowed for standard token exchange" |
| `actor_token` de `svc-x` | `access_denied`, "Client is not within the token audience" |
| subject token sem `may_act` (o `web` simples) | `invalid_request`, "Invalid may_act claim in the subject_token" |

O Keycloak valida só `sub`, `client_id` e `iss` dentro de `may_act`; claims extras vão para `act` só para leitura.

### A cadeia A, B, C: o Keycloak para em um salto, a RFC não

B tem o token delegado e precisa chamar C. Uma troca simples dá o erro "delegation claim
is not allowed" acima; com o `actor_token` de B dá `invalid_request`, "Invalid may_act
claim in the subject_token". Então no 26.8.2 um token delegado não pode ser trocado de
novo. A RFC 8693 seção 4.1 define a cadeia: `act` aninhado, o mais externo é o ator atual,
os internos são "informational only" para controle de acesso. Um STS curto meu
(**ilustração, não é Keycloak**: HS256, regras escritas à mão, `chain.mjs`) com as mesmas
checagens (solicitante em `aud`, escopo subconjunto, audiences permitidas, `may_act`) mostra a forma:

```text
A -> B (aud svc-b, scope orders.read)  {"sub":"alice","aud":"svc-b","scope":"orders.read","act":{"sub":"svc-a"}}
B -> C (aud svc-c, scope orders.read)  {"sub":"alice","aud":"svc-c","scope":"orders.read","act":{"sub":"svc-b","act":{"sub":"svc-a"}}}
B widens to orders.write               -> invalid_scope: orders.write not in the subject token
B asks audience svc-a (back to A)      -> invalid_target: svc-b may not ask for svc-a
```

`sub` nunca muda, `act` ganha um nível por salto, cada salto estreita `aud`. C autoriza
por `sub` e pelo ator externo (`svc-b`); `svc-a` é dado de auditoria. Mantenha cadeias de dois ou três saltos.

### Resposta 4: Microsoft Entra on-behalf-of (só documentação, sem tenant)

Mesma ideia, grant próprio; tudo da página do Learn (atualizada em 2025-01-04), não executado.
Uma web API com um token de usuário (`aud` = ela mesma) faz POST em `https://login.microsoftonline.com/<tenant>/oauth2/v2.0/token`:

```text
grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer   requested_token_use=on_behalf_of
client_id=<API A> + client_secret (or client_assertion with a certificate JWT)
assertion=<token A, aud = this API>   scope=https://graph.microsoft.com/user.read
```

- Não é a RFC 8693: sem `subject_token`, sem `actor_token`, sem `act` documentado (se o
  token emitido nomeia a camada intermediária: não documentado). Só escopos delegados; token app-only não pode ser trocado.
- O consentimento vem antes (a camada intermediária não tem UI): `knownClientApplications` com
  `.default` (nunca misturado com outros escopos delegados: AADSTS70011), `preAuthorizedApplications` ou consentimento de admin.
- Conditional Access no downstream responde `interaction_required` com um desafio `claims`;
  a camada intermediária devolve 401 com `WWW-Authenticate` e não deve tentar de novo com cache.
- .NET: Microsoft.Identity.Web, `.EnableTokenAcquisitionToCallDownstreamApi()` e `IDownstreamApi.CallApiForUserAsync(...)`.

### Onde isso aparece, custo, cache e auditoria

- **MCP.** Uma tool que chama uma API downstream pelo usuário é este problema: o servidor
  valida `aud` e depois troca (ou faz OBO). A lição de identidade do chamador mostra onde o usuário
  é lido dentro do servidor; gateways e meshes também podem fazer a troca (mantenha as regras de audience no AS).
- **Custo, medido** (A trocando o token da alice para B, 100 chamadas, localhost):

```text
100 exchanges      : 3.91 ms each, 100 calls to the AS
100 cached lookups : 0.05 ms each, 1 call to the AS   (key = subject jti + audience + scope; entry dies 5 s before exp)
```

  Faça cache por usuário e audience, nunca além do token. O Keycloak não revoga um access
  token trocado quando o subject é revogado (doc): o TTL é a sua janela de revogação.
- **Auditoria e riscos.** Registre `sub`, `act`, `aud`, `azp` no resource server (com
  impersonation o rastro diz "alice" para algo que A fez). Cuidado com cadeias longas, solicitante que
  pode ampliar (o padrão), `act` usado para autorizar, refresh tokens trocados (sobrevivem ao subject token).

### Escolhendo

| Abordagem | Usuário preservado | Ator | `aud` | Risco | Quando usar |
|---|---|---|---|---|---|
| Repassar o token | sim, por acidente | invisível | errada ou ampla demais | máximo | nunca |
| Client credentials | não | A como `sub` | B | autoridade própria de A, sem controle por usuário | trabalhos sem usuário |
| Troca, impersonation | sim (`sub`) | só `azp` | B | ponto cego na auditoria; ampliar se irrestrito | um salto, B só precisa do usuário |
| Troca, delegation | sim (`sub`) | `act` | B | preview no Keycloak, um salto lá | B precisa conhecer e limitar o ator |
| Entra OBO | sim | não documentado | B | setup de consentimento, desafio de claims | stack Microsoft |

### Para onde ir depois

A lição de segurança do OAuth (DPoP, mTLS, resource indicators) trata de amarrar esses tokens e do
`resource`. Workload identity trata de como A se autentica no AS sem segredo compartilhado (`a-secret`
aqui é o que não se deve entregar). As lições de MCP aplicam isto a servidores que chamam APIs.

## Trade-offs

- **Troca versus credencial própria.** A troca mantém o usuário e estreita a audience por
  uma chamada ao AS por salto (4 ms aqui, 0,05 ms em cache); a credencial de serviço não tem usuário.
- **Impersonation versus delegation.** Impersonation é simples; delegation dá a trilha de auditoria,
  mas no Keycloak exige preview, FGAP V2 e consentimento, e para em um salto.
- **Troca aberta versus restrita.** O padrão deixa A fabricar escopos que a alice nunca teve; o executor
  fecha isso, mas faz do primeiro token o teto de todo salto seguinte.
- **Vida do token.** Sem cadeia de revogação para access tokens: mantenha-os em um ou dois minutos.

## Documentation Links

- [RFC 8693, OAuth 2.0 Token Exchange, IETF](https://datatracker.ietf.org/doc/html/rfc8693) (doc)
- [RFC 9700, Best Current Practice for OAuth 2.0 Security (section 2.3), IETF](https://datatracker.ietf.org/doc/html/rfc9700) (doc)
- [Configuring and using token exchange, Keycloak](https://www.keycloak.org/securing-apps/token-exchange) (doc)
- [Keycloak Server Administration Guide (downscoping, client policies), Keycloak](https://www.keycloak.org/docs/latest/server_admin/index.html) (doc)
- [Microsoft identity platform and OAuth 2.0 On-Behalf-Of flow, Microsoft Learn](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-on-behalf-of-flow) (doc)
- [Web API that calls web APIs: code configuration, Microsoft Learn](https://learn.microsoft.com/en-us/entra/identity-platform/scenario-web-api-call-api-app-configuration) (doc)
