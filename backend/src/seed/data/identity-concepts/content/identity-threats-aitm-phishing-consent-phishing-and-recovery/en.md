---
version: 1.0
updatedAt: 2026-11-19
---
## Objective

Most identity breaches do not break cryptography: they walk through a gap in the trust model. A phished password, a session cookie lifted after the MFA prompt, a push approved at 3 a.m., an OAuth app the user was talked into authorizing, a help-desk agent who resets the wrong person: each is a control that works as designed next to an assumption that does not hold. This lesson is defensive. It names each threat as a class (mechanism in one paragraph, the control it bypasses, the defense, the signal that detects it), and measures only defenses against toy services of my own on this machine: a session that works from another client and then stops working when bound to a device key, an account-recovery flow before and after four controls, a 60-line detector over a generated log, and a consent grant plus its revocation on a local Keycloak. No phishing kit, proxy or stealer is built or described step by step. It ends with the frameworks (MITRE ATT&CK IDs, NIST SP 800-63B-4, CISA) and a table you can use as a review checklist.
Versions: Node 22.23.4, Keycloak 26.8.2 (`quay.io/keycloak/keycloak:26.8.2`, `start-dev`), curl 8.7.1, jq 1.7.1, OpenSSL 4.0.3; NIST SP 800-63B-4, MITRE ATT&CK, CISA fact sheet, Microsoft Entra docs (all read 2026-11-19).

## Use Cases

- Answering "we have MFA, how did they get in?" with the specific path: relayed login, stolen session, consent grant, or the recovery flow.
- Writing the detection rules and the incident checklist for a compromised account before the incident, and knowing what each rule misses.
- Deciding where to spend the next quarter: passkeys for admins, token binding, a consent policy, or fixing the reset flow.

## Deep Dive

### Read every threat the same way

Each section answers four questions: what is the mechanism, which control does it bypass, what is the defense, what does the log show. The earlier lessons of this track own the controls; this one is about how they fail, so it links instead of repeating: the MFA lesson (factors, the AiTM relay in two paragraphs), the WebAuthn lesson (origin binding, measured), the passwords lesson (stuffing and spraying, measured), the session lesson (cookies, revocation) and the OAuth security lesson (DPoP and mTLS, measured).

### Phishing and the resistance ladder

Phishing gets a user to hand a secret or an approval to someone who is not the real site. Anything the user can type or approve can be given away: password, SMS code, TOTP code, push approval. NIST SP 800-63B-4 defines phishing resistance as preventing "the disclosure of authentication secrets and valid authenticator outputs to an impostor verifier", and says authenticators that need manual entry of an output (OTP, out-of-band) "SHALL NOT be considered phishing-resistant". It recognizes two methods: channel binding (client-authenticated TLS) and verifier name binding (WebAuthn: the signature covers the real origin). The WebAuthn lesson measured the second: a look-alike origin gets nothing it can reuse, while a relayed TOTP code was accepted. CISA's fact sheet ranks the forms from strongest to weakest: phishing-resistant (FIDO/WebAuthn, PKI-based), then app or token OTP and push with number matching, then push without it, then SMS and voice last. It calls FIDO/WebAuthn "the only widely available phishing-resistant authentication". Everything below is what is left when a factor lower on that ladder is in use, or when the attacker avoids the login altogether.

### AiTM: the session is stolen after MFA succeeds

Mechanism, in one paragraph: the user is lured to a look-alike address that sits between them and the real site and relays the whole conversation, so the user sees the genuine page, completes the genuine MFA and the intermediary ends up holding the session the real site issues. The MFA lesson shows why a TOTP code cannot tell the difference (the verifier accepted a code sent with a foreign `Origin`). Control bypassed: any MFA that is not phishing-resistant. What was stolen is not the password but the session after MFA, so a stronger second factor on the next login does not help the session already in the attacker's hands.

Defenses, in the order they pay off:

1. Passkeys or FIDO2 security keys for sign-in: the origin is part of what is signed, so the relay has nothing to forward. This removes the phish, not the later theft of a session by malware.
2. Bind the session to something the thief cannot copy: a device key (DPoP, RFC 9449, or mTLS, RFC 8705, both measured in the OAuth security lesson; for browser cookies, Device Bound Session Credentials, a W3C draft that describes itself as "a very early drafting", docs only; Entra Token Protection, docs only: sign-in session tokens bound to the registered device, generally available for native apps on Windows, iOS and macOS and in preview for some web apps).
3. Conditional Access that requires a compliant or managed device (docs only), short lifetimes, and continuous re-evaluation of the session (CAE, see the session lesson).
4. Detection of the same session used from two clients, below.

