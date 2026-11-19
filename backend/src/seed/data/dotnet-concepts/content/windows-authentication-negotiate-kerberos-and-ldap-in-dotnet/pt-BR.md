---
version: 1.0
updatedAt: 2026-11-19
title: "Autenticação Windows no .NET: Negotiate, Kerberos e LDAP"
summary: Autenticação integrada no ASP.NET Core 10 com Microsoft.AspNetCore.Authentication.Negotiate 10.0.15, medida contra um KDC MIT Kerberos e um OpenLDAP reais em Docker. O desafio 401 Negotiate, o estado por conexão (Kerberos não mantém por padrão, NTLM mantém), HTTP/2 e proxies, as falhas vistas do cliente e do servidor (SPN, relógio, keytab, versão da chave, tudo virando 500), NTLM no Linux, roles por EnableLdap (nunca reconecta, derruba o processo, 500 sem memberOf) e o rastro de advisories que começou com LDAP injection dentro do próprio handler. LDAP direto com System.DirectoryServices.Protocols (binds, GSSAPI, LDAPS, StartTLS, paginação, escape de filtro) e AccountManagement só Windows. IIS, HTTP.sys e delegação só por documentação.
---
## Objective

Dentro de uma empresa com Active Directory, o usuário espera abrir um app interno e já estar logado, sem pedir senha e sem redirecionamento: é a autenticação Windows, o `Negotiate` do HTTP carregando Kerberos (ou NTLM), e o ASP.NET Core faz isso com `Microsoft.AspNetCore.Authentication.Negotiate`, inclusive no Linux. Esta lição monta tudo contra um KDC MIT Kerberos e um OpenLDAP reais em Docker e mede o que o handler faz no fio, o que quebra (SPN, relógio, keytab, versão da chave, HTTP/2, proxies, NTLM) e como isso aparece no cliente, como os grupos chegam em `User.IsInRole` no Linux por meio do `EnableLdap`, uma trilha de advisories que começou como LDAP injection dentro do próprio handler, e o que fazer no lugar com `System.DirectoryServices.Protocols` (binds, GSSAPI, LDAPS, StartTLS, paginação, escape de filtro). O `System.DirectoryServices.AccountManagement` só funciona no Windows (mostrado). IIS, HTTP.sys e delegação ficam só na documentação (não há Windows aqui). Os protocolos em si estão em [Kerberos: tickets, TGT, delegação e NTLM](/identity-concepts/kerberos-tickets-tgt-delegation-and-ntlm) e [LDAP: diretórios, DN, schema e binds](/identity-concepts/ldap-directories-dn-schema-and-binds); esta lição é o lado .NET.
Versions: `Microsoft.AspNetCore.Authentication.Negotiate` 10.0.15 (a última 10.0.x em 2026-11-19, medido também 10.0.8 a 10.0.10), `System.DirectoryServices.Protocols` 10.0.15, `System.DirectoryServices.AccountManagement` 10.0.15, `net10.0`, SDK 10.0.100 em macOS arm64 para compilar; execução em `mcr.microsoft.com/dotnet/sdk:10.0` (Ubuntu 24.04, runtime do ASP.NET Core 10.0.14) com MIT krb5 1.20.1-6ubuntu2.10, OpenLDAP slapd e libldap 2.6.10, curl 8.5.0, gss-ntlmssp 1.2.0; Docker 29.9.2. O pacote 11.0.0 também existe (GA em 2026-11-10), não medido.

## Use Cases

- Um app de intranet (portal de RH, relatórios, painel administrativo) para usuários do domínio: single sign-on sem IdP extra, hospedado em containers Linux.
- Ler um loop de 401, um 500 no login ou uma role que não chega e saber se o culpado é o SPN, o keytab, o relógio, o protocolo ou o LDAP.
- Consultar usuários e grupos num diretório LDAP (AD ou OpenLDAP) a partir do .NET em qualquer SO, com segurança.
- Decidir entre Kerberos, OIDC e SAML para um app novo.

## Deep Dive

### O laboratório

