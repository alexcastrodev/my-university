---
version: 1.0
updatedAt: 2026-08-20
title: O Modelo de Grafo de Propriedades e o Básico de CRUD em Cypher
summary: Como o modelo de grafo de propriedades do Neo4j (nós com labels e propriedades, relacionamentos com tipo, direção e propriedades próprias) difere fundamentalmente dos modelos relacional e de documentos, por que ele é "amigo do quadro branco", e o vocabulário central de CRUD do Cypher (CREATE, MATCH, WHERE, RETURN, MERGE, DELETE/DETACH DELETE) para construir e consultar um grafo.
---
## Objective

Entender o modelo de grafo de propriedades que torna o Neo4j uma forma genuinamente diferente de pensar sobre dados em relação aos modelos relacional, de documentos ou de colunas largas cobertos em outros pontos desta trilha: dados como **nós** (com labels e propriedades) conectados por **relacionamentos** (com um tipo, uma direção e propriedades próprias), além do vocabulário central de CRUD da linguagem de consulta Cypher (`CREATE`, `MATCH`, `WHERE`, `RETURN`, `MERGE`, `DELETE`/`DETACH DELETE`) para construir e consultar esse grafo.

## Use Cases

- Explicar a um time que sempre modelou dados de forma relacional por que um relacionamento muitos-para-muitos com atributos próprios (a nota que uma publicação deu a um vinho, uma data de "amigos desde" entre duas pessoas) pertence ao próprio relacionamento no Neo4j, e não a uma tabela de junção.
- Reconhecer quando um domínio é "amigo do quadro branco" (focado em como as coisas se conectam: grafos sociais, motores de recomendação, quadrilhas de fraude, organogramas, listas de materiais, em vez de focado em agregar linhas uniformes) e, portanto, candidato a um modelo de grafo em vez de forçá-lo por JOINs relacionais.
- Ler ou escrever um padrão `MATCH` do Cypher e reconhecê-lo como uma travessia de grafo de verdade (siga este tipo de relacionamento, nesta direção, até nós com este label), e não como um filtro no estilo SQL sobre uma tabela plana.
- Saber por que `CREATE` duplica cegamente a cada execução, enquanto `MERGE` é o verbo de "case este padrão, e só o crie se ele ainda não existir": a diferença que torna um script seguro para rodar de novo.
- Entender por que o Neo4j se recusa a fazer `DELETE` de um nó que ainda tem relacionamentos ligados, e recorrer a `DETACH DELETE` quando a intenção realmente é "remova este nó e tudo que o conecta."

## Deep Dive

### Um elástico, não um arquivo de pastas

O próprio enquadramento do livro para a razão de existir do Neo4j: "Um elástico é uma ferramenta útil porque você pode usá-lo para amarrar as coisas mais díspares, não importa quão estranhas ou mal ajustadas sejam suas formas. De muitas maneiras, o Neo4j é o elástico dos bancos de dados, um sistema pensado não tanto para guardar informações sobre coisas, mas para amarrá-las e registrar suas conexões umas com as outras." O Neo4j "se concentra mais nos relacionamentos entre valores do que nos pontos em comum entre conjuntos de valores (como coleções de documentos ou tabelas de linhas)."

Essa única frase é o ponto de virada em relação a todos os outros modelos desta trilha. Uma tabela relacional e uma coleção do MongoDB organizam os dados em torno de *conjuntos de coisas parecidas* (linhas que compartilham colunas, documentos que compartilham uma forma aproximada) e tratam uma conexão entre duas coisas como uma chave estrangeira ou uma referência embutida: um ponteiro que precisa ser resolvido (via JOIN ou uma busca no nível da aplicação) antes de significar alguma coisa. Um grafo de propriedades organiza os dados em torno das próprias conexões. O relacionamento não é um metadado sobre o modelo; é um cidadão de primeira classe, com identidade própria, tipo próprio e propriedades próprias, existindo no banco de forma tão concreta quanto os dois nós que ele conecta.

### Amigo do quadro branco

