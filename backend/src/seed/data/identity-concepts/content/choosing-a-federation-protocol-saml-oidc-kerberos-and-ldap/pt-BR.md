---
version: 1.0
updatedAt: 2026-11-19
---
## Objective

LDAP, Kerberos, SAML, OIDC e SCIM respondem perguntas diferentes, e a maioria dos sistemas reais usa três deles ao mesmo tempo. Esta lição é a camada de decisão sobre as lições de protocolo desta trilha: uma matriz de quando escolher cada um e depois o padrão que torna a mistura sustentável, o identity brokering. Medimos três containers Keycloak numa mesma rede Docker: um realm hub que não guarda senha e delega a um upstream por OIDC e a outro por SAML. O app enxerga um único token OIDC, qualquer que seja o upstream. Medido: o fluxo no fio, o mapeamento de claims dos dois upstreams, o `kc_idp_hint`, o home realm discovery por domínio de e-mail, o sequestro de conta na vinculação do primeiro login (e qual configuração o fecha) e o que o logout faz com as sessões de cada lado. Os padrões B2B, B2C, workforce e entre organizações ficam em prosa, com a documentação do Entra só lida.
Versions: Keycloak 26.8.2 (`quay.io/keycloak/keycloak:26.8.2`, `start-dev`, três containers de 500 a 650 MiB cada, VM do Docker com 7,7 GiB), curl 8.7.1, jq 1.7.1, Python 3 para decodificar, `javap` sobre o jar do Keycloak (JDK 25).

## Use Cases

- Escolher o protocolo de uma integração nova sem cair no que o último projeto usou.
- Dar ao app um único contrato de login enquanto clientes trazem Entra, Okta, Google ou um IdP SAML de parceiro.
- Revisar a opção "vincular contas por e-mail" antes que ela vire um caminho de sequestro de conta.
- Planejar uma migração de SAML para OIDC em que os dois precisam coexistir por um ano.

## Deep Dive

### Para que serve cada protocolo

Leia os cinco pela pergunta que respondem, não pela idade. **LDAP**: onde as identidades moram e como um bind confere a senha; é um diretório, não SSO. **Kerberos**: SSO sem senha dentro de um domínio, por tickets, para clientes que alcançam o KDC. **SAML 2.0**: SSO de navegador entre organizações sobre XML assinado. **OIDC (sobre OAuth 2.0)**: o mesmo trabalho com JSON, JWT e HTTPS puro, mais APIs, mobile e SPAs. **SCIM**: nem é login, é o canal de provisionamento que cria e desativa as contas que os outros quatro autenticam. O erro tentador é compará-los como alternativas; LDAP ou Kerberos costuma ficar atrás de um IdP, e o IdP fala SAML ou OIDC com os apps.

### Matriz de decisão

| Critério | LDAP | Kerberos | SAML 2.0 | OIDC / OAuth 2.0 | SCIM 2.0 |
|---|---|---|---|---|---|
| Tipo de cliente | qualquer processo que faça bind | SO ingressado no domínio, bibliotecas GSSAPI | só navegador | navegador, SPA, nativo, serviço | servidor a servidor |
| Onde roda | intranet | intranet ou VPN até o KDC | internet, B2B | internet e intranet | internet |
| Quem é o IdP | o próprio diretório | o KDC (muitas vezes Active Directory) | IdP corporativo ou universitário | Keycloak, Entra, Okta, Google | o IdP é o cliente |
| Exigência do parceiro | apps legados | ambientes Windows | muitos SaaS, setor público | a maioria dos SaaS novos | planos enterprise |
| Logout | nenhum (fechar a conexão) | só o tempo de vida do ticket | SLO, frágil | RP-initiated, back-channel | desprovisionar, `active:false` |
| Atributos | entradas do schema | PAC (grupos do AD) | `AttributeStatement` | ID token, UserInfo | modelo completo de recurso |
| Custo de integração | baixo, mas o app lida com senhas | alto (SPNs, keytabs, relógio) | médio a alto (XML, metadata) | baixo a médio | médio (endpoint e mapeamento) |
| Superfície de ataque | senha no app, injeção | Kerberoasting, delegação | XML wrapping, replay | redirect, PKCE, roubo de token | escalada de privilégio pela API |
| Maturidade das bibliotecas | muito alta | alta, presa à plataforma | irregular, atualize sempre | alta, muito auditadas | irregular |