Quatro containers numa rede privada, a partir de uma imagem só (`dnkrb-kdc`, `dnkrb-ldap`, `dnkrb-app` na porta 6960, `dnkrb-client`). Realm `EXAMPLE.TEST`, só chaves AES, `rdns = false`; principals `alice`, `bob`, `svc-app`, e as chaves de serviço `HTTP/app.example.test` e `ldap/example.test` exportadas com `ktadd` para keytabs. O app inteiro é isto:

```csharp
builder.Services.AddAuthentication(NegotiateDefaults.AuthenticationScheme).AddNegotiate();
builder.Services.AddAuthorization(o => o.FallbackPolicy = o.DefaultPolicy);   // every endpoint needs a user
app.UseAuthentication(); app.UseAuthorization();
app.MapGet("/open", [AllowAnonymous] (ClaimsPrincipal u) => new { u.Identity!.IsAuthenticated, u.Identity.Name });
app.MapGet("/whoami", (ClaimsPrincipal u) => new { u.Identity!.Name, u.Identity.AuthenticationType,
    Roles = u.Claims.Where(c => c.Type == ClaimTypes.Role).Select(c => c.Value) });
```

O processo recebe `KRB5_KTNAME=/shared/app.keytab` e `KRB5_CONFIG=/shared/krb5.conf` (a biblioteca MIT lê as duas, não existe opção no .NET). Tudo abaixo roda com `docker exec dnkrb-client`.

### O que o handler faz no fio

```text
$ curl -si http://app.example.test:6960/whoami            # no ticket
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Negotiate
$ echo alicepw | kinit alice; curl -si --negotiate -u : http://app.example.test:6960/whoami
HTTP/1.1 200 OK
WWW-Authenticate: Negotiate oYG3MIG0oAMKAQChCwYJKoZIhvcSAQICooGfBIGcYIGZBgkqhkiG9xIBAgIC...
{"name":"alice@EXAMPLE.TEST","authenticationType":"Kerberos","roles":[],"claims":["name=alice@EXAMPLE.TEST"]}
$ klist | tail -2
krbtgt/EXAMPLE.TEST@EXAMPLE.TEST
HTTP/app.example.test@EXAMPLE.TEST
```

O desafio é a palavra `Negotiate` sozinha. O cliente pediu ao KDC o `HTTP/app.example.test`: o SPN vem do host da URL, sem a porta. O `WWW-Authenticate: Negotiate <token>` no 200 é o AP-REP do servidor (autenticação mútua). A única claim é o nome, `alice@EXAMPLE.TEST`: no Linux o Kerberos não traz grupos, isso é a seção do LDAP. Um cliente .NET se comporta igual: `HttpClientHandler.UseDefaultCredentials = true` lê o cache de tickets (cache vazio: 401), e `Credentials = new NetworkCredential("alice", "alicepw", "EXAMPLE.TEST")` deu 200 sem nenhum `kinit`, a própria biblioteca Kerberos falou com o KDC.

### Estado por conexão: Kerberos não mantém por padrão, NTLM mantém

Capturei o token da alice e o reenviei em conexões HTTP/1.1 cruas, com `PersistKerberosCredentials` desligado (padrão) e ligado:

```text
                                         default (false)              PersistKerberosCredentials = true
connection A, Authorization: Negotiate   200 alice                    200 alice
connection A, same socket, no header     401 + WWW-Authenticate       200 alice  (even /open sees alice)
connection B (new), no header            401                          401
```

Então a ideia de que "o Kestrel guarda o usuário autenticado por conexão" só vale para NTLM (`PersistNtlmCredentials`, padrão true) ou quando você pede. Um `HttpClient` do .NET numa conexão só, com Kerberos, fez duas voltas a cada requisição (`none` e depois `Negotiate`, 401 e 200); com NTLM e três requisições a primeira levou três voltas (401, 401, 200) e as outras duas saíram sem header e receberam 200 como alice; com `PersistNtlmCredentials = false` toda requisição repetiu as três voltas. O `curl` reenviou o token nas três requisições. O risco da persistência está documentado: nunca ligue onde uma conexão pode carregar vários usuários, como atrás de um proxy que reaproveita conexões (a documentação: Negotiate não deve ser usado com proxies, a menos que a conexão seja 1:1). Kerberos e NTLM são handshakes orientados a conexão, então um balanceador ou um YARP no meio precisa de afinidade ou de cuidar da autenticação sozinho, veja [Load Balancing Strategies](/system-design/system-design-concepts/load-balancing-strategies) e [Reverse Proxy and API Gateway with YARP](/dotnet-concepts/reverse-proxy-and-api-gateway-with-yarp).

