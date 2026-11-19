---
version: 1.0
updatedAt: 2026-11-19
title: "Segurança no OAuth: BCP, DPoP, mTLS, PAR, RAR e Resource Indicators"
summary: O endurecimento do OAuth medido no fio contra um Keycloak 26.8.2 local e um resource server próprio em Node 22. O que a RFC 9700 exige e o que cada regra evita, o parâmetro iss contra mix-up (RFC 9207) checado pelo cliente, DPoP (RFC 9449) com cnf.jkt e um token roubado recusado por esquema Bearer, chave errada, jti repetido, htm, htu, ath e nonce, mTLS (RFC 8705) com cnf.x5t#S256 e certificado da mesma CA recusado, PAR (RFC 9126) tirando a requisição da URL, JAR, RAR (RFC 9396) recusado pelo Keycloak, resource indicators (RFC 8707) com aud por API e invalid_target, FAPI 2.0 e o que cada app realmente precisa.
---
## Objective

O OAuth básico (code + PKCE, tokens curtos, rotação de refresh) é a lição anterior. Esta é a camada de
endurecimento por cima, na ordem do problema que cada peça resolve: a Security BCP (RFC 9700), o `iss`
contra mix-up, tokens com sender-constraint via DPoP e mTLS (token roubado para de funcionar), PAR e
JAR (a requisição sai da URL do navegador), RAR (permissões finas), resource indicators (um token por
API) e o FAPI 2.0, o perfil que junta tudo. Cada defesa roda contra um laboratório seu (Keycloak e
resource server locais): primeiro o que passa sem ela, depois a recusa. Assinar exige código, então
cliente e resource server são arquivos Node 22 só com `node:crypto` (sem pacotes, checagens à vista).
Versions: Keycloak 26.8.2 (`quay.io/keycloak/keycloak:26.8.2`, `start-dev --features=resource-indicators`,
HTTPS com `--https-client-auth=request`), Node 22.23.4, OpenSSL 4.0.3, curl 8.7.1, jq 1.7.1.

## Use Cases

- Decidir se um app precisa de DPoP, mTLS ou PAR, ou só de um code + PKCE bem feito.
- Escrever um resource server que recusa token roubado em vez de servi-lo.
- Revisar o documento de discovery de um authorization server atrás de defaults fracos.
- Limitar um token a uma API quando um cliente fala com várias (hosts MCP, BFFs).

## Deep Dive

### O laboratório e a RFC 9700 numa tabela

Keycloak `idn-bcp-keycloak` em 6460 (HTTP) e 6461 (HTTPS, certificado de cliente conferido contra uma
CA de laboratório feita com `openssl`), realm `demo`, usuária `alice`, clientes `dpop-svc`,
`bearer-svc`, `svc-mtls`, `par-web` e `spa`; o resource server (RS) do laboratório escuta em 6463
(DPoP) e HTTPS 6464 (mTLS). A RFC 9700 (janeiro de 2025), absorvida pelo OAuth 2.1, na seção 2:

| Regra (RFC 9700) | Evita | Onde |
|---|---|---|
| Redirect URI com match exato (2.1) | code entregue a uma página do atacante sob curinga | medido na lição de OAuth |
| PKCE para todo cliente, só S256 (2.1.1) | code injection, CSRF, code vazado resgatado | lição de OAuth |
| Sem implicit grant (2.1.2) | token no fragmento da URL, impossível de amarrar ao cliente | lição de OAuth |
| Defesa contra mix-up quando o cliente conhece vários AS (2.1) | code do AS A enviado ao AS B | medido abaixo |
| Access token com sender-constraint, SHOULD (2.2.1) | replay de bearer token vazado | DPoP, mTLS abaixo |
| Refresh de cliente público rotacionado ou amarrado, MUST (2.2.2) | refresh token roubado vivendo para sempre | rotação na lição de OAuth |
| Token restrito por audience (2.3) | uma API reusando o token em outra | resource indicators abaixo |
| Sem ROPC, MUST NOT (2.4) | app que vê a senha e pula o MFA | lição de OAuth |
| Autenticação assimétrica do cliente, mTLS ou `private_key_jwt` (2.5) | segredo compartilhado vazado | mTLS abaixo |

**Code injection** (seção 4.5): o atacante injeta um code roubado na própria sessão dele no cliente
legítimo e entra como a vítima; o PKCE barra, porque aquela sessão guarda outro `code_verifier`.
**Mix-up** (seção 4.4): um cliente que conhece um AS honesto e um do atacante começa pelo atacante, que
joga o usuário para o AS honesto; o cliente então manda o code honesto para o atacante.

