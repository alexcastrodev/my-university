---
version: 1.0
updatedAt: 2026-10-16
title: "Tokens JWT Bearer e ASP.NET Core Identity"
summary: O que o handler JWT valida e o que deixa passar (clock skew de 5 minutos), por que as claims chegam com nomes estranhos, os tokens opacos do MapIdentityApi, o que refresh, logout e security stamp realmente revogam, passkeys no .NET 10 e onde o navegador deve guardar tokens.
---
## Objective

O conceito de fundamentos de autenticação mostrou esquemas, challenge e forbid.
Este entra nas duas opções de token que as pessoas realmente usam: uma API que
valida **access tokens JWT** emitidos por um provedor de identidade, e o
**ASP.NET Core Identity**, que guarda os usuários ele mesmo e, via
`MapIdentityApi`, pode emitir os próprios bearer tokens. O objetivo é saber o
que o handler JWT confere e o que ele deixa passar, por que as claims chegam
com nomes estranhos, o que os tokens do Identity realmente são, o que refresh e
logout revogam (e o que não revogam), onde entram as passkeys do .NET 10, e
onde um navegador deve guardar um token. Todos os status codes abaixo vieram de
requisições contra apps .NET 10 (SDK 10.0.100, pacotes 10.0.0).

## Use Cases

- Uma API chamada por SPAs, apps mobile ou outros serviços, com usuários
  gerenciados pelo Microsoft Entra ID, Keycloak, Auth0 ou outro provedor
  OpenID Connect.
- Um app pequeno com tabela de usuários própria, em que um provedor de
  identidade completo é demais e os endpoints de registro/login do Identity
  bastam.
- Revisar uma API existente: a audience é validada, o clock skew faz sentido,
  o `[Authorize(Roles = "admin")]` enxerga mesmo a claim de role?
- Decidir entre cookies e tokens para um cliente no navegador.

## Deep Dive

### O que o handler JWT bearer valida

O pacote `Microsoft.AspNetCore.Authentication.JwtBearer` valida um token vindo
do header `Authorization: Bearer`. A doc lista o que uma API precisa conferir:
assinatura, issuer, audience e expiração. O app de teste abaixo assina tokens
com uma chave RSA (só para teste: em produção o provedor de identidade guarda a
chave privada e a API baixa as chaves públicas pelos metadados da
`Authority`):

```csharp
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(o =>
    {
        // Production: o.Authority = "https://idp.example"; keys come from its metadata.
        o.MapInboundClaims = false;                 // keep "sub", "role", "name" as sent
        o.TokenValidationParameters = new TokenValidationParameters
        {
            ValidIssuer = "https://idp.example",
            ValidAudience = "orders-api",
            IssuerSigningKey = publicKey,
            NameClaimType = "name",
            RoleClaimType = "role",
            ClockSkew = TimeSpan.FromSeconds(30),   // default is 5 minutes
        };
    });

app.MapGet("/who", (ClaimsPrincipal u) =>
    $"Name={u.Identity!.Name} sub={u.FindFirstValue("sub")} admin={u.IsInRole("admin")}")
   .RequireAuthorization();
```

Com um token válido, `/who` devolveu `Name=Ana sub=user-42 admin=True`. Cada
token quebrado levou 401, e com o `IncludeErrorDetails` padrão o motivo vem no
header `WWW-Authenticate`:

```text
no token                    401  WWW-Authenticate: Bearer
audience billing-api        401  error="invalid_token", error_description="The audience 'billing-api' is invalid"
issuer https://evil.example 401  error_description="The issuer 'https://evil.example' is invalid"
signed with another key     401  error_description="The signature is invalid"
unsigned (alg none)         401  error_description="The signature is invalid"
expired 10 minutes ago      401  error_description="The token expired at '...'"
expired 2 minutes ago       200  (default ClockSkew of 5 minutes)
```

A última linha pega muita gente de surpresa: o
`TokenValidationParameters.DefaultClockSkew` é de 5 minutos, então um token é
aceito por até 5 minutos depois do `exp`. Com `ClockSkew = TimeSpan.Zero` o
mesmo token levou 401. Reduza esse valor quando os access tokens forem curtos e
os relógios dos servidores estiverem sincronizados.

