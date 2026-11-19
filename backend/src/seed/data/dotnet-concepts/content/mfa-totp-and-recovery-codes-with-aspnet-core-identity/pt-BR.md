---
version: 1.0
updatedAt: 2026-11-19
title: "MFA com TOTP e Recovery Codes no ASP.NET Core Identity"
summary: O segundo fator do ASP.NET Core Identity medido com UserManager e SignInManager reais (net10.0, EF Core SQLite), com um TOTP independente conferido contra os 18 vetores da RFC 6238: chave, URI otpauth e QR code (que o framework não gera), janela de relógio de cinco passos, reuso do mesmo código dentro da janela (o padrão não impede) e um provider que impede, recovery codes de uso único guardados em texto claro e o ProtectPersonalData, lockout compartilhado com a senha, os cookies do sign-in em duas etapas e do "lembrar desta máquina", o /manage/2fa do MapIdentityApi, uma política de step-up com claim mfa_at e o que os passkeys do .NET 10 são e não são.
---
## Objective

O ASP.NET Core Identity traz um segundo fator que funciona: TOTP de app autenticador, recovery codes de uso único, sign-in por cookie em duas etapas, lockout e, no `MapIdentityApi`, um endpoint `/manage/2fa`. Ele não traz QR code, proteção contra o reuso de um código dentro da janela, nem um jeito de exigir um segundo fator recente antes de uma ação sensível. Esta lição usa o `UserManager` e o `SignInManager` de verdade e mede o que acontece: o cadastro e a URI `otpauth://`, a janela de relógio, o reuso de um código (e um provider de 20 linhas que o impede), os recovery codes e como são guardados, o lockout compartilhado com a senha, os cookies do sign-in em duas etapas e do "lembrar desta máquina", os formatos de request e response do `/manage/2fa`, uma política de step-up e o que o suporte a passkeys do .NET 10 é e não é. O protocolo em si (HOTP, a matemática do TOTP, SMS, push, phishing) está em [MFA Factors: HOTP, TOTP, SMS, Push and Recovery](/identity-concepts/mfa-factors-hotp-totp-sms-push-and-recovery) e não se repete aqui.
Versions: `Microsoft.AspNetCore.Identity.EntityFrameworkCore` 10.0.15, `Microsoft.EntityFrameworkCore.Sqlite` 10.0.15, `Net.Codecrete.QrCodeGenerator` 3.2.1 (só na seção do QR), TFM `net10.0`, SDK 10.0.100 sobre o runtime compartilhado 10.0.0, SQLite. Os códigos são conferidos por um segundo TOTP independente, escrito no projeto de teste (sem código do Identity), que bate com os 18 vetores do Apêndice B da RFC 6238.

## Use Cases

- Adicionar app autenticador e recovery codes a um app que já usa Identity, com o fluxo de cookie ou com o `MapIdentityApi`.
- Depurar "o código está sempre errado": token provider não registrado, deriva de relógio, espaço no código, chave resetada.
- Endurecer os padrões: controle de códigos já usados, criptografar a chave e os recovery codes em repouso, exigir MFA recente em ações como trocar o e-mail ou mover dinheiro.
- Decidir onde os passkeys entram ao lado do TOTP no .NET 10.

## Deep Dive

### O que precisa estar registrado

O `UserManager.VerifyTwoFactorTokenAsync` procura o provider pelo nome. Só o `AddIdentityCore` não o registra:

```text
NotSupportedException: No IUserTwoFactorTokenProvider<TUser> named 'Authenticator' is registered.
```

`AddDefaultTokenProviders()` (ou `AddIdentity`, `AddDefaultIdentity`, `AddIdentityApiEndpoints`) o adiciona. O provider é o `AuthenticatorTokenProvider<TUser>`, com três métodos virtuais (`CanGenerateTwoFactorTokenAsync`, `GenerateAsync`, `ValidateAsync`). A classe por baixo dele, `Rfc6238AuthenticationService`, não é pública: dá para trocar o provider, mas não para chamar a matemática direto. `TokenOptions.DefaultAuthenticatorProvider` é a string `"Authenticator"`.

### Cadastro: chave, URI e QR code