HTTP/2: o handler só trata HTTP/1.x. Num listener h2c, `curl --http2-prior-knowledge --negotiate -u :` mandou o token e recebeu `401` mesmo assim (`http_version=2`), e a mesma requisição em HTTP/1.1 deu 200; um `HttpClient` fixado em HTTP/2 recebeu 401. Navegadores fazem downgrade depois do desafio, o `HttpClient` não; a documentação diz o mesmo.

### Falhas, como o cliente e o servidor enxergam

Cada linha foi reproduzida; o log do servidor é o do Kestrel com a categoria Negotiate em Debug, e `KRB5_TRACE` no app nos casos de keytab.

| Causa | Cliente | Servidor |
| --- | --- | --- |
| sem ticket (`curl --negotiate -u :`) | 401 `Negotiate` | sem header `Authorization` |
| URL por IP, ou alias DNS sem SPN | 401, `klist` não mostra ticket novo | sem header `Authorization`: o cliente nunca obteve ticket |
| relógio do cliente +4 min | 200 | normal |
| relógio do cliente +6 ou -6 min (`faketime`) | 500 | `Negotiate error code: Other`, `AuthenticationFailureException: GenericFailure` |
| keytab sem a chave `HTTP/` | 500 | trace: `HTTP/app.example.test@EXAMPLE.TEST not found in keytab (ticket kvno 2)` |
| `kadmin cpw -randkey` (kvno 3, o keytab tem 2) | 500 | `GenericFailure` |
| arquivo de keytab ausente | 500 | `AuthenticationFailureException: Unsupported` |

Três lições. Problema de nome nunca chega ao servidor, só o passo do ticket no cliente falha, então olhe o cliente (`klist`, `KRB5_TRACE`). Todo problema Kerberos do lado do servidor é um **500** por padrão, com uma exceção que esconde o motivo do GSS: o handler só mapeia erro de credencial para 401 e erro do cliente para 400, e relança o resto. E exportar um keytab rotaciona a chave: o `ktadd` gerou kvno 4 e depois 6 enquanto as entradas antigas continuaram, e o app aceitou o keytab novo sem reiniciar (a biblioteca MIT lê o arquivo a cada accept; o cliente precisou de um ticket novo). Para transformar o 500 em 401 sem perder o log:

```csharp
.AddNegotiate(o => o.Events = new NegotiateEvents {
    OnAuthenticationFailed = c => { logger.LogWarning(c.Exception, "negotiate failed"); c.SkipHandler(); return Task.CompletedTask; } })
```

Medido nos casos de relógio e kvno: 401 com `WWW-Authenticate: Negotiate`, igual a "sem ticket", então guarde o log se precisar distinguir. `RequireAuthenticatedSignIn` não é opção do Negotiate: é `AuthenticationOptions.RequireAuthenticatedSignIn` (padrão `true`, conferido por reflection) para handlers de sign-in como o de cookies, e o `NegotiateHandler` implementa só `IAuthenticationHandler` e `IAuthenticationRequestHandler`, então nunca faz sign-in de nada. O próprio `NegotiateOptions` tem três membros (`Events`, `PersistKerberosCredentials`, `PersistNtlmCredentials`) mais o `EnableLdap`.

### NTLM no Linux: o fallback que precisa de um pacote e de um validador

Com uma URL que permite Kerberos, tudo acima é Kerberos. Quando o Kerberos não pode ser usado (URL por IP, sem ticket e com credenciais explícitas), um cliente .NET cai para NTLM dentro do mesmo header `Negotiate`. No servidor Linux isso exige o mecanismo `gss-ntlmssp`:

```text
server without the gss-ntlmssp mech (file moved out of /etc/gss/mech.d)   401, AuthenticationFailureException: Unsupported
server with gss-ntlmssp, nothing to verify against                         handshake starts (401), final leg GenericFailure, 401
server with gss-ntlmssp and NTLM_USER_FILE=/shared/ntlm.users              200 {"name":"EXAMPLE.TEST\\alice","authenticationType":"NTLM"}
```

O arquivo de usuários (`EXAMPLE.TEST:alice:alicepw`) é um recurso de teste do gss-ntlmssp; um servidor de verdade valida o NTLM por winbind ou `ntlm_auth` contra um controlador de domínio (só documentação, não executado). Repare no nome: `EXAMPLE.TEST\alice` no NTLM, `alice@EXAMPLE.TEST` no Kerberos, uma pessoa com duas grafias: o mapeamento de roles e os logs de auditoria precisam tratar as duas. NTLM é o caminho de downgrade que o atacante quer (relay e pass-the-hash, veja a lição de Kerberos): no Linux, não instalar o `gss-ntlmssp` desliga o NTLM.

### Roles no Linux: `EnableLdap`, medido

O Windows monta um `WindowsPrincipal` com os SIDs de grupo do token; no Linux o handler pode consultar o LDAP. Fiz o OpenLDAP parecer com os atributos do AD que o handler lê (classes `user` e `group`, atributos `sAMAccountName` e `memberOf`; alice está em `Editors`, que está em `Staff`; bob em `Readers`).

```csharp
.AddNegotiate(o => o.EnableLdap("example.test"));          // domain = LDAP server name AND base DN dc=example,dc=test
.AddNegotiate(o => o.EnableLdap(s => { s.Domain = "example.test"; s.IgnoreNestedGroups = true; /* s.LdapConnection = ... */ }));
```

```text
EnableLdap("example.test"), service ticket cache of svc-app   alice roles ["Editors","Staff"]   bob ["Readers"]
GET /admin with RequireRole("Editors")                          alice 200   bob 403
IgnoreNestedGroups = true                                       alice ["Editors"]
```

Como funciona (código-fonte da v10.0.15, conferido pelos logs): o handler cria um `new LdapConnection` para o servidor chamado em `Domain` e chama `Bind()` **quando as opções são montadas pela primeira vez, na subida do app**, usando o próprio ticket Kerberos do processo (`KRB5CCNAME`, aqui um `kinit` do `svc-app`). Para cada usuário ele busca `(&(objectClass=user)(sAMAccountName=<nome antes do @>))` abaixo do base DN, lê o `memberOf`, usa o primeiro valor `CN=` de cada DN como role, opcionalmente percorre os grupos, e guarda as roles em cache por usuário (sliding de 10 min, absoluto de 60 min, com limite de tamanho). O que mordeu:

- `MachineAccountName` e `MachineAccountPassword` não funcionam no Linux: o app morre na subida com `LdapException: The feature is not supported` (um bind Negotiate com `NetworkCredential` recebe o erro 92 da libldap, mostrado também abaixo). Use o cache de tickets, ou o seu próprio `LdapSettings.LdapConnection` com `AuthType.Basic` sobre LDAPS (medido: mesmas roles). A documentação acrescenta: proteja essa conexão com TLS e use `ReferralChasing = None`.
- LDAP fora do ar na subida: o processo sai (exit 134, `LdapException: The LDAP server is unavailable`).
- O cache esconde mudanças: a alice ganhou um segundo grupo no diretório e continuou com `["Editors","Staff"]`; com o LDAP parado ela ainda foi atendida pelo cache (200), mas o bob, nunca visto antes, recebeu 500.
- Não existe reconexão. Depois de reiniciar o slapd, a primeira consulta sem cache deu 500 e a requisição seguinte **matou o processo** (SIGSEGV, exit 139, em 4 de 4 execuções) com a conexão padrão ligada por Kerberos; com a conexão Basic/LDAPS própria o processo continuou de pé, mas respondeu 500 para todo usuário sem cache até o app reiniciar (3 tentativas seguidas).
- Usuário sem `memberOf` (conta nova, ou a alice depois que tirei o único grupo dela) vira `NullReferenceException` e 500 na 10.0.9 e na 10.0.15 (issue 70090 do dotnet/aspnetcore, aberta). Usuário ausente do LDAP recebe 200 sem roles e um warning.
- Um nome no estilo NTLM não tem `@`: na 10.0.9 o `EXAMPLE.TEST\alice` inteiro entrou no filtro (`The search filter is invalid`, 500); na 10.0.15 a consulta é pulada, então usuários NTLM ficam sem roles.

