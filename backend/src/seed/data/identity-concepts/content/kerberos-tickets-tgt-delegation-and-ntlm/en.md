---
version: 1.0
updatedAt: 2026-11-19
---
## Objective

Kerberos lets a client prove who it is to a service across an untrusted network without sending its password, and lets the service
prove itself back, by trusting a third party (the KDC) that shares a secret with everyone. This lesson runs it against a lab KDC of
your own: principals, `kinit`, the TGT and service tickets on the wire (tshark), a keytab, two real services validating tickets (Apache
Negotiate, sshd GSSAPI), the failures you will meet (pre-auth, clock skew, expiry, renewal, key version, a service reached by IP),
delegation, then NTLM, the fallback that still shows up, with a small verifier of our own. Attacks (golden and silver ticket,
Kerberoasting, pass-the-hash, relay) are prose only, as failure classes with defenses.
Versions: MIT Kerberos 1.21.3 (Debian 13
`krb5-kdc` 1.21.3-5+deb13u1), OpenSSH 10.0p2, Apache 2.4.71 with `libapache2-mod-auth-gssapi` 1.6.4, curl 8.14.1 in the container;
tshark 4.6.0, Node 22.23.4 and curl 8.7.1 on the host; Docker 29.9.2, image `debian:trixie` (not digest-pinned).

## Use Cases

- Reading `Clock skew too great`, `Ticket expired` or `Server not found in Kerberos database` and knowing which exchange failed.
- Setting up or auditing SSO for an intranet app (SPN, keytab, Negotiate).
- Reviewing delegation and NTLM exposure in an Active Directory.

## Deep Dive

### Why it exists and who plays what

Kerberos (RFC 4120) came from MIT (Steiner, Neuman and Schiller, USENIX Winter 1988, version 4) for networks where eavesdropping is
assumed. The password never travels: a **KDC** that holds a key for every principal issues short-lived **tickets**. It has two logical
parts, the **AS** (issues the TGT) and the **TGS** (issues service tickets). A **principal** is `alice@EXAMPLE.TEST` (user) or an
**SPN** `service/host@REALM` such as `HTTP/svc.example.test`; the **realm** is the domain (upper case); a **keytab** holds a service's
long-term keys so it can decrypt tickets without a password.

The three exchanges: **AS-REQ/AS-REP** (client to KDC, returns a TGT, a ticket for `krbtgt/REALM`), **TGS-REQ/TGS-REP** (client to KDC,
returns a service ticket for one SPN) and **AP-REQ/AP-REP** (client to service; the AP-REP lets the client authenticate the service).

### The lab (measured)

Three containers on a private network (`idn-krb-kdc`, `idn-krb-svc`, `idn-krb-client`) from one Debian image (`krb5-kdc krb5-user
openssh-server apache2 libapache2-mod-auth-gssapi curl faketime tcpdump`). Config: `default_realm = EXAMPLE.TEST`, `rdns = false`,
`forwardable = true`; KDC `max_life = 10h`, `max_renewable_life = 7d`, only the two AES types in `supported_enctypes`.

```text
$ kdb5_util create -s -r EXAMPLE.TEST -P masterpw && krb5kdc
$ kadmin.local -q "addprinc -pw alicepw alice"   # bob likewise; -randkey for HTTP/ and host/ svc.example.test
$ kadmin.local -q "ktadd -k /tmp/svc.keytab host/svc.example.test HTTP/svc.example.test"
Entry for principal HTTP/svc.example.test with kvno 2, encryption type aes256-cts-hmac-sha1-96 added
```

`kvno 2` right after creation: `ktadd` generates a new random key, so exporting a keytab rotates it.

### AS exchange and pre-authentication (measured)

A fresh principal does not require pre-authentication on the MIT KDC, and the capture shows the consequence: the first AS-REQ, with no
proof, already gets an AS-REP encrypted with alice's key. Anyone on the network can fetch it and attack the password offline (AS-REP
roasting, below). One attribute fixes it:

```text
$ kadmin.local -q "modprinc +requires_preauth alice"      # Attributes: REQUIRES_PRE_AUTH
$ echo wrongpw | kinit alice ; echo alicepw | kinit alice ; kvno HTTP/svc.example.test
$ tshark -r k2.pcap -Y kerberos
 1 AS-REQ (246 B, no pre-auth)     2 KRB Error: PREAUTH_REQUIRED
 3 AS-REQ (341 B, with timestamp)  4 KRB Error: PREAUTH_FAILED  <- wrong password
 5-7 same again, right password    8 AS-REP (882 B) <- the TGT;  9 TGS-REQ  10 TGS-REP (1078 B) <- service ticket
```

The pre-auth in frames 3 and 7 is `PA-ENC-TIMESTAMP` (padata type 2): the time encrypted with a key derived from the password (etype
18, `aes256-cts-hmac-sha1-96`). Only someone who knows the password can produce it, so the KDC gives nothing attackable to strangers.

`klist -e` shows the TGT `krbtgt/EXAMPLE.TEST@EXAMPLE.TEST` valid 10 hours, `renew until` 7 days later, `Flags: FRIA` (`F` forwardable,
`R` renewable, `I` initial, `A` pre-authenticated), etypes `aes256-cts-hmac-sha1-96`. It is encrypted with the `krbtgt` key, which only
the KDC has: the client stores and replays it but cannot read it.

### TGS exchange and what is inside a ticket (measured)

`kvno HTTP/svc.example.test` sends the TGT plus an *authenticator* (client name and a timestamp, encrypted with the TGT session key).
The reply has two layers: a ticket for the service and a part for the client with the new session key. In the capture the ticket shows
only `realm`, `sname` and an opaque `enc-part` (etype 18, `kvno: 2`): the client cannot read it, it is encrypted with the service key.
Giving tshark the service keytab (a lab key) decrypts it and shows what the service learns:

```text
flags: 40a90000  forwardable, renewable, pre-authent, transited-policy-checked, enc-pa-rep
cname: alice   authtime: 05:45:13   endtime: 15:45:13   renew-till: 11/26 05:45:13
authorization-data: AD-IF-RELEVANT > AD-WIN2K-PAC (client info + ticket, server, KDC checksums)
```

The inner session key lets client and service share a secret without the KDC in every request. MIT's KDC puts a minimal PAC here (no
groups); an Active Directory KDC fills it with the user's SID and group SIDs, which Windows services authorize on. The ticket is
protected by the *service's* key, so a weak or old service key is the weak point (Kerberoasting, below).

### AP exchange: real services validating (measured)

Apache with `mod_auth_gssapi` is the HTTP case (RFC 4559, SPNEGO over HTTP; RFC 4121 is the Kerberos GSS-API mechanism). Config:
`AuthType GSSAPI`, `Require valid-user`, `GssapiCredStore keytab:/etc/apache2/http.keytab`. That keytab holds only the `HTTP/` entries,
cut from the full one with `ktutil` (`rkt`, `delent`, `wkt`) and owned by `www-data`:

```text
$ curl -si http://svc.example.test/whoami/ | head -3        # no ticket
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Negotiate
$ curl -sv --negotiate -u : http://svc.example.test/whoami/ # with the TGT
> Authorization: Negotiate YIIDHwYGKwYBBQUCoIIDEzCCAw+gDTALBgkqhkiG9xIBAgKi...   (1072 chars)
< HTTP/1.1 200 OK
< WWW-Authenticate: Negotiate oYG3MIG0oAMKAQChCwYJKoZIhvcSAQICooGfBIGcYIGZ...    (248 chars)
< X-Gss-Name: alice@EXAMPLE.TEST
$ curl -s -o /dev/null -w '%{http_code}' -u alice:alicepw http://svc.example.test/whoami/   # Basic: 401
```

`openssl asn1parse` on both tokens shows the layers: the request is a SPNEGO token (OID `1.3.6.1.5.5.2`) offering the Kerberos
mechanism `1.2.840.113554.1.2.2`, carrying the AP-REQ (service ticket plus a fresh authenticator). The response is a `negTokenResp`
with `ENUMERATED 0` (accept-completed) and the AP-REP: **mutual authentication**, proof the server held the key.