```csharp
string? key = await um.GetAuthenticatorKeyAsync(user);          // null até o primeiro reset
if (key is null) { await um.ResetAuthenticatorKeyAsync(user); key = await um.GetAuthenticatorKeyAsync(user); }
// mostre a chave e o QR; depois que o usuário digitar um código válido:
if (await um.VerifyTwoFactorTokenAsync(user, TokenOptions.DefaultAuthenticatorProvider, code))
    await um.SetTwoFactorEnabledAsync(user, true);
```

```text
key before reset: null
key after reset: 32 chars, decodes to 20 bytes, stamp changed: True
AspNetUserTokens row: [AspNetUserStore] | AuthenticatorKey | PZ5EV2KDKJNRRIWYNDM745DII475MAQS
TwoFactorEnabled right after reset: False
```

A chave tem 160 bits em base32 e fica numa linha de `AspNetUserTokens`, em texto claro por padrão. Resetar a chave muda o security stamp e não liga o 2FA: ligar é um `SetTwoFactorEnabledAsync` separado, depois que o usuário prova que o app funciona.

O framework não tem gerador de QR. O template Blazor Web App monta a string `otpauth://totp/{issuer}:{email}?secret={key}&issuer={issuer}&digits=6` e deixa um aviso que aponta para a documentação; a documentação adiciona uma biblioteca (`Net.Codecrete.QrCodeGenerator` no Blazor, `qrcode.js` no Razor Pages e no MVC). O issuer do template é o literal `Microsoft.AspNetCore.Identity.UI`, que é o que o usuário vê no app até você trocar. Com um issuer de verdade:

```text
otpauth://totp/Example%20Corp:alice@example.org?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=Example%20Corp&digits=6
QrCode.EncodeText(uri, QrCode.Ecc.Medium): version 7, 45x45 modules, SVG of 4792 chars
```

Acrescentar `algorithm=SHA1&digits=6&period=30` e escapar o `@` levou o QR à versão 8. Escanear não foi testado aqui (sem câmera); o QR é só um bitmap dessa string. O template tira espaços e hífens do código digitado antes de verificar, porque a biblioteca não tira: `799 664` devolveu `False` no `VerifyTwoFactorTokenAsync`.

### A janela de relógio (medido)

O servidor foi mantido 15 s dentro de um passo de 30 s, e o TOTP independente gerou códigos para um celular adiantado ou atrasado:

```text
phone ahead(+)/behind(-) by whole steps: -4:no -3:no -2:ok -1:ok 0:ok +1:ok +2:ok +3:no +4:no
phone clock off by seconds: 0s:ok +30s:ok +60s:ok +70s:ok +80s:no +90s:no -30s:ok -60s:ok -70s:ok -80s:no -90s:no
```

O Identity aceita o passo atual e dois de cada lado, cinco no total, então um código vive cerca de 2,5 minutos. A lição neutra recomenda um passo de cada lado; aqui a chance de acertar por palpite é de 5 em um milhão por tentativa, em vez de 3, o que faz do lockout abaixo o freio de verdade. A janela não é uma opção (o serviço é interno): para ter um passo só, você escreve o provider.

### Reuso de um código: o padrão não impede (medido)

```text
same code three times: True True True
the code from 2 steps ago: True (it has been valid for ~105 s already)
```

Pelo fluxo de cookie, um código usado para entrar funcionou de novo num sign-in novo segundos depois (`2fa SAME code again  Succeeded`). A documentação avisa ("o usuário pode digitar o código várias vezes e autenticar com sucesso antes de ele expirar"). Um código capturado por phishing ou visto por cima do ombro vale, portanto, pela janela inteira. A correção é um provider que lembra os códigos gastos:

```csharp
public class ReplaySafeAuthenticatorProvider<TUser>(IMemoryCache cache) : AuthenticatorTokenProvider<TUser> where TUser : class
{
    static readonly object Gate = new();
    public override async Task<bool> ValidateAsync(string purpose, string token, UserManager<TUser> m, TUser user)
    {
        if (!await base.ValidateAsync(purpose, token, m, user)) return false;
        string key = $"totp:{await m.GetUserIdAsync(user)}:{token}";
        lock (Gate) { if (cache.TryGetValue(key, out _)) return false; cache.Set(key, true, TimeSpan.FromMinutes(3)); return true; }
    }
}
// no identity builder: .AddTokenProvider<ReplaySafeAuthenticatorProvider<IdentityUser>>(TokenOptions.DefaultAuthenticatorProvider)
```

