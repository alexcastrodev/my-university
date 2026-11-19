---
version: 1.0
updatedAt: 2026-11-19
title: "IAM: Identidade, Autenticação, Autorização e Accounting"
summary: O quadro geral de IAM medido no fio. Os quatro A (identidade, autenticação, autorização e accounting) num servidor Node de 58 linhas com PEP, PDP e trilha de auditoria, 401 contra 403, um cookie de sessão e um JWT RS256 decodificados e verificados com openssl, um OpenLDAP local fazendo search e bind, os papéis IdP, SP/RP, PEP e PDP, o ciclo joiner-mover-leaver, privilégio mínimo, Zero Trust e o mapa de MFA, OAuth 2.0, OIDC, SAML, LDAP/AD, Kerberos e SCIM.
---
## Objective

Gestão de identidade e acesso (IAM) responde a quatro perguntas em toda
requisição: quem é (identidade), consegue provar (autenticação), pode fazer
isto (autorização) e o que fez (accounting). Cada protocolo desta trilha, de
MFA a OAuth, OIDC, SAML, LDAP e Kerberos, é a resposta a uma dessas perguntas.
Esta lição monta o mapa: os quatro A rodando de ponta a ponta num servidor de
58 linhas, um JWT e um cookie de sessão decodificados byte a byte, um diretório
LDAP respondendo "quem é a alice", e depois os papéis (IdP, SP/RP, PEP, PDP), o
ciclo de vida, privilégio mínimo, Zero Trust e qual protocolo resolve o quê. O
código é Node 22 sem pacotes, porque o assunto é o fio, não um framework.
Versions: Node 22.23.4, OpenSSL 4.0.3, curl, jq 1.7.1, a imagem
`osixia/openldap:1.5.0` com o cliente `ldapsearch` 2.4.28 do macOS.

## Use Cases

- Olhar um bug de login ou de acesso e saber qual camada falhou: 401 ou 403.
- Escolher entre cookie de sessão e token autocontido para uma API.
- Posicionar IdP, aplicação e motor de políticas num diagrama de arquitetura.
- Reconhecer SAML, LDAP ou Kerberos numa empresa e saber o que os substitui.

## Deep Dive

### Quatro perguntas, quatro falhas

| Pergunta | Nome | Falha | HTTP |
|---|---|---|---|
| Quem diz estar aqui? | Identificação | sujeito desconhecido | 401 |
| Consegue provar? | Autenticação | credencial errada | 401 |
| Pode fazer isto? | Autorização | a política nega | 403 |
| O que aconteceu? | Accounting (auditoria) | nenhuma evidência depois | nenhum |

Identidade é um conjunto de atributos sobre um sujeito (pessoa, serviço,
dispositivo) guardado num repositório de identidades. Conta é essa identidade
dentro de um sistema. A autenticação liga a requisição a uma identidade; a
autorização decide com essa identidade, a ação e o recurso. O arcabouço AAA
clássico (RFC 2904, da época de RADIUS e Diameter) chama o terceiro A de
"accounting"; em segurança de aplicações, é o log de auditoria. 401 quer dizer
"não sei quem você é", 403 quer dizer "sei, e a resposta é não": confundir os
dois esconde qual camada quebrou.

### Os quatro A num servidor só (medido)

Um arquivo Node 22, sem dependências. As senhas viram hash com scrypt, o login
cria um id de sessão aleatório guardado no servidor, uma função PDP decide, o
PEP a chama e grava uma linha de auditoria por decisão. O núcleo:

```js
// PDP: a pure function of subject, action and resource. It knows nothing about HTTP.
function decide(user, action, report) {
  if (!report) return { allow: false, reason: 'no such resource' };
  if (action === 'read' && user.roles.some((r) => r === 'viewer' || r === 'editor'))
    return { allow: true, reason: 'role can read' };
  if (action === 'write' && user.roles.includes('editor') && user.dept === report.dept)
    return { allow: true, reason: 'editor of same dept' };
  return { allow: false, reason: `no rule allows ${action}` };
}
// PEP: intercept, ask, enforce, log
const d = decide(users[sub], action, reports[id]);
audit({ event: 'access', sub, action, resource: `report:${id}`,
        decision: d.allow ? 'permit' : 'deny', reason: d.reason });
return d.allow ? send(200, `${action} report ${id} ok`) : send(403, 'forbidden');
```