### Mix-up: checar o `iss` é trabalho do cliente (medido)

O Keycloak anuncia `"authorization_response_iss_parameter_supported": true` e põe `iss` em todo
redirect, inclusive nos de erro. A RFC 9207 manda o cliente comparar com o AS onde o fluxo começou e
recusar `iss` ausente quando o metadata prometeu. O redirect real e duas cópias editadas:

```text
Location: http://localhost:6462/cb?state=1acwBr621cs&session_state=Mt94...&iss=http%3A%2F%2Flocalhost%3A6460%2Frealms%2Fdemo&code=517bd9e5-...
RFC 9207 check, genuine      : accept code 517bd9e5...
RFC 9207 check, iss swapped  : reject: iss https://attacker-as.example is not the AS this flow started with
RFC 9207 check, iss stripped : reject: iss missing but AS metadata says authorization_response_iss_parameter_supported
```

Um AS que manda `iss` não protege ninguém se a biblioteca do cliente ignora o parâmetro.

### Bearer é dinheiro vivo: provas DPoP (RFC 9449)

Bearer token funciona para quem estiver com ele: uma linha de log, um proxy, um payload de XSS. O
DPoP amarra o token a um par de chaves gerado pelo cliente. O AS grava no token o thumbprint RFC 7638
da chave pública (`cnf.jkt`), e cada requisição leva uma prova nova, um JWT assinado com a chave privada:

```js
function proof(k, htm, htu, extra = {}) {
  const h = b64u(JSON.stringify({ typ: 'dpop+jwt', alg: 'ES256', jwk: k.jwk }));       // public key in the header
  const p = b64u(JSON.stringify({ jti: randomUUID(), htm, htu, iat: now(), ...extra })); // + ath, nonce
  return `${h}.${p}.${b64u(sign('sha256', Buffer.from(`${h}.${p}`), { key: k.privateKey, dsaEncoding: 'ieee-p1363' }))}`;
}
```

`htm`/`htu` fixam método e URL, `iat`/`jti` limitam replay, `ath` (SHA-256 do access token) prende a
prova a um token, `nonce` é um desafio opcional do servidor. No Keycloak: suportado desde 26.4.0.

### DPoP no authorization server (medido)

```text
client key thumbprint (RFC 7638): 0rYIOCnWJwff3Up8abH75PjMcMVAmmMjB1srrbgsOn4
token without DPoP header             -> 400 {"error":"invalid_request","error_description":"DPoP proof is missing"}
token with DPoP proof                 -> 200 {"token_type":"DPoP","expires_in":300}
access token cnf                      -> {"jkt":"0rYIOCnWJwff3Up8abH75PjMcMVAmmMjB1srrbgsOn4","kc-jkt-type":"DPoP"}
same proof replayed at /token         -> 400 {"error":"invalid_request","error_description":"DPoP proof has already been used"}
proof with wrong htu at /token        -> 400 {"error":"invalid_request","error_description":"DPoP HTTP URL mismatch"}
client without DPoP required + proof  -> 200 DPoP {"jkt":"0rYIOCnWJwff3Up8abH75PjMcMVAmmMjB1srrbgsOn4","kc-jkt-type":"DPoP"}
```

`cnf.jkt` bate com o thumbprint calculado pelo cliente. Um cliente sem DPoP obrigatório também recebe
token amarrado quando manda prova, então dá para migrar cliente por cliente.

### DPoP no resource server: cada checagem, cada falha (medido)

O AS só amarra; quem cobra é o RS. O RS do laboratório valida o token (RS256 via JWKS, `iss`, `aud`,
`exp`), depois a prova na ordem da seção 4.3 da RFC 9449, e por fim compara a chave da prova com `cnf.jkt`:

