---
version: 1.0
updatedAt: 2026-11-19
title: "SCIM: Provisionamento e o Ciclo de Vida da Identidade"
summary: SCIM 2.0 (RFC 7643 e 7644) medido contra um servidor SCIM mínimo escrito para a lição, em Node 22 e sem framework. Descoberta (ServiceProviderConfig, ResourceTypes, Schemas), criação com 201 e Location, unicidade, filtros e paginação 1-based, PUT contra PATCH (o PUT apagou externalId e department), PatchOp com caminhos como emails[type eq "work"].value, active:false contra DELETE com revogação de sessões, erros scimType (uniqueness, invalidValue, mutability, noTarget, invalidVers), ETag e If-Match, rotação de bearer, grupos e a corrida entre grupo e usuário, JIT contra SCIM, um reconciliador que acha contas órfãs, a validação do servidor contra mass assignment e privilégio, e Entra ID, Okta e Keycloak lidos só na documentação.
---
## Objective

SCIM 2.0 é o contrato HTTP e JSON que uma fonte de identidade (um sistema de RH,
um IdP como Entra ID ou Okta) usa para criar, alterar e desativar contas dentro
das aplicações, de modo que entrada, mudança e saída de pessoas deixam de ser
chamados e planilhas. Esta lição monta um servidor SCIM de 200 linhas em Node 22
(sem framework, em memória) e o aciona com curl: descoberta, criação, filtros,
paginação, PUT contra PATCH, `active:false` contra DELETE, os erros `scimType`,
ETag, rotação de token, grupos, um reconciliador que acha contas órfãs e as
validações que impedem o endpoint de virar uma API de escalada de privilégio.
Entra ID, Okta e Keycloak foram lidos só na documentação oficial (nada executado).
Versions: Node 22.23.4, curl, jq 1.7.1, RFC 7643 e RFC 7644 (setembro de 2015).

## Use Cases

- Construir o "endpoint SCIM" que um cliente corporativo pede.
- Depurar um IdP que duplica, perde atributos ou nunca desativa.

## Deep Dive

### Onde o SCIM entra

A RFC 7643 define o modelo (User, Group, extensões), a RFC 7644 o protocolo
(verbos, filtros, PATCH, bulk, ETag) e a RFC 7642 os casos de uso. O IdP é o
cliente SCIM, a aplicação é o service provider. Autenticar a pessoa é OIDC ou
SAML; o SCIM só decide quais contas existem. O servidor sobe em `/scim/v2`, porta 6580.

### Descoberta (medido)

```text
$ curl -s -H "$AUTH" $B/ServiceProviderConfig | jq -c '{patch,bulk,filter,etag,sort}'
{"patch":{"supported":true},"bulk":{"supported":false,...},"filter":{"supported":true,"maxResults":100},"etag":{"supported":true},"sort":{"supported":false}}
$ curl -s -H "$AUTH" $B/ResourceTypes | jq -c '.Resources[]|{id,endpoint}'
{"id":"User","endpoint":"/Users"}  {"id":"Group","endpoint":"/Groups"}   # User lists the enterprise extension
```

Todo corpo declara seus `schemas`; atributos fora do núcleo (`department`,
`manager` da extensão enterprise) ficam sob a própria chave URN. O Bulk (RFC 7644
seção 3.7, várias operações por requisição) é opcional: este servidor responde
`supported:false` e as páginas da Entra e da Okta lidas aqui não o exigem.

### Criar, ler e unicidade (medido)

```text
POST /Users {userName alice@example.org, externalId hr-1001, emails[work]} -> 201
  Location: http://localhost:6580/scim/v2/Users/a0b7435f-e49b-4675-a8af-1706f6a70f76
  ETag: W/"1"
POST /Users {userName ALICE@example.org} -> 409 {"scimType":"uniqueness","detail":"userName ALICE@example.org already exists"}
```

O servidor atribui `id` e preenche `meta` (`created`, `lastModified`, `version`,
`location`). `userName` é único e sem distinção de caixa (RFC 7643: `caseExact`
falso), então o duplicado em caixa alta vira 409. `externalId` é a chave do
cliente (o id do RH), guardada como veio: casar por ela e não por e-mail
sobrevive a uma troca de nome.

### Filtros e paginação (medido)