A alice é `editor` em `sales`, o bob é `viewer` em `support`; o relatório 7 é
de vendas, o 9 de finanças. Exercitado com curl:

```text
anonymous GET /reports/7      -> 401
alice, wrong password         -> 401
HTTP/1.1 204 No Content
Set-Cookie: sid=w0K7ID57akwEYMaqxuASs3xKUTWzdBCr3DtDmobhQ2Q; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=3600
alice GET /reports/7          -> 200
alice PUT /reports/7 (sales)  -> 200
alice PUT /reports/9 (finance)-> 403
bob   PUT /reports/7          -> 403
```

A trilha de auditoria que o PEP e o login gravaram (stdout, um JSON por linha;
o segundo login da alice e o do bob foram cortados aqui):

```text
{"ts":"2026-11-19T00:34:21.872Z","event":"login","sub":"alice","outcome":"failure","ip":"::1"}
{"ts":"2026-11-19T00:34:21.900Z","event":"login","sub":"alice","outcome":"success","ip":"::1"}
{"ts":"2026-11-19T00:34:21.960Z","event":"access","sub":"alice","action":"read","resource":"report:7","decision":"permit","reason":"role can read"}
{"ts":"2026-11-19T00:34:21.966Z","event":"access","sub":"alice","action":"write","resource":"report:7","decision":"permit","reason":"editor of same dept"}
{"ts":"2026-11-19T00:34:21.972Z","event":"access","sub":"alice","action":"write","resource":"report:9","decision":"deny","reason":"no rule allows write"}
{"ts":"2026-11-19T00:34:21.978Z","event":"access","sub":"bob","action":"write","resource":"report:7","decision":"deny","reason":"no rule allows write"}
```

O mesmo papel (`editor`) recebeu 200 num relatório e 403 no outro: a regra lê
um atributo do recurso, coisa que checagem só de papel não expressa (o tópico
Authorization Models compara RBAC, ABAC e ReBAC). As negações também vão para
o log: uma falha de login seguida de sucesso é exatamente o padrão que um
detector de credential stuffing procura.

### Cookie de sessão contra JWT, decodificados (medido)

O `sid` acima tem 43 caracteres base64url: 32 bytes aleatórios (`c342 bb20
3e7b 6a4c ...`), referência a estado guardado no servidor. Logout apaga a entrada.

O mesmo servidor emite um JWT para API em `/token`, assinado com RS256.
Separando nos pontos e decodificando cada parte em base64url:

```text
parts: 56 + 158 + 342 chars
{"alg":"RS256","typ":"JWT","kid":"demo-1"}
{"iss":"http://localhost:6081","sub":"alice","aud":"reports-api","roles":["editor"],"iat":1795048461,"exp":1795048761}
signature bytes: 256
Verified OK
```

O `Verified OK` vem de `openssl dgst -sha256 -verify pub.pem -signature sig.bin`
sobre `header.payload`; com o payload trocado para `"roles":["admin"]`, a saída
é `Verification failure`. Qualquer portador lê o payload (é assinado, não
cifrado), qualquer alteração aparece, e a verificação dispensa chamar o
emissor. O preço: o token vale até o `exp`, mesmo depois do logout.

| | Cookie de sessão | Access token JWT |
|---|---|---|
| Conteúdo | id aleatório | claims + assinatura |
| Validação | consulta no servidor | assinatura + `exp`, `aud`, `iss` |
| Revogação | apagar a linha | esperar o `exp` ou manter lista de bloqueio |
| Melhor para | navegador falando com o próprio backend | API chamada por vários clientes |

### Papéis num login federado

- **IdP (identity provider)**: autentica o usuário e emite asserções ou
  tokens. Keycloak, Microsoft Entra ID, Okta, Auth0, Google.
- **SP (service provider, SAML) / RP (relying party, OIDC)**: a aplicação que
  confia no IdP em vez de guardar senhas.
- **Authorization server e resource server (OAuth)**: o primeiro emite access
  tokens, o segundo (a sua API) os valida.