Decida nesta ordem: (1) a exigência rígida do parceiro (SaaS que só fala SAML encerra a discussão naquela borda); (2) o cliente (SPA ou app mobile não faz SAML nem Kerberos bem); (3) a rede (Kerberos exige visada até o KDC); (4) quem é dono da identidade (não transforme o app em depósito de senhas); (5) necessidades de logout e atributos. Quando duas bordas discordam, ponha um broker entre elas em vez de escolher um só para a empresa inteira.

### O laboratório: um hub que não guarda ninguém (medido)

Uma rede Docker `idn-fed-net`, três containers nomeados pelo papel, cada um numa porta: `idn-fed-hub` (6620), `idn-fed-idp-oidc` (6621, realm `acme`, usuária `alice`, `alice@acme.example`, atributos `department=finance`, `groups=[approvers, staff]`) e `idn-fed-idp-saml` (6622, realm `partner`, usuária `carol`, `carol@partner.example`, `orgUnit=legal`, `memberOf=[contracts, reviewers]`). `KC_HOSTNAME=http://idn-fed-<nome>:<porta>` mais `curl --resolve` deixa idênticas as URLs vistas pelo navegador e entre servidores, sem truques de host. Três Keycloaks cabem neste Mac sem problema: 577, 633 e 497 MiB residentes. Numa máquina pequena, suba o hub e um upstream de cada vez; os fluxos abaixo não mudam.

O realm do hub nasce vazio. Cada upstream entra pelo próprio metadata, então endpoints e chaves nunca são digitados:

```text
POST /admin/realms/hub/identity-provider/import-config {"providerId":"oidc","fromUrl":".../realms/acme/.well-known/openid-configuration"}
  -> authorizationUrl, tokenUrl, jwksUrl, userInfoUrl, issuer, logoutUrl
POST /admin/realms/hub/identity-provider/import-config {"providerId":"saml","fromUrl":".../realms/partner/protocol/saml/descriptor"}
  -> singleSignOnServiceUrl, singleLogoutServiceUrl, signingCertificate, idpEntityId
POST /admin/realms/hub/identity-provider/instances  (alias acme-oidc / partner-saml, config = importado + clientId, secret, PKCE S256)
```

Os defaults importados do SAML precisaram de três correções, cada uma uma falha real primeiro: `wantAuthnRequestsSigned` veio `true` do descriptor (o hub não assina), o formato do NameID veio `persistent` (id opaco como username; trocado para `emailAddress`) e o upstream não mandava `firstName`/`lastName`, então o primeiro login no hub parava num formulário "Update Account Information" até os dois serem mapeados.

### O que o app vê: um único protocolo (medido)

O app é um único cliente OIDC confidencial `app` no hub, authorization code com PKCE. Com `kc_idp_hint=acme-oidc` o hub redireciona o navegador ao upstream, e o app só conversa com o hub:

```text
303 GET hub/realms/hub/protocol/openid-connect/auth?...&kc_idp_hint=acme-oidc
303 GET hub/realms/hub/broker/acme-oidc/login
200 GET idp-oidc/realms/acme/protocol/openid-connect/auth      (o formulário de login do upstream)
302 POST idp-oidc/realms/acme/login-actions/authenticate
302 GET hub/realms/hub/broker/acme-oidc/endpoint               (code do upstream resgatado entre servidores)
302 GET hub/realms/hub/login-actions/first-broker-login        (usuário sombra criado)
302 GET hub/realms/hub/broker/after-first-broker-login  -> http://localhost:6623/callback?code=...
```