O Neo4j é descrito como "amigo do quadro branco" porque "praticamente qualquer diagrama que você consiga desenhar com caixas e linhas em um quadro branco pode ser guardado no Neo4j." O exemplo condutor do livro é um motor de sugestão de vinhos: vinhos categorizados por variedade, região, vinícola, safra e designação, cruzados com publicações que escrevem sobre eles e pessoas que gostam deles. Modelado de forma relacional, isso vira uma tabela de categorias e um join muitos-para-muitos entre os vinhos de uma vinícola e alguma combinação de categorias e outros dados: tecnicamente correto, mas não é como ninguém realmente pensa sobre o domínio. Modelado em um quadro branco, são só caixas (Wine, Winery, Publication, Person) conectadas por setas rotuladas (produced, reported_on, likes), e esse esboço no quadro branco *é* o modelo de dados do Neo4j, sem nenhuma etapa de tradução no meio.

O livro liga isso diretamente à flexibilidade de schema: "Há um velho ditado no mundo dos bancos relacionais: em uma linha do tempo longa o bastante, todos os campos se tornam opcionais. O Neo4j lida com isso implicitamente, fornecendo valores e estrutura só onde é necessário. Se um blend não tem safra, acrescente um ano de engarrafamento e aponte as safras para o nó do blend. Em bancos de grafos como o Neo4j simplesmente não há schema a ajustar." Dois nós podem ter o mesmo label com conjuntos de propriedades totalmente diferentes, do mesmo jeito que dois documentos podem viver em uma coleção do MongoDB com formas diferentes, mas aqui a liberdade extra se estende também aos relacionamentos: um relacionamento `likes` entre uma pessoa e um vinho não precisa de propriedade nenhuma, enquanto um relacionamento `reported_on` entre uma publicação e um vinho pode carregar uma `rating`.

### Nós e relacionamentos: o vocabulário

O livro é explícito ao dizer que a terminologia do Neo4j diverge de propósito, um pouco, da teoria matemática dos grafos: "No Cypher, como na teoria matemática dos grafos, os pontos de dados do grafo são chamados de nós. Diferente da teoria dos grafos, porém, os grafos no Cypher consistem em nós e não em vértices (como são chamados na teoria dos grafos), e as conexões entre nós são chamadas de relacionamentos (e não de arestas)." Um nó "é conceitualmente parecido" com o sentido da palavra em redes ("um vértice entre arestas que pode guardar dados"), e esses dados são "guardados como um conjunto de pares chave-valor (como em muitos outros bancos não relacionais de que falamos)." Um nó no Neo4j se comporta, em termos de propriedades, muito como um documento do MongoDB. O que é novo é o relacionamento: não uma chave estrangeira apontando para algum lugar, mas um objeto por si só, com um tipo, uma direção e, assim como um nó, propriedades próprias.

### Labels não são tipos

Criar um nó no console web ou no `cypher-shell` é assim:

```
CREATE (w:Wine {name: "Prancing Wolf", style: "ice wine", vintage: 2015})
```

`Wine` aqui é um **label**, e o livro tem o cuidado de traçar a linha: "Wine e Publication foram labels aplicados aos nós, não tipos. Poderíamos criar um nó com o label Wine que tivesse um conjunto de propriedades completamente diferente. Labels são extremamente úteis para consultas... mas o Neo4j não exige que você tenha tipos predefinidos. Se quiser impor tipos, vai ter que fazer isso no nível da aplicação." Um label é uma etiqueta usada para indexação e casamento de padrões, não uma restrição de schema: a mesma ideia de "estrutura sem forma fixa" das coleções do MongoDB, só que ligada a nós individuais em vez de a uma coleção inteira.

### CRUD em Cypher

As instruções Cypher compartilham uma forma reconhecível: "`MATCH [algum conjunto de nós e/ou relacionamentos] WHERE [algum conjunto de propriedades vale] RETURN [algum conjunto de resultados capturados pelas cláusulas MATCH e WHERE]`." Ler e navegar o grafo inteiro é `MATCH (n) RETURN n`; o livro chama isso de "mais ou menos um `SELECT * FROM grafo_inteiro`."