- **PEP (policy enforcement point)**: o código no caminho da requisição que
  bloqueia ou libera: um middleware, um gateway, um sidecar.
- **PDP (policy decision point)**: responde permit ou deny. No servidor acima
  é uma função; em produção pode ser OPA, Cedar, OpenFGA ou SpiceDB. A NIST
  SP 800-162 acrescenta o PIP (fonte de atributos) e o PAP (onde se escrevem
  as políticas). Separada do PEP, a decisão vira dado entra, dado sai, testável.

### Um diretório respondendo "quem é a alice" (medido)

LDAP é onde as empresas guardam identidades (OpenLDAP, Active Directory).
OpenLDAP local em Docker, um usuário e um grupo, e depois o login clássico
"search, depois bind" que os providers LDAP do Spring e do .NET fazem:

```text
$ ldapsearch -x -LLL -H ldap://localhost:6089 -D cn=admin,dc=example,dc=org -w admin \
    -b dc=example,dc=org '(&(objectClass=inetOrgPerson)(uid=alice))' dn cn mail departmentNumber
dn: uid=alice,ou=people,dc=example,dc=org
cn: Alice Doe
mail: alice@example.org
departmentNumber: sales

$ ldapwhoami -x -H ldap://localhost:6089 -D uid=alice,ou=people,dc=example,dc=org -w 'correct horse'
dn:uid=alice,ou=people,dc=example,dc=org
$ ldapwhoami -x -H ldap://localhost:6089 -D uid=alice,ou=people,dc=example,dc=org -w 'nope'
ldap_bind: Invalid credentials (49)

$ ldapsearch ... -b ou=groups,dc=example,dc=org '(member=uid=alice,ou=people,dc=example,dc=org)' cn
dn: cn=editors,ou=groups,dc=example,dc=org
cn: editors
```

A conta de serviço encontra o DN, o bind prova a senha (autenticação) e a
consulta de grupos alimenta o PDP com papéis (insumo da autorização). Buscar
como a própria alice devolveu `No such object (32)`: a ACL padrão da imagem
esconde a árvore de usuários comuns, por isso as aplicações buscam com conta de
serviço. Em produção se usa LDAPS ou StartTLS: um bind simples em `ldap://`
manda a senha em texto claro.

### O ciclo de vida da identidade: joiner, mover, leaver

- **Joiner** (entrada): o RH cadastra a pessoa, o IdP cria a conta, as
  aplicações recebem via provisionamento (SCIM) ou no primeiro login (JIT).
- **Mover** (mudança): troca de área precisa remover o acesso antigo, não só
  somar o novo. Sem a remoção vem o privilege creep: depois de três mudanças, o
  usuário acumula direitos de quatro cargos.
- **Leaver** (saída): desativar no IdP, revogar sessões e refresh tokens,
  remover de toda aplicação que guardou conta local. Um refresh token não
  revogado ou uma senha local sobrevivem à conta do IdP.

A revisão de acesso (recertificação) confere de tempos em tempos os três.

### Privilégio mínimo e Zero Trust, na prática

Privilégio mínimo: cada sujeito recebe só os direitos que a tarefa exige, só
pelo tempo que precisa. Na prática: escopos e audiences OAuth estreitos, papéis
por função e não por pessoa, nada de admin permanente (elevação just-in-time),
uma conta de serviço por serviço. O concept de Kubernetes sobre RBAC e
privilégio mínimo aplica a mesma ideia a um cluster.

Zero Trust (NIST SP 800-207, 2020) abandona o "dentro da rede é confiável".
Cada requisição é autenticada e autorizada por si só, com identidade, estado do
dispositivo e contexto, por um PEP na frente de cada recurso. Em concreto: VPN
não decide acesso, mTLS ou tokens entre serviços, credenciais de vida curta,
MFA resistente a phishing e log de toda decisão. É arquitetura, não um produto
que se compra.

### Mapa dos protocolos