```text
GET /Users?filter=userName eq "alice@example.org"            -> 200 totalResults 1
GET /Users?filter=userName sw "user" and externalId co "03"  -> 200 ["user3@example.org"]
GET /Users?filter=userName eq "nobody"                       -> 200 totalResults 0 (not 404)
GET /Users?filter=userName like "x"                          -> 400 invalidFilter
GET /Users?startIndex=1&count=2 -> totalResults 6, itemsPerPage 2 [alice, user1]
GET /Users?startIndex=5&count=2 -> [user4, user5]    startIndex=99 -> 200 itemsPerPage 0
```

`startIndex` conta a partir de 1; `totalResults` conta todos os resultados e
`itemsPerPage` a página. Zero resultados é um 200 com lista vazia: o IdP pergunta
"esse usuário existe?" e 0 significa "crie". Meu filtro (20 linhas) tem `eq`,
`co`, `sw`, `pr` e `and`; `or`, `not` e agrupamento faltam de propósito.

### PUT contra PATCH (medido)

```text
PATCH replace emails[type eq "work"].value        -> emails [{alice.doe@example.org, work}]
PATCH add emails [{a@home.example, home}]         -> both emails (add appends)
PATCH replace (no path) {name, enterprise:{department:finance}} -> 200; "op":"Replace" -> 200
PATCH replace emails[type eq "work2"].value       -> 400 noTarget
PUT /Users/<id> {userName alice@example.org}      -> 200 {"emails":null,"name":null,"externalId":null}
```

Um seletor que não casa com nada é `noTarget` (RFC 7644 seção 3.5.2). O PUT
substitui o recurso inteiro: tudo que o corpo omite some, `externalId` e o
`department` incluídos. Um IdP que faz PUT dos "campos que mapeei" apaga o resto
(o reconciliador abaixo achou o department da alice como drift). Prefira PATCH,
documente o PUT como substituição total e aceite valores objeto sem caminho e
caminhos explícitos, porque os clientes variam.

### Erros, ETag e mutabilidade (medido)

```text
PATCH replace active "False"  -> 400 invalidValue  "active must be a boolean"
POST  {id: 1111...}           -> 400 mutability    "id is readOnly"
PATCH {groups:[...]}          -> 400 mutability    "groups is readOnly"
GET -> ETag W/"7"; PATCH If-Match W/"1" -> 412 invalidVers; If-Match W/"7" -> 200, ETag W/"8"
GET /Users without a token    -> 401 + WWW-Authenticate: Bearer realm="scim"
```

Os erros são `application/scim+json` com `schemas`, `status` (string) e `scimType`
de uma lista fechada (`invalidFilter`, `uniqueness`, `mutability`, `invalidSyntax`,
`invalidPath`, `noTarget`, `invalidValue`, `invalidVers`, `sensitive`, `tooMany`).
O cliente decide por ele: sem retry em 400, reconciliar em 409. `meta.version` é
um ETag fraco; `If-Match` é um lock otimista, então duas sincronizações não se
sobrescrevem. É opcional e a maioria dos IdPs não usa.

### Autenticar o endpoint

O IdP é o cliente: API máquina a máquina, em geral com um bearer token estático
que o admin cola no IdP. O meu aceita dois ao mesmo tempo (medido: `Bearer
tok-next` 200, `Bearer tok-old` retirado 401). Rotação: adicione o novo, atualize
o IdP, remova o antigo (sem queda). Limite o token ao SCIM, fora dos logs, com
HTTPS. Ele cria admins: trate como chave raiz.

### Grupos e a corrida entre grupo e usuário

```text
POST /Groups {displayName sales} -> 201     PATCH add members [alice] -> 200; repeat -> still 1 (idempotent)
PATCH add members [ghost-id]     -> 400 invalidValue "member ghost-id does not exist"
```

`members[].value` é o `id` SCIM do usuário, não o userName. A corrida: um IdP que
empurra o grupo antes de o usuário existir recebe `invalidValue`. A cura é a
ordem (usuários, depois grupos) mais retry nesse erro; no sentido inverso, o
DELETE de um usuário o tira de todos os grupos (o servidor faz). A RFC 7643 não
exige `displayName` único, mas a Entra exige (doc). Se o RH e um admin editam a
mesma associação, a próxima sincronização desfaz uma delas.

### Desprovisionar: active:false contra DELETE (medido)

