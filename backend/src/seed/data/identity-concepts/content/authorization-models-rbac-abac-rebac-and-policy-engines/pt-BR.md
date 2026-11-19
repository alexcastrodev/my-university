---
version: 1.0
updatedAt: 2026-11-19
---
## Objective

Autorização é uma função só: `decisão = f(sujeito, ação, recurso, contexto)`. Os modelos de acesso (ACL, RBAC, ABAC, ReBAC) diferem no que colocam no sujeito, no recurso e no contexto, e os motores de política (OPA, Cedar, OpenFGA) são três implementações dessa função. Esta lição passa um único cenário (documentos, pastas, times; o dono edita, o time lê, o admin faz tudo, documento confidencial exige clearance) pelos três motores, faz as mesmas 12 perguntas e compara expressividade, onde a política mora, latência local e teste. Mostra também o erro que importa mais que o motor: autorizar a função mas não o objeto (IDOR/BOLA), medido numa API de brinquedo.
Versões: `openpolicyagent/opa:1.22.4` (Rego v1), CLI do Cedar 4.15.0 (binário de release do GitHub), `openfga/openfga:v1.22.1` com `openfga/cli:v0.9.0` (store em memória), Node 22.23.4, curl, jq 1.7.1. Eram as tags estáveis mais recentes em 2026-11-19.

## Use Cases

- Escolher entre papéis, atributos e relações num produto novo, sabendo qual deles vai doer depois.
- Trocar `if (user.isAdmin)` espalhado pelos handlers por uma política testável e auditável.
- Corrigir o "403 só na tela" (a API responde a quem pula o botão) e ler uma integração com OPA, Cedar ou OpenFGA.

## Deep Dive

### A função e os modelos

A lição de IAM nomeou o PEP (aplica) e o PDP (decide). Esta é sobre o que o PDP sabe:

| Modelo | A decisão usa | Regra de exemplo |
|---|---|---|
| ACL | uma lista guardada no recurso | `d1: alice rw, bob r` |
| RBAC | os papéis do sujeito | `editor` pode editar documentos |
| ABAC | atributos de sujeito, recurso e ambiente | clearance >= nível do documento, horário comercial |
| ReBAC | um caminho num grafo de relações | editor da pasta que contém o documento |

**ACL** é a mais antiga e não escala para "todo mundo de engenharia": você edita cada lista. **RBAC** (modelo do NIST, ANSI INCITS 359-2004) põe um papel entre usuários e permissões: RBAC básico, RBAC hierárquico (`admin` herda `editor`) e separação de funções estática e dinâmica (ninguém é `requester` e `approver` ao mesmo tempo). O modo de falha é a explosão de papéis: se a regra depende de time, ação e clearance, os papéis necessários são o produto dos três. Com 20 times, 2 ações e 4 níveis de clearance são 160 papéis para um tipo de documento (conta, não medido), e o nome do papel passa a codificar atributos. **ABAC** (NIST SP 800-162) mantém poucos papéis e avalia atributos na hora, então "clearance pelo menos igual ao nível do documento" é uma linha. O custo: atributos precisam ser frescos e confiáveis, e "quem alcança isto?" exige ler regras. **ReBAC** guarda relações como dado e deriva o acesso andando por elas, o que serve para compartilhamento (Drive, GitHub): "leitor da pasta" implica "leitor de todo documento dentro".

### XACML: a arquitetura ficou, a linguagem não (só docs)

O XACML 3.0 da OASIS (2013) nomeou os papéis que todo motor ainda usa: o **PEP** intercepta, o **PDP** avalia, o **PIP** (ponto de informação) busca atributos que a requisição não trouxe, o **PAP** (ponto de administração) escreve e guarda as políticas. A linguagem era XML: verbosa, longe do código, difícil de testar. O mercado manteve as caixas e trocou a linguagem por código (Rego), uma linguagem pequena e tipada (Cedar) ou dado (tuplas do OpenFGA). O XACML sobrevive em algumas suítes corporativas; trabalho novo raramente começa nele.

### O cenário, definido uma vez

Usuários: `alice` (time eng, clearance 2), `bob` (eng, 0), `carol` (admin, 0), `dave` (sales, 3). Documentos: `d1` (dono alice, eng, aberto), `d2` (dono alice, eng, confidencial, nível 2), `d3` (dono dave, sales, aberto). Regras: o dono lê e edita; o time do dono lê; o admin lê e edita; documento confidencial exige `clearance >= nível` para todos, admin inclusive. As 12 perguntas estão na tabela de resultados mais abaixo.