#### Defense demo: the cookie as a bearer, then bound to a key (measured)

A toy server of mine (`node:http`, port 6720). The second factor is a stub, because the lab is about what happens after it. A login gives a cookie. In `BIND=none` the session is a plain bearer; in `BIND=key` the login also registers the device's public key (ES256), and every request must carry a signature over time, method, path and the session hash. The check is a DPoP-like proof, 8 lines:

```js
const [ts, sig] = (req.headers['x-proof'] || '').split('.');
if (!sig || Math.abs(now() - Number(ts)) > 30000) return 'proof missing or stale';
if (seen.has(sig)) return 'proof replayed';
const data = `${ts}.${req.method}.${req.url}.${sha(sid)}`;
if (!verify('sha256', Buffer.from(data), { key: s.key, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url'))) return 'bad proof signature';
seen.add(sig); return null;
```

The "device" client holds the private key. The "other client" has only the cookie value, which is exactly what a copy of the session gives anyone:

```text
BIND=none                                         BIND=key
device, with proof        -> 200 balance 1000     200 balance 1000
other client, cookie only -> 200 balance 1000     401 proof missing or stale
other client, forged proof-> 200 balance 1000     401 bad proof signature
same valid proof sent again -> 200 balance 1000   401 proof replayed
```

A copied bearer cookie is the credential. Bound to a key, the copy is useless without the private key, and a captured proof works once, on one request, once. Limits, stated plainly: this stops exfiltration, not use. Malware on the device can ask the device (or its TPM) to sign requests, so it can still act from there while the infection lasts; a device key protects against copying the cookie to another machine, which is the common case. The proofs here are an app-level toy; a real deployment uses the standard (DPoP, mTLS) or the platform feature.

### MFA fatigue (push bombing)

Mechanism: with a valid password, the attacker triggers push prompts until the user taps Approve to make them stop, or approves one that looks routine. It bypasses MFA that is a yes/no tap. Defenses (details in the MFA lesson): number matching so Approve cannot be blind (Entra enables number matching for all Authenticator push notifications, docs only), context in the prompt, a cap on prompts since the last success (NIST: "SHOULD implement a reasonable limit"), prompt-count alerts, and moving users to passkeys. Signal: many prompts in a short window, mostly denied or unanswered, then one approval from a new IP or device. Rule R1 below flags 5 prompts in 10 minutes with 3 denials.

### Token and session theft (infostealers)

Mechanism, as a class: malware or a malicious extension on the user's machine reads the browser's cookie store or token cache and sends it away; the attacker replays it elsewhere. It bypasses everything that happened at login, MFA included, because the session cookie "is" the authentication until it expires or is revoked (the session lesson measured that a stolen copy survives a cookie-only logout and a JWT without a deny list). Defenses: bind the token (above), short access tokens with refresh rotation (RFC 9700), server-side revocation that really deletes the session (the session lesson), step-up for sensitive actions, device compliance, and endpoint controls (EDR, no local admin, browser and extension policy; docs only here). Signal: the same session id from two IPs or user agents, a new country mid-session, access patterns that differ (bulk download, mailbox rules). The toy log from the demo above, fed to the detector's R4:

```text
BIND=none: [{"rule":"session_reuse","user":"alice","why":"63265ec2: 203.0.113.10/VictimBrowser/1 then 198.51.100.77/curl/8.7.1"}]
BIND=key : same alert, caused by the two DENIED requests (proof missing, bad signature)
```

Binding and detection are not alternatives: even when binding blocks the copy, the denied attempts are the best signal you will get that a cookie leaked. An attacker who also copies the user agent defeats a UA check (the session lesson said so: a tripwire, not a control); the IP and the denials do not depend on that.

### Consent phishing: no password, no MFA

Mechanism: the attacker registers an OAuth application and sends the user a link to its consent screen. The user, signed in and passing MFA as always, clicks Accept. The app now holds a grant (and often a refresh token) that reads mail, files or contacts, with the user's own permissions and no stolen secret. It bypasses MFA and password changes entirely: the "credential" is the grant, so resetting the password does not remove it. The defense is mostly platform policy, not user vigilance.

