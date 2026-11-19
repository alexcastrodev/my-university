---
version: 1.0
updatedAt: 2026-11-19
title: "Kerberos: Tickets, TGT, Delegação e NTLM"
summary: Kerberos medido contra um KDC MIT 1.21.3 de laboratório em Docker. Realm, principals, kinit, o TGT e os tickets de serviço no fio (tshark), pré-autenticação com timestamp cifrado, o que há dentro de um ticket, keytab, Apache Negotiate e sshd GSSAPI validando de verdade, falhas medidas (Clock skew too great, ticket expirado e renovação, SPN por IP, kvno de keytab velho), tipos de cifra, delegação (forwardable e unconstrained medidas; constrained e RBCD em prosa), trusts e Active Directory, ataques como classes de falha com defesas, NTLM medido com um verificador próprio (hash NT, desafio-resposta, relay) e a tabela final de tickets, quem cifra, ataque e defesa.
---
## Objective

Kerberos permite que um cliente prove quem é a um serviço numa rede não confiável sem enviar a senha, e que o serviço prove quem é de volta, confiando num terceiro (o KDC) que compartilha um segredo com todos. Esta lição roda isso contra um KDC de laboratório seu: principals, `kinit`, o TGT e os tickets de serviço no fio (tshark), um keytab, dois serviços reais validando tickets (Apache Negotiate, sshd GSSAPI), as falhas que você vai encontrar (pré-auth, diferença de relógio, expiração, renovação, versão de chave, serviço acessado por IP), delegação, e depois o NTLM, o fallback que ainda aparece, com um verificador pequeno nosso. Os ataques (golden e silver ticket, Kerberoasting, pass-the-hash, relay) ficam só em prosa, como classes de falha com defesas.
Versions: MIT Kerberos 1.21.3 (Debian 13 `krb5-kdc` 1.21.3-5+deb13u1), OpenSSH 10.0p2, Apache 2.4.71 com `libapache2-mod-auth-gssapi` 1.6.4, curl 8.14.1 no container; tshark 4.6.0, Node 22.23.4 e curl 8.7.1 no host; Docker 29.9.2, imagem `debian:trixie` (sem digest fixado).

## Use Cases

- Ler `Clock skew too great`, `Ticket expired` ou `Server not found in Kerberos database` e saber qual troca falhou.
- Montar ou auditar SSO de um app de intranet (SPN, keytab, Negotiate).
- Revisar delegação e exposição a NTLM num Active Directory.

## Deep Dive

### Por que existe e quem faz o quê

O Kerberos (RFC 4120) nasceu no MIT (Steiner, Neuman e Schiller, USENIX Winter 1988, versão 4) para redes onde se assume que alguém escuta. A senha nunca viaja: um **KDC** que guarda uma chave de cada principal emite **tickets** de vida curta. Ele tem duas partes lógicas, o **AS** (emite o TGT) e o **TGS** (emite tickets de serviço). Um **principal** é `alice@EXAMPLE.TEST` (usuário) ou um **SPN** `servico/host@REALM`, como `HTTP/svc.example.test`; o **realm** é o domínio (em maiúsculas); um **keytab** guarda as chaves de longo prazo do serviço para ele decifrar tickets sem senha.

As três trocas: **AS-REQ/AS-REP** (cliente para KDC, devolve um TGT, ticket para `krbtgt/REALM`), **TGS-REQ/TGS-REP** (cliente para KDC, devolve um ticket de serviço para um SPN) e **AP-REQ/AP-REP** (cliente para serviço; o AP-REP deixa o cliente autenticar o serviço).

### O laboratório (medido)

Três containers numa rede privada (`idn-krb-kdc`, `idn-krb-svc`, `idn-krb-client`) a partir de uma imagem Debian (`krb5-kdc krb5-user openssh-server apache2 libapache2-mod-auth-gssapi curl faketime tcpdump`). Configuração: `default_realm = EXAMPLE.TEST`, `rdns = false`, `forwardable = true`; no KDC `max_life = 10h`, `max_renewable_life = 7d`, só os dois tipos AES em `supported_enctypes`.

```text
$ kdb5_util create -s -r EXAMPLE.TEST -P masterpw && krb5kdc
$ kadmin.local -q "addprinc -pw alicepw alice"   # bob igual; -randkey para HTTP/ e host/ svc.example.test
$ kadmin.local -q "ktadd -k /tmp/svc.keytab host/svc.example.test HTTP/svc.example.test"
Entry for principal HTTP/svc.example.test with kvno 2, encryption type aes256-cts-hmac-sha1-96 added
```

