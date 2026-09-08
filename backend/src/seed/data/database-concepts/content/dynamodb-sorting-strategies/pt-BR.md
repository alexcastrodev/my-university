---
version: 1.0
updatedAt: 2026-08-20
title: "Estratégias de Ordenação no DynamoDB: ScanIndexForward, Zero-Padding, e Sort Keys Hierárquicas"
summary: O DynamoDB ordena todo resultado de Query pela ordem em árvore B da sort key, ascendente por padrão, invertida com ScanIndexForward=False, então estratégia de ordenação é inteiramente um problema de modelagem de dados, use atributos imutáveis na chave primária e empurre atributos de sort key que mudam para um GSI, faça zero-padding de números embutidos em sort keys de string para que comparação UTF-8 lexicográfica combine com ordem numérica, use KSUIDs para IDs que precisam ser tanto únicos quanto cronologicamente ordenáveis, e posicione itens pai relativos a seus filhos para controlar em que ponta de uma item collection um Query aterrissa.
---
## Objective

Aprender como o DynamoDB de fato ordena os itens que retorna, e como desenhar uma sort key para que essa ordem seja a que seu padrão de acesso precisa. O capítulo enuncia as duas regras de antemão: "você precisa usar uma chave primária composta. Segundo, toda ordenação precisa ser feita com a sort key de uma item collection em particular." Por baixo dessa regra está um fato mecânico que vale a pena internalizar: dentro de uma partição, "itens dentro de uma item collection são armazenados como uma árvore B, que permite complexidade de tempo O(log n) na busca. Essa árvore B é organizada em ordem lexicográfica de acordo com a sort key, e é isso que você vai usar para ordenação." Toda estratégia neste conceito (formatos de timestamp, `ScanIndexForward`, zero-padding, sort keys hierárquicas) é uma forma de moldar o que é escrito naquela sort key, para que a ordem natural da árvore B combine com a ordem que sua aplicação quer ler de volta. O conceito irmão, [DynamoDB Filtering Strategies: Sparse Indexes and Composite Sort Keys](/database-concepts/dynamodb-filtering-strategies-sparse-indexes-composite-sort-keys), cobre a mesma *mecânica* de sort key composta (concatenar atributos em uma chave) para um *objetivo* diferente (filtrar em dois atributos em um `Query`); este conceito reutiliza a mesma ferramenta, mas a aponta para ordenação.

## Use Cases

- Uma aplicação de rastreamento de ticket que precisa de "tickets atualizados mais recentemente primeiro" por organização, sem quebrar a regra do DynamoDB de que atributos de chave primária são imutáveis na atualização.
- Um leaderboard ou um feed que precisa de resultados mais-recente-primeiro (ou maior-pontuação-primeiro): o uso de livro-texto para `ScanIndexForward=False`.
- Um dashboard de IoT que precisa do "Device mais suas 10 Readings mais recentes" em um único `Query`, o que exige decidir se o item Device pai ordena antes ou depois de seus filhos.
- Uma tabela SaaS onde um padrão de acesso precisa dos Users de uma Organization em ordem alfabética, enquanto outro precisa dos Teams dessa mesma Organization em qualquer ordem: ambos compartilhando uma item collection, um de cada lado do item pai.
- Uma sort key como `READING#<number>`, onde o número é armazenado como texto e precisa ordenar numericamente ("Reading #10" precisa vir depois de "Reading #2", não antes).
- Um identificador único, amigável para URL, que também precisa ordenar cronologicamente: números de confirmação de pedido, IDs de negócio, IDs de registro de migração, sem um atributo `CreatedAt` separado para ordenar.

## Deep Dive

### Ordenação lexicográfica não é ordenação alfabética

O DynamoDB só ordena pela sort key, e só tipos escalares (string, number, binary) são permitidos ali. Números ordenam numericamente, como esperado. Strings e binary ordenam "em ordem de bytes UTF-8": o que o livro chama, como uma simplificação, de ordem lexicográfica: "essa ordem é basicamente ordem de dicionário com duas ressalvas: 1. Todas as letras maiúsculas vêm antes das minúsculas. 2. Números e símbolos (por exemplo `#` ou `$`) também são relevantes." O próprio exemplo do livro é o sobrenome de seu autor: "imagine que você tivesse Jimmy Dean, Laura Dern, e eu [DeBrie] em uma item collection usando nossos sobrenomes. Se você esquecesse a capitalização, poderia sair assim... você pode se surpreender ao ver que DeBrie veio antes de Dean! Isso é por causa da caixa: maiúscula antes de minúscula." O conserto é disciplina, não um recurso do DynamoDB: "você deveria padronizar suas sort keys em valores todos maiúsculos ou todos minúsculos... você pode então guardar o valor corretamente capitalizado em um atributo diferente no seu item."