```text
replay-safe: first use=True, same code again=False, previous step's code (never used)=True, wrong code=False
another user, same time: True
cookie flow: 2fa SAME code again  Failed
```

Três minutos cobrem a janela de cinco passos. É um teto: o `IMemoryCache` é por instância e o lock é por processo, então atrás de um balanceador use um cache distribuído ou uma coluna `LastUsedStep` com atualização condicional. O provider também não rejeita um passo mais antigo que nunca foi usado; rastrear o último passo aceito (como na lição neutra) exige a matemática que o Identity mantém interna.

### O sign-in por cookie em duas etapas (medido)

```csharp
var r = await sm.PasswordSignInAsync(email, password, isPersistent: false, lockoutOnFailure: true);   // RequiresTwoFactor
var user = await sm.GetTwoFactorAuthenticationUserAsync();                                            // vem do cookie
var s = await sm.TwoFactorAuthenticatorSignInAsync(code, isPersistent: false, rememberClient: false);
// caminho de recuperação: sm.TwoFactorRecoveryCodeSignInAsync(recoveryCode)
```

```text
login wrong password           Failed
login right password           RequiresTwoFactor   Set-Cookie: Identity.TwoFactorUserId (session, samesite=lax, httponly)
whoami (half-logged-in)        401
2fa wrong code                 Failed
2fa right code                 Succeeded   Set-Cookie: Identity.TwoFactorUserId (deleted); .AspNetCore.Identity.Application (session, samesite=lax, httponly)
whoami after 2fa               claims: name, amr=mfa
```

Depois da senha não há principal autenticado, só o cookie `Identity.TwoFactorUserId` (protegido, de sessão, `HttpOnly`) que nomeia o usuário. O `TwoFactorAuthenticatorSignInAsync` precisa desse cookie: sem ele, `GetTwoFactorAuthenticationUserAsync()` é `null` e a chamada devolve `Failed`. O `SignInManager` padrão grava o `amr`: `pwd` depois de um sign-in com senha e `mfa` depois do segundo fator (inclusive com recovery code). O artigo de MFA do Learn ainda monta essa claim à mão com uma claims factory; no 10.0.15 o `SignInManager` já faz isso.

### O lockout é compartilhado com a senha (medido)

```text
login right password   RequiresTwoFactor
2fa wrong code #1..#4  Failed
2fa wrong code #5      LockedOut      lockout end 12:49:23, now 12:44:23
2fa RIGHT code now     LockedOut
login right password   LockedOut
-- 3 senhas erradas, depois a certa, depois códigos errados:
2fa wrong code #1      Failed
2fa wrong code #2      LockedOut      (3 + 2 = 5)
```

Cinco falhas em 5 minutos (os padrões do `LockoutOptions`, conferidos no código) bloqueiam a conta por 5 minutos, e um código correto não ajuda enquanto está bloqueada. O contador é um só: falhas de senha e de código se somam, e uma senha correta que só chega a `RequiresTwoFactor` não zera. Só um sucesso completo zera. Isso faz da força bruta de um código de seis dígitos um jogo de 5 tentativas por janela, mas também deixa qualquer um que saiba o e-mail bloquear a conta (a lição neutra discute atrasos crescentes contra bloqueio).

### Recovery codes: uso único, guardados em texto claro

```text
generated 10: D4C89-79PBP WP9FB-2CJD8 TRMFD-TGY7J ...; length 11; characters seen: -23456789BCDFGHJKMNPQRTVWXY
AspNetUserTokens: RecoveryCodes | D4C89-79PBP;WP9FB-2CJD8;TRMFD-TGY7J;F69N... | length 119
redeem #0: True; redeem #0 again: False [RecoveryCodeRedemptionFailed]; left=9
redeem #1 in lower case: False; with spaces around: False
after regenerating: old code #2 redeems? False; new code redeems? True
cookie flow: recovery code #0 Succeeded (amr=mfa); #0 again Failed
```

