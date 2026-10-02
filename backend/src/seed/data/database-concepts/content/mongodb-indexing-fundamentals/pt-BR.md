---
version: 1.0
updatedAt: 2026-08-20
title: "Índices no MongoDB: B-Trees, Prefixos Compostos e o Planejador de Consultas"
summary: Todo índice do MongoDB é uma B-tree real do WiredTiger em disco, e é por isso que um índice composto atende qualquer prefixo de suas chaves e nada mais, que a ordem de chaves igualdade-ordenação-intervalo leva a consulta de exemplo do livro de 4.325 ms para 37 ms, e que todo índice que você adiciona é um imposto sobre toda escrita.
---
## Objective

Entender o que um índice do MongoDB realmente é (uma B-tree real em disco mantida pelo storage engine WiredTiger, não uma metáfora), por que o `_id` ganha um de graça e todo outro custa escritas, como um índice composto atende qualquer *prefixo* de suas chaves e nada mais, e como ler o `explain("executionStats")` bem o suficiente para distinguir um índice bom de um ruim em vez de chutar.

## Use Cases

- Diagnosticar uma consulta que "de repente ficou lenta" rodando `explain("executionStats")` e encontrando um estágio `COLLSCAN`: o próprio exemplo de abertura do livro busca um username em um milhão de documentos e reporta `totalDocsExamined: 1000000` e `executionTimeMillis: 419`, contra `totalDocsExamined: 1` e `executionTimeMillis: 1` depois que `createIndex({"username": 1})` existe.
- Decidir a *ordem* dos campos em um índice composto para uma consulta que filtra por igualdade em um campo, por intervalo em outro e ordena por um terceiro: a diferença no exemplo do dataset de alunos do livro entre um plano de 4.325 ms e um de 42 ms é puramente a ordem das chaves, não a quantidade de índices.
- Auditar uma coleção cujo throughput de escrita piorou, rodando `db.collection.getIndexes()` e apagando os índices que nenhuma forma de consulta de fato usa: todo índice da coleção precisa ser atualizado em todo insert, update e delete que toque seus campos.
- Impor "único quando presente" em um campo opcional (um e-mail que pode estar ausente, mas nunca pode colidir) usando `unique` combinado com `partialFilterExpression`, em vez de um índice único simples, que rejeitaria o segundo documento sem o campo.
- Reconhecer os casos em que um índice *piora* as coisas: uma consulta de relatório que retorna a maior parte da coleção é mais rápida como leitura completa da coleção, porque uma busca por índice custa duas leituras (a entrada do índice e depois o documento), enquanto uma leitura completa custa uma.

## Deep Dive

### Um índice é uma lista ordenada, e no disco ele é uma B-tree

O enquadramento do livro é deliberadamente simples: "Um índice de banco de dados é parecido com o índice de um livro. Em vez de olhar o livro inteiro, o banco pega um atalho e só olha uma lista ordenada com referências ao conteúdo." Uma consulta que não consegue usar um índice é uma **leitura completa da coleção (collection scan)**, que a saída do `explain` rotula como `COLLSCAN`: o servidor lendo o livro inteiro desde a primeira página.

O que essa "lista ordenada" é fisicamente é uma B-tree. O storage engine padrão do MongoDB, o WiredTiger, guarda tanto coleções quanto índices como B-trees em disco; o índice criado automaticamente no `_id` e todo índice que você cria com `createIndex` é uma. Isso não é uma analogia emprestada dos bancos relacionais: é a mesma estrutura, pelo mesmo motivo, e é por isso que o livro pode dizer com todas as letras que "os índices do MongoDB funcionam de forma quase idêntica aos índices típicos de bancos relacionais." Uma B-tree mantém suas chaves ordenadas, mantém toda folha na mesma profundidade e empacota muitas chaves em cada nó, para que uma leitura de página do disco compre uma decisão de ramificação larga. É exatamente isso que permite a um índice responder "qual documento tem o username `user101`" com uma busca de chave em vez de um milhão de leituras de documento.

Cada entrada do índice guarda o valor indexado (ou os valores, em um índice composto) mais um **identificador de registro**, "usado internamente pelo storage engine para localizar os dados de um documento." Então um acerto no índice tem dois passos: encontrar a chave e depois seguir o identificador de registro para buscar o documento. Em termos de `explain`, é um estágio `IXSCAN` alimentando um estágio `FETCH`.

