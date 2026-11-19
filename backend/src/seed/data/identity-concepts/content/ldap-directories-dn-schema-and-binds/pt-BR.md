---
version: 1.0
updatedAt: 2026-11-19
title: "LDAP: Diretórios, DN, Schema e Binds"
summary: LDAP medido contra um OpenLDAP 2.6.10 local. A árvore (DIT, DN, RDN), os erros de schema (MUST/MAY, estrutural contra auxiliar), todas as operações, escopos e filtros da RFC 4515, o custo de um índice em 50.000 entradas medido no log do servidor, bind anônimo, simples, SASL e o bug do "unauthenticated bind", LDAPS contra StartTLS vistos no fio, ACLs, hashes de userPassword ({SSHA} e {ARGON2}), paginação, referrals, o padrão busca-e-depois-bind e LDAP injection contra um script de brinquedo local com a defesa de escape.
---
## Objective

LDAP lê e grava um diretório: uma árvore de entradas otimizada para muita leitura e
pouca escrita, cada uma com atributos tipados governados por um schema. Ainda é o
fio por trás do Active Directory, da federação de usuários do Keycloak e de muito
login legado. Esta lição opera um OpenLDAP de verdade: erros de schema, todas as
operações, filtros da RFC 4515, quanto vale um índice (50.000 entradas), tipos de
bind e o bug do "unauthenticated bind", LDAPS contra StartTLS no fio, ACLs, hashes
de senha, paginação, referrals, busca-e-depois-bind e LDAP injection (um brinquedo local).
Versions: OpenLDAP `slapd` 2.6.10 (pacote do Debian 13, imagem própria: o projeto
não publica imagem e a `osixia/openldap:1.5.0` é um build 2.4 sem manutenção),
clientes 2.4.28 (macOS) e 2.6.10, OpenSSL 4.0.3, Python 3.13. O openldap.org lista a 2.6.16.

## Use Cases

- Ler um "login LDAP" legado e depurar `(65)` ou `No such object (32)`.
- Desenhar uma conta de serviço, um filtro e um índice para busca de usuário.

## Deep Dive

### A árvore, o schema e as operações

O nome distinto (DN) de uma entrada é o seu nome relativo (RDN) mais o DN do pai; a
árvore é a DIT. Você endereça entradas por DN: sem joins, sem transação entre
entradas. DNs seguem a RFC 4514 (vírgula escapada, `+` para RDN multivalorado) e
casam normalizados: adicionar `cn=Doe\, Jane+uid=jane,...` voltou como
`cn=Doe\2C Jane+uid=jane,...`, e `-b 'UID=Alice , OU=People,dc=example, dc=org'`
achou `uid=alice,ou=people,...`. Árvore do laboratório: `ou=people`, `ou=groups`,
`ou=services` sob `dc=example,dc=org`.

Cada entrada lista valores de `objectClass`; o schema (`cn=Subschema`) diz o que cada
classe MUST e MAY ter. Classes STRUCTURAL formam uma única cadeia (`person` >
`organizationalPerson` > `inetOrgPerson`), as AUXILIARY acrescentam atributos
(`posixAccount`: MUST `cn uid uidNumber gidNumber homeDirectory`).

| Tentativa | Resultado |
|---|---|
| `inetOrgPerson` sem `sn` | `Object class violation (65)`: `requires attribute 'sn'` |
| `mail` num `organizationalUnit` | `(65)`: `attribute 'mail' not allowed` |
| atributo desconhecido / segunda cadeia estrutural | `Undefined attribute type (17)` / `(65)`: `invalid structural object class chain` |
| `posixAccount` sozinha / tirá-la e manter `uidNumber` | `(65)`: `requires 'uidNumber'` / `'uidNumber' not allowed` |
| pai inexistente / duplicada / apagar não-folha | `(32)` com `matched DN` / `(68)` / `(66)` |

Uma classe e seus atributos precisam sair no mesmo modify. Surpresa: adicionar
`uid=dave` sem atributo `uid` funcionou, o servidor acrescentou `uid: dave`.

Os verbos (RFC 4511) são bind, search, add, modify, modify DN, delete, compare,
abandon e extended. `ldapcompare ... departmentNumber:finance` deu TRUE; `ldapwhoami`
(RFC 4532) deu `dn:uid=alice,...`, ou `anonymous` sem bind; `ldappasswd` (RFC 3062)
trocou uma senha. Armadilhas: `ldapmodrdn` sem `-r` mantém o valor antigo do RDN
(bob renomeado para robert e de volta ficou com `uid: bob` e `uid: robert`); e
`ldapcompare ... userPassword:'correct horse'` imprimiu `FALSE` para a senha certa,
porque compare é literal e não entende `{SSHA}`.