```text
legit: DPoP scheme + fresh proof             -> 200 {"ok":true,"path":"/orders","azp":"dpop-svc"}
stolen token as Bearer                       -> 401 error="invalid_token", error_description="DPoP-bound token sent with Bearer scheme"
stolen token + proof from thief key          -> 401 error="invalid_token", error_description="proof key does not match cnf.jkt"
captured proof replayed (same jti)           -> 401 error="invalid_dpop_proof", error_description="jti aabd9624-... replayed"
proof for GET /orders sent to DELETE         -> 401 error="invalid_dpop_proof", error_description="htm GET vs DELETE"
proof for /orders sent to /payments          -> 401 error="invalid_dpop_proof", error_description="htu http://localhost:6463/orders vs http://localhost:6463/payments"
proof whose ath is for another token         -> 401 error="invalid_dpop_proof", error_description="ath does not match this access token"
proof with iat 5 minutes old                 -> 401 error="invalid_dpop_proof", error_description="iat 1795067494 outside 60 s window"
/payments without nonce                      -> 401 error="use_dpop_nonce", error_description="nonce required"   DPoP-Nonce: x0gKa997JAegD5t42a-vaw
/payments retried with that nonce            -> 200 {"ok":true,"path":"/payments","azp":"dpop-svc"}
```

A primeira recusa é a que mais falta: um RS que aceita `Bearer` para token com `cnf` joga a amarração
fora (RFC 9449, seção 7.2). Compartilhe o cache de `jti` entre as réplicas do RS; o nonce encolhe a
janela de provas feitas com antecedência. O DPoP não barra código rodando dentro do cliente pedindo à
própria chave do cliente que assine (XSS numa SPA); chave WebCrypto não extraível só sobe a barra.

### mTLS: token amarrado ao certificado (RFC 8705, medido)

Entre serviços, o certificado TLS do cliente faz dois papéis: autentica o cliente no AS (`client-x509`,
subject `CN=svc-a`, sem segredo) e amarra o token (`cnf.x5t#S256`, SHA-256 do certificado em DER,
conferido com `openssl x509 -outform DER | openssl dgst -sha256`):

```text
token with svc-a cert    -> 200 {"iss":"https://localhost:6461/realms/demo","azp":"svc-mtls","cnf":{"x5t#S256":"hOOC3ltSJqdDdBIvwSnI3-hbVha_qn89i3dBVvzlKz0"}}
token with mallory cert  -> 401 {"error":"invalid_client","error_description":"Invalid client or Invalid client credentials"}
token with no cert       -> 401 {"error":"invalid_client","error_description":"Invalid client or Invalid client credentials"}
--- resource server (https :6464, requestCert)
svc-a cert + its token                 -> 200 {"ok":true,"subject":"svc-a"}
mallory cert (same CA) + stolen token  -> 401 ... "cert thumbprint gtx3sgmb2iOcdyQONuGFDI5URR6XHj5hkCqYup1oJuE != cnf.x5t#S256 hOOC3ltSJqdDdBIvwSnI3-hbVha_qn89i3dBVvzlKz0"
no cert + stolen token                 -> 401 ... "no client certificate on the TLS connection"
```

Certificado da mesma CA não basta: o RS compara o certificado exato. Duas armadilhas: um proxy que
termina TLS precisa repassar o certificado num header que ele sempre sobrescreve (nunca deixa passar
de fora), e trocar o certificado inutiliza todo token vivo até o próximo refresh.
**Qual usar:** DPoP para SPA, mobile, cliente público ou qualquer coisa atrás de terminação TLS (sem
PKI, uma assinatura por chamada); mTLS entre serviços com PKI ou service mesh (custo zero por chamada,
e ainda autentica o cliente).

### PAR e JAR: a requisição sai da URL (medido)

Uma requisição de autorização no front channel é uma URL que o usuário, extensões, logs e o atacante
leem e editam. Com PAR (RFC 9126) o cliente faz POST da requisição inteira no AS antes, autenticado,
e o navegador recebe só um identificador:

```text
classic front-channel request (264 chars) -> 302 http://localhost:6462/cb?error=invalid_request&error_description=Pushed+Authorization+Request+is+only+allowed.&state=...&iss=...
POST /ext/par/request -> 201 {"request_uri":"urn:ietf:params:oauth:request_uri:1c946853-52f2-558c-871e-d553e706bffd","expires_in":60}
browser URL (173 chars): http://localhost:6460/realms/demo/protocol/openid-connect/auth?client_id=par-web&request_uri=urn%3Aietf%3Aparams%3Aoauth%3Arequest_uri%3A1c946853-...
login -> Location: http://localhost:6462/cb?state=1acwBr621cs&session_state=Mt94...&iss=http%3A%2F%2Flocalhost%3A6460%2Frealms%2Fdemo&code=517bd9e5-...
same request_uri again -> 400 Invalid Request
PAR with unregistered redirect_uri -> 400 {"error":"invalid_request","error_description":"Invalid parameter: redirect_uri"}
```

