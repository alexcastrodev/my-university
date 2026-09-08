---
version: 1.0
updatedAt: 2026-08-20
title: "Estudo de Caso Trabalhado do DynamoDB: Recriando o GitHub com Listas de Adjacência e Sobrecarga de GSI"
summary: O modelo de dados completo do GitHub de Alex DeBrie, nove tipos de entidade, 24 padrões de acesso, uma tabela, mostra a lista de adjacência e a sobrecarga de GSI sobrevivendo ao contato com um design real, três GSIs separados, cada um dedicado a um relacionamento diferente, o mesmo item Repo sobrecarregando GSI2 com dois significados diferentes dependendo de se é um fork, e Users-para-Organizations dividido para que cada direção do muitos-para-muitos ganhe uma estratégia diferente, em vez de um padrão forçado sobre ambas.
---
## Objective

Ver o padrão de lista de adjacência e a sobrecarga de GSI sobreviverem ao contato com um modelo de dados real, "robusto". O conceito companheiro sobre estratégias muitos-para-muitos ensina a lista de adjacência isoladamente, com um exemplo limpo de duas entidades (filmes e atores), onde ambas as direções invertem de forma limpa através de um índice secundário. Este conceito é o teste de estresse: o Capítulo 21 de Alex DeBrie recria os metadados centrais do GitHub (Repos, Issues, Pull Requests, Comments, Reactions, Forks, Users, Organizations, Payment Plans) com 24 padrões de acesso através de nove tipos de entidade em uma tabela. O capítulo nunca precisa de uma quinta estratégia. Em vez disso, mostra o que de fato acontece quando você fica sem espaço em uma única item collection: você não inventa um novo padrão, você adiciona outro índice secundário genericamente nomeado e deixa um par diferente de entidades sobrecarregá-lo. No fim, o humilde item Repo está carregando atributos de chave primária mais três pares de chave de GSI separados, cada um dedicado a um relacionamento diferente, e DeBrie diz isso explicitamente: "nosso item Repo já está bem ocupado na chave primária, já que está lidando com relacionamentos tanto para Issues quanto para Stars... está usando GSI1 para lidar com Repo + Pull Requests, e está usando GSI2 para lidar com o relacionamento hierárquico de Fork. Assim, vamos precisar adicionar um terceiro índice secundário."

## Use Cases

- Revisar um design onde uma entidade (aqui, Repo) é o hub de três ou quatro relacionamentos diferentes, e decidir se cada relacionamento ganha seu próprio índice secundário ou se dois conseguem compartilhar um: a mesma pergunta que este capítulo responde para Issues versus Pull Requests.
- Modelar um relacionamento muitos-para-muitos onde as duas direções têm cardinalidades muito diferentes: o Users-para-Organizations do GitHub, onde um usuário pertence a um punhado limitado de orgs, mas uma org pode ter milhares de usuários, e escolher uma estratégia diferente para cada direção, em vez de forçar um padrão sobre ambas.
- Modelar um relacionamento um-para-muitos autorreferencial, onde o filho também é, de um ponto de vista diferente, uma instância completa do tipo pai: o Fork do GitHub, que é um Repo apontando para outro Repo, e precisar manter esse ponteiro fora da chave primária da tabela base.
- Auditar uma tabela onde uma entidade participa de `GSI1PK`/`GSI1SK`, `GSI2PK`/`GSI2SK`, e `GSI3PK`/`GSI3SK` simultaneamente, e precisar de um modelo mental de por que cada índice existe e o que quebraria se um fosse removido.
- Decidir, no meio do design, se um "relacionamento" precisa ser um item consultável de forma alguma, ou se uma expressão de filtro, um contador desnormalizado, ou uma transação é o encaixe mais barato: as quatro pequenas decisões que este capítulo toma em torno de status de Issue/PR, contagens de star, e contagens de reação.

## Deep Dive