| Protocolo | Responde | Onde aparece | Neste repo |
|---|---|---|---|
| Senha + MFA (TOTP, WebAuthn/passkeys) | autenticação | todo login | próximos desta trilha |
| OAuth 2.0 | autorização delegada (tokens para APIs) | APIs, mobile, SPAs | Spring OAuth 2 Fundamentals and Grant Types; .NET JWT Bearer Tokens |
| OpenID Connect | autenticação sobre OAuth (ID token) | "Entrar com...", SSO | .NET OpenID Connect, Entra ID and the BFF Pattern; Spring OAuth2 Client and SSO |
| SAML 2.0 | SSO de navegador com asserções XML assinadas | SaaS corporativo, universidades | esta trilha, Federation & SSO |
| LDAP / Active Directory | consulta e bind em diretório | bases de usuários corporativas | Spring Security JDBC and LDAP User Management |
| Kerberos | tickets para SSO dentro de um domínio Windows ou Unix | domínios AD, Hadoop, bancos de dados | esta trilha, Directory Services |
| SCIM 2.0 | provisionamento (joiner, mover, leaver) | sincronização do IdP com SaaS | esta trilha, Provisioning & Lifecycle |

Livro contra hoje: SAML, bind LDAP, Kerberos e NTLM ainda sustentam a maioria
das redes corporativas e valem ser bem entendidos, mas aplicação nova integra
via OIDC com um IdP que fala os protocolos legados por ela. Código por SMS
ainda é comum, mas a NIST SP 800-63-4 (julho de 2025) o mantém "restrito";
implantações novas escolhem passkeys ou push com number matching.

### Para onde ir

As implementações em Spring e ASP.NET Core estão nos concepts relacionados.
Próximos nesta trilha: senhas e ataques a credenciais, depois os fatores de MFA
(HOTP, TOTP, push) medidos contra os vetores de teste das RFCs.

## Trade-offs

- **Cookie de sessão contra JWT.** O cookie dá revogação imediata e mantém as
  claims privadas, mas exige armazenamento de sessão compartilhado entre
  instâncias. O JWT escala sem consulta, mas o logout não o encerra; mantenha
  access tokens curtos (minutos) e combine com refresh tokens revogáveis.
- **PDP central contra checagens no código.** Um motor externo (OPA, OpenFGA)
  dá uma política auditável para vários serviços, ao custo de um salto de rede
  e de um cache para invalidar. `if (user.isAdmin)` espalhado pelos handlers é
  rápido de escrever e impossível de revisar.
- **Federação contra contas locais.** O IdP dá SSO, MFA e um único botão de
  desligamento, mas vira ponto único de falha: planeje contas de break-glass.
- **Detalhe de auditoria contra privacidade.** Registre sujeito, ação, recurso,
  decisão e motivo; nunca senhas, tokens ou ids de sessão (a demo não os grava).
- **Privilégio mínimo contra atrito.** Papéis finos multiplicam pedidos de
  acesso; elevação just-in-time com aprovação mantém o padrão estreito sem
  travar quem está de plantão.

## Documentation Links

- [SP 800-207, Zero Trust Architecture, NIST](https://csrc.nist.gov/pubs/sp/800/207/final) (doc)
- [SP 800-63-4, Digital Identity Guidelines, NIST](https://csrc.nist.gov/pubs/sp/800/63/4/final) (doc)
- [SP 800-162, Guide to Attribute Based Access Control, NIST](https://csrc.nist.gov/pubs/sp/800/162/upd2/final) (doc)
- [RFC 2904, AAA Authorization Framework, IETF](https://www.rfc-editor.org/rfc/rfc2904) (doc)
- [RFC 7519, JSON Web Token, IETF](https://www.rfc-editor.org/rfc/rfc7519) (doc)
- [RFC 6749, The OAuth 2.0 Authorization Framework, IETF](https://www.rfc-editor.org/rfc/rfc6749) (doc)
- [OpenID Connect Core 1.0, OpenID Foundation](https://openid.net/specs/openid-connect-core-1_0.html) (doc)
- [SAML V2.0 Technical Overview, OASIS](https://docs.oasis-open.org/security/saml/Post2.0/sstc-saml-tech-overview-2.0.html) (doc)
- [RFC 4511, LDAP: The Protocol, IETF](https://www.rfc-editor.org/rfc/rfc4511) (doc)
- [Session Management Cheat Sheet, OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) (doc)
- [Authorization Cheat Sheet, OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html) (doc)