SSH uses the same tickets: with `GSSAPIAuthentication yes` and `PasswordAuthentication no`, `ssh alice@svc.example.test` with a TGT
logs in without a prompt (`using "gssapi-with-mic"`; the host key is the `host/` entry); without a TGT it fails with `Permission denied
(gssapi-keyex,gssapi-with-mic)`. As `bob`, `ssh alice@svc...` is denied too: Kerberos proves who you are, the account mapping
(`.k5login`) decides which account you may use.

### Failures you will meet (measured)

**Clock skew.** Authenticators carry a timestamp so a captured one cannot be replayed later (servers also keep a replay cache); the
default tolerance is 5 minutes (`clockskew`, RFC 4120). With `faketime` on the client, +4 and -4 minutes worked; at +6 and -6 `kvno`
printed `Clock skew too great` and Apache logged `gss_accept_sec_context() failed ... (Clock skew too great)` and answered 401. Note
that `kinit` itself still succeeded 10 minutes ahead (most likely MIT's client takes the KDC's time from the pre-auth error; observed,
mechanism not checked), so a working `kinit` does not prove the clock is fine: the TGS and AP steps enforce it. Run NTP.

**Lifetimes and renewal.** `kinit -l 1m -r 3m` gave a TGT valid 1 minute, renewable 3. `kinit -R` at 40 and 75 seconds each returned a
new TGT with a later `endtime` and the same `renew until` (05:50:12). A renewal at 05:49:37, ten seconds after expiry, was still
accepted and clipped to `renew until`; at 05:50:26 it failed with `Ticket expired while renewing credentials`. Short tickets plus
renewal give long sessions, and a stolen TGT works only until the renewal limit.

**Names matter.** The client builds the SPN from the host in the URL: `http://172.25.0.3/` asked for `HTTP/172.25.0.3`, which does not
exist, so no ticket and a 401 (same for an unregistered DNS alias). This is where NTLM creeps back in. And `kadmin cpw -randkey
HTTP/svc.example.test` made `kvno = 3` while the keytab had 2: Apache refused with `kvno 3 not found in keytab`. Rotate key and keytab
together.

### Encryption types

Every ticket showed `aes256-cts-hmac-sha1-96`. A principal created with `-e rc4-hmac:normal` (the unsalted NT hash as key) was accepted
by this 1.21.3 KDC, flagged `DEPRECATED` by `getprinc`, and `kinit` warned `encryption type arcfour-hmac used for authentication is
deprecated and will be disabled`; asking for `des-cbc-crc` silently produced AES keys (DES is gone). RC4 tickets and AS-REPs are far
cheaper to attack offline: keep only AES in `supported_enctypes`, set AES on AD service accounts, review RC4 use before turning it off.

### Delegation (measured and prose)

Delegation lets a service act as the user toward another service. The simplest form is a **forwardable TGT** handed over. Measured with
`ssh -o GSSAPIDelegateCredentials=yes`:

```text
$ ssh alice@svc.example.test klist      # default, no delegation:  klist: No credentials cache found
$ ssh -o GSSAPIDelegateCredentials=yes alice@svc.example.test 'klist -f; kvno host/kdc.example.test'
krbtgt/EXAMPLE.TEST@EXAMPLE.TEST   renew until 11/26/26 05:50:37, Flags: FfRAT
host/kdc.example.test@EXAMPLE.TEST: kvno = 1
```

The service host now holds alice's TGT (`F` forwarded, `f` forwardable) and can ask for a ticket to **any** service as alice. That is
**unconstrained delegation** (AD: "Trust this computer for delegation to any service"): one compromised host steals the TGT of every
user that touches it. Defense: avoid it and mark privileged accounts non-delegable. In MIT, `modprinc -allow_forwardable alice` made
the next `kinit` show `Flags: RIA`, and the same `ssh` produced no credentials cache.

Better models limit the reach (docs only here, they need AD or S4U support): **constrained delegation** lists the exact SPNs a service
account may delegate to (S4U2Proxy; S4U2Self gets a ticket for a user who authenticated another way, "protocol transition");
**resource-based constrained delegation (RBCD)** moves that list to the back-end service (`msDS-AllowedToActOnBehalfOfOtherIdentity`),
so its owner decides who may delegate to it. In AD the controls are "Account is sensitive and cannot be delegated" and the **Protected
Users** group (no delegation, no NTLM, no RC4 or DES, TGT capped at 4 hours).

