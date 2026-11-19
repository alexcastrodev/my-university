---
version: 1.0
updatedAt: 2026-11-19
---
## Objective

ASP.NET Core Identity ships a working second factor: an authenticator-app TOTP, single-use recovery codes, a two-step cookie sign-in, lockout and, in `MapIdentityApi`, a `/manage/2fa` endpoint. It does not ship a QR code, protection against reusing a code inside its window, or a way to ask for a fresh second factor before a sensitive action. This lesson drives the real `UserManager` and `SignInManager` and measures what happens: enrollment and the `otpauth://` URI, the clock window, reuse of a code (and a 20-line provider that stops it), recovery codes and how they are stored, lockout shared with the password, the cookies of the two-step sign-in and "remember this machine", the `/manage/2fa` request and response shapes, a step-up policy, and what the .NET 10 passkey support is and is not. The protocol itself (HOTP, TOTP math, SMS, push, phishing) is in [MFA Factors: HOTP, TOTP, SMS, Push and Recovery](/identity-concepts/mfa-factors-hotp-totp-sms-push-and-recovery) and is not repeated here.
Versions: `Microsoft.AspNetCore.Identity.EntityFrameworkCore` 10.0.15, `Microsoft.EntityFrameworkCore.Sqlite` 10.0.15, `Net.Codecrete.QrCodeGenerator` 3.2.1 (QR section only), TFM `net10.0`, SDK 10.0.100 on the 10.0.0 shared runtime, SQLite. The codes are checked by a second, independent TOTP written in the test project (no Identity code), which matches the 18 RFC 6238 Appendix B vectors.

## Use Cases

- Adding an authenticator app and recovery codes to an app that already uses Identity, with the cookie flow or with `MapIdentityApi`.
- Debugging "the code is always wrong": missing token providers, clock drift, a space in the code, a reset key.
- Hardening the defaults: spent-code tracking, encrypting the key and the recovery codes at rest, a fresh-MFA requirement for actions like changing the e-mail or moving money.
- Deciding where passkeys fit next to TOTP in .NET 10.

## Deep Dive

### What must be registered

`UserManager.VerifyTwoFactorTokenAsync` finds the provider by name. `AddIdentityCore` alone does not register it:

```text
NotSupportedException: No IUserTwoFactorTokenProvider<TUser> named 'Authenticator' is registered.
```

`AddDefaultTokenProviders()` (or `AddIdentity`, `AddDefaultIdentity`, `AddIdentityApiEndpoints`) adds it. The provider is `AuthenticatorTokenProvider<TUser>`, with three virtual methods (`CanGenerateTwoFactorTokenAsync`, `GenerateAsync`, `ValidateAsync`). The class under it, `Rfc6238AuthenticationService`, is not public, so you can replace the provider but not call the math directly. `TokenOptions.DefaultAuthenticatorProvider` is the string `"Authenticator"`.

### Enrollment: key, URI and QR code

```csharp
string? key = await um.GetAuthenticatorKeyAsync(user);          // null until a reset
if (key is null) { await um.ResetAuthenticatorKeyAsync(user); key = await um.GetAuthenticatorKeyAsync(user); }
// show the key and the QR; after the user types a valid code:
if (await um.VerifyTwoFactorTokenAsync(user, TokenOptions.DefaultAuthenticatorProvider, code))
    await um.SetTwoFactorEnabledAsync(user, true);
```

```text
key before reset: null
key after reset: 32 chars, decodes to 20 bytes, stamp changed: True
AspNetUserTokens row: [AspNetUserStore] | AuthenticatorKey | PZ5EV2KDKJNRRIWYNDM745DII475MAQS
TwoFactorEnabled right after reset: False
```

The key is 160 bits in base32, kept as a row of `AspNetUserTokens`, in clear text by default. Resetting it changes the security stamp and does not enable 2FA: enabling is a separate `SetTwoFactorEnabledAsync`, after the user proves the app works.

