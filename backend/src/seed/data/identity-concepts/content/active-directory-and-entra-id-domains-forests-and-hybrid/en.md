---
version: 1.0
updatedAt: 2026-11-19
---
## Objective

Active Directory Domain Services (AD DS) is the directory most companies still run their Windows estate on: a forest of domains, domain controllers that replicate with each
other, and two doors in, LDAP and Kerberos. Microsoft Entra ID (formerly Azure AD) is a different product: a cloud identity provider spoken to with OAuth 2.0, OIDC, SAML
and Microsoft Graph, not "AD in the cloud". This lesson drives an AD-compatible domain (Samba, `lab.test`, two DCs) to measure objects, SIDs, GUIDs, names, groups,
`userAccountControl`, nested-group queries, Kerberos and LDAP logins, replication, RID pools and FSMO. Entra ID and the hybrid pieces (Entra Connect, Cloud Sync, PHS, PTA,
AD FS, Seamless SSO) are docs only: no Windows Server or tenant here. Attacks are prose. Samba is compatible with AD, it is not Windows AD.
Versions: Samba 4.22.11 (Debian 13 `samba`, `samba-ad-dc`, `samba-ad-provision`
4.22.11+dfsg-0+deb13u1, own image on `debian:trixie`, arm64), MIT Kerberos client 1.21.3, OpenLDAP clients 2.6.10, Docker 29.9.2. Learn page dates are in each section.

## Use Cases

- Reading a DN, UPN, SID or `memberOf` from a corporate directory and knowing which one is a stable key.
- Choosing, for a new app, between "log in against AD" (LDAP, Kerberos) and "log in against Entra" (OIDC, SAML).
- Knowing what Entra Connect and Cloud Sync move to the cloud, and what each sign-in method changes.

## Deep Dive

### The lab, and what Samba is and is not

One image, two containers on a private network (`idn-ad-dc1`, `idn-ad-dc2`, no published ports):

```text
$ samba-tool domain provision --realm=LAB.TEST --domain=LAB --server-role=dc --dns-backend=SAMBA_INTERNAL --use-rfc2307
ERROR: File [.../AD_DS_Attributes_Windows_Server_v1903.ldf] not found. Please install samba-ad-provision package
$ samba-tool domain level show      ->  Forest and Domain function level: (Windows) 2008 R2
```

The first provision failed on Debian 13: the schema files are in `samba-ad-provision`, not `samba-ad-dc`. The Samba wiki also gives 2008 R2 (a higher level, since 4.19, is
work in progress). KDC, LDAP, DNS and replication are tasks of one `samba` process. Not measurable here: gMSA, LAPS, Windows defaults, Entra.

### Forest, domain, DC, site

A **forest** is the security boundary and shares one schema. A **domain** (`lab.test`) is the replication and policy unit. A **domain controller** holds a writable copy.
The **Global Catalog** (GC) holds a partial copy of every domain (ports 3268 and 3269). **Sites** model the network so clients pick a near DC. The rootDSE and DNS show the
shape:

```text
namingContexts: DC=lab,DC=test | CN=Configuration,... | CN=Schema,CN=Configuration,... | DC=DomainDnsZones,... | DC=ForestDnsZones,...
domainFunctionality: 4   forestFunctionality: 4   isGlobalCatalogReady: TRUE
anonymous search of DC=lab,DC=test -> Operations error (1): 00002020: Operation unavailable without authentication
_ldap._tcp.lab.test SRV 0 100 389 dc1.lab.test.    _kerberos._tcp.lab.test SRV ... 88    _gc._tcp.lab.test SRV ... 3268
```

Anonymous users get the rootDSE only. A subtree search from the domain root returned three "search references" (Configuration and two DNS zones): another naming context is
a referral. Clients find DCs through DNS SRV records, so broken DNS breaks logins first.

### Objects and the names of one user

I made `OU=Staff` and `OU=Eng,OU=Staff`, users `alice` and `bob`, a computer `ws01` and groups, then read alice over StartTLS:

```text
dn: CN=Alice Doe,OU=Eng,OU=Staff,DC=lab,DC=test         objectClass: top, person, organizationalPerson, user
sAMAccountName: alice   userPrincipalName: alice@lab.test   userAccountControl: 512   primaryGroupID: 513
objectGUID:: 7EJvKhXmTUOPFeUNrXt3cw==    objectSid:: AQUAAAAAAAUVAAAAonVJRUKHeBmnTrkjTwQAAA==
memberOf: CN=GG-Developers,OU=Staff,DC=lab,DC=test
```

| Name | Value | Changes when | Use it as |
|---|---|---|---|
| DN | `CN=Alice Doe,OU=Eng,...` | rename or move | never a key; the RDN is `CN`, not `uid` |
| `sAMAccountName` | `alice` (`LAB\alice`) | admin edits it | legacy logon name |
| `userPrincipalName` | `alice@lab.test` | admin edits it | modern logon name, looks like mail, is not mail |
| `objectGUID` | `2a6f42ec-e615-...` | never | stable key in the forest |
| `objectSid` | `S-1-5-21-...-1103` | move to another domain | what Windows ACLs and tokens hold |

Decoded with 10 lines of Python, the SID is revision 1, 5 sub-authorities, authority 5, then `21`, three 32-bit domain numbers and the **RID** `1103`. The first four
sub-authorities name the domain, the RID the account; well-known RIDs: 500 Administrator, 502 krbtgt, 512 Domain Admins, 513 Domain Users (Learn "Security identifiers",
2025-06-26). `objectGUID` is mixed-endian: raw `ec426f2a15e6...` is `2a6f42ec-e615-434d-8f15-e50dad7b7773`, and read naively gives a different GUID.