`kvno 2` logo após criar: o `ktadd` gera uma chave aleatória nova, então exportar um keytab rotaciona a chave.

### Troca AS e pré-autenticação (medido)

Um principal novo não exige pré-autenticação no KDC MIT, e a captura mostra a consequência: o primeiro AS-REQ, sem nenhuma prova, já recebe um AS-REP cifrado com a chave da alice. Qualquer um na rede pode buscá-lo e atacar a senha offline (AS-REP roasting, abaixo). Um atributo resolve:

```text
$ kadmin.local -q "modprinc +requires_preauth alice"      # Attributes: REQUIRES_PRE_AUTH
$ echo wrongpw | kinit alice ; echo alicepw | kinit alice ; kvno HTTP/svc.example.test
$ tshark -r k2.pcap -Y kerberos
 1 AS-REQ (246 B, sem pre-auth)    2 KRB Error: PREAUTH_REQUIRED
 3 AS-REQ (341 B, com timestamp)   4 KRB Error: PREAUTH_FAILED  <- senha errada
 5-7 de novo, senha certa          8 AS-REP (882 B) <- o TGT;  9 TGS-REQ  10 TGS-REP (1078 B) <- ticket de serviço
```

A pré-auth dos quadros 3 e 7 é o `PA-ENC-TIMESTAMP` (padata tipo 2): a hora cifrada com uma chave derivada da senha (etype 18, `aes256-cts-hmac-sha1-96`). Só quem sabe a senha consegue produzi-la, então o KDC não entrega nada atacável a estranhos.

`klist -e` mostra o TGT `krbtgt/EXAMPLE.TEST@EXAMPLE.TEST` válido por 10 horas, com `renew until` 7 dias depois, `Flags: FRIA` (`F` forwardable, `R` renovável, `I` inicial, `A` pré-autenticado) e etypes `aes256-cts-hmac-sha1-96`. Ele é cifrado com a chave do `krbtgt`, que só o KDC tem: o cliente guarda e reapresenta, mas não consegue lê-lo.

### Troca TGS e o que há dentro de um ticket (medido)

`kvno HTTP/svc.example.test` envia o TGT mais um *autenticador* (nome do cliente e um timestamp, cifrados com a chave de sessão do TGT). A resposta tem duas camadas: um ticket para o serviço e uma parte para o cliente com a nova chave de sessão. Na captura o ticket mostra só `realm`, `sname` e um `enc-part` opaco (etype 18, `kvno: 2`): o cliente não o lê, ele é cifrado com a chave do serviço. Dando ao tshark o keytab do serviço (chave de laboratório), ele decifra e mostra o que o serviço descobre:

```text
flags: 40a90000  forwardable, renewable, pre-authent, transited-policy-checked, enc-pa-rep
cname: alice   authtime: 05:45:13   endtime: 15:45:13   renew-till: 11/26 05:45:13
authorization-data: AD-IF-RELEVANT > AD-WIN2K-PAC (client info + checksums do ticket, do servidor e do KDC)
```

A chave de sessão interna deixa cliente e serviço compartilharem um segredo sem o KDC em cada requisição. O KDC do MIT coloca aqui um PAC mínimo (sem grupos); um KDC do Active Directory o preenche com o SID do usuário e os SIDs dos grupos, em que os serviços Windows se baseiam para autorizar. O ticket é protegido pela chave do *serviço*, então uma chave fraca ou antiga do serviço é o ponto frágil (Kerberoasting, abaixo).

### Troca AP: serviços reais validando (medido)

O Apache com `mod_auth_gssapi` é o caso HTTP (RFC 4559, SPNEGO sobre HTTP; a RFC 4121 é o mecanismo Kerberos do GSS-API). Configuração: `AuthType GSSAPI`, `Require valid-user`, `GssapiCredStore keytab:/etc/apache2/http.keytab`. Esse keytab tem só as entradas `HTTP/`, recortadas do completo com `ktutil` (`rkt`, `delent`, `wkt`) e de posse do `www-data`:

```text
$ curl -si http://svc.example.test/whoami/ | head -3        # sem ticket
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Negotiate
$ curl -sv --negotiate -u : http://svc.example.test/whoami/ # com o TGT
> Authorization: Negotiate YIIDHwYGKwYBBQUCoIIDEzCCAw+gDTALBgkqhkiG9xIBAgKi...   (1072 chars)
< HTTP/1.1 200 OK
< WWW-Authenticate: Negotiate oYG3MIG0oAMKAQChCwYJKoZIhvcSAQICooGfBIGcYIGZ...    (248 chars)
< X-Gss-Name: alice@EXAMPLE.TEST
$ curl -s -o /dev/null -w '%{http_code}' -u alice:alicepw http://svc.example.test/whoami/   # Basic: 401
```

O `openssl asn1parse` nos dois tokens mostra as camadas: a requisição é um token SPNEGO (OID `1.3.6.1.5.5.2`) oferecendo o mecanismo Kerberos `1.2.840.113554.1.2.2`, carregando o AP-REQ (ticket de serviço mais um autenticador novo). A resposta é um `negTokenResp` com `ENUMERATED 0` (accept-completed) e o AP-REP: **autenticação mútua**, prova de que o servidor tinha a chave.

O SSH usa os mesmos tickets: com `GSSAPIAuthentication yes` e `PasswordAuthentication no`, `ssh alice@svc.example.test` com um TGT entra sem pedir nada (`using "gssapi-with-mic"`; a chave do host é a entrada `host/`); sem TGT falha com `Permission denied (gssapi-keyex,gssapi-with-mic)`. Como `bob`, `ssh alice@svc...` também é negado: o Kerberos prova quem você é, o mapeamento de conta (`.k5login`) decide em qual conta você pode entrar.

### Falhas que você vai encontrar (medido)

**Diferença de relógio.** Autenticadores levam um timestamp para que um capturado não possa ser reproduzido depois (os servidores também mantêm um replay cache); a tolerância padrão é de 5 minutos (`clockskew`, RFC 4120). Com `faketime` no cliente, +4 e -4 minutos funcionaram; em +6 e -6 o `kvno` imprimiu `Clock skew too great` e o Apache registrou `gss_accept_sec_context() failed ... (Clock skew too great)` e respondeu 401. Repare que o próprio `kinit` ainda funcionou com 10 minutos de adiantamento (provavelmente o cliente MIT toma a hora do KDC a partir do erro de pré-auth; observado, mecanismo não verificado), então um `kinit` que funciona não prova que o relógio está bom: as etapas TGS e AP é que cobram. Rode NTP.

**Vida útil e renovação.** `kinit -l 1m -r 3m` deu um TGT válido por 1 minuto, renovável por 3. `kinit -R` aos 40 e aos 75 segundos devolveu cada vez um TGT novo com `endtime` mais tarde e o mesmo `renew until` (05:50:12). Uma renovação às 05:49:37, dez segundos após expirar, ainda foi aceita e cortada no `renew until`; às 05:50:26 falhou com `Ticket expired while renewing credentials`. Tickets curtos mais renovação dão sessões longas, e um TGT roubado só vale até o limite de renovação.

**Nomes importam.** O cliente monta o SPN a partir do host na URL: `http://172.25.0.3/` pediu `HTTP/172.25.0.3`, que não existe, então sem ticket e 401 (o mesmo para um alias DNS não registrado). É aqui que o NTLM volta a aparecer. E `kadmin cpw -randkey HTTP/svc.example.test` fez `kvno = 3` enquanto o keytab tinha 2: o Apache recusou com `kvno 3 not found in keytab`. Rotacione chave e keytab juntos.

### Tipos de cifra

Todo ticket mostrou `aes256-cts-hmac-sha1-96`. Um principal criado com `-e rc4-hmac:normal` (o hash NT sem salt como chave) foi aceito por este KDC 1.21.3, marcado `DEPRECATED` pelo `getprinc`, e o `kinit` avisou `encryption type arcfour-hmac used for authentication is deprecated and will be disabled`; pedir `des-cbc-crc` produziu silenciosamente chaves AES (o DES acabou). Tickets e AS-REPs RC4 são muito mais baratos de atacar offline: mantenha só AES em `supported_enctypes`, configure AES nas contas de serviço do AD e revise o uso de RC4 antes de desligá-lo.

### Delegação (medido e prosa)

Delegação deixa um serviço agir como o usuário perante outro serviço. A forma mais simples é entregar um **TGT forwardable**. Medido com `ssh -o GSSAPIDelegateCredentials=yes`:

```text
$ ssh alice@svc.example.test klist      # padrão, sem delegação:  klist: No credentials cache found
$ ssh -o GSSAPIDelegateCredentials=yes alice@svc.example.test 'klist -f; kvno host/kdc.example.test'
krbtgt/EXAMPLE.TEST@EXAMPLE.TEST   renew until 11/26/26 05:50:37, Flags: FfRAT
host/kdc.example.test@EXAMPLE.TEST: kvno = 1
```

O host do serviço agora guarda o TGT da alice (`F` forwarded, `f` forwardable) e pode pedir um ticket para **qualquer** serviço como alice. Isso é a **delegação irrestrita** (unconstrained; no AD: "Trust this computer for delegation to any service"): um host comprometido rouba o TGT de todo usuário que passa por ele. Defesa: evitá-la e marcar contas privilegiadas como não delegáveis. No MIT, `modprinc -allow_forwardable alice` fez o `kinit` seguinte mostrar `Flags: RIA`, e o mesmo `ssh` não produziu nenhum cache de credenciais.

Modelos melhores limitam o alcance (só docs aqui, exigem AD ou suporte a S4U): a **delegação restrita** (constrained) lista os SPNs exatos para os quais uma conta de serviço pode delegar (S4U2Proxy; S4U2Self obtém um ticket para um usuário que se autenticou de outro modo, a "protocol transition"); a **delegação restrita baseada em recurso (RBCD)** move essa lista para o serviço de back-end (`msDS-AllowedToActOnBehalfOfOtherIdentity`), e o dono dele decide quem pode delegar. No AD os controles são "Account is sensitive and cannot be delegated" e o grupo **Protected Users** (sem delegação, sem NTLM, sem RC4 nem DES, TGT limitado a 4 horas).

### Realms, trusts e Active Directory

**Cross-realm**: dois realms compartilham uma chave para `krbtgt/B@A`; um cliente em A obtém um TGT de referral para B e depois um ticket de serviço em B (as florestas do AD fazem isso com trusts, e a autenticação seletiva restringe quem pode cruzar). **O Active Directory é um KDC mais um diretório LDAP** em cada controlador de domínio: o `krbtgt` guarda a chave que assina todo TGT e o PAC leva o SID e os grupos do usuário, então um serviço Windows monta seu token de acesso sem consulta LDAP. É o mesmo protocolo da RFC 4120, então este laboratório MIT o explica.

### Classes de ataque, como falhas com defesas (só prosa)

Não demonstradas, de propósito (MITRE ATT&CK T1558, Steal or Forge Kerberos Tickets, mais T1550.002 e T1557.001):

- **Golden ticket** (T1558.001, uma chave `krbtgt` roubada forja TGTs) e **silver ticket** (T1558.002, uma chave de serviço roubada forja tickets de serviço que o KDC nunca vê). Defesa: proteger os DCs, redefinir o `krbtgt` duas vezes após um comprometimento, chaves de serviço longas e aleatórias (gMSA no AD), validação do PAC, só AES, alerta para tempos de vida estranhos.
- **Kerberoasting** (T1558.003): qualquer usuário pode pedir um ticket para um SPN e atacá-lo offline. Defesa: 25+ caracteres aleatórios, contas gerenciadas, AES, alerta para muitos pedidos TGS.
- **AS-REP roasting** (T1558.004): a falta de pré-auth vista acima. Defesa: pré-auth em tudo. Pass-the-hash e relay pertencem ao NTLM, a seguir.

### NTLM: o fallback (medido)

O NTLM não tem terceiro: o *servidor* confere a resposta usando um hash da senha. Um verificador nosso de 34 linhas em Node 22 (`--openssl-legacy-provider` para o MD4) e `curl --ntlm` mostram as três mensagens sobre `WWW-Authenticate: NTLM`:

```text
NT hash of alice: 6d79e54cfc7ee9b0285bfbfeacc048c5       # MD4(UTF-16LE(senha)), sem salt
NT hash of bob:   6d79e54cfc7ee9b0285bfbfeacc048c5       # mesma senha, mesmo hash
type1 flags=0x88206 len=32                                # NEGOTIATE
type2 challenge=60ab2738b8978d0e                          # CHALLENGE: 8 bytes aleatórios
type3 user=alice domain=EXAMPLE ntresp=70B proof=64a41c3b... -> ACCEPT    # AUTHENTICATE
type3 user=alice ... proof=f4abd1cf... -> REJECT          # senha errada
```