### Motor 1: OPA e Rego

Uma política mais dados carregados em `opa run -s`; quem chama manda `input` e recebe JSON:

```rego
package authz
default allow := false
user := data.users[input.sub]
doc := data.docs[input.doc]
is_owner if doc.owner == input.sub
is_admin if user.admin
in_team if doc.team in user.teams
default cleared := false
cleared if doc.confidential == false
cleared if user.clearance >= doc.level
grants contains "owner" if is_owner
grants contains "team" if { input.action == "read"; in_team }
grants contains "admin" if is_admin
allow if { count(grants) > 0; cleared }
decision := {"allow": allow, "grants": grants, "cleared": cleared}
```

```text
$ docker run -d -p 6560:8181 -v $PWD/opa:/p openpolicyagent/opa:1.22.4 run -s -a 0.0.0.0:8181 --set decision_logs.console=true /p
$ curl -s localhost:6560/v1/data/authz/decision -d '{"input":{"sub":"bob","action":"read","doc":"d2"}}' | jq -c .result
{"allow":false,"cleared":false,"grants":["team"]}
# carol read d2 -> {"allow":false,"cleared":false,"grants":["admin"]}
```

O motivo viaja com a decisão: `grants` diz por que o acesso foi dado, e os casos negados mostram um papel válido com clearance insuficiente. Três armadilhas reais ao escrever. (1) Um pacote chamado `docs` ao lado de `data.docs` fez o OPA recusar a compilação (`rego_recursion_error`): mantenha política e dado com nomes diferentes. (2) Sem `default cleared := false`, `decision` ficou indefinida e o corpo HTTP voltou só com `decision_id`, sem `result`: em Rego um valor indefinido remove a resposta inteira em silêncio, então dê default a toda regra de que a decisão depende. (3) `not doc.confidential` é verdadeiro quando o documento não existe, o que falha aberto; `doc.confidential == false` é indefinido para documento inexistente, o que falha fechado. Os testes também são Rego (`opa test`, cada um sobrescrevendo `input` com `with input as {...}`):

```text
$ opa test /p -v   # owner_edits, team_reads, team_cannot_edit, admin_blocked_by_clearance, unknown_user_denied
PASS: 5/5
```

O decision log é uma linha JSON por decisão (console aqui, um coletor em produção): `{"decision_id":"5fcf5970-...","input":{"action":"read","doc":"d1","sub":"mallory"},"path":"authz/allow","result":false,...}`. A avaliação parcial (`/v1/compile` com `"unknowns":["input.doc"]`) devolveu consultas residuais sobre `data.partial.authz` (rodou, saída não mostrada): ela transforma a política num filtro que dá para empurrar para uma consulta de banco, em vez de checar linha a linha.

### Motor 2: Cedar

O Cedar tem um formato fixo de requisição: principal, ação, recurso, contexto. As políticas são `permit` ou `forbid`; o algoritmo é negar por padrão, qualquer `forbid` satisfeito vence, e política que dá erro é ignorada. As entidades (atributos mais pais) vão em JSON. Quatro políticas, o binário CLI da release, local:

```cedar
permit (principal, action in [Action::"read", Action::"edit"], resource)
  when { resource.owner == principal };
permit (principal, action == Action::"read", resource)
  when { principal in resource.team };      // o time é um pai da entidade
permit (principal, action, resource) when { principal.admin };
forbid (principal, action, resource)
  when { resource.confidential && principal.clearance < resource.level };
```

```text
$ cedar authorize --policies policies.cedar --entities entities.json \
    -l 'User::"carol"' -a 'Action::"read"' -r 'Doc::"d2"' -c ctx.json --verbose
DENY
note: this decision was due to the following policies:
  policy3
```

A `policy3` (começando em 0: o `forbid`) venceu o `permit` de admin da carol: uma proteção escrita uma vez não é desfeita por um permit posterior. O schema pega erros de digitação antes do deploy: `resource.ownr` reprova no `validate` com `attribute ownr on entity type Doc not found, did you mean owner?`. O caso perigoso é o skip-on-error. Com o erro de digitação no `forbid` (`principal.clearence`) e sem rodar a validação:

```text
$ cedar authorize ... -l 'User::"carol"' -a 'Action::"read"' -r 'Doc::"d2"' --verbose
ALLOW
error while evaluating policy `policy3`: `User::"carol"` does not have the attribute `clearence`
note: this decision was due to the following policies:
  policy2
```