Duas sessões da alice abertas (tabela de sessões: count 2). Depois:
```text
PATCH replace active false -> 200 {"active":false}   sessions after: count 0
new SSO login of the disabled user -> 403
GET /Users?filter=active eq false -> [alice]          (record kept)
repeat PATCH active false -> 200 (idempotent)
DELETE /Users/<id> -> 204;  DELETE again -> 404;  GET -> 404
```

`active:false` é o soft delete: registro, histórico e referências ficam, e a
pessoa não entra mais. O DELETE remove; o segundo DELETE é um 404 que um IdP com
retry deve tratar como sucesso. Desativar não basta: o hook `onDeactivate` também
matou as sessões, pois sessão viva ou refresh token ainda dá acesso (veja a
ponte). Revogue chaves de API, reatribua o que a pessoa possuía e aplique
retenção aos dados pessoais. A doc da Entra manda devolver o usuário ativo ou não.

### JIT provisioning contra SCIM

O JIT cria a conta no primeiro login SSO, a partir das claims do token. O
`/sso/login` de brinquedo faz isso com `bob@example.org`: sem id do RH, sem
`externalId`. Não precisa de endpoint nem de sincronização, mas nunca remove
ninguém: quando a pessoa sai, ninguém loga, ninguém avisa a aplicação e a conta
fica ativa (órfã) com dados locais, senha ou chave de API. O SCIM acrescenta
contas antes do primeiro login, atualização de atributos e grupos e o sinal de
saída. JIT como rede de segurança, SCIM como ciclo de vida.

### Reconciliação: origem contra destino (medido)

Eventos se perdem (queda, quarentena, edição manual). O reconciliador pagina o
destino, casa por `externalId` e compara com o RH, a fonte de verdade: 6 pessoas,
`hr-2003` e `hr-2004` desligadas. No destino: alice desativada por engano, user1
perdido, `user5` (fora do RH) e o bob do JIT. Relatório, `--apply` (corrige os
seis primeiros) e relatório de novo:

```text
HR: 6  target: 6  findings: 8
  WRONGLY INACTIVE                         alice@example.org
  MISSING                                  user1@example.org
  DRIFT department (none) -> sales         user2@example.org
  LEAVER STILL ACTIVE                      user3@example.org
  LEAVER STILL ACTIVE                      user4@example.org
  MISSING                                  newbie@example.org
  ORPHAN (not in HR)                       user5@example.org
  ORPHAN (no externalId, JIT or manual)    bob@example.org
HR: 6  target: 8  findings: 2      (after --apply: only the two orphans remain)
```

As correções reusam as chamadas SCIM. Órfãos só são reportados: desativar uma
conta que o RH não conhece pode causar uma queda (contas de serviço,
terceirizados, break-glass), então um humano decide. Rode toda noite e alerte em
órfãos: a contagem mede quanto o fluxo de eventos vaza.

### Segurança: o SCIM é uma API de escrita privilegiada

```text
POST  {userName eve, isAdmin:true, roles:[admin]}  -> 400 invalidValue "unknown attribute isAdmin"
PATCH (no path) {roles:[{value:admin}]}            -> 400 invalidValue "unknown attribute roles"
PATCH add alice to group "admins"                  -> 403 "membership of admins is managed outside SCIM"
```

Um token que cria usuários cria um admin, então o servidor decide o que é
gravável: lista de atributos permitidos (rejeite chaves desconhecidas; nunca copie
o corpo para o modelo, nem no PATCH sem caminho: mass assignment); `roles` não vira
privilégio sem decisão; grupos privilegiados não graváveis ou com aprovação; valide
tipos; limite `count`; auditoria por mudança com a identidade do token; normalize
o `userName` antes da unicidade (duplicatas que só diferem na caixa são takeover).

### Como IdPs reais falam SCIM (só documentação, não executado)

- **Entra ID** (Microsoft Learn, página de 2026-09-15): envia o `op` do PATCH como
  `Add`, `Replace` e `Remove`, então não compare com distinção de caixa. Desprovisionar
  é PATCH `Replace`, `path: "active"`, `value: false`. Casa usuários por `userName`
  ou `externalId`, grupos por `displayName`, e usa só `eq` e `and` nos filtros.
  Bearer token, HTTPS, `/Schemas` esperado; grupos são opcionais mas exigem PATCH;
  `entitlements` não é suportado. Há um SCIM Validator para testar o endpoint.
