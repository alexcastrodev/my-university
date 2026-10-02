---
version: 1.0
updatedAt: 2026-08-20
title: "Consultas no MongoDB: Condicionais, Projeções e Cursores"
summary: Consultar o MongoDB com find (projeções, condicionais $, $in/$or/$not e as armadilhas específicas de tipo em torno de null, arrays e documentos embutidos) e então conduzir o cursor resultante com limit, skip e sort sem cair na paginação com skip grande.
---
## Objective

Ler documentos do MongoDB com `find`: o documento de consulta que decide *quais* documentos voltam, o documento de projeção que decide *quais chaves* voltam, os condicionais `$` que expressam intervalos, conjuntos e negação, e o cursor que o servidor entrega a você em vez de um conjunto de resultados. O fio condutor é que uma consulta no MongoDB é ela mesma um documento, o que a torna expressiva de formas que o SQL não é e silenciosamente surpreendente em alguns pontos (`null`, arrays, documentos embutidos) em que "casar" não significa o que parece significar.

## Use Cases

- Enxugar um caminho de leitura muito usado: passar uma projeção para que um endpoint de lista de usuários envie `username` e `email` em vez do documento de usuário inteiro, reduzindo bytes trafegados e o custo de decodificação de BSON no cliente.
- Montar um relatório por intervalo de datas ("todo mundo que se cadastrou antes de 1º de janeiro de 2007"), em que uma consulta de igualdade exata é inútil porque as datas são guardadas com precisão de milissegundos, então um intervalo com `$lt`/`$gte` é a única forma sensata.
- Migrar um schema no lugar: casar *ou* o antigo `user_id` numérico *ou* o novo username em string em uma única consulta, porque `$in` aceita valores de tipos misturados.
- Diagnosticar por que uma consulta por "x entre 10 e 20" retorna um documento cujo `x` é `[5, 25]`, e recorrer a `$elemMatch` depois de entender o porquê.
- Paginar os resultados de busca de uma loja online (50 por página, ordenados por preço decrescente) e depois reescrever essa paginação quando a página 40 começar a se arrastar.
- Auditar uma base de código em busca de cláusulas `$where`, que são tanto um peso de desempenho quanto uma superfície de execução de código se qualquer parte da expressão for influenciada pelo usuário.

## Deep Dive

### `find`, e a projeção que você quase sempre deveria passar

O primeiro argumento de `find` é um documento que especifica os critérios da consulta. Um documento de consulta vazio (`{}`) casa com tudo, e se `find` não receber um, o padrão é `{}`; então `db.c.find()` retorna todos os documentos de `c`, em lotes. Adicionar pares chave/valor restringe a busca, e vários pares são unidos implicitamente: `db.users.find({"username" : "joe", "age" : 27})` se lê como "condição1 AND condição2 AND … AND condiçãoN."

O segundo argumento é a projeção: as chaves que você quer de volta. O motivo que o livro dá para usá-la é concreto: ela "reduz tanto a quantidade de dados enviados pela rede quanto o tempo e a memória usados para decodificar os documentos no lado do cliente."

```js
// inclusão: só estas chaves (mais o _id)
db.users.find({}, {"username" : 1, "email" : 1})
// { "_id" : ObjectId("4ba0f0dfd22aa494fd523620"),
//   "username" : "joe", "email" : "joe@example.com" }

// o _id volta por padrão, a menos que você o suprima explicitamente
db.users.find({}, {"username" : 1, "_id" : 0})
// { "username" : "joe" }

// exclusão: tudo menos esta chave
db.users.find({}, {"fatal_weakness" : 0})
```

Há uma limitação rígida no próprio documento de consulta: seus valores precisam ser constantes *do ponto de vista do banco* (podem ser variáveis comuns no seu próprio código). Uma consulta não pode se referir a outra chave do mesmo documento, então `db.stock.find({"in_stock" : "this.num_sold"})` simplesmente não funciona. O conselho do livro é reestruturar em vez de recorrer a `$where`: manter `initial_stock` e `in_stock`, decrementar `in_stock` a cada compra e responder a pergunta com um simples `db.stock.find({"in_stock" : 0})`.

### Condicionais de consulta

