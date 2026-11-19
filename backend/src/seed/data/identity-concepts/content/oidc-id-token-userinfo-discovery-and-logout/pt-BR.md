---
version: 1.0
updatedAt: 2026-11-19
---
## Objective

O OAuth 2.0 entrega ao cliente um access token para uma API e não diz nada
sobre quem fez login. O OpenID Connect (OIDC) acrescenta isso sobre o mesmo
fluxo de code: o escopo `openid`, o ID token (um JWT assinado endereçado ao
cliente), o UserInfo, o discovery e três mecanismos de logout. Tudo medido num
Keycloak local com curl, jq e um validador de 44 linhas em Node 22 (sem pacotes,
para cada checagem ficar visível), inclusive cada passo da validação falhando
de propósito. Papéis, grants, PKCE e introspecção estão na lição de OAuth que esta exige.
Versions: Keycloak 26.8.2 (`quay.io/keycloak/keycloak:26.8.2`, `start-dev`),
Node 22.23.4, curl 8.7.1, jq 1.7.1, OpenID Connect Core 1.0 com errata set 2.

## Use Cases

- Colocar "Entrar com..." numa aplicação sabendo qual token prova o login.
- Revisar um código que manda o ID token para uma API e explicar por que está errado.
- Exigir login recente ou MFA numa ação sensível e conferir se o IdP obedeceu.
- Desenhar o logout para que sair de uma aplicação encerre de fato as sessões do usuário.

## Deep Dive

### O que o `scope=openid` muda (medido)

Keycloak em Docker (`idn-oidc-keycloak`, porta 6240), realm `demo`, cliente
confidencial `web-app`, usuário `alice`; o formulário de login é dirigido com
curl e um cookie jar, e o code é trocado no token endpoint. Mesmo fluxo, dois escopos:

```text
scope=profile          -> {"access_token":"eyJhbGciOiJSUzI1NiIs...","token_type":"Bearer","scope":"email profile",...}
scope=openid&nonce=... -> {"access_token":"eyJhbGciOiJSUzI1NiIs...","token_type":"Bearer",
                           "id_token":"eyJhbGciOiJSUzI1NiIs...","scope":"openid email profile",...}
```

Sem `openid` é OAuth puro; com ele, a resposta ganha o `id_token`.

### ID token contra access token, lado a lado (medido)

Os dois são JWTs RS256 assinados pela mesma chave (mesmo `kid`). Decodificados:

| Claim | ID token | Access token |
|---|---|---|
| `aud` | `web-app` (o cliente) | `account` (uma API) |
| `typ` (extra do Keycloak) | `ID` | `Bearer` |
| `nonce`, `at_hash` | `n-0S6_WzA2Mj`, `8X3sHIO5FueuXOnscLGA4w` | ausentes |
| `scope`, `realm_access`, `resource_access` | ausentes | presentes (papéis para APIs) |
| `iss`, `sub`, `azp`, `exp`, `iat`, `auth_time`, `acr`, `sid` | mesmos valores | mesmos valores |

O ID token diz ao `web-app`: "a alice se autenticou em `auth_time` com `acr` 1,
respondendo ao seu `nonce`". Uma API que o aceita como credencial bearer aceita
um token emitido para outro destinatário; o próprio UserInfo do Keycloak recusa:

```text
Bearer $ACCESS_TOKEN -> 200 {"sub":"8f4d6d0a-...","name":"Alice Doe","email":"alice@example.org",...}
Bearer $ID_TOKEN     -> 401 WWW-Authenticate: Bearer realm="demo", error="invalid_token",
                        error_description="Token verification failed"
```

Regra: o cliente consome o ID token uma vez, no login; APIs recebem access token.
O UserInfo devolve dados de perfil frescos (alterados depois do login, ou
grandes demais para o token); o `sub` dele tem que ser igual ao do ID token.

### As claims padrão

| Claim | Significado e propósito |
|---|---|
| `iss` | URL do emissor, exatamente como no discovery: qual IdP garante |
| `sub` | id estável do usuário dentro do `iss`; identifique por (`iss`, `sub`), nunca por um `email` reciclável |
| `aud` | client_id(s) a quem o token se destina: impede reuso em outro cliente |
| `exp`, `iat` | expiração e emissão em segundos: limitam a janela de replay |
| `nonce` | eco do valor que o cliente enviou: amarra o token a este login |
| `auth_time` | quando o usuário se autenticou de fato: comparado com `max_age` |
| `acr` / `amr` | nível atingido / métodos usados (`pwd`, `otp`, `hwk`, RFC 8176) |
| `azp` | parte autorizada; desde a errata set 2, definida só por extensões |
| `at_hash` | metade esquerda do SHA-256 do access token: amarra os dois tokens |
| `sid` | id da sessão no IdP, usado pelo logout front-channel e back-channel |

