---
version: 1.0
updatedAt: 2026-11-21
---
## Objective

Um JWT é um documento JSON assinado (às vezes cifrado) que uma API verifica sem consultar o emissor. O formato é pequeno e o verificador é onde as coisas dão errado: os bugs clássicos de JWT são sempre um verificador que deixa o token escolher o algoritmo, a chave ou as regras. Esta lição é escrita para quem valida tokens (o escopo é a RFC 8725 e o cheat sheet de JWT da OWASP): a anatomia de um JWS compacto decodificado na tela, os algoritmos de assinatura, JWE em uma seção curta, JWK e JWKS, e depois cada armadilha clássica nos mesmos três passos contra um verificador pequeno meu, que roda em localhost com chaves descartáveis: o verificador ingênuo, o token forjado que ele aceita e a correção (lista de algoritmos e chave escolhidas pelo servidor) recusando a mesma entrada. Em seguida mostra, medido, o que o `JsonWebTokenHandler` (.NET) e o `NimbusJwtDecoder` (Spring) fazem por padrão, e por que um JWT é uma sessão ruim de navegador.
Versions: Node 22.23.4 (`node:crypto`, sem pacotes), .NET SDK 10.0.100 (`net10.0`) com `Microsoft.IdentityModel.JsonWebTokens` 8.23.0, Java 25.0.3 com `spring-security-oauth2-jose` 7.1.1 e Nimbus JOSE+JWT 10.9.1, jq 1.7.1, num Apple M4 Max.

## Use Cases

- Revisar um resource server e conferir, linha a linha, que o token não escolhe o próprio algoritmo nem a própria chave.
- Ler `IDX10511`, `Unsupported algorithm of none` ou `Another algorithm expected` e saber qual defesa disparou.

## Deep Dive

Tudo roda contra código meu: `naive.mjs` (26 linhas) e `fixed.mjs` (20 linhas), chaves RSA novas a cada execução e três listeners nas portas 7180 a 7182 (um JWKS, um host de JWKS "de fora" e um serviço só interno). Nenhum serviço de terceiros e nenhuma adivinhação de segredo. Os números são desta execução e desta máquina; "docs only" marca o que li e não executei.

### Um JWS compacto, decodificado (medido)

Três partes em base64url separadas por pontos (RFC 7515 seção 7.1). Um token gerado pelo laboratório, decodificado com `cut`, `base64` e `jq`:

```text
eyJhbGciOiJSUzI1NiIsInR5cCI6ImF0K2p3dCIsImtpZCI6ImsxIn0.eyJpc3MiOiJodHRwczovL2lkcC5sb2NhbCIsImF1ZCI6Im9yZGVycy1hcGki...
$ ... | cut -d. -f1 | b64d | jq -c .   {"alg":"RS256","typ":"at+jwt","kid":"k1"}
$ ... | cut -d. -f2 | b64d | jq -c .   {"iss":"https://idp.local","aud":"orders-api","sub":"alice","scope":"orders.read","iat":1795221831,"exp":1795222131,"jti":"a1"}
$ ... | cut -d. -f3 | b64d | wc -c     256     (uma assinatura RSA-2048)
```

As três partes têm 55, 170 e 342 caracteres. A assinatura cobre os bytes ASCII de `header.payload`; o payload só está codificado, então qualquer um o lê: assinado não é cifrado. O header traz `alg` (com o que verificar), `kid` (qual chave), `typ` (que tipo de token) e, de forma perigosa, `jku`, `jwk`, `x5u` e `x5c` (de onde uma chave poderia vir). A RFC 7515 seção 5.2 diz que o algoritmo é uma decisão da aplicação, então o header é entrada, não configuração.

Claims registradas (RFC 7519 seção 4.1, registro da IANA) e a regra do verificador para cada uma: `iss` igualdade exata com o emissor em que você confia; `sub` identifique usuários por (`iss`, `sub`); `aud` o identificador da sua API precisa estar nela; `exp`, `nbf`, `iat` imponha `exp` e `nbf` com uma tolerância pequena; `jti` um id único, a chave de uma lista de bloqueio.

### Algoritmos de assinatura: o que cada um exige (medido)

Medido com `node:crypto` nesta máquina, um núcleo, mesmas claims, 3000 iterações (300 para assinar com RSA). Os números pertencem a este hardware; o que importa são as proporções:

```text
alg    key                  sig bytes  token chars  sign/s   verify/s
HS256  32 B secret, shared        32          203  691198     788799
RS256  RSA 2048                  256          502    2983      95484
ES256  P-256                      64          246   75612      30242
EdDSA  Ed25519                    64          246   69069      28895
```

- **HS256**: um segredo assina e verifica, então todo verificador também pode forjar. Serve dentro de um serviço, é errado entre times. RFC 7518 seção 3.2: a chave DEVE ter pelo menos 256 bits.
- **RS256**: a chave privada assina, a pública verifica e pode ser publicada. Tokens grandes, assinatura lenta, verificação muito rápida (a RFC 7518 exige 2048 bits ou mais). É o padrão da maioria dos IdPs.
- **ES256**: mesmo modelo com assinaturas de 64 bytes e token menor; aqui a verificação é mais lenta que a do RSA. Use a codificação ieee-p1363 (`r || s`) que o JOSE pede, não o DER que o OpenSSL emite por padrão.
- **EdDSA**: Ed25519 (RFC 8037). Livro contra hoje: a RFC 9864 (outubro de 2025) torna obsoleto o identificador polimórfico `EdDSA` e registra `Ed25519` e `Ed448` totalmente especificados; não conferi o suporte das bibliotecas aos nomes novos, então confira o da sua antes de trocar.

### JWE em uma seção: cinco partes, e por que a maioria dos "JWT" é só JWS

Um JWE (RFC 7516) é `header.encrypted_key.iv.ciphertext.tag`. O `alg` diz como a chave de conteúdo é obtida (`dir` usa uma chave compartilhada direto, `RSA-OAEP` a embrulha) e o `enc` como o payload é cifrado (`A256GCM`). Montado à mão com `dir` e `A256GCM`:

```text
JWE parts (chars): [ 39, 0, 16, 58, 22 ]     (encrypted_key empty with dir)
JWE header : {"alg":"dir","enc":"A256GCM"}
payload readable without the key?  false
decrypt with the key  -> {"sub":"alice","email":"alice@example.org"}
one bit flipped       -> Unsupported state or unable to authenticate data
header edited         -> Unsupported state or unable to authenticate data
JWS parts: 3 | payload without any key -> {"sub":"alice","email":"alice@example.org"}
```

O header é o dado associado do AES-GCM, então editá-lo faz a autenticação falhar. Access tokens e ID tokens quase sempre são JWS: o destinatário é uma API que precisa ler as claims, e o TLS já as esconde em trânsito. Use JWE quando o token passa por uma parte não confiável e carrega dados que ela não deve ler, ou assine e depois cifre (um JWT aninhado, `cty: JWT`).

### JWK, JWKS e o thumbprint (medido)

Um JWK (RFC 7517) é uma chave em JSON: `kty` (`RSA`, `EC`, `OKP`), os membros da chave, `use` opcional (`sig` ou `enc`), `alg` e `kid`. Um JWKS é `{"keys":[...]}`, a URL que um IdP publica (o `jwks_uri` do OIDC; o [concept 10](/identity-concepts/oidc-id-token-userinfo-discovery-and-logout) mediu isso). O `kid` é só um rótulo para busca. O thumbprint da RFC 7638 é um nome derivado da própria chave: mantenha os membros obrigatórios, ordene, sem espaços, SHA-256, base64url. Ele reproduz o vetor da própria RFC, ignora `kid` e `use`, e é o que o DPoP põe em `cnf.jkt` ([concept 12](/identity-concepts/oauth-security-bcp-dpop-mtls-par-rar-and-resource-indicators)):

```text
RFC 7638 section 3.1 vector : NzbLsXh8uDCcd-6MNwXF4W_7noWXFZAfHkxZsRGC9Xs (matches the RFC)
thumbprint (kid candidate)  : LkUc-itoiQX9icOE1fLllyZYOxhons9yUixMmmDZPsk | same with kid/use changed: true
```

### O verificador ingênuo e o corrigido

O ingênuo confia no header três vezes: no algoritmo (a busca por `header.alg`), na chave (`loadKey(header)`) e nas claims (não confere nenhuma). Cada bug real abaixo é uma variação de uma dessas linhas:

```js
export async function naiveVerify(token, loadKey) {
  const [h, p, s] = token.split('.');  const header = dec(h), claims = dec(p);
  const data = Buffer.from(`${h}.${p}`), sig = Buffer.from(s, 'base64url');
  const key = await loadKey(header);                       // key chosen from the header
  const ok = { none: () => true,                           // algorithm chosen by the token
    HS256: () => timingSafeEqual(createHmac('sha256', key).update(data).digest(), sig),
    RS256: () => verify('sha256', data, key, sig) }[header.alg]?.();
  if (!ok) throw new Error('bad signature');
  return claims;                                           // no iss, aud, exp, nbf, typ checks
}
// loaders applications really write: one configured PEM for every alg, a file named by kid,
// SQL built from kid, a key fetched from header.jku, a key taken from header.jwk
```

O corrigido tira as regras da configuração, nunca do token:

```js
export function makeVerifier({ algs, keys, iss, aud, typ, skew = 60 }) {   // keys: Map<kid, KeyObject> built by the server
  return (token, t = now()) => {
    const [h, p, s, extra] = token.split('.');  if (s === undefined || extra) throw new Error('not a compact JWS');
    const header = dec(h), c = dec(p);
    if (!algs.includes(header.alg)) throw new Error(`alg ${header.alg} not in allowlist`);
    if (typ && String(header.typ).toLowerCase().replace('application/', '') !== typ) throw new Error(`typ ${header.typ} is not ${typ}`);
    const key = keys.get(header.kid);                      // kid is only a Map key; jku, jwk, x5u are ignored
    if (!key) throw new Error('unknown kid');
    if (!verify('sha256', Buffer.from(`${h}.${p}`), key, Buffer.from(s, 'base64url'))) throw new Error('bad signature');
    if (c.iss !== iss) throw new Error(`iss ${c.iss}`);
    if (![].concat(c.aud).includes(aud)) throw new Error(`aud ${JSON.stringify(c.aud)}`);
    if (typeof c.exp !== 'number' || t > c.exp + skew) throw new Error(`expired ${t - c.exp} s ago`);
    if (c.nbf !== undefined && t < c.nbf - skew) throw new Error(`not before, ${c.nbf - t} s ahead`);
    return c;
  };
}
```

### Armadilha por armadilha: a mesma entrada, dois verificadores (medido)

O atacante só tem o JWKS público, o formato das claims e um palpite do layout do servidor. Cada linha é um token forjado (as claims dizem `sub: mallory`, `scope: orders.admin`) enviado aos dois verificadores:

| # | Entrada forjada | Verificador ingênuo | Verificador corrigido |
|---|---|---|---|
| 0 | token RS256 legítimo | ACCEPTED alice | ACCEPTED alice |
| 1 | header `{"alg":"none"}`, assinatura vazia | ACCEPTED mallory | REFUSED `alg none not in allowlist` |
| 2 | `alg: HS256`, MAC com o PEM da chave pública RSA como chave | ACCEPTED mallory | REFUSED `alg HS256 not in allowlist` |
| 3a | `kid: ../public/robots.txt`, HS256 com o conteúdo desse arquivo como chave | ACCEPTED mallory | REFUSED `alg HS256 not in allowlist` |
| 3b | `kid: x' UNION SELECT 'attacker-secret' --`, HS256 com esse valor como chave | ACCEPTED mallory | REFUSED `alg HS256 not in allowlist` |
| 4a | chave pública do atacante no `jwk` do header, assinado com a privada dele | ACCEPTED mallory | REFUSED `bad signature` |
| 4b | `jku` no header apontando para o JWKS do atacante (127.0.0.1:7181) | ACCEPTED mallory | REFUSED `bad signature` |
| 4c | `jku` no header apontando para um serviço interno (127.0.0.1:7182) | o verificador fez a requisição | nenhuma requisição feita |

O que cada uma explora:

1. **`alg: none`** (JWS sem proteção, RFC 7515 apêndice A.5): um verificador com um ramo `none` está aceitando "não precisa de assinatura". A correção não é só "rejeitar none", é uma lista de permitidos: o que não está nela morre, `none` incluído (RFC 8725 seção 3.1).
2. **RS256 para HS256** (confusão de algoritmo): a aplicação tem uma "chave de verificação" e a biblioteca a usa para o que o `alg` mandar. Para HS256 essa chave vira segredo HMAC, e a chave pública é pública. Aqui funciona porque os bytes do atacante são iguais ao PEM do servidor; numa biblioteca real a conversão de PEM ou JWK precisa reproduzir os mesmos bytes, então a exposição depende desse tratamento. A correção é a lista de permitidos mais um algoritmo por chave; o Node também recusa usar um `KeyObject` público como chave HMAC (`ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE`, medido).
3. **O `kid` é uma entrada**: o `kid` escolheu um arquivo (`readFileSync(`${dir}/${kid}`)`, path traversal até um arquivo cujo conteúdo o atacante conhece) ou entrou num SQL (o `UNION SELECT` devolveu o segredo que o atacante escolheu). A RFC 8725 seção 3.10 cita a injeção de SQL e de LDAP. A correção é uma busca num mapa que o servidor montou na inicialização (ou uma consulta parametrizada mais um padrão estrito), onde `kid` desconhecido é erro.
4. **`jku`, `jwk`, `x5u` vindos do token** são o atacante entregando a chave de verificação. O `jku` também faz o seu servidor buscar uma URL escolhida pelo atacante: o listener interno da 7182 recebeu exatamente uma requisição do verificador ingênuo e nenhuma do corrigido (SSRF, RFC 8725 seção 3.10). As chaves vêm só da configuração ou do `jwks_uri` do emissor, que você descobriu a partir do `iss`. A RFC 7515 seção 4.1.2 exige TLS e validação do servidor se você seguir um `jku`; uma lista de permitidos com a URL exata é o mínimo.

As linhas 5 a 7 são tokens válidos, bem assinados, usados no lugar errado (o ingênuo aceita e o corrigido recusa):

| # | Token | Ingênuo | Corrigido |
|---|---|---|---|
| 5a | assinado pela chave real, `iss` `https://other-idp.example`, `aud` `billing-api` | ACCEPTED | REFUSED `iss https://other-idp.example` |
| 5b | `exp` há 10 minutos | ACCEPTED | REFUSED `expired 600 s ago` |
| 5c | `nbf` daqui a 5 minutos | ACCEPTED | REFUSED `not before, 300 s ahead` |
| 6 | ID token (`typ: JWT`, mesmo emissor, chave e `aud`) usado como access token | ACCEPTED se iss, aud, exp são conferidos | REFUSED `typ JWT is not at+jwt` |

Uma assinatura prova quem fez o token, não que ele era para você. O `aud` barra o token de outra API, o `iss` o de outro emissor, e o `typ` outro tipo de token do mesmo emissor: a RFC 9068 seção 4 diz que o resource server DEVE conferir que o `typ` é `at+jwt`, e a RFC 8725 seções 3.11 e 3.12 pedem regras de validação mutuamente exclusivas por tipo de token (o [concept 10](/identity-concepts/oidc-id-token-userinfo-discovery-and-logout) já mostra `aud` e `nonce` para ID tokens). Tolerância de relógio, o mesmo verificador com `exp` e `nbf` deslocados:

```text
exp 30 s ago     skew 0: REFUSED expired 30 s ago        | skew 60: ACCEPTED
exp 120 s ago    skew 0: REFUSED expired 120 s ago       | skew 60: REFUSED expired 120 s ago
nbf 120 s ahead  skew 0: REFUSED not before, 120 s ahead | skew 60: REFUSED not before, 120 s ahead
```

### Cache do JWKS e rotação: as medidas novas (medido)

O [concept 10](/identity-concepts/oidc-id-token-userinfo-discovery-and-logout) mediu a rotação com Keycloak. O que ele não contou é o custo de um `kid` desconhecido controlado por um atacante e de uma queda do IdP, contra um servidor de JWKS local:

```text
refetch on every unknown kid   JWKS requests: warm-up 1, after 50 unknown kids +50
cooldown 2 s                   JWKS requests: warm-up 1, after 50 unknown kids +0
rotation, k2 asked at once      -> unknown kid (inside cooldown)
rotation, k2 asked after 2.1 s  -> found (one refetch)
IdP down, known kid k1          -> verifies from the cache
IdP down, unknown kid           -> refused, no crash
```