### Por que as claims têm nomes estranhos

`JwtBearerOptions.MapInboundClaims` é `true` por padrão (impresso de um objeto
de opções recém-criado). Ele renomeia algumas claims do JWT para as URIs longas
do WS-Federation. O mesmo token, lido em três configurações:

```text
default (MapInboundClaims = true)
  claims: nameidentifier URI=user-42 | name=Ana | role URI=admin
  Identity.Name = null   IsInRole("admin") = True
MapInboundClaims = false
  claims: sub=user-42 | name=Ana | role=admin
  Identity.Name = null   IsInRole("admin") = False
MapInboundClaims = false + NameClaimType "name" + RoleClaimType "role"
  claims: sub=user-42 | name=Ana | role=admin
  Identity.Name = Ana    IsInRole("admin") = True
```

Nas três, são `NameClaimType` e `RoleClaimType` que decidem o que
`Identity.Name` e `IsInRole` leem, e os padrões deles são os tipos em URI.
Desligar o mapeamento sem configurá-los quebrou as checagens de role em
silêncio: todo `RequireRole("admin")` devolveria 403. O exemplo de validação
explícita da doc também usa `MapInboundClaims = false`; qualquer que seja a
escolha, configure os dois tipos de claim de acordo com os tokens do seu
provedor e teste um endpoint protegido por role.

### De onde os tokens devem vir

A doc de JWT é direta: não crie seus próprios access tokens a não ser para
testes, use sempre chaves assimétricas, e nunca gere um access token direto de
uma requisição com usuário e senha. Tokens devem vir de um fluxo OpenID Connect
ou OAuth (authorization code com PKCE para usuários, client credentials para
serviços). Um ID token prova para o cliente quem fez login e nunca deve ser
enviado para uma API. Para testes locais, `dotnet user-jwts create` emite
tokens, guarda a chave de assinatura no store de user-secrets e grava o issuer
e as audiences correspondentes no `appsettings.Development.json`.

### ASP.NET Core Identity e MapIdentityApi

O Identity é um store de usuários: hash de senha, lockout, 2FA, confirmação de
email, logins externos. `AddIdentityApiEndpoints<TUser>()` mais
`MapIdentityApi<TUser>()` o expõe como endpoints JSON. Listando o endpoint data
source do app rodando apareceram `/register`, `/login`, `/refresh`,
`/confirmEmail`, `/resendConfirmationEmail`, `/forgotPassword`,
`/resetPassword`, `/manage/2fa` e `/manage/info`. Não existe endpoint de logout;
a doc mostra como adicionar um.

```text
POST /register password "123"   400 PasswordTooShort, PasswordRequiresNonAlphanumeric, ...
POST /login wrong password      401 {"title":"Unauthorized","status":401,"detail":"Failed"}
POST /login                     200 {"tokenType":"Bearer","accessToken":"CfDJ8...","expiresIn":3600,"refreshToken":"CfDJ8..."}
POST /login?useCookies=true     200 Set-Cookie: .AspNetCore.Identity.Application=CfDJ8...
```

O access token tinha 688 caracteres e nenhum ponto: **não é um JWT**. A doc
confirma que é um token proprietário do Identity, de propósito: os endpoints
miram cenários simples e first-party e não são um servidor de tokens. O prefixo
`CfDJ8` é o cabeçalho de um payload do Data Protection do ASP.NET Core, o mesmo
mecanismo que protege o cookie, então outra API não consegue ler o token sem
compartilhar o key ring. Padrões, lidos de `BearerTokenOptions`: 1 hora para o
access token e 14 dias para o refresh token.

### O que refresh, logout e revogação realmente fazem

O mesmo app, seguindo com os tokens do primeiro login:

```text
POST /refresh with the refresh token      200 new token pair
POST /refresh with the SAME token again   200 (the old refresh token still works)
GET /me with the old access token         200
POST /logout (SignOutAsync) with bearer   200
GET /me with that access token            200 (logout revoked nothing)
UpdateSecurityStampAsync(user)            200
POST /refresh with the old refresh token  401
GET /me with the old access token         200 (valid until it expires)
```