O erro aparece só nos diagnósticos, e a proteção parou em silêncio: a carol entrou num documento confidencial. Rode `validate` no CI e alerte para erros não vazios em produção. A outra força do Cedar é a análise formal (uma ferramenta baseada em SMT prova "esta mudança não amplia nenhum acesso"); não rodei aqui (só docs).

### Motor 3: OpenFGA (ReBAC)

O OpenFGA implementa o modelo do Zanzibar (abaixo). Você declara tipos e relações numa DSL, escreve tuplas `usuário relação objeto` e faz `check`. Mesmo cenário, mas a clearance precisa virar uma relação:

```text
# cabeçalho: model / schema 1.1
type user
type org
  relations
    define admin: [user]
type team
  relations
    define member: [user]
type folder
  relations
    define parent: [folder]
    define viewer: [user, team#member] or viewer from parent
type document
  relations
    define org: [org]
    define parent: [folder]
    define owner: [user]
    define open: [user:*]
    define cleared: [user]
    define viewer: [user, team#member] or owner or viewer from parent or admin from org
    define editor: owner or admin from org
    define clearance_ok: open or cleared
    define can_read: viewer and clearance_ok
    define can_edit: editor and clearance_ok
```

Os dados são 18 tuplas: pertencimento a times, `team:eng#member` como viewer de `folder:f-eng`, `parent`, `owner` e `org` de cada documento, e uma tupla `open` com `user:*` em d1 e d3. O `d2` tem só uma tupla `cleared` para a alice: clearance é dado que a aplicação precisa escrever, não uma expressão que o motor avalia.

```text
$ fga query check user:bob can_read document:d1        -> {"allowed":true}
$ fga query check user:bob can_read document:d2        -> {"allowed":false}
$ fga query list-objects user:bob   can_read document  -> {"objects":["document:d1"]}
$ fga query list-objects user:alice can_read document  -> {"objects":["document:d1","document:d2"]}
$ fga query expand viewer document:d1   # união: usuários diretos, owner, folder:f-eng#viewer, org:acme#admin
```

O grafo faz a herança. Um novo `document:d4` recebeu dono, uma tupla `open` e `parent folder:f-eng`, sem nenhuma tupla de time própria: o bob conseguiu ler (`true`). Apagar só a tupla `parent` virou `false`. O `list-objects` responde "o que o bob pode ver?", a pergunta que uma tela de lista de documentos precisa e que motores de RBAC respondem mal; o `expand` mostra por que um check passou, o equivalente do `grants` do OPA.

### Zanzibar, o new enemy problem e consistência

Pang et al., "Zanzibar: Google's Consistent, Global Authorization System" (USENIX ATC 2019), descreve o sistema por trás do controle de acesso do Drive, Fotos e YouTube: um modelo único de tuplas (`objeto#relação@usuário`) com usersets e reescritas como `viewer from parent`. Os autores relatam trilhões de ACLs, milhões de checks por segundo, percentil 95 abaixo de 10 ms e disponibilidade acima de 99,999%. OpenFGA e SpiceDB seguem o modelo. O problema difícil é o **new enemy problem**: a Alice tira o Bob da ACL de um documento e depois adiciona conteúdo secreto; se o check usou uma cópia da ACL anterior à remoção, o Bob lê o que nunca deveria ver. A resposta do Zanzibar é um token de consistência (o "zookie") emitido junto com mudanças de conteúdo, para que o check avalie naquele momento ou depois. O OpenFGA expõe o parâmetro `consistency` (`MINIMIZE_LATENCY` por padrão, `HIGHER_CONSISTENCY` para leituras mais fortes ao custo de desempenho, segundo a doc). Um store de nó único em memória não mostra a corrida (só docs). A lição vale para qualquer motor com cache: um direito revogado só está revogado quando o cache de decisão expira.

### Escopo, papel e permissão são coisas diferentes

Um escopo OAuth (`documents:write`) diz o que o **cliente** pode pedir à API em nome do usuário, um teto com que o usuário concordou. Não diz o que o **usuário** pode fazer no `d2`: o token da alice com `documents:write` ainda precisa falhar no documento do bob. Papéis agrupam permissões para pessoas; permissões são fatos do domínio ("editar este documento"). Mantenha escopos grossos no token e a decisão por objeto no PDP. A RFC 9396 (RAR) pode carregar concessões mais finas dentro do token.

### Comparação, medida

As 12 perguntas em cada motor (OPA REST, Cedar CLI, OpenFGA REST):