### Discovery e JWKS (medido)

O RP é configurado com uma URL só, a do emissor; o resto vem do discovery:

```text
$ curl -s localhost:6240/realms/demo/.well-known/openid-configuration | jq '{...}'
"issuer": "http://localhost:6240/realms/demo",  "jwks_uri": ".../protocol/openid-connect/certs",
"end_session_endpoint": ".../logout",  "userinfo_endpoint": ".../userinfo",
"acr_values_supported": ["0","1"],  "prompt_values_supported": ["none","login","consent"],
"id_token_signing_alg_values_supported": ["PS384","RS384","EdDSA","ES384","HS256",...,"RS256",...]
$ curl -s .../certs | jq -c '.keys[] | {kid, kty, alg, use}'
{"kid":"F827YyZ-rIWKo1ke7hIbRHCK1rcDgiwEaSICj9ptTL8","kty":"RSA","alg":"RS256","use":"sig"}
{"kid":"nIX7awUkxoaDaQFUNkrHTa7BD7nND_EJ16mH6w3LXro","kty":"RSA","alg":"RSA-OAEP","use":"enc"}
```

O JWKS (RFC 7517) lista as chaves públicas por `kid`; só as de `use: sig`
verificam tokens. A lista de algoritmos é o que o IdP *consegue* assinar; o RP
fixa o único que registrou.

### Validando um ID token, passo a passo (medido)

A ordem da seção 3.1.3.7 do OIDC Core, em Node 22 só com `node:crypto`:

```js
check('alg allowlist', ['RS256'].includes(header.alg), header.alg);    // never the header's choice
await loadJwks(process.env.JWKS_CACHE);                                // kid -> KeyObject cache
if (!jwks.has(header.kid)) { console.log('     kid not cached, refetching JWKS once'); await loadJwks(); }
check('kid in JWKS', jwks.has(header.kid), header.kid);
check('signature', verify('RSA-SHA256', Buffer.from(`${h}.${p}`), jwks.get(header.kid), b64(s)));
check('iss', claims.iss === ISSUER, claims.iss);                       // exact string match
const aud = [].concat(claims.aud);
check('aud contains client_id', aud.includes(clientId), JSON.stringify(claims.aud));
if (aud.length > 1 || claims.azp) check('azp is client_id', claims.azp === clientId, claims.azp);
check('exp', now < claims.exp + SKEW, `exp=${claims.exp} now=${now}`); // SKEW = 60 s
check('iat not in future', claims.iat <= now + SKEW);
check('nonce', claims.nonce === nonce, `${claims.nonce} vs ${nonce}`); // nonce kept in the RP session
const d = createHash('sha256').update(accessToken).digest();
check('at_hash', claims.at_hash === d.subarray(0, d.length / 2).toString('base64url'), claims.at_hash);
```

O caminho feliz imprime dez linhas `ok` e `valid: sub=8f4d6d0a-... acr=1`. Cada
ataque, com a linha onde ele para:

```text
same token, login session expects nonce n-NEW-LOGIN  -> FAIL nonce: n-0S6_WzA2Mj vs n-NEW-LOGIN
web-app's ID token sent to other-app                 -> FAIL aud contains client_id: "web-app"
access token presented as an ID token                -> FAIL aud contains client_id: "account"
payload edited to email admin@example.org            -> FAIL signature
header replaced by {"alg":"none"}, signature empty   -> FAIL alg allowlist: none
same token checked 10 minutes later                  -> FAIL exp: exp=1795049555 now=1795049855
genuine ID token paired with another access token    -> FAIL at_hash: WSQE3SXWpCsDp7H8whd6NQ
```

O `nonce` é aleatório e fica na sessão do usuário antes do redirect: um token
vindo de outro login (log, URL vazada, code injetado) traz o nonce errado. A
spec deixa o cliente do fluxo code pular a assinatura (o token veio por TLS); as bibliotecas verificam mesmo assim.

### Rotação de chave e o cache do JWKS (medido)