A resposta NTLMv2 é `HMAC-MD5(NTOWFv2, desafio || blob)` com `NTOWFv2 = HMAC-MD5(hash NT, UPPER(user) || domínio)` (MS-NLMP). O verificador usou só o hash, nunca a senha: quem roubar o hash consegue responder desafios (**pass-the-hash**), e o hash não tem salt. Além disso a resposta não é presa ao serviço que o cliente queria alcançar, então uma máquina no meio pode repassar o desafio a outro servidor e retransmitir a resposta (**NTLM relay**). Defesas: SMB signing, LDAP signing com channel binding, Extended Protection for Authentication (EPA) em serviços HTTPS, auditar e depois restringir o NTLM (evento 4776 nos DCs, políticas de restrição), Protected Users e LAPS contra reuso de hash.

Quando o NTLM ainda acontece? Quando o Kerberos não consegue rodar: IP ou alias não registrado na URL (o caso do SPN acima), cliente fora do domínio ou sem DC, aplicação fixada em NTLM, servidor fora do domínio. Livro contra hoje: o NTLM está obsoleto e a Microsoft o está reduzindo; audite quem o usa, corrija nomes e SPNs, e então restrinja.

### Kerberos contra OIDC e SAML, e para onde ir

O Kerberos é um protocolo de **domínio**: excelente dentro de uma fronteira administrativa (DCs alcançáveis, relógios sincronizados), ruim entre empresas, na internet e para mobile ou SPAs, onde OIDC (JWT) e SAML dominam. O formato usual: Kerberos ou NTLM para entrar no domínio, e um IdP (AD FS, Entra ID, Keycloak) que aceita o Kerberos do desktop e emite tokens SAML ou OIDC para apps web e de nuvem; apps novos se integram ao IdP, não ao Kerberos. A seguir na trilha: o concept de LDAP ("LDAP: Directories, DN, Schema and Binds") cobre o diretório por trás do AD, o de SAML ("SAML 2.0: Assertions, Bindings and SSO Flows") a federação no navegador alimentada pela mesma identidade; um concept de Active Directory (planejado) estende este laboratório. História: Steiner, Neuman e Schiller (USENIX 1988) e o "Dialogue in Four Scenes" do MIT, na página do MIT abaixo. O catálogo de papers não tem nenhum de Kerberos.

### Tabela final

| Ticket ou conceito | Cifrado por | Protege | Classe típica de ataque | Defesa |
|---|---|---|---|---|
| AS-REP (parte do cliente) | chave do usuário (senha) | senha nunca enviada | AS-REP roasting | exigir pré-auth |
| TGT | chave `krbtgt` | identidade no KDC | golden ticket | proteger DCs, redefinir `krbtgt` duas vezes |
| Ticket de serviço | chave do serviço (keytab) | identidade no serviço | Kerberoasting, silver ticket | chaves aleatórias, gMSA, AES, validação do PAC |
| TGT encaminhado | chave `krbtgt` | agir como o usuário | roubo por delegação irrestrita | constrained ou RBCD, contas não delegáveis |
| Hash NT / NTLM | hash da senha | logon de fallback | pass-the-hash, relay | signing, EPA, restringir NTLM, Protected Users |

## Trade-offs

- **Kerberos contra NTLM.** O Kerberos dá autenticação mútua, nenhuma senha no fio, delegação e um ponto de auditoria no KDC, mas exige nomes, SPNs e relógios corretos. O NTLM funciona com IP e sem DC, por isso sobrevive e por isso precisa de auditoria.
- **Vida longa contra renovação.** 10 horas com limite de renovação de 7 dias (o laboratório) significa que um cache roubado vale por um dia; vidas menores limitam a exposição (o Protected Users limita o TGT a 4 horas).
- **Conveniência do keytab contra raio de explosão.** Um keytab compartilhado por vários serviços significa que um roubo forja todos (silver ticket): um principal e um keytab por serviço, modo 600.
- **Delegação contra menor privilégio.** A irrestrita é fácil e entrega o TGT do usuário; a RBCD faz o dono do back-end aderir, dá mais trabalho e é muito mais segura.
- **SSO de domínio contra federação.** O Kerberos é invisível dentro do domínio; fora dele você precisa de um IdP com OIDC ou SAML, e passa a operar os dois mundos.

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