A requisição do hub ao upstream OIDC é, ela mesma, um fluxo de code com `state`, `nonce` e `code_challenge` (`S256`) próprios: o hub é cliente OIDC de `acme` e servidor OIDC do `app` ao mesmo tempo. Para o upstream SAML o salto é um formulário HTML postado em `.../protocol/saml`, e o `AuthnRequest` decodificado é curto: `Issuer` = `http://idn-fed-hub:6620/realms/hub`, `AssertionConsumerServiceURL` = o `/broker/partner-saml/endpoint` do hub, `ProtocolBinding` = HTTP-POST, `NameIDPolicy` = `emailAddress`. A `Response` trouxe a assertion assinada e o hub a validou contra o certificado fixado a partir do descriptor (detalhes na lição de SAML). O que o app recebe ao resgatar o próprio code:

```text
alice  via OIDC: {"iss":"http://idn-fed-hub:6620/realms/hub","aud":"app","sub":"a94367a8-...","preferred_username":"alice",
                  "email":"alice@acme.example","email_verified":false,"dept":"finance","groups":["approvers","staff"],
                  "source":"acme","identity_provider":"acme-oidc"}
carol  via SAML: {"iss":"http://idn-fed-hub:6620/realms/hub","aud":"app","sub":"624133cc-...","preferred_username":"carol@partner.example",
                  "email":"carol@partner.example","email_verified":false,"dept":"legal","groups":["contracts","reviewers"],
                  "source":"partner","identity_provider":"partner-saml"}
```

Mesmo issuer, mesmas chaves de assinatura, mesmos nomes de claims, protocolos de upstream diferentes. O `sub` é o id do próprio hub, não o do upstream, e o realm do hub agora guarda dois usuários sem senha. `GET /users/{id}/federated-identity` mostra o vínculo: `acme-oidc` com userId `f53ea021-...` (o `sub` do upstream) e `partner-saml` com userId `carol@partner.example` (o NameID). O app identifica usuários por (`iss` do hub, `sub`) e nunca descobre o que Acme ou o parceiro usam. `email_verified` é `false` nos dois porque `trustEmail` está desligado nos dois upstreams, o padrão seguro, e isso pesa na seção de vinculação.

### Mapeamento de claims: identity provider mappers (medido)

A normalização acontece em dois saltos, ambos configuração. Do upstream para o hub, um IdP mapper por atributo; do hub para o app, um protocol mapper no cliente:

| Claim do app | Do upstream OIDC (`acme`) | Do upstream SAML (`partner`) | Tipo de mapper no hub |
|---|---|---|---|
| `dept` | claim `dept` | atributo `OrgUnit` | `oidc-user-attribute-idp-mapper` / `saml-user-attribute-idp-mapper` para o atributo de usuário `department` |
| `groups` | claim `groups` (array) | atributo `MemberOf` (2 `AttributeValue`) | o mesmo, para o atributo multivalorado `groups` |
| `source` | constante `acme` | constante `partner` | `hardcoded-attribute-idp-mapper` |
| `identity_provider` | nenhum | nenhum | mapper de session note no cliente `app` |
| nome, e-mail | claims padrão | atributos `firstName`, `lastName`, `email` | embutido, mais dois mappers SAML adicionados |

Duas armadilhas medidas aqui. O IdP SAML também emitiu seis atributos `Role` (os roles padrão do realm do upstream, como `uma_authorization` e `offline_access`): um IdP mapper que copiasse `Role` às cegas entregaria ao hub os roles internos do parceiro, então mapeie só o que você nomeou. E o IdP mapper tem sync mode: `IMPORT` copia no primeiro login, `INHERIT` segue o padrão do realm, `FORCE` reescreve a cada login. Para acesso dirigido por grupo use `FORCE`, senão quem saiu de `approvers` no upstream continua nele no hub até alguém notar.

### kc_idp_hint e home realm discovery (medido)

