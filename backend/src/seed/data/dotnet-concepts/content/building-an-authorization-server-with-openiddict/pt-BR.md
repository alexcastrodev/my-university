---
version: 1.0
updatedAt: 2026-11-19
title: "Construindo um Servidor de Autorização com OpenIddict"
summary: Um servidor OAuth 2.0 e OpenID Connect em ASP.NET Core com OpenIddict, medido com curl contra um servidor de laboratório com SQLite e uma API separada, com as quatro tabelas, PKCE e erros de redirect_uri, destinos de claims, access token criptografado contra JWT, revogação e introspecção, rotação de refresh token e de chaves, tokens de referência, PAR, mTLS e DPoP; e a decisão contra Duende IdentityServer e produtos prontos.
---
## Objective

A maioria dos times .NET consome tokens: [JWT bearer](jwt-bearer-and-aspnet-core-identity) e [OpenID Connect](openid-connect-entra-id-and-bff) validam o que um provedor de identidade emitiu. Esta lição constrói o provedor: um servidor de autorização (AS) OAuth 2.0 e OpenID Connect dentro do ASP.NET Core com OpenIddict, e depois faz a pergunta mais difícil: você deveria? O OpenIddict é uma biblioteca, não um produto de identidade: ele interpreta e valida as mensagens do protocolo, guarda aplicações, autorizações e tokens, e assina o que você mandar assinar. A tela de login, o cadastro de usuários, o MFA, a página de consentimento e a recuperação de conta são seus. Tudo abaixo foi medido com curl contra um servidor de laboratório de ~160 linhas (SQLite) e uma API protegida separada; o que veio só da documentação está marcado "só documentação". A [lição de MCP](/dotnet-ai-concepts/choosing-an-authorization-server-for-mcp-entra-keycloak-openiddict) já mediu o OpenIddict como servidor de autorização de MCP, então esta vai ao servidor completo, e o lado cliente fica na [lição de clientes OAuth](oauth-2-clients-in-dotnet-code-pkce-client-credentials-and-device-flow).
Versões: `OpenIddict.AspNetCore` e `OpenIddict.EntityFrameworkCore` 7.9.0 (última estável no NuGet e Apache-2.0 no GitHub, ambos conferidos em 2026-11-19; existe também `8.0.0-preview.6`), `Microsoft.EntityFrameworkCore.Sqlite` 10.0.15, `Microsoft.AspNetCore.Authentication.JwtBearer` 10.0.15, TFM `net10.0`, SDK 10.0.100.

## Use Cases

- Um produto que precisa emitir os próprios tokens para apps de terceiros, parceiros ou sistemas de clientes.
- Uma plataforma interna em que Entra ID ou Keycloak não é permitido ou não basta, e um time .NET é dono do login.
- Decidir, com evidência, entre OpenIddict, Duende IdentityServer e um produto pronto.
- Auditar um servidor OpenIddict existente: lifetimes, rotação de chaves, revogação, claims nos tokens.

## Deep Dive

O vocabulário do protocolo (papéis, grants, PKCE, introspecção) está nas lições neutras [OAuth 2.0 do zero](/identity-concepts/oauth-2-roles-grants-and-tokens-from-first-principles), [OpenID Connect](/identity-concepts/oidc-id-token-userinfo-discovery-and-logout) e [segurança OAuth e BCP](/identity-concepts/oauth-security-bcp-dpop-mtls-par-rar-and-resource-indicators). Aqui é código .NET.

### Core, server, validation e quatro tabelas

`AddOpenIddict()` tem três partes: `AddCore` (os managers e o store, aqui `UseEntityFrameworkCore`), `AddServer` (os endpoints) e `AddValidation` (aceitar tokens, no próprio AS ou numa API). Com EF Core e SQLite, `UseOpenIddict()` no `DbContext` criou quatro tabelas, e alguns fluxos as preencheram:

```text
OpenIddictApplications    clients: ClientId, ClientSecret com hash, ClientType, ConsentType, Permissions, RedirectUris, Requirements
OpenIddictScopes          nomes de scope e os resources (futuro aud) que implicam
OpenIddictAuthorizations  "o usuário X concedeu ao client Y estes scopes": Subject, Scopes, Status, Type (permanent ou ad-hoc)
OpenIddictTokens          uma linha por token: Type, Status, Subject, AuthorizationId, ExpirationDate, RedemptionDate, ReferenceId, Payload
```

A coluna `ClientSecret` tinha `AQAAAAEAACcQ...`, o formato de um hash de senha v3 do ASP.NET Core Identity: segredos têm hash, não são guardados. Tokens também são linhas: um fluxo de authorization code deixou uma autorização `valid` mais linhas para o code, o access, o refresh e o ID token, e é isso que torna possíveis a revogação e a detecção de replay. O Payload fica vazio nos JWTs comuns e só é preenchido nos codes (e nos tokens de referência, abaixo).

### O laboratório, e o login é seu

```csharp
builder.Services.AddOpenIddict()
    .AddCore(o => o.UseEntityFrameworkCore().UseDbContext<DbContext>())
    .AddServer(o =>
    {
        o.SetIssuer("http://localhost:6740/");
        o.SetAuthorizationEndpointUris("connect/authorize").SetTokenEndpointUris("connect/token")
         .SetIntrospectionEndpointUris("connect/introspect").SetRevocationEndpointUris("connect/revoke");
        o.AllowAuthorizationCodeFlow().AllowClientCredentialsFlow().AllowRefreshTokenFlow();   // sem implicit, sem password
        o.RequireProofKeyForCodeExchange();
        o.RegisterScopes(Scopes.Email, Scopes.Profile, Scopes.OfflineAccess, "orders");
        o.AddEncryptionKey(key).AddSigningCertificate(cert);
        o.UseAspNetCore().EnableAuthorizationEndpointPassthrough().EnableTokenEndpointPassthrough()
         .DisableTransportSecurityRequirement();                                    // só no lab: http
    })
    .AddValidation(o => { o.UseLocalServer(); o.UseAspNetCore(); });
```

"Passthrough" significa que o OpenIddict valida a requisição e depois chama o seu endpoint, que devolve `Results.SignIn(principal, authenticationScheme: OpenIddictServerAspNetCoreDefaults.AuthenticationScheme)` para mandá-lo emitir. O meu `/connect/authorize` confere um cookie de login (um esquema `AddCookie` comum com um formulário de 5 linhas em `/login`); se não houver, devolve `Results.Challenge`, que redireciona ao formulário. Só então monta o `ClaimsPrincipal` e faz o sign-in. O `/connect/token` trata `client_credentials` sozinho e, para codes e refresh tokens, reassina o principal que o OpenIddict já reconstruiu a partir do token resgatado. A API é um segundo processo com `AddJwtBearer` e `AddOpenIddict().AddValidation(...)`. Portas 6740 (AS) e 6741 (API); algumas variáveis de ambiente trocam opções entre as execuções.

### Discovery: o que está ligado e o que não está

`GET /.well-known/openid-configuration` anuncia só o que foi habilitado:

```text
grant_types_supported = authorization_code, client_credentials, refresh_token, urn:ietf:params:oauth:grant-type:device_code
response_types_supported = code
code_challenge_methods_supported = plain, S256
jwks_uri = http://localhost:6740/.well-known/jwks      (uma chave RSA, com x5c)
authorization_response_iss_parameter_supported = True
POST /connect/token grant_type=password                      -> unsupported_grant_type (ID2032)
GET  /connect/authorize?response_type=token (implicit)       -> unsupported_response_type (ID2032)
```

O grant de device apareceu porque o lab também chamou `AllowDeviceAuthorizationFlow()`; password e implicit simplesmente não existem a menos que você chame `AllowPasswordFlow()` ou `AllowImplicitFlow()`. Também não há `end_session_endpoint` nem `userinfo_endpoint`, porque não os habilitei.

### Authorization code com PKCE, e seus erros

Um helper de shell segue os redirects: authorize, 302 para `/login`, POST do formulário, authorize de novo, leitura do `Location` final.