### Escopos, filtros e custo de índice

Uma busca é base DN, escopo (`base` a entrada, `one` os filhos, `sub` a subárvore),
filtro (RFC 4515) e atributos. Em 5.000 usuários gerados sob `ou=bulk`:

```text
base dc=example,dc=org -> 1    one -> 4    sub -> 5009    sub ou=people -> 3
(&(objectClass=inetOrgPerson)(departmentNumber=dept3)) -> 250
(&(departmentNumber=dept3)(!(sn=Lastname3)))             -> 247
(|(uid=alice)(uid=bob)) -> 2   (mail=*) -> 2   (uid=user0001*) -> 10   (UID=ALICE) -> 1
```

Filtros são notação prefixa (`&`, `|`, `!`, `=`, `>=`, `<=`, `~=`). `(uid=alice` falha no
cliente com `Bad search filter (-7)`; atributo não definido (`(nosuch=1)`) devolve 0
entradas com rc 0, não é erro; `~=` é fonético (`(sn~=Lastnme3)` casou os 5.000, então
nunca use como busca). `* ( ) \` literais num valor se escrevem `\2a \28 \29 \5c`.

Sem índice, o servidor testa toda entrada sob a base. Com `ou=bulk` em 50.000 usuários
(índices `objectClass eq`, `uid eq`, `cn eq,sub`), o `etime` do próprio servidor no log
`stats` (o tempo do cliente esconde isso atrás de 15 ms de início de processo):

| Filtro | Índice | `etime` |
|---|---|---|
| `(uid=user04999)` | `uid eq` | 0,08 ms |
| `(employeeNumber=104999)` | nenhum | 12,3 ms |
| idem, `olcDbIndex: employeeNumber eq` adicionado online | definido, não construído | 12,3 ms |
| idem, depois do `slapindex` (slapd parado, cerca de um minuto) | construído | 0,09 ms |
| `(uid=user0499*)` | `uid` só tem `eq` | 12,5 ms |

O custo cresce com as entradas, `eq` não atende substring, um `olcDbIndex` online
espera o `slapindex`, e num AND o servidor escolhe o termo indexado.

`groupOfNames` guarda `member: <DN>`, então "grupos da alice" é uma busca reversa; o
overlay `memberof` mantém um `memberOf` somente leitura no usuário, usável em
filtros. Não há chave estrangeira: `member: uid=ghost,...` foi aceito; o `refint` limpa
na exclusão (apagar o bob o tirou de `editors`), não na escrita.

### Bind: quem você é nesta conexão

Medido (RFC 4513):
```text
sem bind                                   -> anonymous
bind simples, senha certa                  -> dn:uid=alice,ou=people,...
bind simples, senha errada / DN inexistente -> Invalid credentials (49) nos dois
DN + senha vazia (padrão do servidor)      -> Server is unwilling to perform (53):
                                              unauthenticated bind ... disallowed
```

O mesmo `(49)` nas duas falhas evita enumeração de usuários. O bug clássico é o último
caso num servidor que o aceita (`olcAllows: bind_anon_dn`, visto em configs antigas):
o bind sucede como anônimo, e um verificador de brinquedo que confia em "o bind deu
certo" loga qualquer um com senha vazia:

```text
padrão do servidor, senha vazia  -> login failed
bind_anon_dn ligado, senha vazia -> ldapwhoami: anonymous, rc=0 -> ingênuo: LOGIN OK
corrigido: rejeitar "" antes, exigir whoami == "dn:<DN pedido>"   -> login failed
```

SASL (RFC 4422) embrulha outros mecanismos. Por `ldapi:///`, o `EXTERNAL` funcionou
(`ldapwhoami -Y EXTERNAL` deu `dn:gidNumber=0+uidNumber=0,cn=peercred,...`: identidade
vinda do SO ou de um certificado de cliente TLS, sem segredo). O `DIGEST-MD5` falhou
(`Couldn't find mech`, fora da minha imagem) e é histórico (RFC 6331); `GSSAPI` é
Kerberos (só documentação). Quase todo app usa bind simples, que exige TLS.

### LDAPS contra StartTLS, no fio

Um relay em Python entre cliente e servidor contou os bytes do cliente e procurou a senha:
```text
ldap:// (sem TLS)         103 bytes, secret visible: True
  0>\x02\x01\x01`9\x02\x01\x03\x04%uid=alice,ou=people,dc=example,dc=org\x80\rcorrect horse