### A forma do problema antes de qualquer chave ser escolhida

O DER do capítulo tem nove tipos de entidade e 24 padrões de acesso, agrupados como básicos de Repo (buscar/criar/listar Repos, Issues, Pull Requests; fazer fork de um Repo; listar Forks), Interações (comentar, reagir, dar star), Gerenciamento de usuário (criar User/Organization, gerenciar membresia), e Contas & Repos (listar Repos para uma Account). DeBrie percorre suas três perguntas usuais (chave primária simples ou composta, o que é incomum sobre os requisitos, qual entidade modelar primeiro) e chega a quatro "requisitos interessantes" que valem a pena nomear, porque cada um conduz a uma técnica específica depois:

1. **Um namespace de ID compartilhado.** Números de Issue e Pull Request são tirados do mesmo contador dentro de um Repo: "se você tivesse um repositório com dois issues e três pull requests, o próximo issue aberto receberia um ID de 6."
2. **Um namespace de nome compartilhado.** Users e Organizations não podem colidir em nome, porque um repo é endereçado como `<owner>/<repo>`, independentemente de o dono ser um User ou uma Organization.
3. **Um fork é um repo.** "Um Fork para uma pessoa é um Repo para outra." O relacionamento um-para-muitos entre um Repo e seus Forks precisa ser modelado sem poluir a própria chave primária do Repo, porque um Repo com fork precisa de seus próprios Issues, Pull Requests, e Stars independentes.
4. **Contagens de referência e alvos polimórficos.** Stars, Forks, e oito tipos de Reactions todos precisam de contagens rápidas no pai, e Reactions podem alvejar um Issue, um Pull Request, ou um Comment de forma intercambiável.

Nenhum desses é resolvido com uma quinta estratégia muitos-para-muitos. São resolvidos combinando os conjuntos de ferramentas um-para-muitos e muitos-para-muitos que os conceitos irmãos já cobrem: esse é o ponto: um modelo real é majoritariamente composição, não invenção nova.

### Sobrecarga de GSI, entidade por entidade

`dynamodb-single-table-design` estabelece que o `PK`/`SK` de uma tabela é sobrecarregado por design: um nome genérico cujo significado depende de qual template de entidade produziu o valor. Este estudo de caso mostra o mesmo truque aplicado a índices secundários, e é a versão mais instrutiva, porque você observa o *mesmo item Repo físico* ganhar uma quarta sobrecarga conforme o modelo cresce.

**Tabela base: Repo + Issue.** Os relacionamentos um-para-muitos do Repo (Issues, Pull Requests, Forks) são todos ilimitados, então desnormalização está fora; cada um precisa da estratégia chave-primária-mais-`Query` do capítulo um-para-muitos. Mas o truque "pai no meio" dessa estratégia (ordenar o pai entre dois filhos ordenados diferentemente) só funciona para *um* relacionamento por item collection, porque tanto Issues quanto Pull Requests precisam de ordem descendente e não há forma de posicionar o item Repo de forma que ambas as direções leiam corretamente ao mesmo tempo. DeBrie escolhe Issues para a tabela base:

| Entidade | `PK` | `SK` |
|---|---|---|
| Repo | `REPO#<Owner>#<RepoName>` | `REPO#<Owner>#<RepoName>` |
| Issue | `REPO#<Owner>#<RepoName>` | `ISSUE#<ZeroPaddedIssueNumber>` |

Um `Query` com `ScanIndexForward=False` retorna o item Repo e seus Issues mais recentes em uma requisição: a mesma mecânica de item collection que o conceito de single-table design percorre para Users e Orders.

**GSI1: Repo + Pull Request.** Pull Requests perderam o cara ou coroa para a tabela base, então ganham seu próprio item (`PK`/`SK` construído a partir de `<Owner>#<RepoName>#<PRNumber>`, único por si só) mais um segundo conjunto de atributos de chave que só existem para posicioná-lo ao lado de seu Repo em um índice:

| Entidade | `GSI1PK` | `GSI1SK` |
|---|---|---|
| Repo | `REPO#<Owner>#<RepoName>` | `REPO#<Owner>#<RepoName>` |
| Pull Request | `REPO#<Owner>#<RepoName>` | `PR#<ZeroPaddedPRNumber>` |

Essa é sobrecarga de GSI em sua forma mais simples: `GSI1PK` guarda a própria identidade de um Repo quando escrito por um item Repo, e um ponteiro *estrangeiro* de volta para o Repo dono, quando escrito por um item Pull Request. Dois tipos de entidade estruturalmente diferentes compartilham um atributo genericamente nomeado, para que um único `Query` no índice retorne ambos.

**GSI2: a hierarquia de Fork, onde uma entidade sobrecarrega a si mesma duas vezes.** Forks não conseguem ser uma entidade de primeira classe com sua própria item collection, porque "um fork para uma pessoa é um repo para outra": o Fork *é* um item Repo. Então GSI2 é construído inteiramente a partir de itens Repo, e os próprios atributos `GSI2PK`/`GSI2SK` do item Repo mudam de significado dependendo do próprio estado do Repo:

| Caso | `GSI2PK` | `GSI2SK` |
|---|---|---|
| Repo original | `REPO#<Owner>#<RepoName>` | `#REPO#<RepoName>` |
| Repo com fork | `REPO#<OriginalOwner>#<RepoName>` | `FORK#<Owner>` |

O `GSI2PK` de um Repo original aponta para si mesmo; o `GSI2PK` de um Repo com fork aponta inteiramente para o Repo de *outra pessoa*, agrupando todo fork de um dado original em uma item collection, com o original ordenado primeiro (o prefixo `#` em seu `GSI2SK` força isso). Esse é o mesmo nome de atributo fazendo dois trabalhos diferentes no mesmo tipo de entidade, dependendo de um booleano que a aplicação precisa acertar no momento da escrita: não há schema para reforçar isso.

**GSI3: Account + Repo, adicionado só porque GSI1 e GSI2 já estavam comprometidos.** O último padrão de acesso, "buscar todos os Repos de uma Account", precisa de sua própria item collection ordenada por `UpdatedAt`. O item Repo não pode reutilizar `GSI1PK`/`GSI1SK` (ocupado agrupando-o com Pull Requests) nem `GSI2PK`/`GSI2SK` (ocupado agrupando-o com Forks), então um terceiro GSI é a única opção:

| Entidade | `GSI3PK` | `GSI3SK` |
|---|---|---|
| User / Organization | `ACCOUNT#<AccountName>` | `ACCOUNT#<AccountName>` |
| Repo | `ACCOUNT#<AccountName>` | `+#<UpdatedAt>` |

Empilhe todos os quatro juntos e o item Repo sozinho carrega: `PK`/`SK` da tabela base (compartilhado com Issues), `GSI1PK`/`GSI1SK` (compartilhado com Pull Requests), `GSI2PK`/`GSI2SK` (compartilhado com Forks, de si mesmo), e `GSI3PK`/`GSI3SK` (compartilhado com sua Account dona). Quatro pares de chave sobrecarregados, quatro parceiros diferentes, um item.

### Lista de adjacência aplicada de forma desigual: Users e Organizations

O exemplo de lista de adjacência do conceito irmão (filmes e atores) é simétrico: ambas as direções passam por um `Query`, uma na tabela base, uma em um índice secundário totalmente invertido. O relacionamento Users-para-Organizations do GitHub também é muitos-para-muitos, mas DeBrie deliberadamente trata suas duas direções de forma diferente, porque sua cardinalidade e mutabilidade não são simétricas:

- **User → Organizations (limitado, quase imutável): duplicação rasa, não lista de adjacência.** "Não temos casos de uso onde precisamos buscar um User e informação detalhada sobre todas as Organizations... não seria um fardo para muitos Users dizer que só poderiam pertencer a, digamos, 40 Organizations." Então o item User só ganha um atributo map `Organizations` (nome de org para papel), lido com um único `GetItem`. Nenhum item de relacionamento, nenhum índice.
- **Organization → Users (ilimitado, continua crescendo): um item de relacionamento real, estilo lista de adjacência.** "É menos razoável limitar o número de Users que pertencem a uma Organization... não queremos usar a estratégia de desnormalização para Memberships." Então Membership ganha seu próprio item, compartilhando a partition key da Organization:

| Entidade | `PK` | `SK` |
|---|---|---|
| User / Organization | `ACCOUNT#<AccountName>` | `ACCOUNT#<AccountName>` |
| Membership | `ACCOUNT#<OrganizationName>` | `MEMBERSHIP#<UserName>` |

Um `Query` na item collection de uma Organization retorna a Organization mais toda Membership: uma direção da lista de adjacência, exatamente como o conceito irmão descreve para Movie + Role. Mas não há um GSI invertido para a outra direção, porque a outra direção já foi resolvida mais barata por duplicação rasa. A lição que o conceito irmão enuncia em abstrato ("as quatro estratégias não são exclusivas, e os melhores designs as misturam") é o que este design de fato faz, por direção, em um único relacionamento.

Há uma segunda reviravolta que vale a pena notar: User e Organization compartilham um template de chave primária idêntico (`ACCOUNT#<AccountName>` / `ACCOUNT#<AccountName>`), porque disputam o mesmo namespace de nome (requisito interessante nº 2 acima) e ambos precisam dos mesmos padrões de acesso downstream (próprios Repos, próprio Payment Plan). Um simples atributo `Type` (a mesma convenção que o conceito de single-table design sinaliza a partir do Capítulo 9) é o que os diferencia, já que a chave sozinha não consegue.

### Técnicas de suporte que aparecem ao lado dos dois padrões nomeados

Essas não são as técnicas de destaque do capítulo, mas são o que torna a lista de adjacência e a sobrecarga de GSI utilizáveis na prática, e reaparecem constantemente em designs single-table reais:

- **Emulando um auto-incremento.** Números de Issue/PR precisam de um contador sem equivalente nativo no DynamoDB. O conserto é duas requisições: `UpdateItem` com `ReturnValues='UPDATED_NEW'` para incrementar atomicamente `IssuesAndPullRequestCount` no item Repo e ler de volta o novo valor, depois `PutItem` para o Issue ou PR usando esse valor como sua sort key. DeBrie é franco ao dizer que isso custa uma ida e volta extra: "é a melhor forma de obter um número auto-incrementado, que você usa ao criar um item novo."
- **Filtrar, em vez de modelar o filtro na chave.** Status Open/Closed para Issues e PRs é tratado com uma `FilterExpression`, não um atributo de chave, porque há apenas dois valores e as páginas são pequenas (25 itens). O capítulo sinaliza isso como uma aposta a revisitar em produção, em vez de uma resposta definitiva.
- **Contagens de referência via `TransactWriteItems`.** Dar star em um Repo escreve o item Star e incrementa `StarCount` no Repo atomicamente: "a segunda parte não deveria acontecer sem a primeira." Contagens de reação usam a mesma forma de transação, mais um atributo string-set `Reactions` (via `ADD` com uma condição `NOT contains`) para impedir que um usuário reaja com o mesmo emoji duas vezes.
- **Uma aresta polimórfica que existe só para ser checada, não consultada.** A chave do item Reaction (`<TargetType>REACTION#<Owner>#<RepoName>#<TargetIdentifier>#<UserName>` tanto para `PK` quanto `SK`) dobra alvos de Issue, Pull Request, e Comment em um template. Diferente de um item Role na lista de adjacência, ninguém nunca consulta essa item collection; ela existe puramente como a outra metade da transação que protege contra uma reação duplicada. Nem todo item de relacionamento está ali para ser lido.