Essa mesma regra de ordem de bytes é o que faz o truque de prefixo `#` do conceito de filtragem servir de truque de ordenação também aqui: `#` ordena antes de letras maiúsculas, então um valor de sort key `#TEAM#<Name>` ordena antes de `ORG#<Name>`, sem precisar de uma comparação de valor. Sort keys compostas e marcadores de prefixo são um mecanismo; filtragem e ordenação são apenas dois usos diferentes dele.

### Timestamps: ordenável, legível por humano, ou ambos

"Sua escolha precisa ser ordenável. Nesse caso, timestamps epoch ou ISO-8601 servem. O que você absolutamente não pode fazer é usar algo que não é ordenável, como um formato amigável para exibição, tipo 'May 26, 1988'." Além de ordenabilidade, o livro prefere ISO-8601 por uma razão de depuração, com uma ressalva: "eu prefiro usar timestamps ISO-8601 porque são legíveis por humano se você está depurando itens no console do DynamoDB. Dito isso, pode ser difícil decifrar itens no console do DynamoDB se você tem um single-table design": um aceno ao custo de legibilidade do [single-table design](/database-concepts/dynamodb-single-table-design).

### IDs únicos, ordenáveis: KSUIDs

Uma necessidade recorrente é um identificador único que também ordena cronologicamente: um problema que UUIDs simples não resolvem, já que UUIDv4 é aleatório e não carrega ordenação temporal. A recomendação do livro é o KSUID (K-Sortable Unique Identifier): "é um identificador único que é prefixado com um timestamp, mas também contém aleatoriedade suficiente para tornar colisões muito improváveis. No total, você obtém uma string de 27 caracteres que é mais única do que um UUIDv4, enquanto ainda retém ordenação lexicográfica." Uma string KSUID como `1YnlHOfSSk3DhX4BR6lMAceAo1V` decodifica para um timestamp embutido mais um payload aleatório: um campo que é simultaneamente um ID único seguro para chave primária e uma sort key que ordena cronologicamente, sem exigir um atributo `CreatedAt` separado. (ULID é um design mais novo, mais amplamente adotado, com o mesmo objetivo, veja Documentation Links.)

### Sort keys imutáveis: não coloque um valor que muda na chave primária

O exemplo de rastreamento de ticket é o conto de advertência mais claro do conceito. Um primeiro design coloca `UpdatedAt` diretamente na sort key, para que um `Query` naturalmente retorne tickets por recência. Isso quebra imediatamente: "você não pode mudar nenhum elemento da chave primária. Nesse caso, sua chave primária inclui o campo `UpdatedAt`, que muda toda vez que você atualiza um ticket. Assim, toda vez que você atualiza um item de ticket, precisaríamos primeiro deletar o item de ticket existente, depois criar um novo item de ticket com a chave primária atualizada. Causamos uma operação desnecessariamente complicada e uma que poderia resultar em perda de dado se você não tratar suas operações corretamente."

O conserto é manter a sort key da tabela base em algo imutável (`TicketId`) e deixar um índice secundário carregar o atributo de ordenação volátil (`UpdatedAt`) em vez disso: "cada item da tabela base é copiado para o índice secundário... podemos usar a API Query contra nosso índice secundário para satisfazer nosso padrão de acesso 'Buscar tickets atualizados mais recentemente'. Mais importante, não precisamos nos preocupar com lógica complicada de deletar + criar ao atualizar um item." A lição generaliza: se o atributo pelo qual você quer ordenar muda frequentemente, não o torne (ou uma chave composta contendo ele) parte da chave primária da tabela base: projete-o em uma sort key de GSI, em vez disso, onde o DynamoDB recopia o item automaticamente em toda atualização.

### Ascendente versus descendente: `ScanIndexForward`

Por padrão um `Query` lê a árvore B de uma sort key da esquerda para a direita: ascendente: "começando em aardvark e indo em direção a zebra", ou para timestamps, "começando no ano 1900 e trabalhando em direção ao ano 2020." Definir `ScanIndexForward=False` inverte a travessia, "útil em várias ocasiões, como quando você quer obter os timestamps mais recentes ou quer encontrar as pontuações mais altas no leaderboard."

A sutileza aparece quando você combina isso com um relacionamento um-para-muitos colocalizado em uma única item collection: a mesma técnica que o conceito de filtragem usa para "montar diferentes collections" via marcadores de prefixo, agora direcionada a controlar onde o item pai aterrissa em relação a seus filhos. No exemplo de IoT (um item Device mais seus itens Reading), uma sort key ingênua `DEVICE#...` / `READING#...` coloca o Device *antes* de todas as Readings, porque `D` ordena antes de `R`. Consulte essa collection para frente e você obtém as leituras *mais antigas* primeiro, que é o inverso do que "as 10 leituras mais recentes" precisa. O conserto do livro é um prefixo `#` nos itens Reading: "agora podemos usar a API Query para buscar o item Device e os itens Reading mais recentes, começando no fim da nossa item collection e usando a propriedade `ScanIndexForward=False`." O princípio geral: "quando você está colocalizando itens para relacionamentos um-para-muitos ou muitos-para-muitos, tenha certeza de considerar a ordem em que você quer que os itens relacionados sejam retornados, para que seu próprio item pai fique posicionado de acordo."