### Veja a B-tree sendo construída: o que o `createIndex` está realmente fazendo

Abaixo está um insert rastreado à mão de sete valores de `age` (`42, 17, 63, 8, 55, 91, 70`, chegando nessa ordem não ordenada, como os documentos reais chegam) em um índice inicialmente vazio. A árvore tem grau mínimo `t = 2`, então todo nó guarda de 1 a 3 chaves e um nó fica **cheio** com `2t - 1 = 3`. Seguindo a disciplina proativa padrão, um nó cheio é dividido *antes* de o algoritmo descer nele, então a inserção é uma única passada para baixo, sem voltar atrás:

```viz
type: btree
node root keys=42 | insert(42): o índice está vazio, então 42 vira a raiz: um nó de B-tree, uma página do WiredTiger.
node root keys=17,42 | insert(17): 17 vem antes de 42 na ordem e a raiz tem espaço (2 de 3 chaves), então ele simplesmente entra no lugar, em ordem.
node root keys=17,42,63 | insert(63): raiz = [17, 42, 63], agora CHEIA com 2t-1 = 3 chaves.
remove root | insert(8): a raiz está CHEIA, então divida-a ANTES de descer nela.
node root2 keys=42 | A mediana 42 é promovida para uma raiz nova. Esta é a única forma de o índice ficar mais alto: pelo topo, nunca pelas folhas, e é por isso que toda folha fica na mesma profundidade.
node n17 keys=17 parent=root2 index=0 | As chaves abaixo da mediana viram o filho da esquerda.
node n63 keys=63 parent=root2 index=1 | As chaves acima da mediana viram o filho da direita.
node n17 keys=8,17 parent=root2 index=0 | Agora termine o insert(8): 8 é menor que 42, então desça à esquerda em [17], que tem espaço -> insira 8.
node n63 keys=55,63 parent=root2 index=1 | insert(55): 55 é maior que 42, então desça à direita em [63], que tem espaço -> insira 55.
node n63 keys=55,63,91 parent=root2 index=1 | insert(91): desça à direita em [55, 63] -> insira 91. Essa folha agora está CHEIA.
remove n63 | insert(70): 70 desceria à direita, mas [55, 63, 91] está CHEIA. Divida-a primeiro.
node root2 keys=42,63 | A mediana 63 é promovida para a raiz, que tinha só 1 chave e, portanto, tem espaço: a divisão para aqui em vez de se propagar mais para cima.
node n55 keys=55 parent=root2 index=1 | [55] fica como filho do meio, cobrindo as chaves estritamente entre 42 e 63.
node n91 keys=91 parent=root2 index=2 | [91] vira o novo filho mais à direita, cobrindo as chaves acima de 63.
node n91 keys=70,91 parent=root2 index=2 | Agora termine o insert(70): 70 é maior que 63, então desça no filho mais à direita -> insira 70.
```

Duas divisões, dois resultados diferentes. `insert(8)` divide a *raiz*, que é o único evento que deixa a árvore mais alta. `insert(70)` divide uma folha cuja mediana promovida cai em um pai que por acaso tinha espaço, então a propagação para depois de um nível; em um índice mais profundo, essa mesma promoção continuaria subindo. A árvore final é a raiz `[42, 63]` sobre as folhas `[8, 17]`, `[55]`, `[70, 91]`: toda folha na profundidade 1, nenhum nó com mais de 3 chaves, chaves corretamente separadas em todo nível.

Esta é a maquinaria que o `createIndex` roda, um documento por vez, sobre a coleção inteira, e é por isso que o livro avisa que "construir índices novos consome tempo e recursos", e que a construção de um índice em uma coleção grande é algo que você acompanha com `db.currentOp()`. Isso também explica uma linha pequena e fácil de passar despercebida no fim do capítulo: "Se você tiver a escolha, criar índices sobre documentos existentes é um pouco mais rápido que criar o índice primeiro e depois inserir todos os documentos." Construir o índice depois deixa o engine montar a árvore a partir de dados que ele consegue processar em lote; construí-lo antes significa que cada insert paga o custo de descer e talvez dividir que você acabou de ver, transação por transação.

### Índices compostos e a regra do prefixo

Um índice mantém seus valores ordenados, o que o torna útil tanto para ordenar quanto para casar, "mas um índice só ajuda a ordenar se for um prefixo da ordenação." Um índice em `{"username": 1}` não faz nada por `.sort({"age": 1, "username": 1})`; você precisa de `createIndex({"age": 1, "username": 1})`, um **índice composto**.