`$lt`, `$lte`, `$gt`, `$gte` correspondem a `<`, `<=`, `>`, `>=` e se combinam dentro do documento de condição de um campo para formar um intervalo:

```js
db.users.find({"age" : {"$gte" : 18, "$lte" : 30}})

start = new Date("01/01/2007")
db.users.find({"registered" : {"$lt" : start}})
```

`$ne` ("diferente de") funciona com qualquer tipo: `db.users.find({"username" : {"$ne" : "joe"}})`.

### OR de três jeitos, e por que `$in` é melhor que `$or`

`$in` cobre vários valores candidatos para uma *única* chave; `$or` é a forma geral, abrangendo várias chaves.

```js
db.raffle.find({"ticket_no" : {"$in" : [725, 542, 390]}})
db.users.find({"user_id" : {"$in" : [12345, "joe"]}})     // tipos misturados não são problema
db.raffle.find({"ticket_no" : {"$nin" : [725, 542, 390]}}) // o complemento

db.raffle.find({"$or" : [{"ticket_no" : 725}, {"winner" : true}]})
db.raffle.find({"$or" : [{"ticket_no" : {"$in" : [725, 542, 390]}},
                         {"winner" : true}]})              // $or pode aninhar condicionais
```

Duas regras que o livro diz com clareza. Primeiro, a intuição de ordem se inverte entre AND e OR: "Em uma consulta normal do tipo AND, você quer reduzir os resultados o máximo possível com o menor número de argumentos possível. Consultas do tipo OR são o contrário: são mais eficientes se os primeiros argumentos casarem com o maior número possível de documentos." Segundo, "embora `$or` sempre funcione, use `$in` sempre que possível, pois o otimizador de consultas o trata com mais eficiência." Um `$in` de um elemento degenera em um simples teste de igualdade: `{ticket_no : {$in : [725]}}` casa exatamente com o mesmo que `{ticket_no : 725}`.

### `$not` é um metacondicional

`$not` não é uma comparação por si só; ele envolve qualquer outro critério. O livro o demonstra com `$mod`, que casa valores cujo resto da divisão pelo primeiro argumento é igual ao segundo:

```js
db.users.find({"id_num" : {"$mod" : [5, 1]}})              // 1, 6, 11, 16, …
db.users.find({"id_num" : {"$not" : {"$mod" : [5, 1]}}})   // 2, 3, 4, 5, 7, 8, …
```

Sua combinação mais útil é com expressões regulares: "encontre tudo que não casa com este padrão."

### `null` também significa "ausente"

Este é o primeiro lugar em que "casar" não é o que parece. `null` casa consigo mesmo, mas *também* casa com "a chave não existe", então consultar uma chave que nenhum documento da coleção tem retorna a coleção inteira:

```js
db.c.find({"y" : null})   // documentos cujo y realmente é null
db.c.find({"z" : null})   // todos os documentos: nenhum deles tem um z

// só os documentos em que a chave existe E contém null:
db.c.find({"z" : {"$eq" : null, "$exists" : true}})
```

### Expressões regulares

`$regex` (ou um literal `/pattern/` direto) faz casamento de padrões em strings, com flags opcionais:

```js
db.users.find({"name" : {"$regex" : /joe/i}})
db.users.find({"name" : /joey?/i})
```

O MongoDB usa a biblioteca PCRE, então qualquer sintaxe válida em PCRE é válida aqui. O comportamento com índices é a parte que vale memorizar: um índice pode ser aproveitado para expressões regulares de **prefixo** (as ancoradas com `^` ou `\A`, como `/^joey/`), porque a busca se reduz ao intervalo do índice que esse prefixo cria. Índices **não podem** ser usados em buscas que ignoram maiúsculas e minúsculas, como `/^joey/i`. Expressões regulares também podem casar consigo mesmas, se você algum dia guardar uma como valor.

### Arrays se comportam como um saco de escalares, até deixarem de se comportar

Consultar um elemento de array funciona exatamente como consultar um escalar: `db.food.find({"fruit" : "banana"})` casa com `{"fruit" : ["apple", "banana", "peach"]}`. Além disso:

- **`$all`** casa vários elementos independentemente da ordem: `db.food.find({fruit : {$all : ["apple", "banana"]}})` retorna tanto `["apple","banana","peach"]` quanto `["cherry","banana","apple"]`. Um `$all` de um elemento é o mesmo que um casamento simples.
- **Casamento exato de array** é implacável nas duas direções: `{"fruit" : ["apple","banana","peach"]}` casa, `["apple","banana"]` (faltando um elemento) não casa, e `["banana","apple","peach"]` (reordenado) também não.
- **Casamento por posição** usa `key.index`: `db.food.find({"fruit.2" : "peach"})`, com índice a partir de 0, então este é o terceiro elemento.
- **`$size`** casa arrays de um tamanho exato e *não pode ser combinado com outro condicional `$`*. O contorno do livro é manter o tamanho por conta própria: troque `{"$push" : {"fruit" : "strawberry"}}` por `{"$push" : {"fruit" : "strawberry"}, "$inc" : {"size" : 1}}` e então consulte o intervalo `{"size" : {"$gt" : 3}}`. Incrementar é rápido o suficiente para que a penalidade seja desprezível, mas o truque não funciona bem com `$addToSet`, que pode ou não adicionar de fato.
- **`$slice`** é um operador de *projeção*: `{"comments" : {"$slice" : 10}}` para os 10 primeiros, `-10` para os 10 últimos, `[23, 10]` para pular 23 e retornar do 24º ao 33º. Note a assimetria: diferente de todo outro especificador de projeção, `$slice` não suprime as chaves não mencionadas, então `title` e `content` continuam voltando junto com o `comments` fatiado.
- **`comments.$`** retorna o elemento do array que casou com o critério, mas só o *primeiro* casamento por documento.

E então a borda afiada. Escalares precisam satisfazer todas as cláusulas de um documento de critérios, mas um array satisfaz a consulta se *algum* elemento casar com cada cláusula, possivelmente um elemento diferente por cláusula:

```js
// documentos: {"x":5} {"x":15} {"x":25} {"x":[5,25]}
db.test.find({"x" : {"$gt" : 10, "$lt" : 20}})
// {"x" : 15}
// {"x" : [5, 25]}   <-- 25 satisfaz $gt:10, 5 satisfaz $lt:20
```

O veredito do livro: "Isso torna consultas por intervalo sobre arrays essencialmente inúteis: um intervalo vai casar com qualquer array de vários elementos." Duas correções. `$elemMatch` força as duas cláusulas a um único elemento do array, ao custo de não casar mais com campos que não são arrays, então `{"x" : 15}` sai do resultado. Ou, se o campo for indexado, limite explicitamente a leitura do índice:

```js
db.test.find({"x" : {"$gt" : 10, "$lt" : 20}}).min({"x" : 10}).max({"x" : 20})
// {"x" : 15}
```

`min`/`max` exigem um índice no campo consultado, e você precisa passar *todos* os campos desse índice. O motivo de isso importar além da corretude: "Os limites de índice de uma consulta `$gt`/`$lt` sobre um array são ineficientes. Eles basicamente aceitam qualquer valor, então a busca percorre todas as entradas do índice, não só as que estão no intervalo."

### Documentos embutidos: notação de ponto, não casamento do documento inteiro

Casar um subdocumento inteiro exige um casamento *exato*: mesmas chaves, mesma ordem. `{"name" : {"first" : "Joe", "last" : "Schmoe"}}` quebra no momento em que o Joe acrescenta um nome do meio, e `{"last" : "Schmoe", "first" : "Joe"}` nem casa, porque a comparação é sensível à ordem. A notação de ponto sobrevive à evolução do schema:

```js
db.people.find({"name.first" : "Joe", "name.last" : "Schmoe"})
```

A notação de ponto é a principal diferença estrutural entre documentos de consulta e documentos armazenados, e o motivo de documentos inseridos não poderem conter `.` em uma chave. (As pessoas esbarram nisso ao tentar usar URLs como chaves; o contorno habitual é uma substituição global de `.` na entrada e na saída.)