**Criar um relacionamento** sempre exige primeiro fazer `MATCH` dos dois nós das pontas e então `CREATE` da conexão entre as variáveis ligadas por esse match:

```
MATCH (p:Publication {name: "Wine Expert Monthly"}),
    (w:Wine {name: "Prancing Wolf", vintage: 2015})
CREATE (p)-[r:reported_on]->(w)
```

A sintaxe de seta `-[r:reported_on]->` codifica de uma vez as três coisas de que um relacionamento precisa: um tipo (`reported_on`), uma direção (do nó da esquerda para o da direita) e uma variável ligada (`r`) para anexar propriedades ou retorná-lo depois. As propriedades do relacionamento podem ser definidas depois com `SET`, ou inline no momento da criação (`CREATE (p)-[r:reported_on {rating: 97}]->(w)`), exatamente como o mapa de propriedades de um nó.

**Consultar por padrão** é onde o Cypher deixa de parecer SQL. O operador `-->` percorre um relacionamento em uma direção, seja qual for o tipo: `MATCH (p:Person {name: "Alice"})-->(n) RETURN n` retorna tudo para o que Alice aponta. Restringir o padrão por label e retornar uma propriedade específica fica assim: `MATCH (p:Person {name: "Alice"})-->(other:Person) RETURN other.name`. `WHERE` filtra por propriedades do mesmo jeito que o SQL, mas o Cypher escreve a desigualdade como `<>` em vez de `!=`: `MATCH (p:Person) WHERE p.name <> 'Patty' RETURN p`. Padrões de vários saltos perseguem relacionamentos de forma transitiva em uma única instrução: a consulta de "amigos de amigos" do livro, `MATCH (fof:Person)-[:friends]-(f:Person)-[:friends]-(p:Person {name: "Patty"}) RETURN fof.name`, percorre dois relacionamentos `friends` em um padrão e retorna todos a dois saltos de Patty, sem self-join, sem CTE recursiva e sem loop no lado da aplicação.

**`MERGE`** é o verbo de casar ou criar do Cypher: um upsert para padrões de grafo. Enquanto `CREATE` sempre insere um nó ou relacionamento novo (rodar a mesma instrução `CREATE` duas vezes produz dois nós), `MERGE` primeiro tenta fazer `MATCH` do padrão dado e só recorre ao `CREATE` se nada casar, tornando um script que constrói um grafo seguro para rodar de novo sem duplicar dados. `MERGE` também suporta as cláusulas `ON CREATE SET` e `ON MATCH SET` para aplicar atualizações de propriedades diferentes conforme qual ramo de fato rodou.

**Apagar** tem uma borda afiada que o livro aponta diretamente: "você não pode apagar um nó que ainda tem relacionamentos associados a ele." Remover um nó conectado é, portanto, uma dança em dois passos: apague o relacionamento, depois o nó:

```
MATCH ()-[r:short_lived_relationship]-()
  DELETE r
MATCH (e:EphemeralNode)
  DELETE e
```

E para limpar um grafo inteiro de uma vez, os relacionamentos precisam ser casados e apagados junto com seus nós: `MATCH (n) OPTIONAL MATCH (n)-[r]-() DELETE n, r`, com o aviso do próprio livro: "cuidado! Este comando vai apagar o grafo inteiro com que você está trabalhando."

### Um MATCH é uma travessia, não um filtro

Este é o ponto em que o modelo de grafo deixa de ser uma metáfora. Em um engine relacional, `WHERE` filtra linhas de uma leitura de tabela ou de um intervalo de índice; não há "caminhada" envolvida. No Neo4j, `MATCH (a:Person {name:"Alice"})-[:KNOWS]->(b) RETURN b` realmente executa como uma travessia de grafo: o engine encontra `Alice` uma vez (via um índice de label+propriedade, o mesmo mecanismo em que a seção de constraints do livro se apoia) e então segue para fora os ponteiros físicos de relacionamento `KNOWS` guardados nesse nó, salto a salto, exatamente como um padrão `MATCH` com mais segmentos `-->` (ou um `[:KNOWS*]` de comprimento variável) continua andando mais longe. O rastro abaixo monta um pequeno grafo `Person`/`KNOWS` com raiz em Alice e o percorre exatamente assim: um salto para os contatos diretos de Alice, um segundo salto para os amigos de amigos e um terceiro salto além disso; a mesma forma da própria consulta de "amigos de amigos de Alice" do livro, só que seguida um relacionamento por vez em vez de condensada em um único padrão de vários saltos.