What Microsoft Entra offers (docs only, no tenant here): disable user consent, or allow it by policy. The built-in policy `microsoft-user-default-low` allows consent "only for apps from verified publishers and apps that are registered in your tenant, and only for permissions that you classify as low impact"; `microsoft-user-default-legacy` lets users consent to any permission that does not need admin consent. Microsoft recommends allowing user consent only for verified-publisher apps. When users may not consent, the admin consent workflow lets them request a review. To remove access, admins can revoke admin-granted permissions in the portal, but "you can't revoke permissions in the User consent tab using the portal", only with Graph or PowerShell (and the sample script also revokes refresh tokens for the app's users).

What Keycloak offers, measured on 26.8.2 with a client `pdf-tools` (`consentRequired: true`, public, PKCE) and user `alice`:

```text
1. consent before any grant:  []
2. code flow, scope 'openid profile email offline_access'
   consent screen, "Do you grant these access privileges?" lists: User profile,Offline Access,Email address
3. the grant as the admin sees it (GET /admin/realms/thr/users/{id}/consents):
   [{"clientId":"pdf-tools","grantedClientScopes":["profile","offline_access","email"],
     "additionalGrants":[{"client":"838ad2c7-...","key":"Offline Token"}]}]
4. refresh token works: 200
6. DELETE /admin/realms/thr/users/{id}/consents/pdf-tools -> 204        7. grants after revoke: []
8. the old (offline) refresh token after revoke: 400 invalid_grant "Offline user session not found"
9. same app without offline_access: consent lists User profile, Email address; grant has no additionalGrants
10. DELETE consent -> 204; the online refresh token: 400 invalid_grant "Session doesn't have required client"
    the access token issued before, at userinfo: 401; but the JWT still has 299 s to run
11. alice's Keycloak SSO session after the revoke: still there (1 session)
```

What this teaches: the Admin API shows the grant (client, scopes, offline token) and one call removes it and kills the refresh token, offline or not. The access token already in the attacker's hands lives until `exp` (300 s here) for any resource server that only checks the signature, and the user's own session at the IdP stays, so revoking a grant is not "sign out". What it does not do: data already read stays read. In Keycloak, `fullScopeAllowed: false` and per-client scopes limit what the token can carry, and the consent screen only appears for clients flagged `consentRequired`, so a consent-less client (for example a first-party app) never shows it. I found no verified-publisher concept or tenant-wide "admin must approve every new app" setting in the Keycloak docs (not documented). For client registration, anonymous dynamic registration with the default realm policies is closed:

```text
POST /realms/thr/clients-registrations/default (no token) -> HTTP 403
{"error":"insufficient_scope","error_description":"Policy 'Trusted Hosts' rejected request to client-registration service. Details: Host not trusted."}
anonymous policies: Allowed Client Scopes; Allowed Protocol Mapper Types; Allowed Registration Web Origins; Consent Required; Default Roles Disabled; Full Scope Disabled; Max Clients Limit; Trusted Hosts
```

The docs say why: no host is whitelisted by default, so anonymous registration is "de-facto disabled". The list is the checklist for realms that do open registration (per the docs, the `Consent Required` policy makes every newly registered client show the consent screen; not exercised here; `Client Policies` cover more than registration, docs only). In both platforms: least-privilege scopes, an allow-list of apps for sensitive scopes, periodic review of granted apps, and an alert when a new app receives a broad scope (`Mail.ReadWrite`, `Files.Read.All`, `offline_access`) or a user consents to something unusual. Application permissions (client credentials, no user) are not user consents at all, so audit service principals separately.

### Account recovery is the weak link

Mechanism: a strong login is irrelevant if "forgot password" or the help desk gets the attacker in. Classes: reset by e-mail (the mailbox is the account), SMS recovery (SIM swap: the carrier moves the number, see the MFA lesson), security questions (answers are guessable or public; NIST says verifiers "SHALL NOT prompt subscribers to use knowledge-based authentication (KBA) ... or security questions" when choosing passwords), and engineering of the help desk (a caller who sounds right gets a factor reset). The downgrade is the real attack: the passkey stays safe while the recovery path accepts a weaker proof. NIST treats replacing a forgotten password, when the user can authenticate otherwise, as binding a new authenticator, and requires authentication at the account's maximum AAL (or that of the new authenticator, whichever is lower) plus a notification "via a mechanism independent of the transaction". Real recovery means saved or issued recovery codes (at least 64 random bits for saved ones), recovery contacts or repeating identity proofing, and "account recovery SHALL cause a notification".

The toy again (same server, `RECOVERY=weak` against `strict`). The attacker controls only the mailbox and already has a stolen session. `strict` adds four controls: a second proof besides the link, notification on every channel (e-mail and SMS) including blocked attempts, revocation of all sessions on success, and a 24 h cooldown before a new factor can be added (the toy clock is advanced with a debug route).

```text
                              RECOVERY=weak            RECOVERY=strict
mailbox only, confirm      -> 200 {"revoked":0}        403 second factor required (log: notified email+sms)
owner: mailbox + 2nd factor ->  (not needed)           200 {"revoked":1}
old stolen session after   -> 200 still works          401 no session
add a factor right away    -> 200                      423 cooldown
add a factor 25 h later    -> 200                      200
```

In `weak`, resetting the password leaves the attacker's session alive and lets the attacker add a factor of his own at once: persistence. The 24 h cooldown is the NIST idea of "extended waiting times" in miniature, and the notification gives the real owner a window. The endpoint answers the same for unknown accounts (no enumeration). Help desk: verify through a channel the caller does not control (call back a number on file, manager approval, a ticket), never reset a strong factor on a phone call or chat message alone, log every reset as a high-risk event. Fewer resets help most: two or more passkeys per user, recovery codes printed at enrollment, and SMS as a fallback only with SIM-change checks.

### Credential stuffing and spraying

Replayed leaked pairs or a few common passwords over many accounts; the passwords lesson measured both and the controls (breached-password blocklist, cross-account detection, MFA). Here only the detection side is added, rules R2 and R3 below: one password fingerprint failing across 10 accounts in an hour, one IP failing on 20 accounts. R3 also flags the accounts that succeeded from that IP, because those are the ones taken.

### Privileged and service accounts

Attackers prefer accounts that skip the controls: admin roles (one phished admin is the tenant), service accounts with a static secret and no MFA, and break-glass accounts nobody watches. Defenses: separate admin identities with phishing-resistant authentication only, no standing privilege (just-in-time elevation, the next lessons on privileged access), no long-lived secrets in workloads (the workload identity lesson: SPIFFE, federation, short certificates), and alerts on any use of a privileged or service identity from a new place, plus role grants and consent grants made by them. Signals: admin role assigned outside change windows, service account interactive login, break-glass sign-in.

### Detection and response

The events that matter are few: failure bursts followed by success, a new device or user agent, impossible travel, an MFA factor added or removed, a new app consented, a mailbox forwarding rule, a password or recovery reset, a privileged role granted, the same session in two places. Log them from the identity provider with user, time, IP, user agent, result and the policy that decided, and keep the log where the attacker who owns the account cannot edit it.

A detector of mine, `detect.mjs` (60 lines, no dependencies), over a generated log: 8,194 events, 300 users over 7 days of benign noise (typos, legitimate travel, VPN exit changes) and injected scenarios with a ground-truth label file. The rules: R1 push fatigue (5 prompts in 10 min, 3 denied), R2 spray (one password fingerprint on 10 accounts in 1 h), R3 stuffing (one IP failing on 20 accounts in 1 h), R4 session reuse (one session id, two IP/UA pairs inside 10 min), R5 impossible travel (over 900 km/h between successful logins), R6 ten failures then a success, R7 takeover chain (a never-seen user agent, then two kinds of change among MFA, consent and forward rule inside 1 h). R4, the core:

```js
for (const [sid, xs] of group(e => e.sid, e => e.event === 'session_use' && e.sid)) {
  const o = xs.find(x => (x.ip !== xs[0].ip || x.ua !== xs[0].ua) && ms(x) - ms(xs[0]) <= 600e3);
  if (o) alert('session_reuse', xs[0].user, `${sid}: ${xs[0].ip}/${xs[0].ua} then ${o.ip}/${o.ua}`);
}
```

```text
push_fatigue       caught 1/1   | other attack users 0 | false positives 0
spray              caught 40/40 | other attack users 0 | false positives 0
stuffing           caught 60/60 | other attack users 0 | false positives 0
session_reuse      caught 3/3   | other attack users 0 | false positives 0
impossible_travel  caught 2/2   | other attack users 6 | false positives 4 (the VPN exit hops)
fail_then_success  caught 2/2   | other attack users 0 | false positives 0
takeover_chain     caught 2/2   | other attack users 0 | false positives 0
malicious users 110, caught by at least one rule 110 | benign users alerted 4 of 190
```

Read this honestly: the log is synthetic and I wrote both the scenarios and the rules, so recall of 110 out of 110 shows the rules work as designed, not what you will see in production. The useful part is the false positive: impossible travel fired on four users who hopped between VPN exits, the classic cost of that rule. Fixes are an allow-list of known egress ranges, and requiring a second signal (new device, risky sign-in) before alerting. A first version of R3 flagged only failed accounts and missed the 3 accounts the stuffing IP had actually logged into (57 of 60); counting every account the IP touched fixed it. Alert fatigue is a defense metric too: measure alerts per day and the share closed as benign.

When an account is compromised, the order that works (docs only for the platform calls, measured where marked):

1. Contain: revoke all sessions and refresh tokens (Graph `revokeSignInSessions` in Entra; in the session lesson, "sign out everywhere"), and disable the account if the attacker is active.
2. Remove persistence: authenticators or factors added since the breach, app consents and grants (the Admin API call above), mailbox forwarding and delegation rules, extra app registrations, API keys and device registrations.
3. Reset: password, then require a fresh strong authenticator enrollment, through the strict recovery path.
4. Scope: build the timeline from the log (first anomalous sign-in, what changed, what was read), then check other accounts touched from the same IP or session source.
5. Learn: which control was missing (token binding, consent policy, recovery strength) and the detection that would have fired sooner.

### Frameworks: ATT&CK, NIST, CISA

MITRE ATT&CK techniques for these threats (each ID confirmed on attack.mitre.org on 2026-11-19; the table maps the lesson to the tactic names):

| Threat | Technique | ID |
|---|---|---|
| Phishing, spearphishing link | Phishing, Spearphishing Link | T1566, T1566.002 |
| AiTM relay | Adversary-in-the-Middle | T1557 |
| Stolen or replayed session | Steal Web Session Cookie; Web Session Cookie (alternate material) | T1539, T1550.004 |
| Push fatigue | Multi-Factor Authentication Request Generation | T1621 |
| OAuth token and consent abuse | Steal Application Access Token | T1528 |
| Factor tampering and persistence | Modify Authentication Process: MFA; Device Registration | T1556.006, T1098.005 |
| Stuffing, spraying | Brute Force: Credential Stuffing, Password Spraying | T1110.004, T1110.003 |
| Using the account after | Valid Accounts, Cloud Accounts | T1078, T1078.004 |
| Mailbox forwarding rule | Email Collection: Email Forwarding Rule | T1114.003 |

NIST SP 800-63B-4: AAL2 verifiers "SHALL offer at least one phishing-resistant authentication option" and federal agencies must require it for staff; AAL3 needs a non-exportable key; the session section sets reauthentication timeouts (at AAL2 no more than 24 h overall and 1 h inactivity, as SHOULD); account recovery and new-authenticator binding need notifications to every stored address except postal. CISA, "Implementing Phishing-Resistant MFA": the ranking above, and the advice to add number matching and detection while the move is under way.

### Summary: threat, what it bypasses, defense, signal

| Threat | Bypasses | Defense | Detection signal |
|---|---|---|---|
| Phishing | password, SMS, TOTP, push | passkey or FIDO2 (origin bound) | sign-in from new IP right after a click on a flagged link |
| AiTM relay | any non-phishing-resistant MFA | passkeys, device-bound sessions, compliant device | session reuse, token used from a new ASN or device |
| MFA fatigue | tap-to-approve push | number matching, prompt cap, passkeys | prompt burst, denials then one approval |
| Token or session theft | everything at login | binding, short life, revocation, EDR | same session, two clients; impossible travel |
| Consent phishing | password and MFA | consent policy, verified publishers, least scope, grant review | new app with broad scope; consent outside policy |
| Weak recovery | strong factor, via downgrade | strict recovery, cooldown, all-channel notice, session revoke | reset then factor add; resets per account |
| Stuffing and spraying | reused or weak passwords | blocklist, MFA, cross-account rules | one password on many accounts; IP on many accounts |
| Privileged and service abuse | MFA exemptions, static secrets | admin passkeys, JIT, workload identity | role grant outside a change window; service login from a new place |

Book versus today: SMS and TOTP are still everywhere and will be for years, so a plan has to cover them with number matching, detection and recovery strength. The direction the market is moving is passkeys for sign-in and device-bound sessions for what comes after (Entra Token Protection and the DBSC draft are early, and cover few apps today). Consent policy and recovery hardening are the cheap, platform-level wins most tenants have not done.

### Where to go next

The next privileged access lesson of this track covers the admin side (JIT, vaults, break-glass). For the session cookie and revocation mechanics behind sections 2 and 4, the session lesson; for DPoP and mTLS, the OAuth security lesson.

## Trade-offs

- **Passkeys against what you can deploy.** The only widely available phishing-resistant factor, and it still needs a recovery plan and a device-loss story. Most organizations run both for years; keep the weaker path as strong as the stronger one.
- **Device binding against compatibility.** A key-bound session cannot be copied, and breaks proxies that terminate or rewrite requests, shared devices and unsupported browsers. Example: Entra Token Protection covers native apps first and few web apps.
- **Detection against alert fatigue.** Impossible travel flagged 4 VPN users out of 190 benign ones in the toy; every rule needs an allow-list or a second signal. Track the share of alerts closed as benign.
- **Strict recovery against support cost.** A 24 h cooldown, a second proof and revocation of every session protect the account and annoy a real user who lost a phone. Mitigate with several passkeys and recovery codes issued at enrollment.
- **Consent policy against developer friction.** Allowing only verified publishers and low-impact scopes blocks the phishing app and slows legitimate internal tools; an admin consent workflow absorbs that.
- **Revocation scope.** Deleting a grant stops refresh in seconds (measured), not the access token already issued, and not the user's IdP session. Pair it with short tokens and a full session revoke.

## Documentation Links

- [SP 800-63B-4, Authentication and Authenticator Management, NIST](https://pages.nist.gov/800-63-4/sp800-63b.html) (doc)
- [Implementing Phishing-Resistant MFA, CISA](https://www.cisa.gov/sites/default/files/publications/fact-sheet-implementing-phishing-resistant-mfa-508c.pdf) (doc)
- [Phishing, T1566, MITRE ATT&CK](https://attack.mitre.org/techniques/T1566/) (doc)
- [Adversary-in-the-Middle, T1557, MITRE ATT&CK](https://attack.mitre.org/techniques/T1557/) (doc)
- [Steal Web Session Cookie, T1539, MITRE ATT&CK](https://attack.mitre.org/techniques/T1539/) (doc)
- [Multi-Factor Authentication Request Generation, T1621, MITRE ATT&CK](https://attack.mitre.org/techniques/T1621/) (doc)
- [Steal Application Access Token, T1528, MITRE ATT&CK](https://attack.mitre.org/techniques/T1528/) (doc)
- [Configure how users consent to applications, Microsoft Entra](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/configure-user-consent) (doc)
- [Review and revoke permissions granted to applications, Microsoft Entra](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/manage-application-permissions) (doc)
- [Token Protection in Conditional Access, Microsoft Entra](https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-token-protection) (doc)
- [How number matching works in MFA push notifications, Microsoft Entra](https://learn.microsoft.com/en-us/entra/identity/authentication/how-to-mfa-number-match) (doc)
- [Keycloak Admin REST API, users consents](https://www.keycloak.org/docs-api/latest/rest-api/index.html) (doc)
- [Revoke signed-in sessions, Microsoft Graph](https://learn.microsoft.com/en-us/graph/api/user-revokesigninsessions) (doc)
- [Client registration service and policies, Keycloak Securing Applications](https://www.keycloak.org/securing-apps/client-registration) (doc)
- [Client registration policies, Keycloak Server Administration](https://www.keycloak.org/docs/latest/server_admin/index.html#_client_registration_policies) (doc)
- [Device Bound Session Credentials, W3C draft](https://w3c.github.io/webappsec-dbsc/) (doc)
- [RFC 9449, OAuth 2.0 Demonstrating Proof of Possession (DPoP), IETF](https://www.rfc-editor.org/rfc/rfc9449) (doc)
- [RFC 9700, Best Current Practice for OAuth 2.0 Security, IETF](https://www.rfc-editor.org/rfc/rfc9700) (doc)
- [Forgot Password Cheat Sheet, OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html) (doc)