Para arrays de subdocumentos, as duas consultas óbvias estão erradas. `{"comments" : {"author" : "joe", "score" : {"$gte" : 5}}}` falha porque o casamento de subdocumento inteiro exige todas as chaves, inclusive `comment`. `{"comments.author" : "joe", "comments.score" : {"$gte" : 5}}` falha de outra forma: a cláusula de autor pode casar com um comentário enquanto a cláusula de nota casa com outro. `$elemMatch` é o único agrupamento correto:

```js
db.blog.find({"comments" : {"$elemMatch" :
                            {"author" : "joe", "score" : {"$gte" : 5}}}})
```

`$elemMatch` só é necessário quando há mais de uma chave para casar dentro do documento embutido.

### `$where`: JavaScript arbitrário, e por que o livro manda evitá-lo

`$where` executa uma função JavaScript por documento; retorne `true` e o documento entra no conjunto de resultados. Seu uso canônico é aquilo que a linguagem de consulta estruturalmente não consegue expressar: comparar dois campos do mesmo documento (o problema de `in_stock` vs. `num_sold` de antes).

O livro o sinaliza nos dois eixos, sem que ninguém pergunte. Segurança: "Por segurança, o uso de cláusulas `$where` deveria ser altamente restrito ou eliminado. Usuários finais nunca deveriam poder executar cláusulas `$where` arbitrárias." Desempenho: "Consultas `$where` não deveriam ser usadas a menos que estritamente necessário: elas são muito mais lentas que consultas normais. Cada documento precisa ser convertido de BSON para um objeto JavaScript e então passar pela expressão `$where`. Índices também não podem ser usados para satisfazer um `$where`." Se você está preso a um, combine-o com filtros de consulta comuns, para que um índice possa pré-filtrar e o JavaScript só faça o ajuste fino do que sobreviveu.

O livro também dá a saída: o MongoDB 3.6 adicionou `$expr`, que traz expressões de agregação para a linguagem de consulta, não executa JavaScript e é "recomendado como substituto deste operador sempre que possível."

### Cursores são preguiçosos, encadeáveis, em lotes e mortais

`find` retorna um cursor, não um conjunto de resultados, e chamar `find` nem conversa com o servidor ainda. Ele espera até você começar a pedir resultados, e é isso que faz o encadeamento funcionar: quase todo método de cursor retorna o próprio cursor, então estes são todos idênticos:

```js
var cursor = db.foo.find().sort({"x" : 1}).limit(1).skip(10);
var cursor = db.foo.find().limit(1).sort({"x" : 1}).skip(10);
var cursor = db.foo.find().skip(10).limit(1).sort({"x" : 1});
```

A consulta só vai para o servidor no primeiro `hasNext()`. Nesse ponto o shell busca os primeiros 100 resultados ou os primeiros 4 MB, o que for menor, então as chamadas seguintes de `next()`/`hasNext()` são locais; quando esse lote acaba, o shell emite um `getMore` para o próximo, repetindo até o cursor se esgotar. Você itera com `hasNext()`/`next()`, ou pela interface de iterador do JavaScript com `forEach`.

`limit` é apenas um limite superior (menos documentos casando simplesmente retornam menos documentos), `skip` descarta do início, e `sort` recebe um documento de chave/direção em que `1` é ascendente e `-1` descendente, aplicado da esquerda para a direita: `db.c.find().sort({username : 1, age : -1})`. Combinados, eles dão a forma de paginação de manual:

```js
db.stock.find({"desc" : "mp3"}).limit(50).sort({"price" : -1})           // página 1
db.stock.find({"desc" : "mp3"}).limit(50).skip(50).sort({"price" : -1})  // página 2
```

Quando uma chave guarda tipos misturados, a ordenação recorre a uma ordem fixa entre tipos, do menor para o maior: valor mínimo, null, números (inteiros, longs, doubles, decimais), strings, objeto/documento, array, dados binários, object ID, booleano, data, timestamp, expressão regular, valor máximo.

**Evitando skips grandes.** Skips pequenos não são problema; grandes são, "já que ele precisa encontrar e depois descartar todos os resultados pulados. A maioria dos bancos guarda mais metadados no índice para ajudar com skips, mas o MongoDB ainda não suporta isso." A correção é a paginação por keyset: levar a chave de ordenação do último documento para a próxima consulta em vez de contar linhas a pular:

```js
var page1 = db.foo.find().sort({"date" : -1}).limit(100)
// …itera page1, guardando `latest`…
var page2 = db.foo.find({"date" : {"$lt" : latest.date}});
page2.sort({"date" : -1}).limit(100);
```

O mesmo raciocínio derruba a receita ingênua de "documento aleatório" (`count()`, depois `skip(Math.floor(Math.random()*total)).limit(1)`): um count caro mais um skip grande. A alternativa do livro é guardar um campo `random : Math.random()` no insert e consultar `{"random" : {"$gt" : random}}`, recorrendo a `$lte` quando o sorteio cair acima de todos os valores guardados, com `random` como último campo de um índice composto (`{"profession" : 1, "state" : 1, "random" : 1}`) para que ele se combine com filtros reais.

**Cursores imortais.** No lado do servidor, um cursor ocupa memória e recursos. Ele morre de uma de três formas: termina de iterar; o cursor do lado do cliente sai de escopo e o driver envia uma mensagem para matá-lo; ou passam 10 minutos de inatividade e o banco o encerra por timeout. Esta última é uma rede de segurança para clientes que travaram ou têm bugs. Os drivers expõem uma opção do tipo `immortal` para desativar o timeout em cursores que de fato vivem muito, e se você usá-la, "precisa iterar por todos os resultados ou matá-lo para garantir que ele seja fechado. Caso contrário, ele vai ficar parado no banco consumindo recursos até o servidor ser reiniciado."

### Livro vs. hoje

A semântica de consulta deste capítulo é estável: `$in`/`$or`/`$not`/`$elemMatch`, a regra de `null` casar com ausente, a armadilha das consultas por intervalo em arrays, a ordem de ordenação entre tipos e os avisos sobre `$where` continuam se lendo como documentação atual. Três detalhes de superfície mudaram desde o livro (2019/2020, escrito sobre o MongoDB 4.2), e nenhum deles muda as ideias acima:

> Os números de lote do lado do shell no livro ("primeiros 100 resultados ou primeiros 4 MB") agora são documentados do lado do servidor como um lote inicial de **101 documentos**, com lotes `getMore` subsequentes limitados apenas pelo tamanho máximo de mensagem de 16 MB. O mecanismo (uma primeira ida ao servidor preguiçosa, depois `getMore` até esgotar) não mudou.

> O trecho do contorno de `$size` usa `db.food.update(...)`, e a seção de documento aleatório usa `db.people.ensureIndex(...)` e `db.foo.count()`. As três são grafias legadas hoje: `updateOne`/`updateMany`, `createIndex` e `countDocuments`/`estimatedDocumentCount`. É uma renomeação, não uma mudança de comportamento, e em outros pontos o mesmo capítulo já usa os modernos `insertOne`/`findOne`.

> Para "me dê um documento aleatório", o estágio de agregação `{$sample : {size : 1}}` é o idioma atual e faz o trabalho sem o truque da chave aleatória armazenada. Esse estágio não é mencionado em nenhum lugar do capítulo, então trate a receita do livro como um padrão de consulta indexada que vale entender, e não como a primeira coisa a usar.

## Trade-offs