Sem dica, a página de login do hub lista os dois botões de upstream (`id="social-acme-oidc"`, `id="social-partner-saml"`). Serve para dois parceiros e não serve para 200. Dois mecanismos escolhem o upstream pelo usuário:

- **`kc_idp_hint=<alias>`** na requisição de autorização, definido pelo app que já conhece o tenant (um subdomínio, um caminho, um convite). É um parâmetro da authorize request, então o cliente só consegue pular a tela de escolha do hub, nunca forçar uma escolha que o hub recusa.
- **Home realm discovery (HRD) por domínio de e-mail**: o usuário digita o endereço e o hub decide. No Keycloak 26 isso é o recurso Organizations: uma organização por cliente, um domínio, um IdP vinculado e auto-redirect. A regra é dado, definido pela API admin (`PUT /organizations/{id}` com `domains:[{name, verified:true, identityProviderAlias, autoRedirect:true}]`, mais `POST /organizations/{id}/identity-providers`). O "Organization Identity-First Login" do browser flow passa então a pedir o endereço primeiro. Medido, postando o username no primeiro formulário:

```text
alice@acme.example      -> 303 Location: .../broker/acme-oidc/login          (upstream OIDC)
carol@partner.example   -> 303 Location: .../broker/partner-saml/login       (upstream SAML)
dave@other.example      -> 200, o formulário de senha (nenhuma organização casa, login local)
```

Duas lições de fazer isso funcionar. Domínio e vínculo do IdP sozinhos não fizeram nada: enquanto a linha do domínio não trouxe `identityProviderAlias` e `autoRedirect:true`, o formulário identity-first continuou pedindo senha, então um HRD meio configurado falha aberto para o login local. E o domínio é chave de roteamento, não prova de posse: o app que escolhe o IdP por `@acme.example` também precisa exigir que aquele IdP possa afirmar aquele domínio (o "domain gate" da documentação do Keycloak), senão um tenant pode reivindicar endereços alheios.

### First broker login e vinculação de contas (medido)

Na primeira vez que uma identidade federada chega, o hub executa o **first broker login flow**: revisar o perfil e então criar um usuário local novo ou vincular a um existente. A pergunta é o que prova que "esta identidade do upstream é a mesma pessoa daquela conta do hub". O e-mail é a resposta tentadora e insegura. Cenário: o hub já tem um usuário local `bob` (`bob@hub.example`, departamento `treasury`). No upstream `acme` qualquer um se cadastra, e `mallory` se cadastrou com o e-mail `bob@hub.example`, nunca verificado: o token do upstream traz `"email":"bob@hub.example","email_verified":false`. Mallory se autentica no upstream com a própria senha e chega ao hub. Cada linha abaixo é uma execução real, com o vínculo federado removido entre elas:

| First login flow do hub | `trustEmail` | `email_verified` no upstream | Resultado |
|---|---|---|---|
| padrão (`first broker login`) | off | false | página "Account already exists"; "Add to existing account" pede a **senha do bob** (reautenticação). Sem sequestro |
| padrão, SMTP configurado | off | false | "Verify existing account by e-mail" dispara; com SMTP morto: "Failed to send email". Ainda sem sequestro |
| custom: Create User If Unique + Automatically Set Existing User | off | false | recusado, "Invalid username or password" genérico, evento `IDENTITY_PROVIDER_FIRST_LOGIN_ERROR` |
| mesmo flow custom | **on** | false | **sequestro**: `sub` do token = id do bob, `preferred_username` bob, `dept` treasury |
| mesmo flow custom | off | **true** | **sequestro**, mesmo token |
| mesmo flow custom | on | true | **sequestro**, mesmo token |