ldaps:// (636)           1806 bytes, secret visible: False
ldap:// + StartTLS (-ZZ) 1837 bytes, secret visible: False
```

O BER é versão 3, o DN, a tag `0x80` (autenticação simples) e a senha. LDAPS embrulha a
conexão desde o primeiro byte na 636; StartTLS (RFC 4513) é uma operação estendida que
promove a porta 389. `openssl s_client -connect localhost:6321` e `-connect
localhost:6320 -starttls ldap` deram `TLSv1.3, TLS_AES_256_GCM_SHA384`, `Verification:
OK`. Com uma CA não confiável, o `-ZZ` falhou (`self-signed certificate in certificate
chain`): o cliente precisa verificar, ou o TLS só barra sniffing. Para forçar TLS,
`olcSecurity: simple_bind=128` fez o bind simples em claro falhar com `Confidentiality
required (13)`, enquanto StartTLS e LDAPS funcionaram.

### ACLs e `userPassword`

As regras `olcAccess` rodam em ordem, a primeira que casa vale. As minhas: `userPassword`
para o próprio e `auth`; `mail` e `departmentNumber` para o próprio, `svc-search` e `editors`.
Busca de `uid mail departmentNumber` em `ou=people`:

| Identidade | O que voltou |
|---|---|
| anônimo | `No such object (32)`: escondido, não vazio |
| bob (usuário) | o próprio `mail`; alice aparece só com `uid`; escrever `mail` deu `(50)` |
| alice (em `editors`), `svc-search` | `mail` e `departmentNumber` de todos, nunca `userPassword` |

ACLs valem também nos filtros: `(departmentNumber=finance)` deu 0 entradas para o bob e 1
para a alice embora o dado casasse, o que barra sondagem um filtro por vez. `by self
write` implica leitura (bob viu o próprio hash); `=xw` evita isso.

`userPassword` é uma etiqueta de esquema mais um hash. `{SSHA}` é Base64 de SHA-1(senha +
salt) + salt:

```text
{SSHA}WiSP9GpTtu3tdGOZkToFmbqedteTujpZ    24 bytes: 20 de digest + 4 de salt
sha1("correct horse" + salt) = 5a248ff4...e9e76d7 = o digest da entrada
{ARGON2}$argon2id$v=19$m=7168,t=5,p=1$ivYO70sFwRCPZo5FfE3ogQ$qGwYXfx3otKIo...
```

A mesma senha em duas execuções do `slappasswd` dá dois hashes. SHA-1 é rápido de quebrar
por força bruta, então `{ARGON2}` (módulo `argon2.so`) é a escolha hoje, com um preço
por bind: `etime` de 0,08 ms com `{SSHA}`, 10 a 18 ms com `{ARGON2}` (cerca de 130 vezes).
O Password Modify faz o hash no servidor (`olcPasswordHash: {ARGON2}` gerou argon2id),
mas um cliente que escreve o atributo grava o que enviou: `userPassword: plain-text-pw`
ficou em texto claro. Bloqueio é o overlay `ppolicy` (só documentação).

### Limites, paginação e referrals

Uma identidade não-root recebe 500 entradas: a alice sobre 50.000 usuários levou `Size
limit exceeded (4)`, e o Paged Results (RFC 2696, `-E pr=100/noprompt`) não levantou o
teto. Com `olcLimits ... size.pr=1000 size.prtotal=unlimited` na conta de serviço,
`pr=1000` devolveu 50 páginas e 50.000 entradas; `pr=10000` levou `(11)`.

Uma entrada de referral (`objectClass: referral`, `ref:`) aponta para outro lugar: uma
busca base abaixo dela deu `Referral (10)` com `Matched DN` e a URL, uma busca de
subárvore deu um "search reference", `-M` mostra a entrada, `-C` o segue. Seguir
conecta a uma URL guardada em dado, então apps costumam desligar isso.

### O padrão de login e a LDAP injection

Spring, ASP.NET e Keycloak buscam com uma conta de serviço e depois fazem bind como o
usuário; os grupos alimentam os papéis. Meu `login.sh`:

```text
login.sh alice 'correct horse' -> OK dn=uid=alice,... groups=[editors]
login.sh bob 'bobs secret'     -> OK ... groups=[]   (usuário {ARGON2})
login.sh 'a*' x -> reject: 0 matches      login.sh alice '' -> reject
```

Por que não comparar você mesmo: a ACL esconde `userPassword`, o esquema varia por
entrada, o `ldapcompare` disse FALSE, e o bind alimenta logs e bloqueio.

Quando o filtro é concatenado, a entrada vira sintaxe. Meu brinquedo local `lookup.sh`
(não é padrão para copiar) monta `(&(uid=INPUT)(departmentNumber=sales))`:

```text
a*                  -> alice (curinga)
alice)(mail=alice@* -> (&(uid=alice)(mail=alice@*)(departmentNumber=sales)) achou,
                       e `mail=z*` não acha nada: um oráculo booleano
*)(uid=*))(|(uid=*  -> Bad search filter (-7): a libldap recusa o payload de dois filtros
```

O último é o payload de livro (fecha o AND cedo e anexa um segundo filtro). O cliente do
OpenLDAP o recusou, mas curingas enumeram e a cláusula extra lê qualquer atributo que a
conta consiga ler (`userPassword={SSHA}*` não achou nada só porque a ACL o esconde).
Parsers que ignoram o texto depois do primeiro filtro completo aceitariam o payload de
livro (não medido). A defesa é o escape da RFC 4515: o modo seguro enviou
`(&(uid=\2a\29\28uid=\2a\29\29\28|\28uid=\2a)(departmentNumber=sales))` e achou 0
entradas. Use o escape da sua biblioteca (Spring LDAP `LdapEncoder.filterEncode`,
python-ldap `escape_filter_chars`) e uma ACL estreita.

Replicação (só documentação): o `syncrepl` (RFC 4533) puxa de um provedor; configurações
multi-provider aceitam escrita em vários servidores e convergem pelo `entryCSN`. Livro
contra hoje: LDAP continua sendo o protocolo do Active Directory e dos repositórios de
usuários locais, mas apps novos usam OIDC contra um IdP (Keycloak) que federa o diretório,
e SCIM para provisionar. Próximo na trilha: Active Directory e Entra ID, escolher um
protocolo de federação, SCIM.

| Conceito | Comando | O que observar |
|---|---|---|
| schema, rootDSE | `ldapsearch -x -b cn=Subschema -s base objectClasses` | MUST/MAY |
| busca | `ldapsearch -x -H URL -D DN -w PW -b BASE -s sub 'F'` | escopo, filtro, `(-7)` |
| escrita | `ldapadd`, `ldapmodify`, `ldapmodrdn -r`, `ldapdelete` | `(65)`, `(68)` |
| bind | `ldapwhoami -D DN -w ''`, `-Y EXTERNAL` | `(53)` ou `anonymous` |
| TLS | `-ZZ`, `ldaps://`, `openssl s_client -starttls ldap` | resultado da verificação |
| índice, paginação | log `stats` do slapd, `-E pr=1000/noprompt` | `etime=` |
| injection | imprimir o filtro antes de enviar | `\2a \28 \29` |

## Trade-offs

- **Diretório contra banco relacional.** Leitura rápida por índice e subárvore, mas sem
  joins nem transação entre entradas: identidade, não dado de aplicação.
- **Índices contra custo de escrita.** De 12 ms a 0,09 ms aqui, pagos em escrita e
  reindexação mais lentas; indexe o que os filtros usam.
- **Busca-e-bind contra bind por padrão de DN.** O primeiro funciona com qualquer
  layout e dá grupos, mas exige uma conta privilegiada sob ACL estreita; o segundo não
  exige, mas pede um layout de DN uniforme.
- **Argon2 contra SSHA.** Hashes roubados custam muito mais para quebrar, o bind custa
  130 vezes mais: dimensione para o pico de logins e mantenha o TLS obrigatório.

## Documentation Links

- [RFC 4511, LDAP: The Protocol, IETF](https://datatracker.ietf.org/doc/html/rfc4511) (doc)
- [RFC 4512, LDAP: Directory Information Models, IETF](https://datatracker.ietf.org/doc/html/rfc4512) (doc)
- [RFC 4513, LDAP: Authentication Methods and Security Mechanisms, IETF](https://datatracker.ietf.org/doc/html/rfc4513) (doc)
- [RFC 4514, LDAP: String Representation of Distinguished Names, IETF](https://datatracker.ietf.org/doc/html/rfc4514) (doc)
- [RFC 4515, LDAP: String Representation of Search Filters, IETF](https://datatracker.ietf.org/doc/html/rfc4515) (doc)
- [RFC 2696, LDAP Control Extension for Simple Paged Results, IETF](https://datatracker.ietf.org/doc/html/rfc2696) (doc)
- [OpenLDAP Software 2.6 Administrator's Guide, OpenLDAP](https://www.openldap.org/doc/admin26/) (doc)
- [LDAP Injection Prevention Cheat Sheet, OWASP](https://cheatsheetseries.owasp.org/cheatsheets/LDAP_Injection_Prevention_Cheat_Sheet.html) (doc)