```text
authorize, sem login                    -> 302 /login?ReturnUrl=...
authorize sem code_challenge            -> error=invalid_request "The mandatory 'code_challenge' parameter is missing." (ID2029)
redirect_uri com barra no final         -> 400 "The specified 'redirect_uri' is not valid for this client application." (ID2043)
scope=openid admin (não registrado)     -> invalid_scope (ID2052)
scope=email num client que não o tem    -> "This client application is not allowed to use the specified scope." (ID2051)
authorize com PKCE                      -> 302 http://localhost:6745/callback?code=...&state=xyz&iss=http%3A%2F%2Flocalhost%3A6740%2F
token com o verifier                    -> access_token, id_token, refresh_token
segundo resgate do mesmo code           -> invalid_grant "The specified authorization code has already been redeemed." (ID2010)
```

O `redirect_uri` é comparado exatamente com o valor registrado, e a página de erro é um 400 simples, nunca um redirect para uma URL não verificada. O `state` só é devolvido, e o `nonce` foi parar no ID token (`"nonce":"n1"`): conferir os dois continua sendo trabalho do client. Dois detalhes importam para segurança. A metadata lista `plain` e o servidor aceitou `code_challenge_method=plain`; adicionar `o.Configure(x => x.CodeChallengeMethods.Remove(CodeChallengeMethods.Plain))` deixou a metadata `['S256']` e `plain` falhou com ID2032. E o segundo resgate não só falhou: o log disse `4 tokens associated with the authorization ... were revoked to prevent a potential token replay attack`, e a tabela mostrou code, access, refresh e ID token todos `revoked` (a autorização em si continuou `valid`). Um access token dessa cadeia levou 401 da API.

### Aplicações: públicas, confidenciais, consentimento

`IOpenIddictApplicationManager.CreateAsync` recebe um descriptor. O client `spa` é público (sem segredo) com um redirect exato e o requisito de PKCE; `worker` é confidencial:

```csharp
new OpenIddictApplicationDescriptor
{
    ClientId = "worker", ClientSecret = "worker-secret", ClientType = ClientTypes.Confidential,
    Permissions = { Permissions.Endpoints.Token, Permissions.Endpoints.Introspection,
                    Permissions.GrantTypes.ClientCredentials, Permissions.Prefixes.Scope + "orders" },
}
```

As permissões são uma lista de permitidos por client, então um client não chama um endpoint, não usa um grant nem pede um scope que não recebeu. Medido com client credentials: segredo errado `invalid_client` (ID2055); `scope=email` sem permissão `invalid_request`; o `spa` pedindo `client_credentials` levou `invalid_request` (falta um segredo); o segredo foi aceito no formulário ou em HTTP Basic. Um client com `ConsentTypes.Explicit` e nenhuma autorização guardada recebeu `error=consent_required` no redirect, porque o meu handler devolveu `Forbid` com esse erro. A tela que pergunta e a chamada `AuthorizationManager.CreateAsync` que lembra a resposta são código seu (só documentação: o exemplo da página de authorization storage); `Implicit` pula a pergunta, `External` deixa para um administrador.

### Scopes, resources e destinos de claims

Uma linha de scope carrega `Resources = { "orders-api" }`; o handler chama `p.SetResources(await scopes.ListResourcesAsync(p.GetScopes()))` e o token ganha `"aud":"orders-api"`. Claims são diferentes: o OpenIddict copia claims para codes e refresh tokens sozinho, mas para access e ID tokens só as que têm destino, exceto `sub`. O meu principal tinha `name`, `email`, `role` e `department`:

```text
SetDestinations nunca chamado  AT {sub}                                        ID {sub}                        (e mais nada)
regra std (name: AT+ID, email: ID se scope email, role: AT, department: nenhum)
                               AT {sub, name, role}                            ID {sub, name, email}
toda claim -> AccessToken      AT {sub, name, email, role, department}         ID {sub}
```