O livro representa esse índice concretamente como pares de chaves ordenados apontando para identificadores de registro:

```
[0, "user100020"] -> 8623513776
[0, "user1002"]   -> 8599246768
...
[1, "user100113"] -> 8623525680
[2, "user100191"] -> 8623535664
```

Idades estritamente crescentes; dentro de cada idade, usernames crescentes. Esse layout é toda a explicação do que um índice assim consegue e não consegue fazer:

- **Consulta de igualdade**: `find({"age": 21}).sort({"username": -1})` pula direto para o primeiro `21` e percorre o índice; nenhum passo de ordenação é necessário, porque o índice já guarda os usernames em ordem dentro de uma idade. A direção não importa, já que o MongoDB consegue percorrer um índice nos dois sentidos.
- **Consulta por intervalo**: `find({"age": {"$gte": 21, "$lte": 30}})` usa a chave inicial `age` para delimitar a leitura e retorna os documentos na ordem do índice.
- **Intervalo mais ordenação pela segunda chave**: `find({"age": {"$gte": 21, "$lte": 30}}).sort({"username": 1})` não consegue usar o índice para a ordenação, porque os usernames só estão ordenados *dentro* de uma idade. O MongoDB ordena em memória e, se o resultado passar de 32 MB, dá erro de vez: `"Sort operation used more than the maximum 33554432 bytes of RAM. Add an index, or specify a smaller limit."`

A regra geral que o livro chama de **índices implícitos**: "se um índice tem N chaves, você ganha um índice 'de graça' em qualquer prefixo dessas chaves." Um índice em `{a, b, c, ..., z}` é ao mesmo tempo um índice em `{a}`, em `{a, b}`, em `{a, b, c}`, e assim por diante. E o outro lado, onde vive a maioria dos erros com índices compostos: "isso não vale para qualquer subconjunto de chaves: consultas que usariam o índice `{"b": 1}` ou `{"a": 1, "c": 1}` não serão otimizadas. Só consultas que podem usar um prefixo do índice conseguem aproveitá-lo."

A *direção* das chaves só importa em ordenações por várias chaves. `{"age": 1, "username": -1}` e `{"age": -1, "username": 1}` são equivalentes (índices inversos servem às mesmas consultas), e se você só ordena por uma chave, um índice crescente atende uma ordenação decrescente igualmente bem: "então não crie os dois!"

### Ordenando as chaves: igualdade, ordenação, intervalo

O melhor material do capítulo é um exemplo resolvido sobre uma coleção `students` de um milhão de registros, rodando:

```js
db.students.find({ student_id: { $gt: 500000 }, class_id: 54 })
  .sort({ student_id: 1 })
  .explain("executionStats")
```

Com um índice em `{student_id: 1, class_id: 1}`, o plano vencedor examinou **850.477 chaves de índice para retornar 9.903 documentos** em 4.325 ms. O índice era utilizável, mas não *seletivo*: a chave inicial era o filtro de intervalo, então a leitura teve que percorrer quase metade do índice. Inverter a ordem para `{class_id: 1, student_id: 1}` coloca o filtro de igualdade primeiro, e a mesma consulta retorna em **37 ms com `totalKeysExamined` igual a `nReturned`**: 9.903 chaves para 9.903 documentos, a proporção ideal.

Mude a ordenação para um terceiro campo (`.sort({final_grade: 1})`) e um estágio `SORT` reaparece no plano vencedor: uma ordenação em memória, 136 ms. A correção é `{class_id: 1, final_grade: 1, student_id: 1}`: a chave de ordenação vem *depois* do filtro de igualdade, mas *antes* do filtro de intervalo, para que o MongoDB possa percorrer o índice na ordem de final_grade enquanto o filtro de intervalo estreita o que ele mantém. Essa versão roda em 42 ms sem estágio `SORT`, ao custo de examinar um pouco mais de chaves do que retorna (9.905 contra 9.903), uma troca que o livro faz explicitamente: "para evitar uma ordenação em memória, precisamos examinar mais chaves que o número de documentos que retornamos."

O capítulo enuncia a regra resultante em três linhas:

> - Chaves de filtros de igualdade deveriam aparecer primeiro.
> - Chaves usadas para ordenação deveriam aparecer antes de campos de vários valores.
> - Chaves de filtros de vários valores deveriam aparecer por último.