The framework has no QR generator. The Blazor Web App template builds the string `otpauth://totp/{issuer}:{email}?secret={key}&issuer={issuer}&digits=6` and leaves a notice that links to the docs; the docs add a library (`Net.Codecrete.QrCodeGenerator` for Blazor, `qrcode.js` for Razor Pages and MVC). The template's issuer is the literal `Microsoft.AspNetCore.Identity.UI`, which is what the user sees in the app until you change it. With a real issuer:

```text
otpauth://totp/Example%20Corp:alice@example.org?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=Example%20Corp&digits=6
QrCode.EncodeText(uri, QrCode.Ecc.Medium): version 7, 45x45 modules, SVG of 4792 chars
```

Adding `algorithm=SHA1&digits=6&period=30` and escaping the `@` grew it to version 8. Scanning was not tested here (no camera); a QR is only a bitmap of that string. The template strips spaces and hyphens from the typed code before verifying, because the library does not: `799 664` returned `False` from `VerifyTwoFactorTokenAsync`.

### The clock window (measured)

The server was held 15 s into a 30 s step and the independent TOTP generated codes for a phone ahead or behind:

```text
phone ahead(+)/behind(-) by whole steps: -4:no -3:no -2:ok -1:ok 0:ok +1:ok +2:ok +3:no +4:no
phone clock off by seconds: 0s:ok +30s:ok +60s:ok +70s:ok +80s:no +90s:no -30s:ok -60s:ok -70s:ok -80s:no -90s:no
```

Identity accepts the current step and two on each side, five steps in all, so a code lives for roughly 2.5 minutes. The neutral lesson recommends one step on each side; here the guess odds per attempt are 5 in a million instead of 3, which makes the lockout below the real brake. The window is not an option (the service is internal): if you want one step, you write the provider.

### Reuse of a code: the default does not stop it (measured)

```text
same code three times: True True True
the code from 2 steps ago: True (it has been valid for ~105 s already)
```