Esse é o clássico "minha claim sumiu": sem destino não há claim, e não há erro. Pôr tudo no access token vaza `department` para o client, que consegue lê-lo quando a criptografia está desligada. A API imprimiu `role=admin email= dept=` na regra std: `email` só estava no ID token, como pretendido.

### Formato do token e como a API valida

Por padrão os access tokens são JWE (JWT criptografado): header `{"alg":"A256KW","enc":"A256CBC-HS512","typ":"at+jwt","cty":"JWT"}`, cinco segmentos, 1575 caracteres; o ID token é um JWT assinado de 3 segmentos. A API aceitou o mesmo token em quatro configurações:

| Validação na API | AT criptografado (padrão) | `DisableAccessTokenEncryption()` |
| --- | --- | --- |
| `AddJwtBearer` com `Authority` | 401 `invalid_token` | 200 (precisa de `aud` e de um JWKS acessível) |
| Validation do OpenIddict, `UseIntrospection()` | 200 (uma chamada a `/connect/introspect` por token) | 200 |
| Validation do OpenIddict, `AddEncryptionKey(sameKey)` | 200 (local, sem chamada) | n/a |
| `UseLocalServer()` no próprio AS | 200 | 200 |

```csharp
// API: o.SetIssuer("http://localhost:6740/"); o.AddAudiences("orders-api");
o.UseIntrospection().SetClientId("orders-api").SetClientSecret("api-secret");   // ou o.AddEncryptionKey(sharedKey)
o.UseSystemNetHttp(); o.UseAspNetCore();
```

`orders-api` é ela mesma uma aplicação, só com a permissão de introspecção. A resposta de introspecção trouxe `"active": true`, `aud`, `scope`, `client_id`, `name` e `role`; um chamador que não é a audiência do token (`worker`) recebeu `{"active": false}`. A criptografia esconde as claims dos clients e de terceiros; desligá-la é o que faz o JwtBearer comum funcionar (o caso da [lição de JWT](jwt-bearer-and-aspnet-core-identity)), ao preço de claims legíveis. Compartilhar a chave de criptografia com cada API é a terceira opção.

### Lifetimes, revogação e o que "válido" significa

Padrões lidos nos tokens e nas linhas: code 5 minutos, access token 1 hora (`expires_in: 3600`), ID token 20 minutos, refresh token 14 dias; `SetAccessTokenLifetime`, `SetRefreshTokenLifetime`, `SetAuthorizationCodeLifetime` e `SetIdentityTokenLifetime` mudam isso. Com um access token de 5 segundos, 7 segundos depois:

```text
AddJwtBearer (clock skew padrão de 5 min)    200   (expirou há 2 s e ainda foi aceito)
Validation do OpenIddict via introspecção    401
Validação local no AS                        401
```

Depois a revogação, `POST /connect/revoke` (200, `{}` vazio), com um JWT autocontido:

```text
                                       AddJwtBearer   introspecção   local, padrão   local, EnableTokenEntryValidation()
após revogar o access token            200            401            200             401
```

Sem `EnableTokenEntryValidation()` o handler de validation nunca olha o banco ("access tokens são considerados válidos até expirar", segundo a documentação), e uma API com JwtBearer não enxerga a revogação de jeito nenhum. O modo de chave compartilhada (200 após revogar) se comporta como o JwtBearer. A revogação só alcança uma API que faz introspecção ou lê o banco do AS. O advisory GHSA-cxgj-hwwh-855g (corrigido na 7.9.0 e no 8.0 preview 6): com `EnableAuthorizationEntryValidation()` mas sem `EnableTokenEntryValidation()`, a checagem da autorização era pulada, no `OpenIddict.Validation` acima da 4.0.0. Atualize, e habilite os dois quando validar entradas.

### Refresh tokens: rotação, leeway e reuso

Cada refresh emitiu um novo refresh token e marcou o antigo como `redeemed`. Três configurações, cada uma partindo do primeiro refresh token (`RT0`):

