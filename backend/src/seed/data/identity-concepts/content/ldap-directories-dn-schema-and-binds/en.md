---
version: 1.0
updatedAt: 2026-11-19
---
## Objective

LDAP reads and writes a directory: a tree of entries tuned for many reads and
few writes, each a bag of typed attributes governed by a schema. It is still
the wire behind Active Directory, Keycloak user federation and legacy login.
This lesson drives a real OpenLDAP: schema errors, every operation, RFC 4515
filters, what an index is worth (50,000 entries), bind types and the
"unauthenticated bind" bug, LDAPS against StartTLS on the wire, ACLs, password
hashes, paging, referrals, search-then-bind and LDAP injection (a local toy).
Versions: OpenLDAP `slapd` 2.6.10 (Debian 13 package, own image: upstream ships
none and `osixia/openldap:1.5.0` is an unmaintained 2.4 build), clients 2.4.28
(macOS) and 2.6.10, OpenSSL 4.0.3, Python 3.13. openldap.org lists 2.6.16.

## Use Cases

- Reading a legacy "LDAP login" and debugging `(65)` or `No such object (32)`.
- Designing a service account, a filter and an index for user lookup.

## Deep Dive

### The tree, the schema and the operations

An entry's distinguished name (DN) is its relative name (RDN) plus its parent's
DN; the tree is the DIT. You address entries by DN: no joins, no transactions
across entries. DNs follow RFC 4514 (commas escaped, `+` for multi-valued RDNs)
and match normalized: adding `cn=Doe\, Jane+uid=jane,...` read back as
`cn=Doe\2C Jane+uid=jane,...`, and `-b 'UID=Alice , OU=People,dc=example, dc=org'`
found `uid=alice,ou=people,...`.

Lab tree: `ou=people`, `ou=groups`, `ou=services` under `dc=example,dc=org`.

Each entry lists `objectClass` values; the schema (`cn=Subschema`) says what
each MUST and MAY hold. STRUCTURAL classes form one chain (`person` >
`organizationalPerson` > `inetOrgPerson`), AUXILIARY ones add attributes
(`posixAccount`: MUST `cn uid uidNumber gidNumber homeDirectory`).

| Attempt | Result |
|---|---|
| `inetOrgPerson` without `sn` | `Object class violation (65)`: `requires attribute 'sn'` |
| `mail` on an `organizationalUnit` | `(65)`: `attribute 'mail' not allowed` |
| unknown attribute / second structural chain | `Undefined attribute type (17)` / `(65)`: `invalid structural object class chain` |
| `posixAccount` alone / drop it, keep `uidNumber` | `(65)`: `requires 'uidNumber'` / `'uidNumber' not allowed` |
| missing parent / duplicate / delete non-leaf | `(32)` with `matched DN` / `(68)` / `(66)` |

A class and its attributes must change in one modify. Surprise: adding `uid=dave`
with no `uid` attribute worked, the server added `uid: dave`.

The verbs (RFC 4511) are bind, search, add, modify, modify DN, delete, compare,
abandon and extended. `ldapcompare ... departmentNumber:finance` gave TRUE;
`ldapwhoami` (RFC 4532) gave `dn:uid=alice,...`, or `anonymous` with no bind;
`ldappasswd` (RFC 3062) changed a password. Traps: `ldapmodrdn` without
`-r` keeps the old RDN value (bob renamed to robert and back held `uid: bob`
and `uid: robert`); and `ldapcompare ... userPassword:'correct horse'` printed
`FALSE` for the right password, since compare is literal and ignores `{SSHA}`.

### Scopes, filters and index cost

A search is base DN, scope (`base` the entry, `one` children, `sub` subtree),
filter (RFC 4515) and attributes. On 5,000 generated users under `ou=bulk`:

```text
base dc=example,dc=org -> 1    one -> 4    sub -> 5009    sub ou=people -> 3
(&(objectClass=inetOrgPerson)(departmentNumber=dept3)) -> 250
(&(departmentNumber=dept3)(!(sn=Lastname3)))             -> 247
(|(uid=alice)(uid=bob)) -> 2   (mail=*) -> 2   (uid=user0001*) -> 10   (UID=ALICE) -> 1
```

Filters are prefix notation (`&`, `|`, `!`, `=`, `>=`, `<=`, `~=`). `(uid=alice` fails in the client with `Bad search filter (-7)`; an
undefined attribute (`(nosuch=1)`) returns 0 entries with rc 0, not an error;
`~=` is phonetic (`(sn~=Lastnme3)` matched all 5,000, so never use it as a
lookup). Literal `* ( ) \` in a value are written `\2a \28 \29 \5c`.

Without an index the server tests every entry under the base. With `ou=bulk`
at 50,000 users (indexes `objectClass eq`, `uid eq`, `cn eq,sub`), the server's
own `etime` in its `stats` log (client wall time hides it behind 15 ms of process
start):

| Filter | Index | `etime` |
|---|---|---|
| `(uid=user04999)` | `uid eq` | 0.08 ms |
| `(employeeNumber=104999)` | none | 12.3 ms |
| same, `olcDbIndex: employeeNumber eq` added online | defined, not built | 12.3 ms |
| same, after `slapindex` (slapd stopped, about a minute) | built | 0.09 ms |
| `(uid=user0499*)` | `uid` has only `eq` | 12.5 ms |

Cost grows with entries, `eq` does not serve substrings, an online `olcDbIndex`
waits for `slapindex`, and in an AND the server picks the indexed term.

`groupOfNames` stores `member: <DN>`, so "groups of alice" is a reverse search;
the `memberof` overlay keeps a read-only `memberOf` on the user, usable in
filters. There are no foreign keys: `member: uid=ghost,...` was accepted;
`refint` cleans up on delete (deleting bob left `editors`), not on write.

### Bind: who you are on this connection

Measured (RFC 4513):
```text
no bind                                   -> anonymous
simple bind, right password               -> dn:uid=alice,ou=people,...
simple bind, wrong password / unknown DN  -> Invalid credentials (49) for both
DN + empty password (server default)      -> Server is unwilling to perform (53):
                                             unauthenticated bind ... disallowed
```

Same `(49)` for both failures avoids user enumeration. The classic bug is the
last case on a server that allows it (`olcAllows: bind_anon_dn`, seen in old
configs): the bind succeeds as anonymous, so a toy verifier that trusts "the
bind succeeded" logs in anyone with an empty password:

```text
default server, empty password   -> login failed
bind_anon_dn on, empty password  -> ldapwhoami: anonymous, rc=0 -> naive: LOGIN OK
fixed: reject "" first, require whoami == "dn:<DN asked>"       -> login failed
```

SASL (RFC 4422) wraps other mechanisms. Over `ldapi:///`, `EXTERNAL` worked
(`ldapwhoami -Y EXTERNAL` gave `dn:gidNumber=0+uidNumber=0,cn=peercred,...`:
identity from the OS or a TLS client certificate, no secret). `DIGEST-MD5` failed
(`Couldn't find mech`, not in my image) and is historic (RFC 6331); `GSSAPI` is
Kerberos (docs only). Almost every app uses simple bind, which needs TLS.

### LDAPS against StartTLS, on the wire

A Python relay between client and server counted client bytes and searched for
the password:
```text
ldap:// (no TLS)          103 bytes, secret visible: True
  0>\x02\x01\x01`9\x02\x01\x03\x04%uid=alice,ou=people,dc=example,dc=org\x80\rcorrect horse