### Dois padrões de acesso relacionais, direções opostas, uma item collection

Levando isso um passo adiante: uma única item collection pode servir *dois* relacionamentos um-para-muitos em direções de ordenação *opostas*, se o item pai fica entre eles. O exemplo SaaS do livro coloca os itens Team de uma Organization de um lado e os itens User do outro, usando `#TEAM#<Name>` (ordena antes do pai) e `USER#<Name>` (ordena depois dele), com o próprio item Org em `ORG#<OrgName>` no meio:

```python
result = dynamodb.query(
    TableName='SaaSTable',
    KeyConditionExpression="#pk = :pk AND #sk <= :sk",
    ExpressionAttributeNames={"#pk": "PK", "#sk": "SK"},
    ExpressionAttributeValues={
        ":pk": {"S": "ORG#MCDONALDS"},
        ":sk": {"S": "ORG#MCDONALDS"}
    },
    ScanIndexForward=False
)
```

"Isso vai até nossa partição e encontra todos os itens menores ou iguais ao valor de sort key do nosso item Org. Depois varre para trás para pegar todos os itens Team." A query espelho (`#sk >= :sk` com `ScanIndexForward=True`, o padrão) busca o Org mais todos os itens User em ordem alfabética. Uma item collection, duas ordenações independentes, "de forma alguma necessário, mas vai te poupar índices secundários adicionais na sua tabela."

### Zero-padding: forçando ordem numérica a partir de uma sort key de string

Sempre que uma sort key mistura um prefixo de tipo com um número (`<ItemType>#<Number>`), esse número é comparado como texto, não aritmeticamente, e comparação lexicográfica de strings de dígitos não combina com ordem numérica: "ordenação lexicográfica avalia um caractere de cada vez, da esquerda para a direita. Quando comparou '10' com '2', o primeiro dígito de 10 ('1') vem antes do primeiro dígito de 2 ('2'), então 10 foi colocado antes de 2." Reading #10 aterrissa antes de Reading #2: visivelmente errado.

O conserto é fixar a largura: preencha todo número com o mesmo número de dígitos, com zeros à esquerda, para que `"10"` se torne `"00010"` e `"2"` se torne `"00002"`, e agora eles comparam corretamente caractere por caractere. A única decisão de design é escolher a largura antecipadamente, porque não pode ser mudada depois sem uma migração: "o fator principal aqui é garantir que seu padding seja grande o suficiente para dar conta de qualquer crescimento... eu recomendaria ir até o número máximo de itens relacionados que você poderia imaginar alguém ter, então adicionar 2-3 dígitos além disso... você também pode querer ter uma condição de alerta no código da sua aplicação que te avise se uma contagem em particular chegar a mais de X% do seu máximo."

### Falsificando ordem ascendente: a diferença com zero-padding

O padrão mais avançado do livro resolve um problema estreito, mas real: dois relacionamentos um-para-muitos a partir do mesmo pai, ambos usando um ID numérico, onde você quer buscar *ambos* na *mesma* direção (digamos, ambos descendentes por ID) dentro de uma *única* item collection: normalmente impossível, já que a ordem ascendente de um relacionamento é a ordem descendente do outro em relação à posição do pai.

O truque: em vez de armazenar o próprio número (com zero-padding), armazene a *diferença* com zero-padding em relação ao valor máximo possível. Para largura 5 e um ID de `157`, a diferença com padding é `99999 − 157 = 99842`. Armazene `99842` em vez de `00157`, e agora IDs maiores (que deveriam ordenar como "mais recente", ou seja, primeiro) produzem strings armazenadas *menores*, então ler a item collection *para frente*, a partir do pai, produz IDs em ordem descendente: travessia ascendente falsificando ordem descendente. Como o livro coloca: "repare que eu mudei a estrutura de SK dos itens Reading, de forma que o item Device pai agora está no topo da nossa item collection. Agora podemos buscar o Device e as Readings mais recentes começando em Device e lendo para frente, mesmo que estejamos de fato obtendo as leituras em ordem descendente de acordo com seu ReadingId." O livro é franco sobre quão de nicho isso é ("você pode nunca ter uma necessidade disso na prática"), e enquadra o ganho real como uma demonstração de composabilidade: "a melhor lição que você pode tirar dessa estratégia é o quão flexível o DynamoDB pode ser se você combinar múltiplas estratégias. Uma vez que você aprende o básico, você pode colá-las juntas de formas únicas para resolver seu problema."