- **`$where` é o único operador deste capítulo com uma questão de segurança, não só de desempenho.** Ele executa JavaScript arbitrário no servidor, por documento, depois de uma conversão de BSON para JavaScript, e nenhum índice consegue satisfazê-lo, então o custo escala com todo o conjunto de candidatos. A própria orientação do livro é restringi-lo ou eliminá-lo e nunca deixar usuários finais fornecerem um. `$expr` cobre a motivação comum (comparar dois campos do mesmo documento) sem nenhum JavaScript; os casos residuais em que só `$where` funciona são raros o bastante para que encontrar um em code review normalmente seja um cheiro de schema, e a reestruturação `initial_stock`/`in_stock` é a correção real.
- **`skip()` grande degrada exatamente como o `OFFSET` do SQL, exatamente pelo mesmo motivo.** Os dois precisam produzir e descartar todas as linhas puladas antes de retornar qualquer coisa, então a página 400 custa aproximadamente 400 páginas de trabalho. O livro é explícito ao dizer que o MongoDB não guarda os metadados de índice que tornariam isso mais barato. É a mesma armadilha tratada no lado relacional em [SQL: Pagination, Top-N, and Extremes per Group](/database-concepts/sql-pagination-top-n-and-extremes-per-group), e a saída é a mesma nos dois mundos: paginação por keyset (seek) na chave de ordenação, levando `$lt : latest.date` (ou `WHERE date < :last_seen`) em vez de um offset. A troca que você aceita é que a paginação por keyset não consegue pular para um número de página arbitrário e precisa de uma chave de ordenação realmente única para evitar linhas puladas ou duplicadas nas fronteiras das páginas.
- **A conveniência de "arrays são consultados como escalares" é paga com consultas por intervalo que casam demais em silêncio.** `{"x" : {"$gt" : 10, "$lt" : 20}}` retornando `[5, 25]` não é um bug, é o casamento de elementos por cláusula documentado, mas significa que qualquer array de vários elementos casa com quase qualquer intervalo. `$elemMatch` corrige a corretude e *quebra* campos mistos de escalar/array ao excluir os que não são arrays; `min`/`max` corrigem sem esse efeito colateral, mas exigem um índice e todos os seus campos. A correção mais barata normalmente está antes: não misture escalares e arrays no mesmo campo.
- **`null` confundir "é nulo" com "está ausente" é uma decisão de modelagem real, não só uma pegadinha.** Em um schema relacional fixo, `NULL` e "essa coluna não existe" não podem ser confundidos; em um schema dinâmico eles colapsam no mesmo resultado de consulta. Se a distinção importa para o seu domínio ("perguntamos e a pessoa não respondeu" contra "nunca perguntamos"), a forma `{"$eq" : null, "$exists" : true}` precisa estar na consulta, e toda consulta escrita por alguém que esqueceu disso vai retornar silenciosamente o conjunto errado.
- **Tudo neste capítulo é escrito às cegas: ainda não há visibilidade do planejador de consultas.** Você só sabe que `$in` é mais bem otimizado que `$or`, que regexes de prefixo podem usar um índice e as case-insensitive não, e que `$gt`/`$lt` sobre arrays percorre todas as entradas do índice porque o livro diz isso. Nada aqui mostra qual índice uma consulta de fato escolheu ou quantos documentos ela examinou para retornar dez. É para isso que servem os índices e o `explain()` (veja [MongoDB Indexing Fundamentals and Compound Indexes](/database-concepts/mongodb-indexing-fundamentals)), e é por isso que os conselhos de desempenho deste capítulo deveriam ser tratados como heurísticas a verificar, não como medições.
- **Projeções são quase de graça para adicionar e fáceis de esquecer.** A justificativa do livro são os bytes trafegados mais o tempo de decodificação no cliente, ambos escalando com o tamanho do documento, então o retorno é maior justamente nos documentos largos que um schema dinâmico incentiva. A única exceção a "projeções estreitam o resultado" é `$slice`, que também retorna todas as outras chaves; misturá-lo com especificadores de inclusão sem saber disso produz documentos mais gordos do que o pretendido.

## Documentation Links

- [Shannon Bradshaw, Eoin Brazil e Kristina Chodorow, "MongoDB: The Definitive Guide", 3ª edição (O'Reilly, 2020): Capítulo 4, "Querying", p. 74-93](https://www.oreilly.com/library/view/mongodb-the-definitive/9781491954454/): doc
- [MongoDB Documentation: Query Documents](https://www.mongodb.com/docs/manual/tutorial/query-documents/): doc
- [MongoDB Documentation: Query and Projection Operators](https://www.mongodb.com/docs/manual/reference/operator/query/): doc
- [MongoDB Documentation: Iterate a Cursor](https://www.mongodb.com/docs/manual/tutorial/iterate-a-cursor/): doc
- [MongoDB Documentation: BSON Comparison Order](https://www.mongodb.com/docs/manual/reference/bson-type-comparison-order/): doc
- [MongoDB Documentation: $where](https://www.mongodb.com/docs/manual/reference/operator/query/where/): doc