O formato robusto no Linux é a sua própria consulta num `IClaimsTransformation`: uma `LdapConnection` curta por cache miss, filtro escapado, leitura tolerante do `memberOf`:

```csharp
using var c = new LdapConnection(new LdapDirectoryIdentifier("example.test")) { AuthType = AuthType.Negotiate };
c.SessionOptions.ProtocolVersion = 3; c.Bind();                       // the process ticket cache, as before
var r = (SearchResponse)c.SendRequest(new SearchRequest("dc=example,dc=test",
    $"(&(objectClass=user)(sAMAccountName={Esc(uid)}))", SearchScope.Subtree, "memberOf"));   // Esc: see below
var groups = r.Entries.Count == 1 && r.Entries[0].Attributes["memberOf"] is { } a
    ? a.GetValues(typeof(string)).Cast<string>().Select(dn => dn.Split(',')[0][3..]).ToArray() : [];
// cache `groups` per user in IMemoryCache for a few minutes, then add one ClaimTypes.Role claim each
```

Medido: alice `["Editors"]` (esta versão não percorre grupos aninhados), svc-app `[]` sem queda, e o bob normal logo depois de reiniciar o slapd.

### O LDAP injection do próprio handler (CVE-2026-47303)

Até a 10.0.9 o handler colocava o nome autenticado no filtro sem escapar. Um nome Kerberos é o que o KDC emitir: o MIT aceitou `bo*`, `*` e `*)(|(sAMAccountName=alice)` como principals. Com `EnableLdap` e esses principals:

```text
                                        10.0.9                      10.0.15 (logged filter)
bo*                                     roles ["Readers"]           [] (sAMAccountName=bo\2a)
*                                       ["Editors","Staff"]         [] (sAMAccountName=\2a)
*)(|(sAMAccountName=alice)              ["Editors","Staff"]         [] (...\2a\29\28|\28sAMAccountName=alice\29)
```

Um principal ganhou os grupos de outro usuário. A auditoria do NuGet avisa no restore: `NU1903` na 10.0.8 e na 10.0.9 para o GHSA-2p3q-h3hg-jcqq (CVE-2026-47303, CWE-90 listada, corrigido na 10.0.10), o GHSA-8prm-248r-h957 (CVE-2026-47300, validação, só para apps que buscam roles no LDAP) e o GHSA-vrrp-6v32-2p8g (CVE-2026-70179, resultado do LDAP ligado ao principal errado, corrigido na 10.0.13; a 10.0.10 ainda avisava). Se um atacante consegue criar esse principal depende do seu KDC: o MIT deixa um administrador fazer isso, não conferi quais caracteres o AD aceita, então o risco prático não está verificado. A lição é geral: se o handler da própria Microsoft esqueceu o escape, o seu também pode esquecer, e quem usa `EnableLdap` precisa estar pelo menos na 10.0.13.

### LDAP direto com `System.DirectoryServices.Protocols`

O pacote é multiplataforma e embrulha a libldap no Linux. O pacote `System.DirectoryServices.AccountManagement` (`PrincipalContext`, `UserPrincipal`) não é: ele restaura e compila em net10.0 só com o warning CA1416, traz um asset em `runtimes/win` e, em tempo de execução no container Linux, `new PrincipalContext(ContextType.Domain, "example.test")` lança `PlatformNotSupportedException: System.DirectoryServices.AccountManagement is not supported on this platform.` Binds medidos contra o slapd (`WhoAmI` é a operação estendida da RFC 4532):