Binding with alice's password (`ldapwhoami -ZZ`): `alice@lab.test`, `LAB\alice` and the DN all gave `u:LAB\alice`; bare `alice` gave `Invalid credentials (49) ... data
52e`. After I set her UPN to `alice@corp.example`, both it and the old `alice@lab.test` still bound: Samba falls back to `sAMAccountName@domain` (observed, not tested on
Windows).

`(objectClass=user)` also returned `DC1$` and `ws01$`: `computer` is a subclass of `user` (`subClassOf: user`), so people are
`(&(objectCategory=person)(objectClass=user))`. The schema is readable data (269 classes, 1,499 attributes here).

### Groups: type, scope, nesting and the chain filter

**Type**: security (usable in permissions) or distribution (mail lists). **Scope**: global (members from its own domain), domain local (grants access in its domain, members
from anywhere) and universal (forest-wide, in the GC), per Learn "Security groups" (2025-07-02). `groupType` read: `GG-Developers` `-2147483646` (security, global),
`DL-Repo-Write` `-2147483644` (security, domain local), `UG-Mail-List` `8` (universal distribution); the sign bit is "security". **AGDLP**: Accounts into Global groups (by
role), Global into Domain Local (one per resource), Permission on the Domain Local. Built: alice in `GG-Developers` in `GG-Engineers` in `DL-Repo-Write`.

```text
alice memberOf (direct only):  CN=GG-Developers,OU=Staff,DC=lab,DC=test
(&(objectCategory=person)(memberOf=CN=DL-Repo-Write,...))                          -> 0 entries
(&(objectCategory=person)(memberOf:1.2.840.113556.1.4.1941:=CN=DL-Repo-Write,...)) -> CN=Alice Doe
(memberOf:1.2.840.113556.1.4.1941:=CN=DL-Repo-Write,...)  -> GG-Developers, Alice Doe, GG-Engineers
tokenGroups of alice: -1106 (GG-Developers) -1105 (GG-Engineers) -1107 (DL-Repo-Write) -513 (Domain Users) S-1-5-32-545 (Builtin Users)
```

`memberOf` is one level. `LDAP_MATCHING_RULE_IN_CHAIN` (`1.2.840.113556.1.4.1941`, Learn "Search filter syntax") walks the nesting in the server, at a cost for high
fan-out. `tokenGroups` is the flattened SID list a logon gets, and includes `513`, the primary group, which `memberOf` never shows: "is alice in Domain Users?" on
`memberOf` is wrong. In OpenLDAP (LDAP lesson) `memberOf` is an overlay, filters are not recursive and RDNs are `uid=`.

### `userAccountControl`: a bit field, searched with bit filters

UAC packs account state into one integer (Learn "useraccountcontrol", 2026-02-12). Measured:

```text
new user 512 (NORMAL_ACCOUNT)   setexpiry --noexpiry 66048 (+DONT_EXPIRE_PASSWORD 65536)   disable 66050 (+ACCOUNTDISABLE 2)   enable 66048
ws01$ 4098 (WORKSTATION_TRUST 4096 + disabled until joined)     krbtgt 514 (disabled: nobody logs in as krbtgt)
delegation for-any-service bob on -> 524800 (512 + TRUSTED_FOR_DELEGATION 524288)     DC1$ 532480 (SERVER_TRUST 8192 + 524288)
(userAccountControl:1.2.840.113556.1.4.803:=2) -> Guest, krbtgt, ws01$, bob           # LDAP_MATCHING_RULE_BIT_AND: disabled accounts
```

Constrained delegation is an attribute: `samba-tool delegation add-service bob cifs/dc1.lab.test` set `msDS-AllowedToDelegateTo`, and `samba-tool spn add HTTP/web.lab.test
bob` put an SPN on a user (the Kerberoasting surface of the Kerberos lesson). `NOT_DELEGATED` (1048576) is "cannot be delegated". `msDS-` is AD's extension namespace:
`msDS-KeyVersionNumber: 2` is the `kvno`.

### The two doors: LDAP and Kerberos

```text
ldapsearch -x -H ldap://127.0.0.1 -D alice@lab.test -w ... -> Strong(er) authentication required (8): Transport encryption required
same with -ZZ (StartTLS) -> works      kinit alice@LAB.TEST ; ldapwhoami -Y GSSAPI -> SASL data security layer installed.  u:LAB\alice
klist -e: krbtgt/LAB.TEST@LAB.TEST, 10 h, renew 1 d, aes256-cts-hmac-sha1-96     kvno cifs/dc1.lab.test: kvno = 1
smbclient //dc1.lab.test/netlogon -k -c ls -> lists      wrong password: Password incorrect      disabled bob: credentials have been revoked
```

Samba refuses a plain simple bind by default (`ldap server require strong auth = Yes`); Windows has "LDAP signing" policies (not checked). The tickets are those of the
Kerberos lesson from an AD KDC found by `_kerberos._tcp`, with `krbtgt` (RID 502) holding the key and group SIDs in the PAC. GSSAPI gives an authenticated bind with a
signing layer and no TLS. Gotcha: `ldapwhoami -Y GSSAPI` first failed with `Server not found in Kerberos database`; `rdns = false` did not help, `SASL_NOCANON on` in
`ldap.conf` did (the library canonicalized the host name, most likely by reverse DNS; not checked). LDAP is how apps read and bind, Kerberos is how members sign in,

### Multi-master replication, RID pools and FSMO

Every DC is writable. `samba-tool domain join lab.test DC` made `dc2`; `drs showrepl` there listed `DC1 via RPC` as inbound neighbor for five naming contexts. A user made
on `dc1` appeared on `dc2` within one 5-second poll, before I forced anything. The **RID master** hands each DC a block, so SIDs stay unique:

```text
CN=RID Set,CN=DC1,...  rIDAllocationPool: 1100-1599      carol created on dc1 -> RID 1111
CN=RID Set,CN=DC2,...  rIDAllocationPool: 1600-2099      dave  created on dc2 -> RID 1600
samba-tool fsmo transfer --role=rid (on dc2) -> RidAllocationMasterRole owner: DC2 ; the other four stay on DC1
```

Five **FSMO** roles exist because some operations cannot be multi-master: schema master and domain naming master (per forest), PDC emulator, RID master and infrastructure
master (per domain), per Learn "operations master role placement" (2025-05-12), which also says the PDC emulator processes password changes.

### GPO: a directory object plus files, applied by the client

```text
samba-tool gpo listall -> {31B2F340-016D-11D2-945F-00C04FB984F9} Default Domain Policy ; {6AC1786C-...} Default Domain Controllers Policy
CN={31B2F340-...},CN=Policies,CN=System,DC=lab,DC=test: versionNumber: 0, gPCFileSysPath: \\lab.test\sysvol\lab.test\Policies\{31B2F340-...}
DC=lab,DC=test: gPLink: [LDAP://CN={31B2F340-...},CN=Policies,CN=System,DC=lab,DC=test;0]     # folders of files under SYSVOL
```

A **Group Policy Object** is a `groupPolicyContainer` (metadata, version) plus a SYSVOL folder (settings), linked to a domain, site or OU by `gPLink`. The DC pushes
nothing: a Windows client reads the links for its place in the tree and applies the files (refresh timing not checked here), so OU design is policy design. Samba hosts
GPOs; its wiki says enabling them needs an `smb.conf` step. Default password policy here: complexity on, history 24, minimum length 7, maximum age 42 days (`kinit` warned
"expire in 41 days"), lockout threshold 0: no lockout, so password guessing is silent until you set one.

### Entra ID: what it is and is not (docs only)

Pages: "What is Microsoft Entra?" (2026-06-18), "How and why applications are added" (2022-10-26), "Permissions and consent overview" (2025-03-18). No tenant.

- **A tenant is a directory plus an IdP.** Each gets `contoso.onmicrosoft.com`; a Microsoft 365 or Azure subscriber already has one. Objects are reached by **Microsoft
  Graph** (`https://graph.microsoft.com`); sign-in is OAuth 2.0, OIDC or SAML. Groups are security or Microsoft 365, assigned or **dynamic** (attribute rules). The overview
  lists group policy, LDAP and Kerberos/NTLM as what **Entra Domain Services** adds, a managed domain "for legacy applications" and "transitional". A sentence "Entra ID has
  no OUs or GPO" is not in the pages read, but that split says it. The OU-like tool is the **administrative unit**: a container of users, groups or devices that scopes a
  role, not a policy.
- **App registration versus Enterprise application.** The *application object* (App registrations) is the definition, in its home tenant: redirect URIs, secrets, scopes,
  app roles. A *service principal* (Enterprise applications) is the instance in each tenant using it: assignments, consents and Conditional Access live there; the first
  consent creates it. The OIDC client of the .NET lesson is the first, what an admin governs the second.
- **Delegated versus application permissions.** Delegated (scopes) act for a signed-in user and cannot exceed what the user may do; application permissions (app roles) are
  app-only and "able to access any data that the permission is associated with". Tenant-wide **admin consent** is called sensitive. It is the `scp` versus `roles` split of
  the .NET lesson, and OBO (token exchange lesson) needs consent the same way.
- **Control plane**: Conditional Access (if-then policies "enforced after first-factor authentication"), Privileged Identity Management (just-in-time eligible versus active
  roles, licensed) and **managed identities** (system- or user-assigned, backed by a service principal; the workload identity lesson compares them to SPIFFE). Application
  Proxy is only named here.

### Hybrid: moving identities and choosing the sign-in path (docs only)

Pages: Entra Connect and "user sign-in options" (2025-04-09), Cloud Sync (2026-10-21), Seamless SSO (2025-04-09), hybrid join (2026-10-06), design concepts and PHS
(2025-04-09).

**Sync.** *Connect Sync* is an on-premises Windows application (sync engine, PHS, PTA and AD FS setup, Health). *Cloud Sync* is a light agent plus a cloud service using
SCIM, about every two minutes, several agents, disconnected forests. The Connect page says Cloud Sync "is the future" and "replaces" it; the Cloud Sync page says to check
the migration decision guide and otherwise "continue using Connect Sync". The **source anchor** (`sourceAnchor`, `immutableId`) says "this AD user is that Entra user": set
at install, immutable after the first sync. Default `objectGUID`; Connect 1.1.524.0 and later can use **`ms-DS-ConsistencyGuid`** for users, copying `objectGUID` into it
when empty (the sync account needs write permission). Pick it when users move between forests, since `objectGUID` changes.

| Method | Password checked at | What reaches Entra | Extra infrastructure | Risk shape |
|---|---|---|---|---|
| PHS | Entra | derived hash (MD4 hash, PBKDF2 with HMAC-SHA256, 1,000 iterations, per-user salt) | none beyond sync | the cloud hash is no pass-the-hash credential on premises (doc) |
| PTA | your DC, via agent | nothing stored; outbound-only agents | agents, availability | on-premises policy (logon hours) honored; agents become critical |
| Federation (AD FS, third party) | your IdP | a token from your farm | farm, proxies, certificates | most control, most to run; farm and signing key become Tier 0 |

The sign-in page recommends "the default password hash synchronization option" and the migration guide "We recommend using PHS". That AD FS is declining is not stated in
those pages; a federation-to-cloud migration guide exists, no more. **Seamless SSO** (Kerberos, the SID claim in the ticket) signs in domain-joined devices without a
prompt, works with PHS or PTA, is "opportunistic" (falls back to a password) and not for AD FS; on Windows 10 and later the doc prefers the primary refresh token. **Hybrid
join** keeps the device in AD and registers it in Entra (needs periodic line of sight to a DC). **Password writeback** lets Entra self-service reset change the on-premises
password.

**Friction.** The UPN is the Entra sign-in name. If its suffix is not a verified custom domain (`corp.local` is the classic), Entra replaces it with
`user@contoso.onmicrosoft.com`; the doc offers an *alternate ID* (mail) but "strongly" recommends keeping `userPrincipalName`, and says UPN and mail "might or might not"
match. In the lab, editing the UPN left `sAMAccountName` and `mail` untouched: three separate attributes.

### Security: why AD is the target, in prose

A DC holds every password hash and the `krbtgt` key: owning AD owns the company. MITRE ATT&CK catalogues DCSync (T1003.006) and forged tickets and tokens (T1558,
T1606.002); no recipes here. Controls:

- **Tiers**: keep Tier 0 (DCs, `krbtgt`, AD admins, AD FS) apart from servers and workstations. Book versus today: Learn's "enterprise access model" builds on the AD tier
  model and widens it into a control plane; the "red forest" ESAE is "a legacy approach".
- **LAPS** rotates each machine's local admin password. **gMSA**: the DC derives the service password from a key service, so no human knows it: the answer to an SPN on a
  user like `bob`. Docs only.
- **`krbtgt`** reset twice after a compromise, **Protected Users** (no delegation, NTLM or RC4; the group exists empty in Samba, not tested), a lockout threshold, LDAP
  signing, and audit of who may replicate the directory.

### What to use today, and the table

Book versus today: AD DS is still the center of on-premises Windows and legacy apps (file shares, Kerberos SSO, GPO, SQL Server, IIS). New apps and SaaS use OIDC or SAML
against Entra (or Keycloak, Okta) and receive identities by SCIM. The usual shape is hybrid: AD remains the source of employees, a sync feeds Entra, PHS or PTA is the
sign-in path and new apps never speak LDAP to a DC. Next: choosing a federation protocol across SAML, OIDC, Kerberos and LDAP; the SCIM lesson covers provisioning.

| AD DS concept | Entra ID equivalent | Note |
|---|---|---|
| forest, domain | tenant | the tenant is the boundary; no domain tree |
| DC, replication, FSMO | none exposed | Microsoft runs it; Domain Services gives a managed domain |
| OU | administrative unit | scopes roles only, no policy |
| GPO | Conditional Access, Intune | different settings, not a translation |
| `sAMAccountName`, UPN | UPN, object ID | UPN must be a verified domain |
| SID, groups with scope | object ID (GUID), security and M365 groups | no domain local or global scope |
| LDAP, Kerberos, NTLM | Graph, OIDC, SAML | Kerberos only via Seamless SSO or Domain Services |
| gMSA, delegation | managed identity, on-behalf-of | same idea, other mechanism |

## Trade-offs

- **Samba AD versus Windows AD.** Reproducible in a container in minutes, but 2008 R2 levels, GPO setup and Windows-only features unmeasured: for learning and tests, not
  proof of production behavior.
- **Nested groups (AGDLP) versus flat.** Permissions stay on resources and roles on people, but `memberOf` shows one level and chain queries cost more: use `tokenGroups` or
  the chain rule and test depth.
- **Stable key versus pretty name.** `objectGUID` (Entra object ID) survives renames; `sAMAccountName`, UPN and DN do not.
- **PHS, PTA or federation.** PHS runs least infrastructure but keeps a derived hash in the cloud; PTA keeps policy on premises with critical agents; federation gives
  control and the largest attack surface. The docs recommend PHS.

## Documentation Links

- [Active Directory Domain Services overview, Microsoft Learn](https://learn.microsoft.com/en-us/windows-server/identity/ad-ds/get-started/virtual-dc/active-directory-domain-services-overview) (doc)
- [Security identifiers, Microsoft Learn](https://learn.microsoft.com/en-us/windows-server/identity/ad-ds/manage/understand-security-identifiers) (doc)
- [Active Directory security groups, Microsoft Learn](https://learn.microsoft.com/en-us/windows-server/identity/ad-ds/manage/understand-security-groups) (doc)
- [Operations master role placement, Microsoft Learn](https://learn.microsoft.com/en-us/windows-server/identity/ad-ds/plan/planning-operations-master-role-placement) (doc)
- [Search filter syntax, Microsoft Learn](https://learn.microsoft.com/en-us/windows/win32/adsi/search-filter-syntax) (doc)
- [What is Microsoft Entra?, Microsoft Learn](https://learn.microsoft.com/en-us/entra/fundamentals/whatis) (doc)
- [How and why applications are added to Microsoft Entra ID, Microsoft Learn](https://learn.microsoft.com/en-us/entra/identity-platform/how-applications-are-added) (doc)
- [Overview of permissions and consent, Microsoft Learn](https://learn.microsoft.com/en-us/entra/identity-platform/permissions-consent-overview) (doc)
- [What is Microsoft Entra Connect?, Microsoft Learn](https://learn.microsoft.com/en-us/entra/identity/hybrid/connect/whatis-azure-ad-connect) (doc)
- [What is Microsoft Entra Cloud Sync?, Microsoft Learn](https://learn.microsoft.com/en-us/entra/identity/hybrid/cloud-sync/what-is-cloud-sync) (doc)
- [Microsoft Entra Connect user sign-in options, Microsoft Learn](https://learn.microsoft.com/en-us/entra/identity/hybrid/connect/plan-connect-user-signin) (doc)
- [Password hash synchronization, Microsoft Learn](https://learn.microsoft.com/en-us/entra/identity/hybrid/connect/how-to-connect-password-hash-synchronization) (doc)
- [Microsoft Entra seamless single sign-on, Microsoft Learn](https://learn.microsoft.com/en-us/entra/identity/hybrid/connect/how-to-connect-sso) (doc)
- [Enterprise access model, Microsoft Learn](https://learn.microsoft.com/en-us/security/compass/privileged-access-access-model) (doc)
- [Setting up Samba as an Active Directory Domain Controller, Samba Wiki](https://wiki.samba.org/index.php/Setting_up_Samba_as_an_Active_Directory_Domain_Controller) (doc)
- [T1003.006, OS Credential Dumping: DCSync, MITRE ATT&CK](https://attack.mitre.org/techniques/T1003/006/) (doc)