Escopo, redirect URI, challenge do PKCE e state nunca chegam ao navegador, o identificador é de uso
único e vive 60 s, e uma redirect URI ruim falha no back channel, antes de envolver qualquer usuário.
O JAR (RFC 9101, só na doc) assina a própria requisição (`request=<JWT>`, no corpo do PAR quando
combinados) e ninguém consegue alterá-la. Defaults para auditar no discovery: `"none"` aparece em
`request_object_signing_alg_values_supported` e `"plain"` em `code_challenge_methods_supported`;
fixe o algoritmo do cliente e S256, ou aplique um client policy profile do Keycloak.

### RAR: permissões mais finas que um escopo (medido)

`scope=payments` não consegue dizer "123,50 EUR para este IBAN, uma vez". A RFC 9396 cria o
`authorization_details`, um array JSON de objetos tipados que a tela de consentimento mostra e o token carrega:

```text
authorization_details=[{"type":"payment_initiation","actions":["initiate"],"instructedAmount":{"currency":"EUR","amount":"123.50"},"creditorName":"Merchant A","creditorAccount":{"iban":"DE02100100109307118603"}}]
PAR with authorization_details -> 201 {"request_uri":"urn:ietf:params:oauth:request_uri:392139ac-...","expires_in":60}
  ...authorize -> http://localhost:6462/cb?error=invalid_request&error_description=Unsupported type 'payment_initiation' of authorization_details parameter supplied in the request. Supported values: []
```

O Keycloak 26.8.2 lê o parâmetro, mas não tem tipos próprios: sem `authorization_details_types_supported`
no metadata e sem RFC 9396 na lista de padrões. A Auth0 documenta RAR num add-on (tabela abaixo).

### Resource indicators: um token por API (medido)

Um cliente, duas APIs: sem alvo o token vale nas duas, e qualquer uma pode reusá-lo na outra. A RFC 8707
cria o `resource` (experimental no Keycloak 26.8.2, `--features=resource-indicators` mais `resource_url`
no cliente da API):

```text
client_credentials, no resource               -> aud ["orders-api","reports-api","account"]
resource=https://orders.example/api           -> aud "https://orders.example/api"
resource=https://evil.example                 -> 400 {"error":"invalid_target","error_description":"The requested resource is invalid, missing, unknown, or malformed."}
code flow: authorize orders, token orders     -> aud "https://orders.example/api"
code flow: authorize orders, token reports    -> 400 {"error":"invalid_target","error_description":"The requested resource is not matching the original request."}
```

O `aud` vira a URL do recurso, não o client id: um RS que checa `aud == "orders-api"` precisa passar a
checar a URL. O MCP exige exatamente essa amarração; o concept de autorização MCP mede isso com o SDK C#.

### FAPI 2.0: tudo isso, obrigatório (só na doc)

O FAPI 2.0 Security Profile (OpenID Foundation, Final) mira open banking e outras APIs em que token
roubado move dinheiro ou dados. Os authorization servers dele devem: aceitar só clientes confidenciais,
autenticados por mTLS ou `private_key_jwt`; emitir só tokens com sender-constraint (mTLS ou DPoP);
exigir PAR e recusar requisição sem ele; exigir PKCE S256; devolver `iss`; manter code por no máximo
60 s e `request_uri` abaixo de 600 s. Uma surpresa: ele proíbe rotação de refresh token fora de casos
extraordinários, porque com token amarrado e cliente confidencial a rotação só acrescenta falhas. O
Message Signing (spec irmã) acrescenta requisições e respostas assinadas; o Keycloak traz perfis `fapi-2-*`.

### O que a maioria dos apps precisa contra alto risco

**Todo app (o piso da BCP):** code + PKCE S256, redirect URI exata, sem implicit nem ROPC, access token
curto (5 a 15 minutos), `aud` checado em toda API, rotação de refresh em cliente público, `iss`
checado, `resource` quando um cliente chama várias APIs. **Só alto risco** (dinheiro, saúde, admin,
agentes com alcance amplo): DPoP ou mTLS, PAR (mais JAR para requisição assinada), RAR, FAPI 2.0.

### Ameaça, mitigação, custo, suporte