```text
sujeito ação doc   | opa   cedar fga        sujeito ação doc   | opa   cedar fga
alice  read d1     | allow allow allow      carol  read d2     | deny  deny  deny
alice  edit d1     | allow allow allow      carol  read d3     | allow allow allow
bob    read d1     | allow allow allow      dave   edit d3     | allow allow allow
bob    edit d1     | deny  deny  deny       dave   read d1     | deny  deny  deny
carol  edit d1     | allow allow allow      alice  read d2     | allow allow allow
bob    read d2     | deny  deny  deny       alice  read d3     | deny  deny  deny
```

Nenhuma divergência. Latência por chamada, 1000 requisições sequenciais do Node 22 numa conexão keep-alive em loopback, depois de 50 aquecimentos. É Docker local num notebook, sem rede real, sem TLS, três documentos pequenos: mostra a sobrecarga dos motores aqui, não o comportamento em produção.

```text
OPA REST /v1/data      n=1000 mediana 0.44 ms  p95 0.62 ms
OpenFGA REST /check    n=1000 mediana 0.54 ms  p95 0.76 ms
Cedar CLI (processo)   n=200  mediana 3.41 ms  p95 3.93 ms
```

O número do Cedar é um processo novo por chamada (parse, carga das entidades, saída): é o custo de iniciar processo, não do motor. O Cedar foi feito para rodar como biblioteca no seu processo, sem salto de rede; isso não foi medido. Com rede real some o tempo de ida e volta; no OpenFGA o custo cresce com a profundidade e o fan-out do grafo, que este cenário quase não exercita.

| | OPA / Rego | Cedar | OpenFGA |
|---|---|---|---|
| Modelo | regras sobre JSON | políticas sobre entidades | grafo de relações |
| A política mora | arquivos `.rego`, bundles | `.cedar` + schema | modelo + tuplas num store |
| O dado mora | `data` enviado ou no `input` | entidades por requisição | o store de tuplas |
| Atributos | nativos | nativos | desajeitados (tupla ou condição) |
| Hierarquias | você escreve | `in` nos pais da entidade | nativas, é o ponto |
| "O que X vê?" | avaliação parcial | não embutido | `list-objects` |
| Por que permitiu | seu próprio `grants` | ids das políticas determinantes | `expand` |
| Teste | `opa test` | `validate` + `authorize` no CI | `fga model test` |

### Onde o motor fica e quanto custa

- **Biblioteca embutida**: menor latência, nenhum serviço novo; cada linguagem precisa de binding e mudança de política viaja no seu deploy. O lugar natural do Cedar.
- **Sidecar**: política atualizada por bundles sem redeploy da aplicação, um salto em loopback. O lugar clássico do OPA (Envoy, admission do Kubernetes).
- **PDP central**: um grafo ou conjunto de políticas autoritativo, necessário quando a decisão depende de dado compartilhado (compartilhamento entre apps). Vira dependência dura: decida o que acontece quando cai (falhar fechado para escrita, cache curto para leituras de baixo risco) e vigie o p95.

O custo cresce com a centralização: biblioteca é dependência, sidecar é uma frota para atualizar, store central é um banco para operar e manter sincronizado com seus dados (quem está em qual time mora no seu IdP e no store de tuplas). Todo cache de decisão precisa de uma expiração que você consiga declarar.

### A armadilha: esconder o botão, e IDOR/BOLA

Autorização no cliente é dica de exibição; quem decide é a API. Uma API de brinquedo (Node 22, `X-User` no lugar de um token verificado) tem duas rotas que diferem por um `if`: `/v1` checa só que o chamador está logado (nível de função), `/v2` checa também que o documento pertence ao chamador (nível de objeto):

```text
v1 as alice GET /v1/docs/1 -> {"owner":"alice","text":"alice: Q3 plan"} [200]
v1 as alice GET /v1/docs/2 -> {"owner":"bob","text":"bob: salary table"} [200]
v2 as alice GET /v2/docs/1 -> {"owner":"alice","text":"alice: Q3 plan"} [200]
v2 as alice GET /v2/docs/2 -> {"error":"forbidden"} [403]
```

A `/v1` é Broken Object Level Authorization (OWASP API Security Top 10, API1:2023), o velho IDOR: troque `2` por `1` na URL e leia o dado de outro usuário. A interface nunca mostrou à alice um link para o `2`, e isso não protegeu nada. Autorize todo acesso a objeto em toda rota, usando o id da URL; ids imprevisíveis são defesa em profundidade, nunca o controle. Registre cada decisão com sujeito, ação, objeto e motivo (`grants`, ids das políticas determinantes, resultado do `expand`): as negações são o sinal.

### Onde cada modelo se encaixa