Rebuscar a cada `kid` desconhecido transforma 50 tokens lixo em 50 requisições ao seu IdP; um cooldown faz isso virar 0, ao preço de uma chave legitimamente nova ser recusada até o cooldown acabar (então publique a chave nova antes de assinar com ela). Mantenha o último conjunto de chaves bom quando a busca falha, e mantenha a chave antiga publicada até passar a maior vida de token.

### Segredos HS256 fracos: a conta, não um ataque

Um token HS256 é uma mensagem e o seu HMAC, então quem vê um token pode testar um segredo candidato offline: sem servidor, sem limite de taxa, sem bloqueio. A defesa é entropia, e a RFC 7518 seção 3.2 fixa o piso (uma chave pelo menos do tamanho da saída do hash, 256 bits para HS256). Um palpite é um HMAC; o custo de percorrer todas as chaves de cada tipo, na taxa medida aqui (cerca de 1,1 milhão de HMAC-SHA256 por segundo em um núcleo):

```text
secret                             bits   time to try every key (1 core, this machine)
8 chars, a-z                        37.6   52.8 h
8 chars, a-zA-Z0-9                  47.6   6.30e+0 years
16 chars, a-zA-Z0-9                 95.3   1.38e+15 years
32 random bytes (RFC 7518 minimum) 256.0   3.34e+63 years
```

Um segredo curto escolhido por uma pessoa está nas primeiras linhas, e hardware dedicado é muitas ordens de grandeza mais rápido que um núcleo, então só a última linha é um projeto seguro. Gere 32 bytes aleatórios de um CSPRNG, guarde num cofre de segredos e prefira RS256 ou ES256 quando o verificador não é o emissor. Nenhuma lista de palavras foi usada ou testada aqui.

### O que as bibliotecas fazem por padrão (medido nesta máquina)

.NET, `JsonWebTokenHandler.ValidateTokenAsync` com `TokenValidationParameters` (`Microsoft.IdentityModel.JsonWebTokens` 8.23.0, a chave é um `RsaSecurityKey`):

| Entrada | Resultado |
|---|---|
| `alg: none`, padrões | INVALID `IDX10504: Unable to validate signature, token does not have a signature` |
| `alg: none`, `RequireSignedTokens = false` | VALID (sub mallory): nunca configure isso |
| HS256 com o PEM da chave pública RSA como chave | INVALID `IDX10511` (igual com `ValidAlgorithms = [RS256]`) |
| `jwk` ou `jku` do atacante no header | INVALID `IDX10511`, esses headers não são seguidos |
| chave legítima, `RS384` em vez de `RS256` | VALID por padrão, INVALID com `ValidAlgorithms = [RS256]` |
| `kid` que não casa com nenhuma chave | VALID com um `IssuerSigningKey` ou com `IssuerSigningKeys` (`TryAllIssuerSigningKeys` é `true` por padrão); INVALID `IDX10500` com `false` |
| expirado há 2 min / há 10 min; `nbf` daqui a 2 min | VALID / INVALID; VALID (`ClockSkew` padrão de 5 minutos) |
| ID token (`typ: JWT`) | VALID por padrão; INVALID `IDX10257` com `ValidTypes = ["at+jwt"]` |

Então o handler já recusa `none` e a confusão de tipo de chave (o `RsaSecurityKey` não verifica um HMAC) e ignora `jku` e `jwk`. O que ele deixa para você: `ValidAlgorithms` (a chave limita o algoritmo, não o contrário), `ValidTypes`, um `ClockSkew` menor e `TryAllIssuerSigningKeys = false` para o `kid` significar algo. Os detalhes do middleware do ASP.NET Core e do mapeamento de claims estão no [concept de JWT Bearer](/dotnet-concepts/jwt-bearer-and-aspnet-core-identity).

Spring, `NimbusJwtDecoder.withPublicKey(...)` (Spring Security 7.1.1, Nimbus 10.9.1), os mesmos ataques:

| Entrada | Resultado |
|---|---|
| `alg: none` (um `PlainJWT`) | `BadJwtException: Unsupported algorithm of none` |
| HS256 com os bytes da chave pública como chave | `Signed JWT rejected: Another algorithm expected, or no matching key(s) found` |
| `RS384` com a chave legítima, decoder padrão | recusado (o decoder espera RS256); VALID com `signatureAlgorithm(RS384)` |
| `iss` e `aud` errados, validadores padrão | VALID: por padrão só os timestamps são conferidos; `createDefaultWithIssuer` rejeita o `iss`, o `aud` fica por sua conta |
| `exp` há 30 s / há 120 s | VALID / `Jwt expired` (tolerância padrão de 60 s) |
| `typ: at+jwt`, decoder padrão | recusado: `the given typ value needs to be one of [JWT]` |
| `typ: at+jwt` com `validateType(false)` e `createAtJwtValidator().issuer().audience()` | VALID; o ID token (`typ: JWT`), o `aud` errado e o `iss` errado são recusados cada um |

O padrão do Spring é estrito em algoritmo e chave, e frouxo em `iss` e `aud` quando você monta o decoder a partir de uma chave pública avulsa (os builders a partir de issuer location ou de JWKS URI são docs only aqui). A página de referência do Spring mostra `validateTypes(false)` enquanto o jar 7.1.1 que medi expõe `validateType(boolean)`: confira o nome na sua versão. O lado de assinatura e JWKS está no [concept de assinatura de JWT do Spring](/spring-concepts/spring-security-jwt-signing-symmetric-and-asymmetric).

### Revogação: um JWT vale até expirar

Um verificador que só confere assinatura e claims não tem como saber que um token foi revogado. As opções, todas pagas na mesma moeda (estado ou latência):

| Opção | Custo | Medido em outro lugar |
|---|---|---|
| `exp` curto (minutos) mais refresh | mais renovações; um token roubado vive até o `exp` | [concept 9](/identity-concepts/oauth-2-roles-grants-and-tokens-from-first-principles): tokens de 5 minutos |
| introspecção (RFC 7662) | uma chamada por requisição ou um cache | [concept 9](/identity-concepts/oauth-2-roles-grants-and-tokens-from-first-principles): cerca de 100 vezes mais lenta que a local, vê `active:false` após o revoke |
| lista de bloqueio por `jti` ou versão por usuário | uma consulta por requisição: de novo um armazenamento de sessão | [concept 18](/identity-concepts/session-management-cookies-fixation-and-revocation): a cópia roubada só é recusada com a consulta |
| tokens presos ao remetente (DPoP, mTLS) | gestão de chave no cliente | [concept 12](/identity-concepts/oauth-security-bcp-dpop-mtls-par-rar-and-resource-indicators): token roubado recusado sem a chave |
| eventos do emissor (CAE, logout back-channel) | suporte do IdP e do RP | [concept 10](/identity-concepts/oidc-id-token-userinfo-discovery-and-logout) e [18](/identity-concepts/session-management-cookies-fixation-and-revocation) |

### JWT como sessão de navegador, e onde guardar um token

Pôr um JWT num cookie no lugar de um id de sessão mantém o cookie e perde o que fazia dele uma sessão: o [concept 18](/identity-concepts/session-management-cookies-fixation-and-revocation) mediu que o logout só limpou a cópia da vítima, que uma lista de bloqueio ou `ver` traz o armazenamento de volta, e que um token cheio de claims fez o cookie ir a 2229 bytes contra 22 de um id de sessão (acima do limite de 4096 bytes do cookie ele é descartado em silêncio). Use sessão no servidor para apps de navegador e JWT para chamadas entre serviços. Um token em JavaScript de front-end é legível por qualquer XSS: o cheat sheet HTML5 da OWASP diz para não guardar identificadores de sessão em local storage, e o [concept 18](/identity-concepts/session-management-cookies-fixation-and-revocation) (BFF, cookie `HttpOnly`) mostra onde ele deve ficar.

### Livro contra hoje, e onde o JWT é usado agora

Livro: tutoriais antigos punham um JWT no `localStorage` como "sessões sem estado", assinado com um segredo HS256 curto e verificado com o `alg` que viesse. Hoje: JWT é o formato dos access tokens OAuth em que a API confere localmente (RFC 9068, `typ: at+jwt`, com as claims do [concept 9](/identity-concepts/oauth-2-roles-grants-and-tokens-from-first-principles)) e o formato obrigatório dos ID tokens do OIDC ([concept 10](/identity-concepts/oidc-id-token-userinfo-discovery-and-logout)), enquanto a sessão de navegador é um id opaco num cookie `__Host-` ([concept 18](/identity-concepts/session-management-cookies-fixation-and-revocation)). A RFC 8725 (2020) é o checklist e a RFC 9068 (2021) o perfil. O PASETO (versionado, sem campo de algoritmo, então sem `alg` para confundir; especificação no GitHub) é um formato alternativo, mas o OIDC exige JWT nos ID tokens e a RFC 9068 define um perfil de JWT para access tokens, então para tokens que cruzam fornecedores você vai validar JWTs; tokens opacos com introspecção são a alternativa onde revogar pesa mais que validar localmente. Não medi o PASETO.