### Realms, trusts and Active Directory

**Cross-realm**: two realms share a key for `krbtgt/B@A`; a client in A gets a referral TGT for B, then a service ticket in B (AD
forests do this with trusts, and selective authentication narrows who may cross). **Active Directory is a KDC plus an LDAP directory**
on every domain controller: `krbtgt` holds the key that signs every TGT and the PAC carries the user's SID and groups, so a Windows
service builds its access token with no LDAP query. Same RFC 4120 protocol, so this MIT lab explains it.

### Attack classes, as failures with defenses (prose only)

Not demonstrated, by design (MITRE ATT&CK T1558, Steal or Forge Kerberos Tickets, plus T1550.002 and T1557.001):

- **Golden ticket** (T1558.001, a stolen `krbtgt` key forges TGTs) and **silver ticket** (T1558.002, a stolen service key forges
  service tickets the KDC never sees). Defense: protect DCs, reset `krbtgt` twice after a compromise, long random service keys (gMSA in
  AD), PAC validation, AES only, alert on odd lifetimes.
- **Kerberoasting** (T1558.003): any user can request a ticket for an SPN and attack it offline. Defense: 25+ random characters,
  managed accounts, AES, alert on mass TGS requests.
- **AS-REP roasting** (T1558.004): the missing pre-auth above. Defense: pre-auth everywhere. Pass-the-hash and relay belong to NTLM,
  next.

### NTLM: the fallback (measured)

NTLM has no third party: the *server* checks the answer using a hash of the password. A 34-line Node 22 verifier of ours
(`--openssl-legacy-provider` for MD4) and `curl --ntlm` show the three messages over `WWW-Authenticate: NTLM`:

```text
NT hash of alice: 6d79e54cfc7ee9b0285bfbfeacc048c5       # MD4(UTF-16LE(password)), no salt
NT hash of bob:   6d79e54cfc7ee9b0285bfbfeacc048c5       # same password, same hash
type1 flags=0x88206 len=32                                # NEGOTIATE
type2 challenge=60ab2738b8978d0e                          # CHALLENGE: 8 random bytes
type3 user=alice domain=EXAMPLE ntresp=70B proof=64a41c3b... -> ACCEPT    # AUTHENTICATE
type3 user=alice ... proof=f4abd1cf... -> REJECT          # wrong password
```

The NTLMv2 answer is `HMAC-MD5(NTOWFv2, challenge || blob)` with `NTOWFv2 = HMAC-MD5(NT hash, UPPER(user) || domain)` (MS-NLMP). The
verifier used only the hash, never the password: whoever steals the hash can answer challenges (**pass-the-hash**), and the hash is
unsalted. Nor is the answer bound to the service the client meant to reach, so a machine in the middle can pass the challenge to
another server and relay the answer (**NTLM relay**). Defenses: SMB signing, LDAP signing with channel binding, Extended Protection for
Authentication (EPA) on HTTPS services, auditing then restricting NTLM (DC event 4776, restrict policies), Protected Users, and LAPS
against hash reuse.

When does NTLM still happen? When Kerberos cannot run: an IP or unregistered alias in the URL (the SPN case above), a client off the
domain or without a DC, an application hard-coded to NTLM, a server outside the domain. Book versus today: NTLM is deprecated and
Microsoft is reducing it; audit who uses it, fix names and SPNs, then restrict.

### Kerberos against OIDC and SAML, and where to go next

Kerberos is a **domain** protocol: excellent inside one administrative boundary (reachable DCs, synced clocks), awkward across
companies, on the internet and for mobile or SPAs, where OIDC (JWT) and SAML rule. The usual shape: Kerberos or NTLM into the domain,
and an IdP (AD FS, Entra ID, Keycloak) that accepts the desktop's Kerberos and issues SAML or OIDC tokens for web and cloud apps; new
apps integrate with the IdP, not with Kerberos. Next in the track: the LDAP concept ("LDAP: Directories, DN, Schema and Binds") covers
the directory behind AD, the SAML concept ("SAML 2.0: Assertions, Bindings and SSO Flows") the browser federation fed by the same
identity; an Active Directory concept (planned) extends this lab. History: Steiner, Neuman and Schiller (USENIX 1988) and the MIT
"Dialogue in Four Scenes", on the MIT page below. The papers catalog has no Kerberos entry.