### Book vs today: `ScanIndexForward` e a ordenação por sort key permanecem inalteradas

A referência de API `Query` atual da AWS enuncia a regra de ordenação essencialmente nas próprias palavras do livro: "resultados de `Query` são sempre ordenados pelo valor da sort key. Se o tipo de dado da sort key é Number, os resultados são retornados em ordem numérica; caso contrário, os resultados são retornados em ordem de bytes UTF-8. Por padrão, a ordem de classificação é ascendente. Para inverter a ordem, defina o parâmetro `ScanIndexForward` como false." A página de boas práticas de sort key do guia de desenvolvedor atual confirma independentemente os padrões de controle de versão e prefixo hierárquico que este capítulo ensina, incluindo o mesmo truque de prefixo zero ("`v0_`") para "sempre buscar a versão mais recente primeiro", e um post de 2024 do AWS Database Blog sobre design de sort key percorre o padrão idêntico de `ScanIndexForward=False` "mais recente primeiro" contra um GSI. Nada sobre a mecânica de ordenação (ascendente por padrão, `ScanIndexForward` para inverter, regras de comparação numérica versus UTF-8) mudou desde a edição de 2020 do livro. Esse é um canto genuinamente estável da API do DynamoDB; a técnica de *concatenação* de sort key composta na qual este capítulo também se apoia ganhou uma alternativa nativa no final de 2025 (chaves compostas multi-atributo em GSIs), coberta no conceito irmão de filtragem, mas essa mudança é sobre como você constrói uma chave composta, não sobre como a própria ordem de classificação funciona, uma vez que você tem uma.

## Trade-offs

- **Zero-padding exige se comprometer com uma largura antecipadamente, sem forma barata de voltar atrás.** Subestime a contagem máxima e todo ID além da largura com padding quebra a ordenação silenciosamente (sem erro, só ordem de classificação errada) até você migrar o atributo e reconstruir qualquer índice construído sobre ele. O próprio conselho do livro (faça padding para a maior contagem que você consegue imaginar, depois adicione 2-3 dígitos, e alerte bem antes de chegar perto) é uma proteção contra uma decisão que você não consegue reverter facilmente.
- **A disciplina de chave primária imutável empurra atributos de sort key voláteis para um GSI, o que custa um índice.** O conserto de rastreamento de ticket (tabela base ordena por `TicketId`, GSI ordena por `UpdatedAt`) troca o risco de deletar+recriar por um índice secundário extra para criar, projetar, e pagar: barato comparado a um bug de perda de dado, mas não de graça.
- **KSUIDs (ou ULIDs) compram unicidade ordenável ao custo de um formato de ID não padrão.** Diferente de um UUID, uma string KSUID/ULID embute um timestamp que é recuperável decodificando-a: um pequeno vazamento de informação (aproximadamente quando o registro foi criado) que um UUID aleatório não tem, vale a pena considerar para IDs expostos a usuários finais.
- **As estratégias "dois padrões de acesso relacionais, uma item collection" e "falsificar ordem ascendente" economizam contagem de índice ao custo de legibilidade.** Ambas dependem de exatamente onde um valor de sort key prefixado com `#` ou numericamente invertido acontece de cair em relação a um item pai: correto, mas longe de autodocumentado; um futuro mantenedor lendo a tabela bruta precisa do comentário ou da documentação explicando *por que* o SK parece assim, não apenas o que ele é.
- **`ScanIndexForward=False` muda a ordem de *travessia*, não o custo de query.** É de graça no sentido de que não adiciona capacidade de leitura ou um índice extra, mas só produz uma ordenação útil se a sort key já foi desenhada para colocar os itens desejados no fim da item collection: não consegue consertar uma sort key que não foi moldada para o padrão de acesso em primeiro lugar.

## Documentation Links

- [Alex DeBrie, "The DynamoDB Book", v1.0.1 (2020), Chapter 14, "Strategies for sorting", p. 234-252](https://www.dynamodbbook.com/) - doc
- [AWS Documentation, Query (API Reference), ScanIndexForward and sort-order semantics](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_Query.html) - doc
- [AWS Documentation, Best Practices for Using Sort Keys to Organize Data](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-sort-keys.html) - doc
- [AWS Database Blog, Effective data sorting with Amazon DynamoDB](https://aws.amazon.com/blogs/database/effective-data-sorting-with-amazon-dynamodb/) - doc
- [AWS Documentation, Key Condition Expressions for the Query Operation](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Query.KeyConditionExpressions.html) - doc
- [Segment, ksuid: K-Sortable Globally Unique IDs](https://github.com/segmentio/ksuid) - doc
- [ULID Specification, Universally Unique Lexicographically Sortable Identifier](https://github.com/ulid/spec) - doc