`GenerateNewTwoFactorRecoveryCodesAsync(user, 10)` devolve os códigos uma vez, e o Identity os guarda numa única linha de `AspNetUserTokens`, unidos por `;`, legíveis. Resgatar remove o código da string (uso único), a comparação é exata (maiúsculas e espaços importam, então normalize na sua UI como o template faz), e gerar um conjunto novo invalida o antigo. Resgatar não mexe na chave do TOTP nem no security stamp. A lição neutra manda guardar hash dos recovery codes; o Identity não guarda. Se o banco vazar, vazam os códigos e a chave do TOTP.

### Criptografando a chave e os códigos em repouso (medido)

`Stores.ProtectPersonalData = true` mais `AddPersonalDataProtection<TProtector, TKeyRing>()` faz o store do EF proteger as colunas de dados pessoais e os valores dos tokens. Com um protector de demonstração propositalmente falso (base64, só um substituto, nunca use):

```text
AspNetUserTokens: AuthenticatorKey | k1:ENC:N1A0T... ; RecoveryCodes | k1:ENC:VkszN...
AspNetUsers.Email: k1:ENC:ZGFuQ...
TOTP still verifies through the store: True
```

Os dois segredos passaram pelo protector e a verificação continuou funcionando. Um protector de verdade criptografa com uma chave vinda de um cofre (veja [segredos e managed identities](secrets-and-managed-identities-key-vault-and-workload-identity)); proteger o `Email` também impede de consultá-lo em SQL.

### "Lembrar desta máquina" (medido)

```text
2fa with rememberClient=true   Succeeded   Set-Cookie: Identity.TwoFactorRememberMe (expires in 14 d, samesite=lax, httponly)
login again (same jar)         Succeeded   (no second factor asked)   claims: name, amr=pwd
-- lado do servidor: ResetAuthenticatorKeyAsync (o security stamp muda)
login after stamp change       RequiresTwoFactor
```

`rememberClient: true` grava um cookie `Identity.TwoFactorRememberMe` de 14 dias, preso ao usuário e ao security stamp. Enquanto vale, só a senha entra e o `amr` é `pwd`, não `mfa`, então uma política de step-up enxerga a diferença. Uma troca de stamp (resetar a chave, trocar a senha) o invalida. Com o intervalo padrão de validação do stamp de 30 minutos (conferido no código), uma sessão já aberta continua funcionando até a próxima renovação.

### MapIdentityApi: `/manage/2fa` (medido)

A lista de endpoints do .NET 10 tem `POST /manage/2fa` e nenhum `GET`, nenhum endpoint de passkey, nenhum logout. Os corpos:

```text
POST /manage/2fa {} (bearer)        200 {"sharedKey":"GLO5...YB7B","recoveryCodesLeft":0,"recoveryCodes":null,"isTwoFactorEnabled":false,"isMachineRemembered":false}
  enable, wrong code        400 errors.InvalidTwoFactorCode: "The 2fa token provided by the request was invalid. A valid 2fa token is required to enable 2fa."
  enable, no code           400 errors.RequiresTwoFactor
POST {"enable":true,"twoFactorCode":"<totp>"}   200 recoveryCodesLeft 10, recoveryCodes ["XNQR7-4YRPF", ...], isTwoFactorEnabled true
POST {}                              200 recoveryCodes null (mostrados uma vez)
POST /login (password only)          401 {"title":"Unauthorized","detail":"RequiresTwoFactor"}
POST /login + "twoFactorCode"        200 {tokenType, accessToken, expiresIn, refreshToken}
POST /login + "twoFactorRecoveryCode"  200; o mesmo código de novo 401 "Failed"
POST {"resetRecoveryCodes":true}     200 10 códigos novos; um código antigo então 401
POST {"resetSharedKey":true}         200 novo sharedKey, isTwoFactorEnabled false
```