Essa é a regra que a documentação do MongoDB agora chama de **ESR (Equality, Sort, Range)**: o livro a ensina por completo, só sem a sigla.

### Como o MongoDB escolhe um índice: a corrida de planos

O MongoDB não estima o custo dos planos como um otimizador relacional faz: ele os põe para *correr*. Quando uma consulta chega, o servidor olha a **forma** da consulta (quais campos são filtrados, se há ordenação), identifica os índices candidatos, monta um plano de consulta por candidato e os roda em threads paralelas por um período de teste. "Para vencer a corrida, uma thread de consulta precisa ser a primeira a retornar todos os resultados da consulta ou a retornar um número de teste de resultados na ordem de ordenação."

O vencedor é guardado em um **cache de planos** indexado pela forma da consulta, para que consultas seguintes com a mesma forma pulem a corrida. Os planos são despejados quando a coleção ou seus índices mudam, quando um índice é reconstruído/adicionado/apagado, quando o cache é limpo explicitamente, e o cache inteiro se perde em um restart do `mongod`. Uma consequência prática para ler o `explain`: `executionTimeMillis` "vai refletir quanto tempo levou para todos rodarem, não só o escolhido como melhor" quando vários planos foram testados.

Os campos que vale ler no `explain("executionStats")` são poucos:

| Campo | O que ele diz |
|---|---|
| `stage` | `IXSCAN` significa que um índice foi usado; `COLLSCAN` significa que a coleção inteira foi lida |
| `nReturned` | Documentos que a consulta de fato retornou |
| `totalKeysExamined` | Entradas de índice percorridas; compare com `nReturned` para medir a seletividade |
| `totalDocsExamined` | Documentos buscados via identificadores de registro; `0` significa que a consulta foi **coberta** |
| `indexBounds` | O intervalo exato do índice que foi percorrido |
| `rejectedPlans` | Os planos que perderam a corrida |

Uma **consulta coberta** é aquela cujos campos pedidos estão todos no índice, então nenhuma busca de documento é necessária: "o resultado tem um estágio `IXSCAN` que não é descendente de um estágio `FETCH`, e nas `executionStats` o valor de `totalDocsExamined` é 0." Conseguir uma normalmente significa projetar fora o `_id`, a menos que ele faça parte do índice.

Se o planejador escolher um índice que você não quer, `hint()` força um específico, com a ressalva do livro: rode `explain` na consulta com hint antes de implantar, porque forçar um índice que o MongoDB não sabe usar bem pode deixar a consulta mais lenta do que estava.

### Quando não indexar, e no que os índices são ruins

Nem todo campo merece um índice, e nem toda consulta fica melhor com um.

**Baixa cardinalidade mata a seletividade.** Cardinalidade é quantos valores distintos um campo tem. `gender` ou `newsletter_opt_out` têm dois; `username` ou `email` têm um por documento. "Em geral, quanto maior a cardinalidade de um campo, mais útil um índice nele pode ser." Um índice em `gender` estreita uma busca por mulheres chamadas Susan em cerca de 50% antes de precisar começar a ler documentos; um índice em `name` a estreita para um punhado imediatamente. Regra prática: indexe chaves de alta cardinalidade, ou pelo menos coloque-as antes das chaves de baixa cardinalidade em um índice composto.

**Conjuntos de resultados grandes são mais rápidos sem índice.** Uma busca por índice são duas leituras: a entrada do índice e depois o documento. Uma leitura completa da coleção é uma. "No pior caso (retornar todos os documentos de uma coleção), usar um índice levaria o dobro de buscas e em geral seria bem mais lento que uma leitura completa da coleção." A regra prática do livro é que um índice muitas vezes *para* de ajudar quando a consulta retorna 30% ou mais da coleção, observando que o ponto real de virada vai de 2% a 60%, dependendo do tamanho dos documentos e do conjunto de resultados. Índices combinam com coleções grandes, documentos grandes e consultas seletivas; leituras completas combinam com coleções pequenas, documentos pequenos e consultas não seletivas.

**Negação é ineficiente.** `$ne` pode usar um índice, mas precisa ler tudo dos dois lados do valor excluído. `$not` às vezes consegue inverter um intervalo simples ou uma regex, mas normalmente recorre a uma leitura completa, e `$nin` sempre lê tudo. Prefira `$in` a `$or`, já que `$or` roda um `IXSCAN` separado por cláusula e depois precisa deduplicar os resultados combinados.

### Índices únicos e parciais