ldaps:// (636)           1806 bytes, secret visible: False
ldap:// + StartTLS (-ZZ) 1837 bytes, secret visible: False
```

The BER is version 3, the DN, tag `0x80` (simple auth), the password. LDAPS wraps
the connection from the first byte on 636; StartTLS (RFC 4513) is an extended
operation that upgrades port 389. `openssl s_client -connect localhost:6321` and
`-connect localhost:6320 -starttls ldap` both gave `TLSv1.3,
TLS_AES_256_GCM_SHA384`, `Verification: OK`. With an untrusted CA, `-ZZ` failed
(`self-signed certificate in certificate chain`): clients must verify, or TLS
only stops sniffing. To force TLS, `olcSecurity: simple_bind=128` made a plain
bind fail with `Confidentiality required (13)` while StartTLS and LDAPS worked.

### ACLs and `userPassword`

`olcAccess` rules run in order, first match wins. Mine: `userPassword` for self
and `auth`; `mail` and `departmentNumber` for self, `svc-search` and `editors`.
Search `uid mail departmentNumber` on `ou=people`:

| Identity | What came back |
|---|---|
| anonymous | `No such object (32)`: hidden, not empty |
| bob (user) | own `mail`; alice appears with `uid` only; writing `mail` gave `(50)` |
| alice (in `editors`), `svc-search` | `mail` and `departmentNumber` of everyone, never `userPassword` |

ACLs apply to filters too: `(departmentNumber=finance)` returned 0 entries for
bob and 1 for alice although the data matched, which stops one-filter-at-a-time
probing. `by self write` implies read (bob saw his own hash); `=xw` avoids it.

`userPassword` is a scheme tag plus a hash. `{SSHA}` is Base64 of SHA-1(password
+ salt) + salt:

```text
{SSHA}WiSP9GpTtu3tdGOZkToFmbqedteTujpZ    24 bytes: 20 digest + 4 salt
sha1("correct horse" + salt) = 5a248ff4...e9e76d7 = the digest in the entry
{ARGON2}$argon2id$v=19$m=7168,t=5,p=1$ivYO70sFwRCPZo5FfE3ogQ$qGwYXfx3otKIo...
```

Same password, two `slappasswd` runs, two hashes. SHA-1 is fast to brute-force,
so `{ARGON2}` (module `argon2.so`) is the choice today, at a price per bind:
`etime` 0.08 ms with `{SSHA}`, 10 to 18 ms with `{ARGON2}` (about 130 times). Password Modify hashes on the server (`olcPasswordHash: {ARGON2}` gave
argon2id), but a client writing the attribute stores what it sends:
`userPassword: plain-text-pw` stayed cleartext. Lockout is the `ppolicy`
overlay (docs only).

### Limits, paging and referrals

A non-root identity gets 500 entries: alice over 50,000 users got `Size limit
exceeded (4)`, and Paged Results (RFC 2696, `-E pr=100/noprompt`) did not lift
it. With `olcLimits ... size.pr=1000 size.prtotal=unlimited` on the service
account, `pr=1000` returned 50 pages and 50,000 entries; `pr=10000` got `(11)`.

A referral entry (`objectClass: referral`, `ref:`) points elsewhere: a base
search below it gave `Referral (10)` with `Matched DN` and the URL, a subtree
search a "search reference", `-M` shows the entry, `-C` follows it. Chasing
connects to a URL stored in data, so apps usually turn it off.

### The login pattern, and LDAP injection

Spring, ASP.NET and Keycloak search with a service account, then bind as the
user; groups feed roles. My `login.sh`:

```text
login.sh alice 'correct horse' -> OK dn=uid=alice,... groups=[editors]
login.sh bob 'bobs secret'     -> OK ... groups=[]   (an {ARGON2} user)
login.sh 'a*' x -> reject: 0 matches      login.sh alice '' -> reject
```

Why not compare yourself: the ACL hides `userPassword`, schemes vary per entry,
`ldapcompare` said FALSE, and a bind feeds logs and lockout.

When a filter is concatenated, input becomes syntax. My local toy `lookup.sh`
(not a pattern to copy) builds `(&(uid=INPUT)(departmentNumber=sales))`:

```text
a*                  -> alice (wildcard)
alice)(mail=alice@* -> (&(uid=alice)(mail=alice@*)(departmentNumber=sales)) found,
                       and `mail=z*` finds nothing: a boolean oracle
*)(uid=*))(|(uid=*  -> Bad search filter (-7): libldap refuses the two-filter payload
```

The last is the textbook payload (close the AND early, append a second filter).
OpenLDAP's client refused it, but wildcards enumerate and the extra clause reads
any attribute the account can read (`userPassword={SSHA}*` found nothing only
because the ACL hides it). Parsers that ignore trailing text would accept the
textbook payload (not measured). The defense is RFC 4515 escaping: the safe mode sent `(&(uid=\2a\29\28uid=\2a\29\29\28|\28uid=\2a)(departmentNumber=sales))`
and found 0 entries. Use your library's escape (Spring LDAP
`LdapEncoder.filterEncode`, python-ldap `escape_filter_chars`) and a narrow ACL.

Replication (docs only): `syncrepl` (RFC 4533) pulls from a provider; multi-provider
setups take writes on several servers and converge by `entryCSN`. Book versus
today: LDAP remains the protocol of Active Directory and on-premises user
stores, but new apps use OIDC against an IdP (Keycloak) that federates the
directory, and SCIM to provision. Next in this track: Active Directory and
Entra ID, choosing a federation protocol, SCIM.

| Concept | Command | What to observe |
|---|---|---|
| schema, rootDSE | `ldapsearch -x -b cn=Subschema -s base objectClasses` | MUST/MAY |
| search | `ldapsearch -x -H URL -D DN -w PW -b BASE -s sub 'F'` | scope, filter, `(-7)` |
| write | `ldapadd`, `ldapmodify`, `ldapmodrdn -r`, `ldapdelete` | `(65)`, `(68)` |
| bind | `ldapwhoami -D DN -w ''`, `-Y EXTERNAL` | `(53)` or `anonymous` |
| TLS | `-ZZ`, `ldaps://`, `openssl s_client -starttls ldap` | verify result |
| index, paging | slapd `stats` log, `-E pr=1000/noprompt` | `etime=` |
| injection | print the filter before sending | `\2a \28 \29` |

## Trade-offs

- **Directory versus relational database.** Fast indexed and subtree reads, but
  no joins or cross-entry transactions: identity, not application data.
- **Indexes versus write cost.** 12 ms to 0.09 ms here, paid in slower writes
  and reindexing; index what filters use.
- **Search-then-bind versus bind by DN pattern.** The first works with any
  layout and gives groups but needs a privileged account under a narrow ACL;
  the second needs none but a uniform DN layout.
- **Argon2 versus SSHA.** Stolen hashes cost far more to crack, binds 130
  times more: size for the login peak, and keep TLS mandatory.

## Documentation Links

- [RFC 4511, LDAP: The Protocol, IETF](https://datatracker.ietf.org/doc/html/rfc4511) (doc)
- [RFC 4512, LDAP: Directory Information Models, IETF](https://datatracker.ietf.org/doc/html/rfc4512) (doc)
- [RFC 4513, LDAP: Authentication Methods and Security Mechanisms, IETF](https://datatracker.ietf.org/doc/html/rfc4513) (doc)
- [RFC 4514, LDAP: String Representation of Distinguished Names, IETF](https://datatracker.ietf.org/doc/html/rfc4514) (doc)
- [RFC 4515, LDAP: String Representation of Search Filters, IETF](https://datatracker.ietf.org/doc/html/rfc4515) (doc)
- [RFC 2696, LDAP Control Extension for Simple Paged Results, IETF](https://datatracker.ietf.org/doc/html/rfc2696) (doc)
- [OpenLDAP Software 2.6 Administrator's Guide, OpenLDAP](https://www.openldap.org/doc/admin26/) (doc)
- [LDAP Injection Prevention Cheat Sheet, OWASP](https://cheatsheetseries.owasp.org/cheatsheets/LDAP_Injection_Prevention_Cheat_Sheet.html) (doc)