| Modelo | Expressa bem | Expressa mal | Motor típico | Armadilha |
|---|---|---|---|---|
| ACL | exceções por objeto | grupos, mudança em massa | tabela no banco, ACL de bucket | lista desatualizada, sem revisão |
| RBAC | funções de trabalho, SoD, auditoria | regras por objeto e contexto | papéis do framework, Keycloak | explosão de papéis |
| ABAC | contexto, clearance, hora, tenant | "quem alcança X?" | OPA, Cedar | atributo velho ou forjável |
| ReBAC | compartilhamento, aninhamento, hierarquias | condições numéricas ou de tempo | OpenFGA, SpiceDB | cache velho, new enemy, tuplas fora de sincronia |

Sistemas reais combinam: papéis grossos vindos do IdP, relações para compartilhamento, atributos como proteção. Um `forbid` do Cedar ou uma regra de negação do OPA é o lugar natural de "nunca, não importa o papel".

### Para onde ir agora

A troca de tokens leva uma concessão reduzida e restrita por audience ao próximo serviço (`OAuth Token Exchange: Delegation and On-Behalf-Of`), e o gerenciamento de sessão (próximo desta trilha) decide a rapidez com que um direito revogado passa a valer. O concept de system design sobre autenticação e autorização em escala coloca o mesmo PEP e PDP no nível da frota (gateways, mTLS, zero trust); a method security do Spring e as policies do .NET são os PEPs dentro do processo.

## Trade-offs

- **RBAC contra ABAC.** Papéis são fáceis de auditar; atributos eliminam a explosão de papéis mas transformam "quem pode fazer X" numa consulta sobre regras. Papéis para funções de trabalho, atributos para proteções (clearance, tenant, horário).
- **Política no código contra política num motor.** Um `if` no handler é rápido e impossível de revisar; um motor dá uma política e uma trilha de auditoria, ao custo de um problema de sincronização: o motor precisa dos fatos (times, atributos) e eles divergem.
- **Falhar aberto contra falhar fechado.** O Rego sem default não devolveu resposta; um erro de digitação no Cedar foi ignorado e deixou a carol entrar. Negue por padrão, valide no CI, alerte para erros de avaliação.
- **Fresco contra rápido.** Cachear um check transforma um direito revogado numa janela de exposição (o new enemy problem em pequena escala); escolha um TTL por sensibilidade do recurso.
- **Grafo central contra regras locais.** O OpenFGA dá `list-objects` e compartilhamento entre apps, mas atributos viram tuplas que você mantém atualizadas (a tupla `cleared`); OPA e Cedar avaliam atributos nativamente mas não listam objetos acessíveis de forma barata.
- **Escopo contra permissão no objeto.** Escopo é teto do cliente, não concessão no objeto: cheque os dois, na API.

## Documentation Links

- [Role Based Access Control, NIST](https://csrc.nist.gov/projects/role-based-access-control) (doc)
- [SP 800-162, Guide to Attribute Based Access Control, NIST](https://nvlpubs.nist.gov/nistpubs/specialpublications/nist.sp.800-162.pdf) (doc)
- [eXtensible Access Control Markup Language (XACML) 3.0, OASIS](https://docs.oasis-open.org/xacml/3.0/) (doc)
- [Open Policy Agent Documentation, OPA](https://www.openpolicyagent.org/docs) (doc)
- [Policy Language (Rego), OPA](https://www.openpolicyagent.org/docs/policy-language) (doc)
- [Policy Testing, OPA](https://www.openpolicyagent.org/docs/policy-testing) (doc)
- [Decision Logs, OPA](https://www.openpolicyagent.org/docs/management-decision-logs) (doc)
- [Cedar Policy Language Reference Guide, Cedar](https://docs.cedarpolicy.com/) (doc)
- [How Cedar authorization works, Cedar](https://docs.cedarpolicy.com/auth/authorization.html) (doc)
- [OpenFGA Documentation, OpenFGA](https://openfga.dev/docs) (doc)
- [Getting started with modeling, OpenFGA](https://openfga.dev/docs/modeling/getting-started) (doc)
- [Query consistency, OpenFGA](https://openfga.dev/docs/interacting/consistency) (doc)
- [Zanzibar: Google's Consistent, Global Authorization System, USENIX ATC 2019](https://www.usenix.org/conference/atc19/presentation/pang) (paper)
- [API1:2023 Broken Object Level Authorization, OWASP](https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/) (doc)
- [Authorization Cheat Sheet, OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html) (doc)
- [RFC 9396, OAuth 2.0 Rich Authorization Requests, IETF](https://www.rfc-editor.org/rfc/rfc9396) (doc)