| Bind | Resultado |
| --- | --- |
| simples, `uid=alice,...` e a senha certa | `dn:uid=alice,ou=People,dc=example,dc=test`, log do slapd `mech=SIMPLE bind_ssf=0` |
| simples, senha errada | `LdapException 49 "The supplied credential is invalid."` |
| simples, DN com senha vazia | `DirectoryOperationException "The server cannot handle directory requests."` (slapd: err=53 unauthenticated bind disallowed) |
| sem credencial | o bind anônimo passa, `WhoAmI` vem vazio; a minha ACL recusa a busca (50) |
| `AuthType.Negotiate` ou `Kerberos`, cache de tickets | ligado como `dn:uid=alice,...`, `mech=GSSAPI bind_ssf=256 ssf=256` (criptografado mesmo em `ldap://` puro) |
| o mesmo com `NetworkCredential` | `LdapException 92 "The feature is not supported."` |
| `Negotiate` com o servidor por IP | `LdapException 82 "A local error occurred."` (SPN `ldap/<host>` não bate) |

No Linux, o bind Kerberos precisa de um ticket obtido fora do .NET e de um nome de servidor que bata com o SPN. Um bind que volta sem erro não é login, a menos que a senha não seja vazia: alguns servidores aceitam bind simples com senha vazia como anônimo (RFC 4513 seção 5.1.2), este recusou.

```text
LDAPS 636, CA in ldap.conf TLS_CACERT          bound as dn:uid=alice,...       (slapd: TLS1.3 AES-256-GCM)
LDAPS with only the system CA bundle           LdapException 81 "The LDAP server is unavailable."
LDAPS to the server by IP                      81 (certificate has DNS names only)
LDAPS + VerifyServerCertificate (accept all)   81 (slapd sees TLS established, then the client closes)
StartTransportLayerSecurity before any Bind    81, and no STARTTLS reaches slapd
anonymous Bind(), then StartTransportLayerSecurity(null), then a simple bind    bound, slapd bind_ssf=0 ssf=256
```

A confiança no TLS vem da configuração da libldap (`TLS_CACERT` no `ldap.conf` ou `LDAPTLS_CACERT`), não do .NET, e o callback `VerifyServerCertificate` ficou inutilizável aqui. O StartTLS só funciona numa conexão já aberta, então abra com um `Bind()` anônimo antes; e o erro 81 esconde o motivo, então um StartTLS que falhou tem que parar o programa, nunca seguir em texto claro. `SslInformation` também lançou 81.

Paginação com 600 entradas abaixo de `ou=Bulk` e o `sizelimit` padrão de 500 do OpenLDAP:

```csharp
var cookie = Array.Empty<byte>();
do {
    var req = new SearchRequest("ou=Bulk,dc=example,dc=test", "(objectClass=*)", SearchScope.OneLevel, "uid");
    req.Controls.Add(new PageResultRequestControl(200) { Cookie = cookie });
    var resp = (SearchResponse)conn.SendRequest(req);
    cookie = ((PageResultResponseControl)resp.Controls[0]).Cookie;      // empty cookie = last page
} while (cookie.Length > 0);
```

```text
no paging                                             DirectoryOperationException 4 SizeLimitExceeded
paged, 200 per page, slapd defaults                   page 1: 200, page 2: 200, page 3: SizeLimitExceeded after 400
sizelimit size.prtotal=unlimited in slapd.conf        200 + 200 + 200 = 600 entries, 3 pages
```

A paginação não levanta o teto total do servidor (o OpenLDAP conta o total entre as páginas por padrão; o AD usa `MaxPageSize` por página). A biblioteca não escapa filtros. Uma varredura por reflection na API pública atrás de `Escape|Encode|Sanitiz|Quote` achou só `BerConverter.Encode`, então não existe `LdapFilterEncoder` nem equivalente: escreva você mesmo o escape da RFC 4515 (o do handler é internal). Com o filtro `(&(uid={name})(sAMAccountName=*))` abaixo de `ou=People` (3 usuários):