Through the cookie flow, a code used to sign in worked again on a fresh sign-in seconds later (`2fa SAME code again  Succeeded`). The docs warn about it ("the user can enter the code multiple times and authenticate successfully before it expires"). A phished or shoulder-surfed code is therefore good for the whole window. The fix is a provider that remembers spent codes:

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
// identity builder: .AddTokenProvider<ReplaySafeAuthenticatorProvider<IdentityUser>>(TokenOptions.DefaultAuthenticatorProvider)
```

```text
replay-safe: first use=True, same code again=False, previous step's code (never used)=True, wrong code=False
another user, same time: True
cookie flow: 2fa SAME code again  Failed
```

Three minutes covers the five-step window. It is a ceiling: `IMemoryCache` is per instance and the lock is per process, so behind a load balancer use a distributed cache or a `LastUsedStep` column with a conditional update. The provider also does not reject an older, never-used step; tracking the last accepted step (as in the neutral lesson) needs the math that Identity keeps internal.

### The two-step cookie sign-in (measured)

```csharp
var r = await sm.PasswordSignInAsync(email, password, isPersistent: false, lockoutOnFailure: true);   // RequiresTwoFactor
var user = await sm.GetTwoFactorAuthenticationUserAsync();                                            // from the cookie
var s = await sm.TwoFactorAuthenticatorSignInAsync(code, isPersistent: false, rememberClient: false);
// recovery path: sm.TwoFactorRecoveryCodeSignInAsync(recoveryCode)
```

```text
login wrong password           Failed
login right password           RequiresTwoFactor   Set-Cookie: Identity.TwoFactorUserId (session, samesite=lax, httponly)
whoami (half-logged-in)        401
2fa wrong code                 Failed
2fa right code                 Succeeded   Set-Cookie: Identity.TwoFactorUserId (deleted); .AspNetCore.Identity.Application (session, samesite=lax, httponly)
whoami after 2fa               claims: name, amr=mfa
```

After the password, there is no authenticated principal, only the `Identity.TwoFactorUserId` cookie (protected, session, `HttpOnly`) naming the user. `TwoFactorAuthenticatorSignInAsync` needs that cookie: without it, `GetTwoFactorAuthenticationUserAsync()` is `null` and the call returns `Failed`. The stock `SignInManager` stamps `amr`: `pwd` after a password sign-in and `mfa` after the second factor (including a recovery code). The Learn MFA article still builds that claim by hand with a claims factory; on 10.0.15 the `SignInManager` already does it.

### Lockout is shared with the password (measured)

```text
login right password   RequiresTwoFactor
2fa wrong code #1..#4  Failed
2fa wrong code #5      LockedOut      lockout end 12:49:23, now 12:44:23
2fa RIGHT code now     LockedOut
login right password   LockedOut
-- 3 wrong passwords, then the right one, then wrong codes:
2fa wrong code #1      Failed
2fa wrong code #2      LockedOut      (3 + 2 = 5)
```

Five failures in 5 minutes (the `LockoutOptions` defaults, checked in code) lock the account for 5 minutes, and a correct code does not help while locked. The counter is one: password failures and code failures add up, and a correct password that only reaches `RequiresTwoFactor` does not reset it. Only a full success does. That makes brute force of a six-digit code a 5-attempts-per-window game, but also lets anyone who knows the e-mail lock the account out (the neutral lesson discusses delays against lockout).

### Recovery codes: single use, stored in clear

```text
generated 10: D4C89-79PBP WP9FB-2CJD8 TRMFD-TGY7J ...; length 11; characters seen: -23456789BCDFGHJKMNPQRTVWXY
AspNetUserTokens: RecoveryCodes | D4C89-79PBP;WP9FB-2CJD8;TRMFD-TGY7J;F69N... | length 119
redeem #0: True; redeem #0 again: False [RecoveryCodeRedemptionFailed]; left=9
redeem #1 in lower case: False; with spaces around: False
after regenerating: old code #2 redeems? False; new code redeems? True
cookie flow: recovery code #0 Succeeded (amr=mfa); #0 again Failed
```

`GenerateNewTwoFactorRecoveryCodesAsync(user, 10)` returns the codes once, and Identity stores them in one `AspNetUserTokens` row, joined by `;`, readable. Redeeming removes the code from the string (single use), the match is exact (case and spaces matter, so normalize in your UI as the template does), and generating a new set invalidates the old one. Redeeming does not touch the TOTP key or the security stamp. The neutral lesson says to hash recovery codes; Identity does not. If the database leaks, so do the codes and the TOTP key.

### Encrypting the key and the codes at rest (measured)

`Stores.ProtectPersonalData = true` plus `AddPersonalDataProtection<TProtector, TKeyRing>()` makes the EF store protect personal-data columns and the token values. With a deliberately fake demo protector (base64, a stand-in only, never use it):

```text
AspNetUserTokens: AuthenticatorKey | k1:ENC:N1A0T... ; RecoveryCodes | k1:ENC:VkszN...
AspNetUsers.Email: k1:ENC:ZGFuQ...
TOTP still verifies through the store: True
```

Both secrets went through the protector, and verification kept working. A real protector encrypts with a key from a vault (see [secrets and managed identities](secrets-and-managed-identities-key-vault-and-workload-identity)); protecting `Email` also stops querying it in SQL.

### "Remember this machine" (measured)

```text
2fa with rememberClient=true   Succeeded   Set-Cookie: Identity.TwoFactorRememberMe (expires in 14 d, samesite=lax, httponly)
login again (same jar)         Succeeded   (no second factor asked)   claims: name, amr=pwd
-- server side: ResetAuthenticatorKeyAsync (security stamp changes)
login after stamp change       RequiresTwoFactor
```

`rememberClient: true` writes a 14-day `Identity.TwoFactorRememberMe` cookie bound to the user and the security stamp. While valid, the password alone signs in and `amr` is `pwd`, not `mfa`, so a step-up policy sees the difference. A stamp change (resetting the key, changing the password) invalidates it. With the default stamp validation interval of 30 minutes (checked in code), an already signed-in session keeps working until the next refresh.

### MapIdentityApi: `/manage/2fa` (measured)

The .NET 10 endpoint list has `POST /manage/2fa` and no `GET`, no passkey endpoints, no logout. The bodies:

```text
POST /manage/2fa {} (bearer)        200 {"sharedKey":"GLO5...YB7B","recoveryCodesLeft":0,"recoveryCodes":null,"isTwoFactorEnabled":false,"isMachineRemembered":false}
  enable, wrong code        400 errors.InvalidTwoFactorCode: "The 2fa token provided by the request was invalid. A valid 2fa token is required to enable 2fa."
  enable, no code           400 errors.RequiresTwoFactor