O segundo fator viaja na mesma requisição de `/login`, não numa segunda chamada. O `resetSharedKey` desliga o 2FA do usuário (a documentação diz) e o login seguinte só com senha devolveu `200`: um cliente que reseta a chave sem religar rebaixa a conta em silêncio, e os recovery codes antigos continuam (`recoveryCodesLeft` ficou em 10). O `forgetMachine` é uma operação de cookie e não tem efeito sobre tokens (documentação). Mais três medições: o mesmo código usado para ligar o 2FA foi aceito um instante depois pelo `/login` (reuso de novo); seis códigos errados com a senha certa deram `Failed` x4, depois `LockedOut`, depois `LockedOut` até com o código certo; e um access token emitido antes de ligar o 2FA continuou devolvendo `200` num endpoint protegido depois, porque o handler de bearer token não olha o stamp. O refresh token não sobreviveu: `POST /refresh` com um token emitido antes de ligar o 2FA devolveu `401`: o reset de chave que inicia o cadastro muda o security stamp (medido acima), e o `/refresh` rejeita um token cujo stamp não bate mais. Depois de ligar o 2FA, portanto, um access token antigo vive até expirar (uma hora por padrão), e nada mais sobrevive.

### Step-up: exigir um segundo fator recente

O Identity dá o `amr` e nenhum timestamp. O `IssuedUtc` do cookie não serve de substituto: com `SlidingExpiration` ele é reiniciado na renovação (medido: idade de 6,1 s e depois 3,1 s quando o cookie foi reemitido), então mede atividade, não o último MFA. Um requirement próprio lê duas claims gravadas no momento do segundo fator:

```csharp
await sm.SignInWithClaimsAsync(user, false, [new Claim("amr", "mfa"), new Claim("mfa_at", now.ToString())]);   // depois do VerifyTwoFactorTokenAsync

public class RecentMfaHandler(TimeProvider clock) : AuthorizationHandler<RecentMfaRequirement>
{
    protected override Task HandleRequirementAsync(AuthorizationHandlerContext c, RecentMfaRequirement r)
    {
        bool ok = c.User.HasClaim("amr", "mfa") && long.TryParse(c.User.FindFirstValue("mfa_at"), out long at)
                  && clock.GetUtcNow() - DateTimeOffset.FromUnixTimeSeconds(at) <= r.MaxAge;
        if (ok) c.Succeed(r); else c.Fail(new AuthorizationFailureReason(this, "step_up_required"));
        return Task.CompletedTask;
    }
}   // um IAuthorizationMiddlewareResultHandler transforma esse motivo em 401 + WWW-Authenticate
```

```text
sensitive right after stock 2fa       401  (amr=mfa mas sem mfa_at)
sensitive right after 2fa-stamped     200
sensitive 6 s later (limit 5 s)       401  WWW-Authenticate: Identity error="insufficient_user_authentication", max_age=300
stepup wrong code                     401 {"stepUp":"failed"}
stepup right code                     200, mfa_at renovado, sensitive 200
password-only session (half-logged)   401
```

O `401` com `insufficient_user_authentication` e `max_age` segue a RFC 9470 (só documentação para a RFC; o header foi apenas escrito e lido de volta aqui). O endpoint de step-up precisa contar as falhas (`AccessFailedAsync`), senão vira um oráculo de palpites de graça. Uma armadilha, medida: quando o security stamp é revalidado, o Identity reconstrói o principal e descarta as claims extras.

```text
security stamp refresh every 3 s, default:    whoami +0 s: amr=mfa mfa_at=...; +4 s: só name (claims sumiram); sensitive 401
same, OnRefreshingPrincipal copies amr/mfa_at: +4 s: amr=mfa mfa_at=... mantidas; sensitive 200
```

Por padrão a renovação roda a cada 30 minutos, então uma política baseada em claims falha para uma sessão que dure mais que isso, a não ser que o `SecurityStampValidatorOptions.OnRefreshingPrincipal` carregue as claims, como na segunda execução.

### Passkeys no .NET 10 (tipos medidos, fluxo só na documentação)

Os pacotes do Identity 10.0.x contêm a API de passkeys: o `SignInManager` tem `MakePasskeyCreationOptionsAsync`, `PerformPasskeyAttestationAsync`, `MakePasskeyRequestOptionsAsync`, `PerformPasskeyAssertionAsync` e `PasskeySignInAsync`; o `UserManager` tem `AddOrUpdatePasskeyAsync`, `GetPasskeysAsync`, `FindByPasskeyIdAsync` e `RemovePasskeyAsync`; o `IdentityPasskeyOptions` se configura com `Configure<IdentityPasskeyOptions>`. Padrões medidos: timeout de 5 min, challenge de 32 bytes, `ServerDomain` nulo, verificação de usuário `required`, resident key `preferred`.