```text
LEEWAY=0           refresh RT0 -> ok; reuso de RT0 -> invalid_grant "already been redeemed"; depois RT1 -> invalid_grant "no longer valid"
                   linhas: todo access, refresh, code e ID token revogado ("7 tokens associated with the authorization ... were revoked")
padrão             reuso de RT0 na hora -> ok (um segundo par), RT1 -> ok; as duas cadeias vivas (janela de leeway)
padrão, +31 s      reuso de RT0 -> invalid_grant, RT1 -> invalid_grant, todas as linhas revogadas
ROLLING=off        (DisableRollingRefreshTokens) RT0 reusado 3 vezes -> ok; 4 linhas de refresh, todas válidas, nada revogado
```

O `RefreshTokenReuseLeeway` padrão de 30 segundos tolera um client que tenta de novo depois de uma resposta perdida, ao custo de uma janela curta de gasto duplo. Passada essa janela, o reuso é tratado como roubo e a cadeia inteira morre, o mesmo sinal do replay de code. Desligar a rotação remove a detecção: um refresh token roubado funciona até expirar. Os access tokens já emitidos da cadeia continuam funcionando numa API com JwtBearer pelo resto da vida deles (veja acima). Ao renovar, reconfira o usuário no seu handler (conta desativada, senha trocada); essa parte é código seu (só documentação).

### Chaves de assinatura e rotação

`AddEphemeralSigningKey()` gerou uma chave nova a cada start: um token emitido antes de um restart levou 401 depois dele e, segundo a documentação, o mesmo acontece com refresh tokens e codes se a chave de criptografia também for efêmera (só documentação). `AddDevelopmentSigningCertificate()` persiste um certificado no repositório do usuário (só documentação, não rodei para não mexer no keychain). Em produção, `AddSigningCertificate` com um certificado real vindo de um cofre. Rotação com dois certificados (A expira em 2027-11, B em 2028-11):

```text
AS com A:            jwks [7506ACC9]            token t1 assinado com kid 7506ACC9, API 200
AS com A,B:          jwks [E35760B0, 7506ACC9]  token novo assinado com E35760B0 (B), também com a lista na ordem B,A
API, JWKS em cache:  t2 primeira chamada 401, chamada seguinte 200 (o JwtBearer atualizou no kid desconhecido)
API reiniciada:      t1 200, t2 200
AS só com B:         jwks [E35760B0]            t1 numa API com JWKS em cache 200, após reiniciar a API 401
```

A documentação diz que o OpenIddict assina com o certificado que expira mais tarde (os ainda não válidos são ignorados), e ele publicou as duas chaves, então os tokens antigos continuaram validando até A sair do JWKS. Duas consequências: o cache de JWKS da API deixa uma chave aposentada viva até um restart ou refresh, e a primeira requisição depois da rotação pode falhar uma vez. Rotação é um procedimento de deploy que é seu (gerar, publicar as duas, esperar o maior lifetime de token, remover a antiga); a Duende vende isso como add-on (abaixo).

### Tokens de referência

`UseReferenceAccessTokens()` tornou o access token uma string opaca de 43 caracteres (em vez de 1575) e guardou o payload assinado em `OpenIddictTokens.Payload` (1554 caracteres) com um `ReferenceId` que não é a string do token. O JwtBearer levou 401; a introspecção, 200; revogar marcou a linha `revoked` e a introspecção passou a 401 na hora. Você ganha tokens curtos e revogação imediata e paga uma leitura de banco a cada validação, e a documentação recomenda fortemente proteger a coluna `Payload` (criptografia em repouso) ou usar o formato de token do Data Protection (só documentação).

### PAR, mTLS e DPoP, device flow, limpeza