Mallory termina com um token do bob: mesmo `sub`, atributos do bob, `email_verified:true`, e o app não tem como ver a diferença. Dois achados corrigem crenças comuns. Primeiro, `trustEmail` se sobrepõe a um upstream que diz que o endereço não foi verificado (linha 4); o guia do Keycloak diz que a claim é respeitada, mas no 26.8.2 a guarda do auto-link deixou passar. Segundo, a guarda existe e é estreita: ler o `IdpAutoLinkAuthenticator` do jar 26.8.2 com `javap` mostra três recusas (e-mail ou username editado no review profile, e-mail do broker diferente do do usuário existente, nem confiado nem verificado) e nada sobre quem controla o upstream. Com um passo Review Profile antes do auto-link o mesmo ataque foi recusado; não isolei o motivo, então não confie nisso.

A defesa é estrutural, não uma opção:

1. Mantenha o flow padrão (reautenticar com as credenciais da conta existente, ou verificar por e-mail com um SMTP funcionando) para todo upstream cujos usuários escolhem o próprio endereço.
2. Use Automatically Set Existing User só num flow ligado a um upstream que você controla e cujas afirmações de endereço você confia (o seu IdP corporativo), nunca em cadastro aberto nem em e-mail editável por admin de tenant. Flows por IdP tornam isso propriedade do IdP, não do realm.
3. Vincule pelo par imutável (`iss`, `sub`). A referência de claims do Entra diz que a claim `email` é mutável e nunca deve ser usada para autorização (docs only, Microsoft Learn).
4. Nunca ligue `trustEmail` num upstream que aceita endereços não verificados; use `FORCE` nos mappers só para claims que o upstream realmente possui.

### Logout entre o hub e o upstream (medido)

Existem duas sessões: a do hub e a de cada upstream. App para hub é o logout RP-initiated da lição de OIDC; depois o hub precisa alcançar o upstream. Logout no hub com `id_token_hint`, a partir de um cookie jar de navegador:

```text
Upstream OIDC:  302 hub logout -> 302 idp-oidc/.../openid-connect/logout -> 302 hub/.../broker/acme-oidc/endpoint/logout_response -> app
                sessões da alice no upstream 1 -> 0, hub prompt=none -> login_required
Upstream SAML:  200 hub logout (formulário HTML) -> POST SAMLRequest (LogoutRequest) para idp-saml/protocol/saml -> POST SAMLResponse para o hub -> app
                sessões da carol no upstream 1 -> 0, hub prompt=none -> login_required
```

O hub, provedor OIDC para o app, vira cliente de logout RP-initiated perante o `acme` e um SP SAML que emite `LogoutRequest` perante o `partner`. Dois detalhes machucaram: o upstream rejeitou o `post_logout_redirect_uri` do hub com "Invalid redirect uri" até o cliente no upstream registrar `.../broker/acme-oidc/endpoint/logout_response`, e a cadeia é mediada pelo navegador, então só completa se o navegador levar os cookies das três sessões. O sentido inverso é a borda fraca: encerrar a sessão do upstream direto (logout de admin) deixou a contagem de sessões do hub em 1, e um refresh token do hub ainda renovou (`expires_in` 300) porque não havia back-channel logout configurado de `acme` para o hub. Encerrar a sessão do upstream nunca revoga o que o hub já emitiu. Back-channel logout e tempo de vida de tokens estão na lição de OIDC; o modelo de sessão é o I18.

### Padrões de arquitetura (prosa, não medido)