Bearer tokens são autocontidos, então logout só faz diferença para cookies. O
refresh valida o security stamp do usuário, e essa é a alavanca de revogação:
trocar a senha ou chamar `UpdateSecurityStampAsync` mata os refresh tokens.
Access tokens já emitidos vivem até o `BearerTokenExpiration`, e é por isso que
a doc amarra a janela de sessão depois de uma mudança de segurança a esse tempo
de vida. Mantenha-o curto.

### Passkeys no .NET 10

Novidade do .NET 10, o Identity suporta passkeys (WebAuthn/FIDO2): o servidor
guarda só uma chave pública e o navegador prova que tem a chave privada, que é
amarrada ao site e por isso resiste a phishing. Segundo a doc de passkeys, só o
template Blazor Web App (com contas individuais) traz a UI, passkeys são fator
primário e não segundo fator, e o recurso é focado em autenticação, não é uma
biblioteca WebAuthn genérica. A lista de endpoints do `MapIdentityApi` acima
não tem endpoints de passkey. Configure `IdentityPasskeyOptions.ServerDomain`
ou garanta que os host headers sejam validados, porque senão o relying party ID
sai do header `Host`.

### Onde o navegador deve guardar tokens

A doc de JWT lista guardar access tokens em local storage, session storage ou
web workers como manuseio inseguro, e a doc do Identity recomenda cookies para
apps no navegador porque JavaScript não consegue ler um cookie `HttpOnly`.
Qualquer XSS lê o `localStorage` e manda o token para qualquer lugar, e um
bearer token roubado funciona de qualquer máquina. Para fronts no navegador,
prefira sessão por cookie, com um backend-for-frontend que guarda os access
tokens no servidor quando APIs downstream precisam deles. Tokens no header
`Authorization` combinam com clientes fora do navegador: apps mobile, CLIs,
outros serviços.

## Trade-offs

- **Provedor externo versus Identity.** Um provedor OIDC entrega JWTs padrão,
  SSO e um lugar só para MFA, ao custo de mais um sistema para operar ou pagar.
  O Identity mantém os usuários no seu banco, mas os tokens dele só funcionam no
  seu app.
- **Tokens autocontidos versus revogação.** JWTs e bearer tokens do Identity
  não exigem consulta por requisição e, pelo mesmo motivo, não podem ser
  revogados antes de expirar. Access tokens curtos mais refresh é o meio-termo
  usual.
  ```csharp
  builder.Services.Configure<BearerTokenOptions>(IdentityConstants.BearerScheme,
      o => o.BearerTokenExpiration = TimeSpan.FromMinutes(15));
  ```
- **Mapeamento de claims ligado ou desligado.** Mapear mantém funcionando o
  código antigo que lê `ClaimTypes.NameIdentifier`; desligar preserva os nomes
  do próprio token. Nos dois casos, configure `NameClaimType` e
  `RoleClaimType` de propósito.
- **Clock skew.** Cinco minutos escondem desvio de relógio, mas esticam a vida
  de todo token; um valor pequeno exige relógios sincronizados.
- **Cookies versus tokens no navegador.** Cookies exigem proteção contra CSRF e
  deploy no mesmo site; tokens no storage do JavaScript ficam expostos a XSS.
- **Passkeys.** Fortes e resistentes a phishing, mas a UI pronta só existe no
  template Blazor, e a recuperação de conta ainda precisa de outro método.

## Documentation Links

- [Configure JWT bearer authentication in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/authentication/configure-jwt-bearer-authentication) (doc)
- [Use Identity to secure a Web API backend for SPAs, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/authentication/identity-api-authorization) (doc)
- [Mapping, customizing, and transforming claims in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/authentication/claims) (doc)
- [Enable Web Authentication API (WebAuthn) passkeys, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/authentication/passkeys/) (doc)
- [Manage JSON Web Tokens in development with dotnet user-jwts, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/authentication/jwt-authn) (doc)
- [RFC 8725: JSON Web Token Best Current Practices, IETF](https://datatracker.ietf.org/doc/html/rfc8725) (doc)