```csharp
static string Esc(string s) => s.Replace("\\", "\\5c").Replace("*", "\\2a").Replace("(", "\\28").Replace(")", "\\29").Replace("\0", "\\00");
```

```text
input        interpolated                                    escaped
alice        (&(uid=alice)(sAMAccountName=*))   1 entry      1 entry
bo*          (&(uid=bo*)(...))                  1 (bob)      0
*            (&(uid=*)(...))                    3 entries    0
*)(uid=*     (&(uid=*)(uid=*)(...))             3 entries    0   (escaped: uid=\2a\29\28uid=\2a)
```

A forma interpolada devolveu todos os usuários para `*`, e uma entrada que fecha a cláusula acrescenta uma segunda (a biblioteca só rejeita filtros desbalanceados: `The search filter is invalid`). Escape os valores nos filtros (RFC 4515) e nos componentes de DN (RFC 4514, regra diferente), use uma conta somente leitura com ACL estreita, e prefira buscar e depois fazer o bind em vez de montar o DN a partir da entrada.

### Hospedagem no Windows e delegação (só documentação)

Não executado aqui. No Windows o mesmo pacote funciona com o Kestrel por SSPI e entrega um `WindowsPrincipal`. Sob IIS ou HTTP.sys, a autenticação Windows é habilitada no servidor (`web.config`, `HttpSysOptions.Authentication`) e o handler delega a ele (o `PostConfigureNegotiateOptions` liga `DeferToServer` quando o servidor informa autenticação integrada, e lança exceção se o servidor suporta mas ela está desligada). O HTTP.sys autentica em modo kernel e decifra o ticket com a conta de máquina, então o SPN vai no host. Personificação não é implementada: `WindowsIdentity.RunImpersonated` só existe no Windows. Chamar um serviço a jusante como o usuário exige delegação Kerberos (delegação restrita ou delegação restrita baseada em recurso no AD), configurada no diretório e não no app: veja a lição de Kerberos e a visão geral da Microsoft. A documentação do .NET 11 acrescenta channel binding ao endpoint TLS no Negotiate sobre HTTPS contra relay de NTLM, não medido aqui.

### Kerberos contra OIDC e SAML

O Kerberos serve para clientes no domínio dentro de uma floresta AD: sem tokens, sem redirecionamentos, autenticação mútua, um navegador que já tem o ticket e um app que nunca vê senha. Ele falha onde não há domínio (usuários da Internet, apps móveis, parceiros), onde um proxy reaproveita conexões, onde o HTTP/2 precisa ser ponta a ponta e onde o container não tem história para o keytab. Para um app novo hoje o padrão do mercado é OIDC contra Entra ID ou Keycloak, com o diretório por trás ([OpenID Connect, Entra ID e o padrão BFF](/dotnet-concepts/openid-connect-entra-id-and-bff)); o SAML cobre os IdPs dos clientes ([SAML 2.0 Single Sign-On no ASP.NET Core](/dotnet-concepts/saml-2-single-sign-on-in-aspnet-core)); o Kerberos continua sendo a resposta certa para apps de intranet já existentes no AD, muitas vezes como o primeiro salto de um broker. [Choosing a Federation Protocol](/identity-concepts/choosing-a-federation-protocol-saml-oidc-kerberos-and-ldap) compara os quatro.

## Trade-offs