- **Okta** (developer.okta.com): SCIM 2.0 e 1.1; a 2.0 é recomendada e exigida no
  Okta Integration Network. Auth por OAuth 2.0 authorization code, Basic ou header
  HTTP Authorization; o app suporta `active` e atribui o `id` (o cliente não pode).
  A suíte de testes checa a caixa do username.
- **Keycloak**: as release notes da 26.8.0 (outubro de 2026) promovem a SCIM API de
  preview para suportada: gerenciar usuários e grupos de um realm, isto é, o
  Keycloak como alvo SCIM. Sem cliente de saída oficial ali; confira a versão.

### Eventos do ciclo de vida: o que é enviado e o que pode dar errado

| Evento | O IdP envia (SCIM) | O servidor deve | O que dá errado |
|---|---|---|---|
| Entrada (joiner) | busca pelo atributo de casamento (`GET ...filter=userName eq`), depois `POST /Users` | 201, `userName` único, `Location`, seguro em retry | duplicata (409 ignorado), `externalId` perdido |
| Mudança (mover) | `PATCH` de atributos, `PATCH` de grupos (add e remove) | aplicar pelo caminho, tirar grupos antigos, versionar | PUT apaga campos, corrida de grupo, acesso antigo mantido (privilege creep) |
| Saída (leaver) | `PATCH active false` (ou `DELETE`) | desativar, matar sessões e tokens, guardar dados pela política | sessão ou refresh token vivo, senha local, DELETE repetido dá 404 |
| Evento perdido ou recontratação | nada, ou `PATCH active true` | reconciliar em agenda, achar a conta antiga por `externalId` | órfãos, drift, uma segunda conta na recontratação |

Mercado: SCIM é o padrão de provisionamento SaaS a partir de um IdP; sync de LDAP
ou AD e scripts sobre exportações do RH ainda movem boa parte do legado.

### Para onde ir depois

Este é o protocolo do laço joiner-mover-leaver da visão geral de IAM; a fonte costuma
ser um diretório (a lição de LDAP). O SCIM não encerra sessão viva nem refresh
token: isso é gerenciamento de sessão e revogação.

## Trade-offs

- **SCIM contra JIT.** O SCIM dá controle do ciclo de vida, mas pede endpoint,
  token e sincronização; o JIT não pede nada e deixa órfãos. Escolha pelo risco.
- **Soft contra hard delete.** `active:false` guarda auditoria, referências e
  dados pessoais: a retenção pede um segundo passo (anonimizar após 90 dias).
- **PUT contra PATCH.** O PUT é fácil de construir e perigoso de receber; no PATCH
  é que os fornecedores divergem. Suporte o subconjunto comum e teste com o IdP real.
- **Validação estrita contra permissiva.** Rejeitar atributos desconhecidos quebra
  clientes que mandam extras; aceitá-los é mass assignment. Rejeite e registre.
- **Sincronização contra reconciliação.** Eventos são baratos e derivam em
  silêncio; a varredura completa custa leituras e acha o que a sync perdeu. Rode as
  duas e acompanhe a contagem de diferenças.

## Documentation Links

- [RFC 7642, SCIM: Definitions, Overview, Concepts and Requirements, IETF](https://datatracker.ietf.org/doc/html/rfc7642) (doc)
- [RFC 7643, SCIM: Core Schema, IETF](https://datatracker.ietf.org/doc/html/rfc7643) (doc)
- [RFC 7644, SCIM: Protocol, IETF](https://datatracker.ietf.org/doc/html/rfc7644) (doc)
- [Tutorial: Develop a SCIM endpoint for user provisioning, Microsoft Learn](https://learn.microsoft.com/en-us/entra/identity/app-provisioning/use-scim-to-provision-users-and-groups) (doc)
- [Build a SCIM provisioning integration, overview, Okta Developer](https://developer.okta.com/docs/guides/scim-provisioning-integration-overview/) (doc)
- [Prepare your SCIM API, Okta Developer](https://developer.okta.com/docs/guides/scim-provisioning-integration-prepare/main/) (doc)
- [Keycloak 26.8.0 released (SCIM API supported), Keycloak](https://www.keycloak.org/2026/10/keycloak-2680-released) (doc)