O checklist acima é o que o mapa de validação do [concept 10](/identity-concepts/oidc-id-token-userinfo-discovery-and-logout) pressupõe. Na sequência da trilha, o token exchange OAuth ([concept 13](/identity-concepts/oauth-token-exchange-delegation-and-on-behalf-of)) emite JWTs com `act` e restrição de audience e os consome com o grant JWT bearer, e o [concept de OAuth Security (12)](/identity-concepts/oauth-security-bcp-dpop-mtls-par-rar-and-resource-indicators) acrescenta o vínculo por DPoP e mTLS para o problema do token roubado levantado na tabela de revogação.

## Trade-offs

- **JWT contra access token opaco.** Um JWT verifica em microssegundos e não pode ser recolhido; um token opaco custa uma chamada e revoga na hora. JWTs curtos (5 minutos) mais refresh tokens revogáveis é o meio-termo usual.
- **HS256 contra RS256 ou ES256.** HS256 é rápido e tem um segredo só, e todo verificador pode forjar; chaves assimétricas custam tamanho (502 contra 203 caracteres aqui) e gestão de chaves e deixam o verificador ser outra parte.
- **Validação estrita contra compatibilidade.** Um algoritmo, `iss`, `aud` e `typ` exatos quebram no dia em que o IdP os muda: faça a transição aceitando os dois por um tempo. Um cooldown de rebusca do JWKS protege o IdP e faz uma chave nova esperar (medido: `k2` recusada de imediato, achada após 2,1 s), então publique a chave antes de assinar com ela.
- **Tolerância de relógio.** 60 segundos escondem a deriva; o padrão de 5 minutos do .NET estende cada token por esse tempo (medido: um token expirado há 2 minutos foi VALID).

## Documentation Links

- [RFC 7515, JSON Web Signature (JWS), IETF](https://datatracker.ietf.org/doc/html/rfc7515) (doc)
- [RFC 7516, JSON Web Encryption (JWE), IETF](https://datatracker.ietf.org/doc/html/rfc7516) (doc)
- [RFC 7517, JSON Web Key (JWK), IETF](https://datatracker.ietf.org/doc/html/rfc7517) (doc)
- [RFC 7518, JSON Web Algorithms (JWA), IETF](https://datatracker.ietf.org/doc/html/rfc7518) (doc)
- [RFC 7519, JSON Web Token (JWT), IETF](https://datatracker.ietf.org/doc/html/rfc7519) (doc)
- [RFC 7638, JSON Web Key (JWK) Thumbprint, IETF](https://datatracker.ietf.org/doc/html/rfc7638) (doc)
- [RFC 8725, JSON Web Token Best Current Practices, IETF](https://datatracker.ietf.org/doc/html/rfc8725) (doc)
- [RFC 9068, JWT Profile for OAuth 2.0 Access Tokens, IETF](https://datatracker.ietf.org/doc/html/rfc9068) (doc)
- [RFC 9864, Fully-Specified Algorithms for JOSE and COSE, IETF](https://datatracker.ietf.org/doc/html/rfc9864) (doc)
- [JSON Object Signing and Encryption (JOSE) registry, IANA](https://www.iana.org/assignments/jose/jose.xhtml) (doc)
- [JSON Web Token Cheat Sheet, OWASP](https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_Cheat_Sheet.html) (doc)
- [HTML5 Security Cheat Sheet, OWASP](https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html) (doc)
- [TokenValidationParameters.ValidAlgorithms, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/microsoft.identitymodel.tokens.tokenvalidationparameters.validalgorithms) (doc)
- [OAuth 2.0 Resource Server JWT, Spring Security Reference](https://docs.spring.io/spring-security/reference/servlet/oauth2/resource-server/jwt.html) (doc)
- [PASETO specification, paseto-standard on GitHub](https://github.com/paseto-standard/paseto-spec) (doc)