- **Single sign-on contra alcance.** Zero prompts para máquinas do domínio, nada para o resto. Um app híbrido pode oferecer Negotiate num host interno e OIDC no público; o mesmo usuário passa a ter dois identificadores (`alice@EXAMPLE.TEST` e um `sub` do OIDC).
- **Linux significa assumir o trabalho.** Você cuida do keytab (um segredo, legível só pelo usuário do app, rotacionado junto com o KDC), do relógio, do nome DNS que bate com o SPN e do cache de tickets da conta do LDAP. No Windows o domínio faz isso. Exemplo: o `ktadd` rotacionou a chave e o próximo cliente com ticket antigo recebeu 500 até pedir um novo.
- **`EnableLdap` contra consulta própria.** O embutido são duas linhas, mas faz bind na subida, nunca reconecta, pode derrubar o processo depois de um restart do LDAP no caminho Kerberos, dá 500 para usuário sem grupos e teve três advisories em 2026. A sua própria transformação custa 20 linhas e os modos de falha são você quem escolhe. Faça cache de qualquer jeito: o cache padrão de 10 minutos também é o atraso para revogar uma role.
- **500 por padrão.** Ligue o `OnAuthenticationFailed` com `SkipHandler` para que um keytab ruim não pareça bug do servidor para o usuário, e alerte pela linha de log.
- **NTLM.** Deixar o `gss-ntlmssp` fora de uma imagem Linux remove o downgrade; em servidores Windows, restrinja o NTLM por política.
- **Persistir credenciais.** `PersistKerberosCredentials = true` economiza uma volta por requisição e só é seguro com conexões 1:1.

## Documentation Links

- [Configure Windows Authentication in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/authentication/windowsauth) (doc)
- [NegotiateOptions Class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/microsoft.aspnetcore.authentication.negotiate.negotiateoptions) (doc)
- [LdapSettings Class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/microsoft.aspnetcore.authentication.negotiate.ldapsettings) (doc)
- [Negotiate handler source (v10.0.15), GitHub](https://github.com/dotnet/aspnetcore/tree/v10.0.15/src/Security/Authentication/Negotiate/src) (doc)
- [Negotiate: handle missing memberOf during LDAP claim resolution, issue 70090, GitHub](https://github.com/dotnet/aspnetcore/issues/70090) (doc)
- [CVE-2026-47303 advisory GHSA-2p3q-h3hg-jcqq, GitHub](https://github.com/advisories/GHSA-2p3q-h3hg-jcqq) (doc)
- [CVE-2026-47300 advisory GHSA-8prm-248r-h957, GitHub](https://github.com/advisories/GHSA-8prm-248r-h957) (doc)
- [CVE-2026-70179 advisory GHSA-vrrp-6v32-2p8g, GitHub](https://github.com/advisories/GHSA-vrrp-6v32-2p8g) (doc)
- [LdapConnection Class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.directoryservices.protocols.ldapconnection) (doc)
- [PageResultRequestControl Class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.directoryservices.protocols.pageresultrequestcontrol) (doc)
- [PrincipalContext Class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.directoryservices.accountmanagement.principalcontext) (doc)
- [HTTP.sys web server implementation in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/servers/httpsys) (doc)
- [Host ASP.NET Core on Windows with IIS, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/host-and-deploy/iis/) (doc)
- [Kerberos constrained delegation overview, Microsoft Learn](https://learn.microsoft.com/en-us/windows-server/security/kerberos/kerberos-constrained-delegation-overview) (doc)
- [Keytabs and application servers, MIT Kerberos documentation](https://web.mit.edu/kerberos/krb5-1.20/doc/admin/appl_servers.html) (doc)
- [Size and time limits, OpenLDAP Administrator's Guide](https://www.openldap.org/doc/admin26/limits.html) (doc)
- [Using SASL, OpenLDAP Administrator's Guide](https://www.openldap.org/doc/admin26/sasl.html) (doc)
- [RFC 4559, SPNEGO-based Kerberos and NTLM HTTP Authentication](https://www.rfc-editor.org/rfc/rfc4559) (doc)
- [RFC 4515, LDAP String Representation of Search Filters](https://www.rfc-editor.org/rfc/rfc4515) (doc)
- [RFC 4513, LDAP Authentication Methods and Security Mechanisms](https://www.rfc-editor.org/rfc/rfc4513) (doc)
- [RFC 2696, LDAP Control Extension for Simple Paged Results](https://www.rfc-editor.org/rfc/rfc2696) (doc)
- [LDAP Injection Prevention Cheat Sheet, OWASP](https://cheatsheetseries.owasp.org/cheatsheets/LDAP_Injection_Prevention_Cheat_Sheet.html) (doc)