POST {"enable":true,"twoFactorCode":"<totp>"}   200 recoveryCodesLeft 10, recoveryCodes ["XNQR7-4YRPF", ...], isTwoFactorEnabled true
POST {}                              200 recoveryCodes null (shown once)
POST /login (password only)          401 {"title":"Unauthorized","detail":"RequiresTwoFactor"}
POST /login + "twoFactorCode"        200 {tokenType, accessToken, expiresIn, refreshToken}
POST /login + "twoFactorRecoveryCode"  200; the same code again 401 "Failed"
POST {"resetRecoveryCodes":true}     200 10 new codes; an old code then 401
POST {"resetSharedKey":true}         200 new sharedKey, isTwoFactorEnabled false
```

The second factor travels in the same `/login` request, not in a second call. `resetSharedKey` turns 2FA off for the user (the docs say so) and the next password-only login returned `200`: a client that resets the key without re-enabling it silently downgrades the account, and the old recovery codes stay (`recoveryCodesLeft` stayed 10). `forgetMachine` is a cookie operation with no effect on tokens (docs). Three more measurements: the same code used to enable 2FA was accepted a moment later by `/login` (reuse again); six wrong codes with the right password gave `Failed` x4, then `LockedOut`, then `LockedOut` even for the right code; and a bearer access token issued before enabling 2FA still returned `200` on a protected endpoint afterwards, because the bearer token handler does not look at the stamp. The refresh token did not survive: `POST /refresh` with a token issued before enabling 2FA returned `401`: the key reset that starts enrollment changes the security stamp (measured above), and `/refresh` rejects a token whose stamp no longer matches. So after enabling 2FA an old access token lives until it expires (one hour by default), and nothing else carries over.

### Step-up: demanding a recent second factor

Identity gives you `amr` and no timestamp. The cookie's `IssuedUtc` is not a substitute: with `SlidingExpiration` it resets on renewal (measured: age 6.1 s, then 3.1 s after the cookie was reissued), so it measures activity, not the last MFA. A custom requirement reads two claims written at the moment of the second factor:

```csharp
await sm.SignInWithClaimsAsync(user, false, [new Claim("amr", "mfa"), new Claim("mfa_at", now.ToString())]);   // after VerifyTwoFactorTokenAsync