- **Workforce.** Um IdP corporativo (Entra, Okta, Keycloak), todo app interno e SaaS atrás dele por OIDC ou SAML, entrada e saída de pessoas por SCIM, Kerberos ou LDAP mantidos só para a cauda Windows e legada atrás desse IdP. O objetivo é que um desligamento no RH encerre o acesso num lugar só.
- **B2B (funcionários dos clientes).** Um tenant do seu produto por organização cliente, cada um com o próprio upstream (o IdP do cliente) e o próprio domínio: exatamente o modelo de organizações e HRD acima. Mapeamento de claims por tenant, `hint` por tenant. A documentação de B2B e External ID do Entra (docs only) cobre a variante da Microsoft em que o convidado continua no diretório do cliente. As partes difíceis são o onboarding (uma troca de metadata por cliente) e o isolamento de tenant na autorização, não o login.
- **B2C e CIAM (consumidores).** A identidade é sua: senha mais passkeys, login social como upstreams federados, MFA adaptativa por sinais de risco, consentimento e privacidade (LGPD e GDPR, exclusão, central de preferências). A vinculação de contas é o risco central, então a seção anterior vale em escala; a recuperação é o elo fraco (I19). Passkeys são o fator para liderar (veja a lição de WebAuthn e passkeys desta trilha).
- **Federação entre organizações.** Universidades e redes de pesquisa (InCommon, eduGAIN) operam milhares de IdPs e SPs SAML publicando agregados de metadata assinados que cada lado consome. Ninguém troca certificados à mão; a confiança é a assinatura do operador da federação sobre o agregado. Só citado, não medido aqui.
- **Gateways e BFF.** Ponha o protocolo num lugar só (um gateway, um BFF, o hub) e entregue à aplicação um cookie de sessão ou um único formato de token. O app então troca de IdP sem novo deploy. As implementações em Spring e .NET estão nos concepts relacionados.
- **Migrar de SAML para OIDC.** Não vire a chave app por app. Ponha o hub na frente, aponte cada app para ele por OIDC enquanto o upstream SAML legado continua funcionando atrás (é o laboratório acima, com `partner` como IdP SAML), mova um app por vez e troque o protocolo do upstream quando o parceiro estiver pronto. O hub é o tradutor, então os apps migram no ritmo deles e o parceiro no dele. Custo: o hub vira infraestrutura crítica e o mapeamento de claims vira um contrato a testar.

### O livro contra hoje

Textos mais antigos apresentam o SAML como "o SSO corporativo" e o OIDC como a alternativa de consumidor. Hoje: aplicações novas começam com OIDC com PKCE; o SAML sobrevive porque IdPs corporativos, catálogos de SaaS e federações se padronizaram nele e as migrações são lentas; Kerberos e LDAP persistem dentro de ambientes Windows e diretórios, mas como backend atrás de um IdP, não como protocolos expostos a apps web novos; NTLM é um fallback a remover. O SCIM virou o padrão de ciclo de vida para SaaS B2B. Senhas estão cedendo lugar a passkeys como fator principal, e a passkey muda o passo de login, não o protocolo de federação ao redor.

### Tabela de decisão

| Cenário | Protocolo recomendado | Por quê | Armadilha |
|---|---|---|---|
| App web novo, clientes entram com o próprio IdP | OIDC por um hub, HRD por domínio | um contrato para o app, qualquer upstream | confiar no e-mail para vincular contas |
| SPA ou app mobile | OIDC code com PKCE, via BFF para SPAs | suporte nativo, sem XML | tokens no storage do navegador |
| Parceiro SaaS que só fala SAML | SAML naquela borda, um hub atrás | a exigência do parceiro vence | `Destination`/`Recipient` sem checar, XSW |
| App de intranet Windows, usuários no domínio | Kerberos (Negotiate), ou OIDC do IdP sobre o AD | sem senha, sem prompt | deriva de SPN e keytab, desvio de relógio |
| App legado que precisa conferir senhas | bind LDAP no diretório, LDAPS | menor mudança | o app agora lida com senhas, injeção |
| API serviço a serviço | OAuth client credentials, ou workload identity (I17) | sem usuário | segredos compartilhados de vida longa |
| Cliente quer offboarding automático | SCIM 2.0 do IdP dele | ciclo de vida da conta, não login | desprovisionar que só bloqueia o login |
| Consumidores, cadastro público | IdP próprio com passkeys mais upstreams sociais | você é dono do ciclo de vida | recuperação e abuso de vinculação |
| Federação acadêmica | SAML com metadata da federação | a comunidade funciona assim | metadata velho, entity attributes |

### Para onde ir depois