```viz
type: graph
node ALICE Alice 1 2
node BOB Bob 3 1
node CAROL Carol 3 3
node DANA Dana 5 1
node EVE Eve 5 3
node FRANK Frank 7 1
edge ALICE BOB directed
edge ALICE CAROL directed
edge BOB DANA directed
edge CAROL EVE directed
edge DANA FRANK directed
---
visit ALICE | MATCH (a:Person {name: "Alice"}) ancora o padrão: o Neo4j usa uma busca em índice de label+propriedade para pular direto para o nó de Alice em vez de ler todas as Person.
traverse ALICE BOB | -[:KNOWS]-> é seguido como uma perseguição de ponteiro, não um join: o Cypher percorre o registro físico do relacionamento KNOWS direto de Alice até Bob.
mark BOB | Bob casa com (a)-[:KNOWS]->(b) e entra diretamente no conjunto de resultados de "todos que Alice conhece".
traverse ALICE CAROL | O engine percorre o outro relacionamento KNOWS de saída de Alice com a mesma diretividade, sem precisar de outra busca em índice; o próprio relacionamento é o caminho de acesso.
mark CAROL | Carol também casa e entra no conjunto de resultados.
traverse BOB DANA | Estender o padrão para (a)-[:KNOWS*2]->(b) percorre mais um salto, de Bob até Dana, do mesmo jeito, perseguindo ponteiros.
mark DANA | Dana está a dois saltos de Alice: uma amiga de um amigo, ainda fora do conjunto de resultados de um salto.
traverse CAROL EVE | O mesmo segundo salto do lado de Carol no grafo.
mark EVE | Eve também é amiga de uma amiga.
traverse DANA FRANK | Um terceiro salto, a três graus de distância de Alice.
mark FRANK | Por mais longe que o padrão de comprimento variável KNOWS* chegue, todo salto é uma perseguição de ponteiro, nunca um join; esse é o motivo mecânico de as consultas com forma de grafo continuarem rápidas à medida que ficam mais profundas.
```

Compare isso com o modo como a mesma pergunta, "quem Alice conhece, a dois saltos", rodaria de forma relacional: um self-join em uma tabela `friendships` (ou dois joins por uma tabela de junção), com o planejador de consultas decidindo se um índice torna esse join barato. Aqui não há join a planejar: os ponteiros de relacionamento *são* o índice, e é exatamente por isso que o livro descreve os padrões de vários saltos do Cypher como algo que se lê "como inglês simples" em vez de como SQL aninhado.

### Índices e constraints, de forma breve

O Neo4j "não permite impor schemas rígidos como os bancos relacionais fazem", mas índices e constraints acrescentam estrutura opcional por par label/propriedade: um índice acelera as buscas por uma propriedade sem mudar como as consultas são escritas, e uma constraint de unicidade (`CREATE CONSTRAINT ON (w:Wine) ASSERT w.name IS UNIQUE`, na sintaxe do livro) rejeita escritas que a violariam e, notavelmente, é verificada retroativamente contra os dados existentes no momento em que é criada. Como o livro diz, "embora o Neo4j não seja fundamentalmente orientado a schema como os bancos relacionais, índices e constraints vão ajudar a manter suas consultas rápidas e seu grafo são. Eles são absolutamente obrigatórios se você quer rodar o Neo4j em produção."

### Livro vs hoje

O livro documenta o Neo4j 3.1.4 (época de 2018). Conferido com a documentação atual do Neo4j/Cypher:

> **A sintaxe DDL de índices e constraints mudou; as formas antigas foram removidas, não só descontinuadas.** `CREATE INDEX ON :Wine(name)` / `DROP INDEX ON :Wine(name)` e `CREATE CONSTRAINT ON (w:Wine) ASSERT w.name IS UNIQUE`, do livro, eram sintaxe do Cypher 3.x. O Neo4j atual troca `ON` por `FOR` e `ASSERT` por `REQUIRE`, e suporta um nome opcional e `IF NOT EXISTS`: `CREATE INDEX [index_name] [IF NOT EXISTS] FOR (n:Wine) ON (n.name)` e `CREATE CONSTRAINT [constraint_name] [IF NOT EXISTS] FOR (w:Wine) REQUIRE w.name IS UNIQUE`. Rodar a sintaxe exata do livro contra um servidor atual não só emite um aviso, ela lança um erro: *"Invalid constraint syntax, ON and ASSERT should not be used. Replace ON with FOR and REQUIRE."* Scripts escritos com a sintaxe do livro precisam ser atualizados, não só ter um aviso de descontinuação suprimido.
> **`DETACH DELETE` existe no Cypher atual e faz o que o passo duplo manual do livro evita.** `DETACH DELETE e` apaga um nó e todo relacionamento ligado a ele em uma instrução, em vez de exigir a dança de relacionamento-depois-nó que o Dia 1 ensina. Se o `DETACH DELETE` já existia na versão 3.1.4 que o livro usa não dá para confirmar pela documentação atual (que não guarda esse tipo de histórico de versões); trate a versão em dois passos do livro como uma escolha didática deliberada que torna concreta a distinção entre nó e relacionamento, não como evidência de que a sintaxe ainda não existia. De qualquer forma, a boa prática atual para "apague este nó e tudo que o conecta" é a forma de uma linha `DETACH DELETE`.
> **A sintaxe central `CREATE (n:Label {props})` / `(a)-[r:TYPE]->(b)`, `MATCH`/`WHERE`/`RETURN` e a semântica de casar ou criar do `MERGE` não mudaram.** O `MERGE` hoje também suporta as cláusulas `ON CREATE SET` / `ON MATCH SET` para ramificar atualizações de propriedades conforme o caminho que de fato rodou, um passo natural além do básico de CRUD deste conceito, ausente no trecho do livro. Este é o núcleo estável do Cypher em todo o intervalo do 3.x até hoje: todo o resto que este conceito ensina ainda funciona literalmente.
> **O Cypher não é mais só "a linguagem de consulta do Neo4j": ele é o ancestral direto de um padrão ISO.** O livro chama o Cypher de "específico do Neo4j", o que era verdade na época. O Neo4j contribuiu o Cypher para a iniciativa openCypher em 2015 para que outros bancos de grafos pudessem implementá-lo, e em abril de 2024 a ISO publicou o **GQL (Graph Query Language)**, ISO/IEC 39075:2024, como padrão internacional formal para consultas em grafos de propriedades, o primeiro novo padrão ISO de linguagem de banco de dados desde o SQL. O GQL foi construído diretamente sobre a base do Cypher, com engenheiros do Neo4j entre os principais contribuidores do comitê de padronização; o próprio enquadramento do Neo4j é que "se você já usa Cypher ou openCypher, já está 95% lá" em direção ao GQL. Desde então o Neo4j introduziu o "Cypher 25", uma edição que se alinha mais ao GQL em sintaxe e semântica e é ativada por consulta ou por sessão, em vez de substituir o dialeto clássico de uma vez.
> **O Neo4j abandonou o versionamento semântico em favor do CalVer a partir de janeiro de 2025.** Não existe mais um único "Neo4j 5.x" para citar como atual: as versões agora são datadas como `2025.01` ou `2026.07`, tornando "Neo4j 5" uma marca legada para quem consultar a documentação daqui em diante.

## Trade-offs