- PAR (RFC 9126): `SetPushedAuthorizationEndpointUris("connect/par")` mais `Permissions.Endpoints.PushedAuthorization` no client. `POST /connect/par` devolveu 201 com `request_uri=urn:ietf:params:oauth:request_uri:...` e `expires_in: 3599`; `authorize?client_id=spa&request_uri=...` deu um code, um segundo uso do mesmo `request_uri` deu 400, e `RequirePushedAuthorizationRequests()` fez a metadata dizer `require_pushed_authorization_requests: True` e o authorize comum falhar com `The mandatory 'request_uri' parameter is missing`.
- mTLS (RFC 8705): presente nos assemblies do servidor (`EnablePublicKeyInfrastructureTlsClientAuthentication`, `EnableSelfSignedTlsClientAuthentication`, `UseClientCertificateBoundAccessTokens`, segundo a issue #2417 mergeada em 2026), só documentação: não rodei, exige um terminador TLS com certificados de cliente.
- DPoP (RFC 9449): não suportado. Os assemblies não têm tipo de DPoP, e na issue #2483 (junho de 2026) o mantenedor escreveu que DPoP não é suportado nas stacks de client, server ou validation, que está aberto a adicioná-lo e que mTLS oferece o nível de segurança maior. A página de preços da Duende lista DPoP no plano base.
- Device flow: `AllowDeviceAuthorizationFlow()` com `SetDeviceAuthorizationEndpointUris` e `SetEndUserVerificationEndpointUris`: o endpoint de device devolveu `device_code`, `user_code 0185-0217-0799`, `verification_uri` e `expires_in: 600`; o polling deu `authorization_pending`. A página de verificação (digitar o código, aprovar) é sua, só documentação. O lado client está na lição de clientes OAuth.
- Limpeza: tokens e autorizações expirados ficam nas tabelas até serem podados. A 7.x usa `OpenIddict.Quartz` (`UseQuartz()`, só documentação); as notas do 8.0 preview.5 o trocam por um `BackgroundService` dentro do `OpenIddict.Core`, com opt-out por `DisableAutomaticTokenPruning()` (livro contra hoje: os guias da 7.x falam em Quartz).

### Construir ou não? O mercado

O OpenIddict é Apache-2.0, mantido (release estável em 2026-11-14, previews do 8.0 em andamento) e um kit de ferramentas. O Duende IdentityServer é um framework comercial para o mesmo trabalho; pelas páginas de preços e FAQ, lidas em 2026-11-19: não precisa de licença para desenvolvimento, teste, trial ou projetos pessoais, e há uma Community Edition gratuita (equivalente em funcionalidades ao Standard) para empresas com fins lucrativos com menos de US$1M de receita bruta anual projetada e US$3M de acesso a capital, ou entidades sem fins lucrativos com orçamento abaixo de US$1M. Planos pagos, cobrados anualmente: Lite US$480/mês (2 Connected Apps, suporte pela comunidade, protocolo básico com PAR e DPoP), Standard US$1.042/mês (10 Connected Apps, mTLS, device flow, resource indicators, server-side sessions, SLA de 2 dias por e-mail), Advanced US$2.075/mês; no Standard, Automatic Key Management, SAML e User Management são add-ons. Preços mudam: leia a página.

O `MapIdentityApi` não é alternativa: os tokens dele são blobs do Data Protection que só o próprio app consegue usar (medido na lição de JWT). O Keycloak é o produto self-hosted medido na lição de MCP (console de admin, DCR), e o Entra ID é o gerenciado; o Auth0 não foi avaliado aqui.

| Decisão | OpenIddict | Duende IdentityServer | Produto pronto (Keycloak, Entra ID) | Escolha quando |
| --- | --- | --- | --- | --- |
| Custo | grátis, Apache-2.0; seu tempo de engenharia | Community Edition grátis abaixo dos limites, depois assinatura | Keycloak self-hosted, Entra por plano (preço não consultado) | o orçamento é gente (OpenIddict) ou licença (Duende) |
| O que você recebe | motor de protocolo, stores, validation | o mesmo mais suporte do fornecedor, add-on de chaves, DPoP, exemplos de UI | UI de login, usuários, MFA, recuperação, admin | você quer telas e MFA prontos (produto) |
| Login, MFA, recuperação | seus | seus (User Management é add-on) | incluídos | usuários precisam entrar com passkeys, MFA, SSO no dia um |
| Rotação de chaves, limpeza | procedimento manual, você agenda | add-on Automatic Key Management | gerenciado | não há time para cuidar de chaves |
| Specs novas | PAR, mTLS, device sim; DPoP não | PAR, DPoP, mTLS conforme o plano | conforme o produto | leia cada changelog antes |
| Controle de claims e fluxos | total | total | limitado aos pontos de extensão do produto | os tokens dependem do seu modelo de domínio |

Você precisa mesmo emitir tokens? Se os usuários já existem no Entra ou no Keycloak e os apps só precisam confiar neles, o AS mais barato é o que você não opera: validar tokens são algumas linhas, enquanto operar um AS significa ser dono da segurança do login, do MFA, da recuperação, da rotação de chaves, de advisories como o de cima e da evidência de conformidade.

## Trade-offs

- **Biblioteca contra produto.** O OpenIddict dá controle exato e nenhuma taxa por client, mas nada desenha um login, redefine uma senha ou exige MFA. Orce isso antes de escolhê-lo.
- **Access token criptografado contra legível.** A criptografia mantém as claims privadas e obriga introspecção ou chave compartilhada em cada API; `DisableAccessTokenEncryption()` faz o JwtBearer funcionar e expõe o payload a quem tiver o token.
- **Autocontido contra referência.** JWTs não pedem consulta e não podem ser revogados numa API com JwtBearer; tokens de referência revogam na hora mas custam uma leitura de banco por chamada.
  ```csharp
  o.UseReferenceAccessTokens();   // e proteja a coluna Payload
  ```
- **Leeway do refresh.** 30 segundos absorvem retentativas; `SetRefreshTokenReuseLeeway(TimeSpan.Zero)` é mais estrito e pune redes instáveis. `DisableRollingRefreshTokens()` remove a detecção de roubo.
- **Destinos explícitos.** Seguro por padrão (claims ausentes), mas silencioso; escreva um teste que decodifique um token e liste as claims.
- **Rotação de chaves é sua.** Um cache de JWKS velho numa API mantém uma chave aposentada viva e faz a primeira chamada depois de uma nova falhar.
- **Onde as specs param.** PAR e mTLS estão aqui; DPoP não. Confira as notas de release antes de prometer uma spec.

## Documentation Links

- [OpenIddict documentation](https://documentation.openiddict.com/) (doc)
- [Claim destinations, OpenIddict documentation](https://documentation.openiddict.com/configuration/claim-destinations) (doc)
- [Token formats, OpenIddict documentation](https://documentation.openiddict.com/configuration/token-formats) (doc)
- [Token storage, OpenIddict documentation](https://documentation.openiddict.com/configuration/token-storage) (doc)
- [Authorization storage, OpenIddict documentation](https://documentation.openiddict.com/configuration/authorization-storage) (doc)
- [Encryption and signing credentials, OpenIddict documentation](https://documentation.openiddict.com/configuration/encryption-and-signing-credentials) (doc)
- [openiddict-core, GitHub](https://github.com/openiddict/openiddict-core) (doc)
- [OpenIddict, NuGet Gallery](https://www.nuget.org/packages/OpenIddict) (doc)
- [GHSA-cxgj-hwwh-855g, OpenIddict security advisory](https://github.com/openiddict/openiddict-core/security/advisories/GHSA-cxgj-hwwh-855g) (doc)
- [Duende IdentityServer, Duende Software](https://duendesoftware.com/products/identityserver) (doc)
- [Duende pricing and licensing, Duende Software](https://duendesoftware.com/pricing) (doc)
- [RFC 6749: The OAuth 2.0 Authorization Framework, IETF](https://datatracker.ietf.org/doc/html/rfc6749) (doc)
- [RFC 7636: Proof Key for Code Exchange, IETF](https://datatracker.ietf.org/doc/html/rfc7636) (doc)
- [RFC 7009: OAuth 2.0 Token Revocation, IETF](https://datatracker.ietf.org/doc/html/rfc7009) (doc)
- [RFC 7662: OAuth 2.0 Token Introspection, IETF](https://datatracker.ietf.org/doc/html/rfc7662) (doc)