O armazenamento é opt-in: com o schema padrão não há tabela de passkeys, e com `Stores.SchemaVersion = IdentitySchemaVersions.Version3` o modelo ganhou `AspNetUserPasskeys (CredentialId, UserId, Data)`. As cerimônias de registro e de sign-in precisam de um autenticador no navegador, então não foram executadas; a documentação diz o que esperar. Segundo o artigo de passkeys do Learn: só o template Blazor Web App tem a UI, não há endpoints no `MapIdentityApi`, não há validação de attestation por padrão, e passkeys são um fator primário, não um segundo ("no built-in 2FA support"), embora o artigo de MFA do Learn diga que passkeys podem servir a fluxos de MFA. Com `ServerDomain` nulo, o relying party ID vem do header `Host`, então valide os hosts. Leitura prática: mantenha TOTP e recovery codes como segundo fator para contas com senha, e trate o passkey como um jeito de substituir a senha.

## Trade-offs

- **Padrões do TOTP vs endurecimento.** De fábrica: janela de cinco passos, códigos reutilizáveis, chave e recovery codes em texto claro. Cada correção é pequena (um provider, um protector) e nenhuma vem ligada. Exemplo: sem o provider acima, um código capturado entra de novo por cerca de 2,5 minutos.
- **Cache de replay vs banco.** O `IMemoryCache` é simples e errado entre instâncias; uma coluna de último passo por usuário resolve e custa uma escrita por login.
- **Lockout vs negação de serviço.** Contar as falhas em conjunto limita o palpite a cinco tentativas, mas deixa um estranho bloquear a conta do usuário. Atrasos ou limites por IP suavizam.
- **Lembrar desta máquina.** Menos prompts, mas por 14 dias a conta vale o que vale o cookie, e o `amr` fica `pwd`. Ações sensíveis devem pedir step-up de qualquer jeito.
- **Claims de step-up próprias vs provedor de identidade.** Um `mfa_at` próprio é rápido, mas precisa sobreviver à renovação do stamp. Com Entra ID ou OpenIddict, peça `acr_values` ou `max_age` e leia `amr` e `auth_time` do token ([clientes OAuth](oauth-2-clients-in-dotnet-code-pkce-client-credentials-and-device-flow), [OpenIddict](building-an-authorization-server-with-openiddict)).
- **`MapIdentityApi` para 2FA.** Conveniente, mas o `resetSharedKey` desliga o 2FA, um access token antigo continua valendo até expirar, e não há GET para ler o estado. Embrulhe ou troque para algo além de um protótipo.
- **Passkeys vs TOTP.** Passkeys resistem a phishing, TOTP não ([ameaças](/identity-concepts/identity-threats-aitm-phishing-consent-phishing-and-recovery)), mas o suporte do .NET 10 é só de fator primário e exige o schema versão 3.

## Documentation Links

- [Enable QR code generation for TOTP authenticator apps in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/authentication/identity-enable-qrcodes) (doc)
- [Enable QR code generation for TOTP authenticator apps in a Blazor Web App, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/security/qrcodes-for-authenticator-apps) (doc)
- [Multi-factor authentication in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/authentication/mfa) (doc)
- [Identity API endpoints (MapIdentityApi), Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/authentication/identity-api-authorization) (doc)
- [Enable WebAuthn passkeys in ASP.NET Core Identity, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/authentication/passkeys/) (doc)
- [Configure ASP.NET Core Identity (lockout and token options), Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/authentication/identity-configuration) (doc)
- [Policy-based authorization in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/authorization/policies) (doc)
- [RFC 6238, TOTP: Time-Based One-Time Password Algorithm, IETF](https://datatracker.ietf.org/doc/html/rfc6238) (doc)
- [RFC 9470, OAuth 2.0 Step Up Authentication Challenge Protocol, IETF](https://datatracker.ietf.org/doc/html/rfc9470) (doc)
- [RFC 8176, Authentication Method Reference Values, IETF](https://datatracker.ietf.org/doc/html/rfc8176) (doc)
- [Key Uri Format, Google Authenticator wiki](https://github.com/google/google-authenticator/wiki/Key-Uri-Format) (doc)
- [QrCodeGenerator for .NET, GitHub](https://github.com/manuelbl/QrCodeGenerator) (doc)