public class RecentMfaHandler(TimeProvider clock) : AuthorizationHandler<RecentMfaRequirement>
{
    protected override Task HandleRequirementAsync(AuthorizationHandlerContext c, RecentMfaRequirement r)
    {
        bool ok = c.User.HasClaim("amr", "mfa") && long.TryParse(c.User.FindFirstValue("mfa_at"), out long at)
                  && clock.GetUtcNow() - DateTimeOffset.FromUnixTimeSeconds(at) <= r.MaxAge;
        if (ok) c.Succeed(r); else c.Fail(new AuthorizationFailureReason(this, "step_up_required"));
        return Task.CompletedTask;
    }
}   // an IAuthorizationMiddlewareResultHandler turns that reason into 401 + WWW-Authenticate
```

```text
sensitive right after stock 2fa       401  (amr=mfa but no mfa_at)
sensitive right after 2fa-stamped     200
sensitive 6 s later (limit 5 s)       401  WWW-Authenticate: Identity error="insufficient_user_authentication", max_age=300
stepup wrong code                     401 {"stepUp":"failed"}
stepup right code                     200, mfa_at renewed, sensitive 200
password-only session (half-logged)   401
```

The `401` with `insufficient_user_authentication` and `max_age` follows RFC 9470 (docs only for the RFC, the header was only written and read back here). The step-up endpoint must count failures (`AccessFailedAsync`) or it is a free guessing oracle. One trap, measured: when the security stamp is revalidated, Identity rebuilds the principal and drops the extra claims.

```text
security stamp refresh every 3 s, default:    whoami +0 s: amr=mfa mfa_at=...; +4 s: only name (claims gone); sensitive 401
same, OnRefreshingPrincipal copies amr/mfa_at: +4 s: amr=mfa mfa_at=... kept; sensitive 200
```

By default the refresh runs every 30 minutes, so a policy based on claims will fail for a session that outlives it unless `SecurityStampValidatorOptions.OnRefreshingPrincipal` carries the claims, as in the second run.

### Passkeys in .NET 10 (types measured, flow docs only)

The Identity packages 10.0.x contain the passkey API: `SignInManager` has `MakePasskeyCreationOptionsAsync`, `PerformPasskeyAttestationAsync`, `MakePasskeyRequestOptionsAsync`, `PerformPasskeyAssertionAsync` and `PasskeySignInAsync`; `UserManager` has `AddOrUpdatePasskeyAsync`, `GetPasskeysAsync`, `FindByPasskeyIdAsync` and `RemovePasskeyAsync`; `IdentityPasskeyOptions` is configured with `Configure<IdentityPasskeyOptions>`. Measured defaults: timeout 5 min, challenge 32 bytes, `ServerDomain` null, user verification `required`, resident key `preferred`.

Storage is opt-in: with the default schema there is no passkey table, and with `Stores.SchemaVersion = IdentitySchemaVersions.Version3` the model gained `AspNetUserPasskeys (CredentialId, UserId, Data)`. The registration and sign-in ceremonies need a browser authenticator, so they were not run; the doc states what to expect. Per the Learn passkey article: only the Blazor Web App template has the UI, there are no `MapIdentityApi` endpoints, no attestation validation by default, and passkeys are a primary factor, not a second one ("no built-in 2FA support"), although the Learn MFA article says passkeys can serve MFA flows. When `ServerDomain` is null the relying party ID comes from the `Host` header, so validate hosts. Practical reading: keep TOTP and recovery codes as the second factor for password accounts, and treat a passkey as a way to replace the password.

## Trade-offs

- **TOTP defaults vs hardening.** Out of the box: five-step window, reusable codes, clear-text key and recovery codes. Each fix is small (a provider, a protector) and none is on by default. Example: without the provider above, a captured code signs in again for about 2.5 minutes.
- **Replay cache vs database.** `IMemoryCache` is simple and wrong across instances; a per-user last-step column fixes that and costs a write per login.
- **Lockout vs denial of service.** Shared failure counting caps guessing at five tries but lets a stranger lock a user out of the account. Delays or IP-aware limits soften it.
- **Remember this machine.** Fewer prompts, but for 14 days the account is only as strong as the cookie and `amr` stays `pwd`. Sensitive actions should step up regardless.
- **Own step-up claims vs an identity provider.** A custom `mfa_at` is quick, but must survive stamp refresh. With Entra ID or OpenIddict, request `acr_values` or `max_age` and read `amr` and `auth_time` from the token instead ([OAuth clients](oauth-2-clients-in-dotnet-code-pkce-client-credentials-and-device-flow), [OpenIddict](building-an-authorization-server-with-openiddict)).
- **`MapIdentityApi` for 2FA.** Convenient, but `resetSharedKey` disables 2FA, an old access token keeps working until it expires, and there is no GET to read state. Wrap or replace it for anything beyond a prototype.
- **Passkeys vs TOTP.** Passkeys resist phishing, TOTP does not ([threats](/identity-concepts/identity-threats-aitm-phishing-consent-phishing-and-recovery)), but the .NET 10 support is primary-factor only and needs schema version 3.

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