- **O relacionamento como objeto de primeira classe é toda a proposta de valor, e também é a disciplina de modelagem que agora fica com você.** Uma tabela de junção muitos-para-muitos relacional é um detalhe de implementação; um relacionamento do Cypher com tipo, direção e propriedades próprias é o modelo. É exatamente isso que torna natural guardar a nota de uma avaliação ou uma data de amizade, mas também significa que todo relacionamento precisa de um nome e uma direção reais e deliberados, escolhidos de antemão (`reported_on`, `likes`, `friends`): a mesma responsabilidade de design que o MongoDB empurra para "embutir ou referenciar", só que expressa por tipos de relacionamento em vez de fronteiras de documento.
- **Sem schema significa iteração rápida e nenhuma rede de segurança.** Adicionar um nó com o label `Wine` e um conjunto de propriedades totalmente diferente de todos os outros nós `Wine` "simplesmente funciona": nada impede. É a mesma troca que o modelo de documentos faz (veja o conceito de MongoDB nesta trilha): dezenas de formas coexistem sem migração, e nada pega um nome de propriedade digitado errado no momento da escrita. Índices e constraints recuperam parte dessa segurança por par label/propriedade, mas são opcionais, não o padrão.
- **O casamento de padrões de vários saltos que se lê como inglês simples é genuinamente diferente de um JOIN relacional, não só uma sintaxe mais bonita.** `MATCH (fof)-[:friends]-(f)-[:friends]-(p {name:"Patty"})` percorre dois relacionamentos em uma instrução, sem self-join e sem CTE recursiva. O custo dessa expressividade é que o desempenho de uma consulta em grafo depende da forma e da densidade dos relacionamentos realmente percorridos: uma consulta de "amigo de amigo" continua barata em um grafo social esparso e fica cara rápido em um denso (uma celebridade com um milhão de seguidores), do mesmo jeito que um JOIN relacional fica caro em uma chave estrangeira sem índice, só que descoberto por outro mecanismo.
- **`CREATE` vs `MERGE` é uma borda afiada e fácil de não ver para quem vem do `INSERT`.** Rodar a mesma instrução `CREATE (w:Wine {name:"X"})` duas vezes cria dois nós Wine separados com propriedades idênticas: não há chave primária implícita deduplicando-os como um `INSERT` relacional colidiria em uma. `MERGE` dá a semântica de casar ou criar, mas recorrer a `CREATE` por hábito (porque ele se lê como `INSERT`) duplica dados em silêncio em vez de dar erro.
- **A regra de apagar o relacionamento antes do nó é uma proteção de corretude que parece atrito até você entender por quê.** Recusar-se a apagar um nó com relacionamentos ativos impede que registros de relacionamento fiquem órfãos, apontando para nada, em silêncio: um equivalente nativo de grafo de uma constraint de chave estrangeira, imposta incondicionalmente, e não só quando você por acaso a declara. `DETACH DELETE` é a válvula de escape de conveniência depois que você decidiu que é realmente isso que quer.

## Documentation Links

- [Eric Redmond e Jim R. Wilson, "Seven Databases in Seven Weeks", 2ª edição (Pragmatic Bookshelf, 2018): Capítulo 6, "Neo4J", Introdução e Dia 1: "Graphs, Cypher, and CRUD"](https://pragprog.com/titles/rwdata2/seven-databases-in-seven-weeks-second-edition/): doc
- [Neo4j Documentation: Cypher Manual: Clauses (CREATE, MATCH, WHERE, RETURN, MERGE, DELETE, DETACH DELETE)](https://neo4j.com/docs/cypher-manual/current/clauses/): doc
- [Neo4j Documentation: Managing Indexes](https://neo4j.com/docs/cypher-manual/current/indexes/search-performance-indexes/managing-indexes/): doc
- [Neo4j Documentation: Constraints: Examples](https://neo4j.com/docs/cypher-manual/current/constraints/examples/): doc
- [Neo4j Documentation: GQL Conformance](https://neo4j.com/docs/cypher-manual/current/appendix/gql-conformance/): doc
- [Neo4j Blog: openCypher, GQL, and the Cypher Implementation](https://neo4j.com/blog/cypher-and-gql/opencypher-gql-cypher-implementation/): doc
- [ISO/IEC 39075:2024: Information technology, Database languages, GQL](https://www.iso.org/standard/76120.html): doc