Um segundo provedor de chave RSA, com prioridade maior, foi adicionado em
execução. O JWKS passou a listar duas chaves `sig` e os tokens novos vieram com o `kid` novo:

```text
new token kid: qu4GcQOydxK6X2_yXpd-tdI3lP0KqLWEw8M774IxQMA
validator still holding the old JWKS -> "kid not cached, refetching JWKS once" -> ok signature
token signed before rotation          -> ok (old key still published)
old key provider deleted              -> JWKS lists only qu4G...; old token: FAIL kid in JWKS
```

Faça cache do JWKS, rebusque uma vez diante de `kid` desconhecido com limite de
taxa (senão `kid`s aleatórios fazem o RP martelar o IdP) e mantenha a chave
antiga publicada pelo maior tempo de vida de token: tirá-la antes derruba todo token vivo de uma vez.

### Pedindo ao IdP um tipo de login (medido)

```text
prompt=none, no IdP session      -> callback?error=login_required&state=st123&iss=...
first login                      -> {"auth_time":1795049269,"iat":1795049269,"acr":"1"}
prompt=none, 5 s later (SSO)     -> {"auth_time":1795049269,"iat":1795049274,"acr":"0"}
max_age=2                        -> login form again; {"auth_time":1795049274,"acr":"1"}
login_hint=alice                 -> <input id="username" name="username" value="alice" ...>
acr_values=2 (no level 2 set up) -> code issued, {"acr":"1"}, no error
claims={"id_token":{"acr":{"essential":true,"values":["2"]}}} -> fresh login, {"acr":"1"}, no error
```

`prompt=none` é uma checagem silenciosa de SSO; o login via cookie de SSO mantém
o `auth_time` antigo e o Keycloak informa `acr` 0. `max_age` (ou `prompt=login`)
força autenticação de verdade, visível no `auth_time`. A armadilha: `acr_values`
é um pedido, o Keycloak respondeu com nível mais fraco e sem erro, então o RP
tem que comparar o `acr` do token com o que pediu. O `amr` exige um mapper e
referências por autenticador no Keycloak (só o mapper deu `"amr":[]`; o resto é
docs only). Os fatores em si são a lição de MFA (I3) desta trilha.

### Fluxos: code hoje, implicit e hybrid como história (medido)

Livro contra hoje: o implicit (`response_type=id_token token`) devolvia tokens no
fragmento da URL (daí o `at_hash` e o `nonce` obrigatório); o hybrid (`code
id_token`) devolvia um ID token antecipado para detectar injeção de code. A RFC
9700 (2025) e o OAuth 2.1 removem o implicit, code com PKCE atende SPA, mobile e
servidor, e o hybrid sobrevive no FAPI 1.0 Advanced. Resposta do Keycloak a um
implicit num cliente padrão: `#error=unauthorized_client` ("Implicit flow is disabled").

### Logout: três mecanismos, três garantias (medido)

Existem duas sessões: a do IdP (cookie de SSO, `sid`) e o cookie próprio de cada
RP. O **logout iniciado pelo RP** encerra a sessão do IdP a partir da aplicação:

```text
GET .../logout?id_token_hint=<ID token>&post_logout_redirect_uri=http://localhost:6241/bye&state=lo-state
front-channel on -> 200, HTML with
  <iframe src="http://localhost:6241/frontchannel-logout?sid=aAdy9deh9NwUfa_FcGN5ZdpM&iss=http%3A%2F%2F..." style="display:none;">
  window.location.replace("http://localhost:6241/bye?state=lo-state")
afterwards: prompt=none -> error=login_required; UserInfo with old access token -> 401
            local validation of the old ID token -> valid (signature and exp still fine)
unregistered post_logout_redirect_uri -> 400 "Invalid redirect uri"; no id_token_hint -> "Do you want to log out?"
```

O **front-channel** depende de o navegador carregar aquele iframe oculto. O curl
nunca o renderizou e o log do RP ficou vazio: o RP nunca foi avisado. Navegadores
que bloqueiam cookies de terceiros entregam a chamada sem o cookie de sessão do RP.
O **back-channel** (com o front-channel desligado) é um POST de servidor para servidor:

```text
POST /backchannel-logout  application/x-www-form-urlencoded  logout_token=eyJhbGciOiJSUzI1NiIsInR5cCI...
{"alg":"RS256","typ":"logout+jwt","kid":"qu4GcQOydxK6X2_yXpd-tdI3lP0KqLWEw8M774IxQMA"}
{"aud":"web-app","events":{"http://schemas.openid.net/event/backchannel-logout":{}},"exp":1795049480,
 "iat":1795049360,"iss":"http://localhost:6240/realms/demo","jti":"1debca12-...",
 "sid":"JFu3aqJyAOMDo9WXylI2NJWO","sub":"8f4d6d0a-...","typ":"Logout"}
```

O RP valida como um ID token (assinatura, `iss`, `aud`, `iat`), confere `events`,
rejeita se houver `nonce` (assim ele nunca passa por ID token), apaga as sessões
pelo `sid` e responde 200 com `Cache-Control: no-store`. Exige conectividade do
IdP até o RP e sessões num store compartilhado. Nenhum dos três revoga tokens já
emitidos: um access token JWT vive até o `exp`.

### Mapa da validação: claim, quem confere, o que previne

| Claim / checagem | Quem confere | Pular permite |
|---|---|---|
| allowlist de `alg` | RP | `alg: none` e forja por troca de RS256 para HS256 |
| assinatura com o `kid` do JWKS | RP (a API, para access token) | claims forjadas ou editadas |
| `iss` com match exato | RP | tokens de outro IdP ou tenant |
| `aud` contém o client_id | RP | token emitido para outra aplicação entra na sua |
| `exp`, `iat` | RP | replay indefinido de um token vazado |
| `nonce` | RP (pela sessão) | replay ou injeção do token de outro login |
| `at_hash` | RP, quando presente | troca do access token numa resposta |
| `acr`, `amr`, `auth_time` | RP | rebaixamento silencioso de MFA, login antigo |
| logout token: `events`, sem `nonce` | RP | logout token reaproveitado como ID token |

Próximos nesta trilha: JWT, JWS, JWE e JWK (I11) cobre a confusão de `alg`, a
injeção em `kid` e o clock skew por trás desta tabela; SAML 2.0 (I5) é o
antecessor em XML ainda comum no SSO corporativo, com o OIDC como padrão para
aplicações novas. As implementações em ASP.NET Core (OIDC e BFF) e Spring estão nos concepts relacionados.

## Trade-offs

- **Claims no ID token contra UserInfo.** Claims no token não custam chamada,
  mas envelhecem e incham cookies; o UserInfo é fresco, mas soma latência no login.
- **Logout front-channel contra back-channel.** O front-channel não precisa de
  caminho de rede, mas depende de iframe e cookie de terceiros (medido: sem
  navegador, sem aviso); o back-channel é confiável, mas exige que o IdP alcance
  o RP e um store de sessões indexado por `sid`.
- **Token curto contra carga no IdP.** O `expires_in: 300` padrão do Keycloak
  limita o estrago depois do logout ao custo de mais refresh; logout nunca revoga JWT.
- **`acr` estrito contra disponibilidade.** Rejeitar `acr` menor bloqueia usuários
  quando o IdP está mal configurado; aceitar transforma "MFA obrigatório" em sugestão.

## Documentation Links

- [OpenID Connect Core 1.0 incorporating errata set 2, OpenID Foundation](https://openid.net/specs/openid-connect-core-1_0.html) (doc)
- [OpenID Connect Discovery 1.0, OpenID Foundation](https://openid.net/specs/openid-connect-discovery-1_0.html) (doc)
- [OpenID Connect RP-Initiated Logout 1.0, OpenID Foundation](https://openid.net/specs/openid-connect-rpinitiated-1_0.html) (doc)
- [OpenID Connect Front-Channel Logout 1.0, OpenID Foundation](https://openid.net/specs/openid-connect-frontchannel-1_0.html) (doc)
- [OpenID Connect Back-Channel Logout 1.0, OpenID Foundation](https://openid.net/specs/openid-connect-backchannel-1_0.html) (doc)
- [RFC 7517, JSON Web Key (JWK), IETF](https://www.rfc-editor.org/rfc/rfc7517) (doc)
- [RFC 8176, Authentication Method Reference Values, IETF](https://www.rfc-editor.org/rfc/rfc8176) (doc)
- [RFC 9700, Best Current Practice for OAuth 2.0 Security, IETF](https://www.rfc-editor.org/rfc/rfc9700) (doc)
- [Server Administration Guide, Keycloak](https://www.keycloak.org/docs/latest/server_admin/index.html) (doc)
- [Securing applications and services with OpenID Connect, Keycloak](https://www.keycloak.org/securing-apps/oidc-layers) (doc)