### Summary table

| Ticket or concept | Encrypted by | Protects | Typical attack class | Defense |
|---|---|---|---|---|
| AS-REP (client part) | user key (password) | password never sent | AS-REP roasting | require pre-auth |
| TGT | `krbtgt` key | identity at the KDC | golden ticket | protect DCs, rotate `krbtgt` twice |
| Service ticket | service key (keytab) | identity at the service | Kerberoasting, silver ticket | random keys, gMSA, AES, PAC validation |
| Forwarded TGT | `krbtgt` key | acting as the user | unconstrained delegation theft | constrained or RBCD, non-delegable accounts |
| NT hash / NTLM | hash of password | fallback logon | pass-the-hash, relay | signing, EPA, restrict NTLM, Protected Users |

## Trade-offs

- **Kerberos versus NTLM.** Kerberos gives mutual authentication, no password on the wire, delegation and an audit point at the KDC,
  but needs correct names, SPNs and clocks. NTLM works with an IP and no DC, which is why it survives and why it needs auditing.
- **Long lifetimes versus renewal.** 10 hours with a 7 day renew limit (the lab) means a stolen cache works for a day; shorter
  lifetimes limit exposure (Protected Users caps the TGT at 4 hours).
- **Keytab convenience versus blast radius.** One shared keytab for many services means one theft forges them all (silver ticket): one
  principal and keytab per service, mode 600.
- **Delegation versus least privilege.** Unconstrained is easy and hands over the user's TGT; RBCD makes the back-end owner opt in,
  more work and much safer.
- **Domain SSO versus federation.** Kerberos is invisible inside the domain; outside it you need an IdP with OIDC or SAML, and you run
  both worlds.

## Documentation Links

- [RFC 4120, The Kerberos Network Authentication Service (V5), IETF](https://www.rfc-editor.org/rfc/rfc4120) (doc)
- [RFC 4121, The Kerberos Version 5 GSS-API Mechanism: Version 2, IETF](https://www.rfc-editor.org/rfc/rfc4121) (doc)
- [RFC 4559, SPNEGO-based Kerberos and NTLM HTTP Authentication, IETF](https://www.rfc-editor.org/rfc/rfc4559) (doc)
- [RFC 6806, Kerberos Principal Name Canonicalization and Referrals, IETF](https://www.rfc-editor.org/rfc/rfc6806) (doc)
- [MIT Kerberos Documentation, MIT](https://web.mit.edu/kerberos/krb5-latest/doc/) (doc)
- [Papers and the Dialogue in Four Scenes, MIT Kerberos](https://web.mit.edu/kerberos/papers.html) (doc)
- [Kerberos authentication overview, Microsoft Learn](https://learn.microsoft.com/en-us/windows-server/security/kerberos/kerberos-authentication-overview) (doc)
- [Kerberos constrained delegation overview, Microsoft Learn](https://learn.microsoft.com/en-us/windows-server/security/kerberos/kerberos-constrained-delegation-overview) (doc)
- [Protected Users security group, Microsoft Learn](https://learn.microsoft.com/en-us/windows-server/security/credentials-protection-and-management/protected-users-security-group) (doc)
- [MS-NLMP, NT LAN Manager (NTLM) Authentication Protocol, Microsoft](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-nlmp/b38c36ed-2804-4868-a9ff-8dd3182128e4) (doc)
- [T1558, Steal or Forge Kerberos Tickets, MITRE ATT&CK](https://attack.mitre.org/techniques/T1558/) (doc)
- [T1550.002, Pass the Hash, MITRE ATT&CK](https://attack.mitre.org/techniques/T1550/002/) (doc)
- [T1557.001, LLMNR/NBT-NS Poisoning and SMB Relay, MITRE ATT&CK](https://attack.mitre.org/techniques/T1557/001/) (doc)