## Trade-offs

- **Sobrecarga de GSI multiplica amplificação de escrita por entidade participante, e é fácil subestimar em quantos índices uma entidade acaba entrando.** O item Repo aqui escreve na tabela base mais três GSIs em toda mutação que toca seus atributos compartilhados: quatro caminhos de escrita físicos para o que um DER desenha como um nó. Estimar capacidade a partir de "um item por Repo" subestima em 4x antes mesmo de você ter adicionado um quinto relacionamento.
- **O truque "pai no meio" é um orçamento de uso único por item collection, e este capítulo mostra exatamente o que acontece quando você o gasta.** Issues e Pull Requests ambos queriam ordem descendente na mesma collection que seu Repo; só um conseguiu ter. Reconhecer que esse orçamento já foi gasto é o que te diz que um novo GSI é necessário, não uma remodelagem da tabela base.
- **Sobrecarregar o mesmo atributo com dois significados diferentes no mesmo tipo de entidade (GSI2 em Repo) é poderoso e tem zero reforço.** O `GSI2PK` de um Repo original aponta para si mesmo; o `GSI2PK` de um Repo com fork aponta inteiramente para um Repo diferente. Erre o condicional no momento da escrita (escreva um fork com o template de Repo original, ou vice-versa) e o item aterrissa na item collection errada, sem erro, sem restrição, e sem query que revele o engano até que alguém perceba um fork faltando em uma lista. Esse é o custo de "integridade referencial se move para sua aplicação" do conceito de single-table design, concentrado em um único atributo.
- **Dividir as duas direções de um relacionamento muitos-para-muitos entre estratégias diferentes é a decisão certa aqui, mas dobra o número de decisões que você precisa acertar.** Users-para-Organizations funciona porque DeBrie testou cada direção contra a barra de mutabilidade/cardinalidade independentemente (limitado-e-raso versus ilimitado-e-crescendo), em vez de escolher uma estratégia para o relacionamento inteiro. Isso é mais trabalho de design do que o exemplo simétrico de filmes-e-atores do conceito irmão, e é fácil pular a segunda metade da análise e padronizar ambas as direções para qualquer padrão que você recorreu primeiro.
- **Um item de relacionamento que existe só para uma transação (a aresta Reaction) é barato de modelar e fácil de esquecer ao raciocinar sobre a tabela.** Não tem padrão de acesso de query, então não vai aparecer em uma revisão orientada a padrão de acesso primeiro, a menos que você lembre que existe para prevenir contagem dupla, não para ser lida.
- **Em 24 padrões de acesso e nove tipos de entidade, o próprio gráfico de entidade se torna documentação essencial.** DeBrie o reconstrói três vezes ao longo do capítulo, conforme novos atributos são adicionados; sem ele, rastrear qual entidade escreve em qual de `PK`/`SK`, `GSI1PK`/`GSI1SK`, `GSI2PK`/`GSI2SK`, e `GSI3PK`/`GSI3SK`, e por quê, não é algo que você consegue guardar na cabeça. Trate o gráfico como um entregável obrigatório do design, não uma anotação incidental.

## Documentation Links

- [Alex DeBrie, "The DynamoDB Book", v1.0.1 (2020), Chapter 21, "Recreating GitHub's Backend", p. 369-412](https://www.dynamodbbook.com/) - doc
- [AWS Documentation, Best Practices for Managing Many-to-Many Relationships (adjacency list, materialized graph)](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-adjacency-graphs.html) - doc
- [AWS Documentation, Global Secondary Indexes](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/GSI.html) - doc
- [AWS Documentation, DynamoDB Transactions (TransactWriteItems)](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis.html) - doc
- [AWS Documentation, Best Practices for Designing and Using Partition Keys Effectively](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-partition-key-design.html) - doc