Um **índice único** garante que cada valor apareça no máximo uma vez; um insert duplicado falha com o código de erro `11000`, `E11000 duplicate key error`. O índice do `_id` é exatamente isso: um índice único comum, exceto pelo fato de que não pode ser apagado. Duas coisas a saber: construir um índice único em uma coleção que já tem duplicatas simplesmente falha, e constraints de unicidade são uma ferramenta de corretude, não um filtro: "use a constraint de unicidade para a duplicata ocasional, não para filtrar zilhões de duplicatas por segundo."

A armadilha clássica: um campo ausente é indexado como `null`, então um índice único simples rejeita o *segundo* documento que omite o campo. **Índices parciais** são a correção: passe `partialFilterExpression` para que só os documentos que casam sejam indexados:

```js
db.users.createIndex(
  { email: 1 },
  { unique: true, partialFilterExpression: { email: { $exists: true } } }
);
```

Índices parciais não precisam ser únicos; tire a opção `unique` para ter um simples. O livro aponta uma consequência genuinamente surpreendente: a mesma consulta pode retornar *resultados diferentes* dependendo de usar ou não o índice parcial, porque documentos excluídos do índice ficam invisíveis para um plano que o percorre. O exemplo deles: com um índice parcial em `x`, `find({"x": {"$ne": 2}})` para de retornar o documento que não tem campo `x` nenhum. Se você precisa desses documentos, use `hint` para forçar a consulta a uma leitura completa da coleção.

Os índices parciais do MongoDB são um superconjunto dos índices esparsos, e o livro tem o cuidado de observar que eles *não* são a mesma coisa que um índice esparso de um RDBMS: "Índices parciais no MongoDB só são criados sobre um subconjunto dos dados. Isso é diferente dos índices esparsos em bancos relacionais, que criam menos entradas de índice apontando para um bloco de dados; porém, em um RDBMS, todos os blocos de dados terão uma entrada de índice esparso associada."

### Administração de índices

`db.collection.getIndexes()` lista todo índice com sua `key` (a especificação de campo/direção, usada no `hint`) e seu `name` (o identificador para `dropIndex`). Os nomes padrão são `keyname1_dir1_keyname2_dir2_...`, o que fica difícil de manejar rápido, então `createIndex` aceita uma opção `name`. A ordem dos campos faz parte da identidade: "um índice em `{"class_id": 1, "student_id": 1}` não é o mesmo que um índice em `{"student_id": 1, "class_id": 1}`." Criar o mesmo índice duas vezes não faz nada. `db.people.dropIndex("x_1_y_1")` remove um.

> **Livro vs. hoje.** Dois detalhes deste capítulo envelheceram, e os dois já estavam mudando quando ele foi escrito. (1) O livro descreve a escolha entre uma construção de índice em *primeiro plano* (rápida, bloqueia todas as leituras e escritas no banco) e uma construção com `background: true` (mais lenta, cede periodicamente). O MongoDB 4.2 substituiu as duas pela **construção híbrida de índices**, que mantém um lock exclusivo só no início e no fim e intercala leituras e escritas no resto; o livro a menciona como novidade; hoje ela é o único tipo de construção, e a opção `background` sumiu. (2) O livro diz que os metadados de índices vivem em uma coleção `system.indexes`. O acesso direto a `system.indexes` foi descontinuado lá no MongoDB 3.0 em favor do comando `listIndexes`, e ela nem existe no WiredTiger; `db.collection.getIndexes()` (que o livro também mostra, e que encapsula o `listIndexes`) e o estágio de agregação `$indexStats` são as formas suportadas de inspecionar índices hoje. Um terceiro detalhe *não* mudou na direção que você poderia esperar: o limite de 1.024 bytes de tamanho de chave de índice anterior ao 4.2 foi removido no 4.2, exatamente como o livro diz, então chaves grandes demais não saem mais do índice em silêncio.

## Trade-offs