Provisionamento é a outra metade da federação: o SCIM 2.0 (I16) cria e desativa as contas que o hub agora loga. O que um usuário autenticado pode fazer é autorização (I15), e grupos e roles mapeados são entradas dela, não decisões. Sessão, rotação de refresh e revogação entre hub, app e upstream é o I18.

## Trade-offs

- **Hub contra integração direta.** O hub dá aos apps um só protocolo e deixa os IdPs mudarem sem trabalho nos apps (medido). Também é ponto único de falha, um contrato de mapeamento de claims a testar e uma sessão a mais para encerrar. Um IdP e poucos apps raramente justificam; muitos tenants ou protocolos mistos justificam.
- **HRD por domínio de e-mail contra dica explícita.** O HRD não exige conhecimento do app, mas falha aberto para login local quando um domínio é mapeado errado (medido). O `kc_idp_hint` é exato, mas só funciona quando o app conhece o tenant. Use os dois: dica quando conhecida, HRD no resto.
- **Auto-link contra perguntar.** Vincular automaticamente é fluido e, com um upstream que não controla seus e-mails, um sequestro (medido, três das seis linhas). Pedir as credenciais existentes custa um clique uma vez e é seguro.
- **Claims mapeadas contra claims brutas do upstream.** O mapeamento dá ao app um contrato estável; copiar atributos do upstream às cegas importa os roles internos dele (seis valores de `Role` medidos). Mapeie só o que o app precisa e prefira sync `FORCE` para atributos que afetam autorização.
- **Back-channel logout contra sessões curtas.** Encadear o logout pelo navegador é frágil; matar a sessão do upstream deixou a sessão do hub viva (medido). Sessões curtas no hub são brutas, mas confiáveis.

## Documentation Links

- [Server Administration Guide: identity brokering, first login flow, organizations, Keycloak](https://www.keycloak.org/docs/latest/server_admin/index.html) (doc)
- [Securing applications and services with OpenID Connect, Keycloak](https://www.keycloak.org/securing-apps/oidc-layers) (doc)
- [OpenID Connect Core 1.0 incorporating errata set 2, OpenID Foundation](https://openid.net/specs/openid-connect-core-1_0.html) (doc)
- [OpenID Connect Back-Channel Logout 1.0, OpenID Foundation](https://openid.net/specs/openid-connect-backchannel-1_0.html) (doc)
- [SAML Core 2.0 OS, OASIS](https://docs.oasis-open.org/security/saml/v2.0/saml-core-2.0-os.pdf) (doc)
- [RFC 9700, Best Current Practice for OAuth 2.0 Security, IETF](https://www.rfc-editor.org/rfc/rfc9700) (doc)
- [RFC 7644, SCIM Protocol, IETF](https://www.rfc-editor.org/rfc/rfc7644) (doc)
- [RFC 4120, The Kerberos Network Authentication Service (V5), IETF](https://www.rfc-editor.org/rfc/rfc4120) (doc)
- [RFC 4511, Lightweight Directory Access Protocol (LDAP): The Protocol, IETF](https://www.rfc-editor.org/rfc/rfc4511) (doc)
- [NIST SP 800-63C Digital Identity Guidelines: Federation and Assertions, NIST](https://pages.nist.gov/800-63-4/sp800-63c.html) (doc)
- [Microsoft Entra External ID overview, Microsoft Learn](https://learn.microsoft.com/en-us/entra/external-id/external-identities-overview) (doc)
- [B2B collaboration overview, Microsoft Entra External ID, Microsoft Learn](https://learn.microsoft.com/en-us/entra/external-id/what-is-b2b) (doc)
- [Secure applications and APIs by validating claims, Microsoft Learn](https://learn.microsoft.com/en-us/entra/identity-platform/claims-validation) (doc)
- [ID token claims reference, Microsoft Learn](https://learn.microsoft.com/en-us/entra/identity-platform/id-token-claims-reference) (doc)