| Ameaça | Mitigação | Custo de adoção | Keycloak 26.8.2 | Entra ID | Auth0 |
|---|---|---|---|---|---|
| Bearer token roubado reusado | DPoP (RFC 9449) | cliente assina cada chamada; RS checa prova e `jti` | suportado (medido) | "aims to support" (doc do MSAL), sem status GA | documentado |
| O mesmo, entre serviços | mTLS (RFC 8705) | PKI, repasse no proxy | suportado (medido) | mTLS PoP em private preview, só token de aplicação | add-on HRI |
| Requisição lida ou editada no navegador | PAR (RFC 9126), JAR (RFC 9101) | uma chamada no back channel | suportado (PAR medido) | não documentado | add-on HRI |
| Consentimento grosso | RAR (RFC 9396) | tipos, tela de consentimento, RS checa | sem tipos próprios (medido) | não documentado | add-on HRI |
| Token reusado em outra API | resource indicators (RFC 8707) | um token por API | experimental (medido) | não documentado | não documentado |
| Mix-up entre AS | `iss` (RFC 9207) | uma comparação no cliente | suportado (medido) | não documentado | não documentado |

"Não documentado": as páginas consultadas do fornecedor não dizem nada. HRI: Highly Regulated Identity da Auth0, add-on Enterprise.

### Para onde ir

Token exchange (I13) mostra um serviço trocando um token amarrado por outro mais estreito rio abaixo em
vez de repassá-lo; sessões e revogação (I18) tratam do que acontece com token amarrado no logout. Os
concepts de MCP aplicam `resource`, `iss` e registro de cliente a hosts de agentes.

## Trade-offs

- **DPoP contra bearer puro.** O DPoP barra replay, mas custa uma assinatura por chamada, um store de
  `jti` compartilhado e retries de nonce (um 401 a mais em `/payments`); bearer curto atrás de BFF costuma bastar.
- **mTLS contra DPoP.** mTLS não custa nada por chamada, mas exige PKI e quebra em proxy que descarta o certificado.
- **PAR contra redirect simples.** Uma ida e volta compra uma requisição autenticada e de uso único; SPA pública ganha menos.
- **Rotação contra amarração no refresh.** A BCP aceita os dois em cliente público; o FAPI 2.0 proíbe rotação (resposta perdida desloga).
- **Features experimentais.** O `resource-indicators` do Keycloak pode mudar: fixe a versão e reteste o `aud`.

## Documentation Links

- [RFC 9700, Best Current Practice for OAuth 2.0 Security, IETF](https://datatracker.ietf.org/doc/html/rfc9700) (doc)
- [RFC 9449, OAuth 2.0 Demonstrating Proof of Possession (DPoP), IETF](https://datatracker.ietf.org/doc/html/rfc9449) (doc)
- [RFC 8705, OAuth 2.0 Mutual-TLS Client Authentication and Certificate-Bound Access Tokens, IETF](https://datatracker.ietf.org/doc/html/rfc8705) (doc)
- [RFC 9126, OAuth 2.0 Pushed Authorization Requests, IETF](https://datatracker.ietf.org/doc/html/rfc9126) (doc)
- [RFC 9101, JWT-Secured Authorization Request (JAR), IETF](https://datatracker.ietf.org/doc/html/rfc9101) (doc)
- [RFC 9396, OAuth 2.0 Rich Authorization Requests, IETF](https://datatracker.ietf.org/doc/html/rfc9396) (doc)
- [RFC 8707, Resource Indicators for OAuth 2.0, IETF](https://datatracker.ietf.org/doc/html/rfc8707) (doc)
- [RFC 9207, OAuth 2.0 Authorization Server Issuer Identification, IETF](https://datatracker.ietf.org/doc/html/rfc9207) (doc)
- [FAPI 2.0 Security Profile, OpenID Foundation](https://openid.net/specs/fapi-security-profile-2_0-final.html) (doc)
- [Securing applications with DPoP, Keycloak](https://www.keycloak.org/securing-apps/dpop) (doc)
- [Supported specifications, Keycloak](https://www.keycloak.org/securing-apps/specifications) (doc)
- [Integrating with Model Context Protocol (resource indicators), Keycloak](https://www.keycloak.org/securing-apps/mcp-authz-server) (doc)
- [Proof-of-Possession tokens, MSAL.NET, Microsoft Learn](https://learn.microsoft.com/en-us/entra/msal/dotnet/advanced/proof-of-possession-tokens) (doc)
- [Token binding with mTLS PoP, Microsoft Identity Web, Microsoft Learn](https://learn.microsoft.com/en-us/entra/msidweb/call-downstream-apis/token-binding) (doc)
- [Sender constraining, Auth0](https://auth0.com/docs/secure/sender-constraining) (doc)
- [Highly Regulated Identity, Auth0](https://auth0.com/docs/secure/highly-regulated-identity) (doc)