- **Todo índice é um imposto permanente sobre toda escrita.** O livro diz isso uma vez, com clareza, e isso governa todo o resto: "operações de escrita (inserts, updates e deletes) que modificam um campo indexado vão demorar mais... além de atualizar o documento, o MongoDB precisa atualizar os índices quando seus dados mudam." Esse custo é a manutenção da B-tree que você viu na animação (descer, inserir, talvez dividir), repetida por índice, por escrita. Dez índices em uma coleção quente significam dez árvores para manter balanceadas em todo insert. Excesso de índices é um modo de falha real em produção, e ele aparece como queda no throughput de escrita muito antes de alguém pensar em olhar a lista de índices.
- **A ordem dos campos em um índice composto importa mais que a quantidade de índices.** A mudança de 4.325 ms → 37 ms no exemplo dos alunos do livro veio de reordenar dois campos em um único índice, não de adicionar um. Igualdade primeiro, ordenação em seguida, intervalo por último (a ordem ESR). Inverta isso e você tem um índice que é *usado* (o `explain` mostra um `IXSCAN` feliz) enquanto lê 86× mais chaves do que retorna. `totalKeysExamined` vs. `nReturned` é o número que expõe isso; `stage: "IXSCAN"` sozinho não prova nada.
- **Um prefixo é de graça; um subconjunto que não é prefixo não vale nada.** Um índice composto em `{a, b, c}` cobre `{a}`, `{a, b}` e `{a, b, c}` sem custo extra (genuinamente três índices pelo preço de um, e o principal motivo para consolidar). Mas uma consulta em `{b}` ou `{a, c}` não ganha nenhum benefício e precisa do próprio índice. A tentação é "só adicionar mais um índice" para cada nova forma de consulta; a disciplina é verificar primeiro se reordenar um índice composto existente transforma as duas formas em prefixos de uma única árvore.
- **Evitar uma ordenação em memória custa leituras extras de chaves, de propósito.** Colocar o campo de ordenação antes do campo de intervalo significa examinar mais chaves de índice do que você retorna (9.905 para 9.903 no exemplo do livro). É uma proporção de seletividade que parece ruim de propósito, comprada em troca de eliminar um estágio `SORT`, e vale a pena, porque ordenações em memória escalam com o tamanho do resultado e falham de vez em 32 MB, enquanto leituras extras de chaves escalam de forma suave.
- **Indexar um campo de baixa cardinalidade normalmente não compra nada e ainda custa escritas.** Um booleano ou um enum de dois valores não consegue estreitar uma busca de forma significativa, então você paga o imposto completo de escrita por uma redução de mais ou menos 50% nos documentos examinados. Se um campo assim precisa ser indexado, coloque-o depois de uma chave de alta cardinalidade em um índice composto, em vez de dar a ele um índice próprio.
- **Índices únicos trocam throughput de escrita por uma garantia de corretude, e o caso do null vai morder você.** Exceções de chave duplicada são caras de lançar, então um índice único é uma constraint, não um mecanismo de deduplicação. E como um campo ausente é indexado como `null`, "único" significa em silêncio "no máximo um documento pode omitir este campo", a menos que você acrescente uma `partialFilterExpression`, que por sua vez traz sua própria sutileza, já que documentos fora do filtro parcial ficam invisíveis para qualquer plano que use esse índice.
- **Construir o índice antes de uma carga em massa é mais lento que construí-lo depois.** A nota final do livro ("criar índices sobre documentos existentes é um pouco mais rápido que criar o índice primeiro e depois inserir todos os documentos") sai direto da mecânica da B-tree: um índice preexistente força cada um desses inserts pelo seu próprio caminho de descer e dividir, enquanto uma construção posterior monta a árvore a partir de dados que já estão em disco. Em uma migração ou importação grande, a ordem vale vários minutos.

## Documentation Links

- [Shannon Bradshaw, Eoin Brazil e Kristina Chodorow, "MongoDB: The Definitive Guide", 3ª edição (O'Reilly, 2020): Capítulo 5, "Indexes", p. 96-153](https://www.oreilly.com/library/view/mongodb-the-definitive/9781491954454/): doc
- [MongoDB Documentation: Indexes](https://www.mongodb.com/docs/manual/indexes/): doc
- [MongoDB Documentation: Compound Indexes](https://www.mongodb.com/docs/manual/core/index-compound/): doc
- [MongoDB Documentation: The ESR (Equality, Sort, Range) Rule](https://www.mongodb.com/docs/manual/tutorial/equality-sort-range-guideline/): doc
- [MongoDB Documentation: Analyze Query Performance and explain Results](https://www.mongodb.com/docs/manual/reference/explain-results/): doc
- [MongoDB Documentation: Partial Indexes](https://www.mongodb.com/docs/manual/core/index-partial/): doc
- [MongoDB Documentation: WiredTiger Storage Engine](https://www.mongodb.com/docs/manual/core/wiredtiger/): doc
