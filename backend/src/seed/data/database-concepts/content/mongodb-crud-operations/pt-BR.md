---
version: 1.0
updatedAt: 2026-08-20
title: "Escritas no MongoDB: Inserts, Operadores de Update, Upserts, e Deletes"
summary: O caminho de escrita do MongoDB é insertOne/insertMany, deleteOne/deleteMany/drop, e updateOne/updateMany/replaceOne, e as decisões que de fato mordem são substituição versus operadores $, batches ordenados versus não ordenados, e se upsert silenciosamente transforma uma correspondência falha em um documento totalmente novo.
---
## Objective

Entender o caminho de escrita do MongoDB: `insertOne`/`insertMany`, `deleteOne`/`deleteMany`/`drop`, e `updateOne`/`updateMany`/`replaceOne`, e, acima de tudo, a única distinção que causa mais dano na prática: se o segundo argumento de uma escrita é um *documento de substituição* ou um *documento modificador* feito de operadores `$`. Pelo caminho: o que um upsert de fato faz (constrói o novo documento a partir do seu filtro mais seus modificadores), e por que `findOneAndUpdate` existe, em vez de "consultar, depois atualizar".

## Use Cases

- Carregar em massa alguns milhares de documentos em uma ida e volta com `insertMany`, em vez de um insert por documento, e escolher ordenado versus não ordenado, para que um documento ruim não descarte silenciosamente o resto do lote.
- Incrementar um contador (visualizações de página, pontuação, karma, contagem de voto) sem um ciclo de ler-modificar-escrever na aplicação: `$inc` se aplica do lado do servidor e atomicamente, então requisições concorrentes não perdem atualizações.
- Escritas idempotentes de "registre este evento, criando a linha se for a primeira": um upsert colapsa `findOne` + branch + `insertOne`/`update` em uma declaração atômica e remove a corrida onde dois processos ambos decidem que o documento ainda não existe.
- Migração de schema em dado vivo: `replaceOne` para reestruturar um documento por completo, `updateMany` com `$set` para lançar um campo novo para todo documento correspondendo a um filtro.
- Fila de trabalho / reivindicação de trabalho: `findOneAndUpdate` com um `sort` reivindica atomicamente o item pendente de maior prioridade e o entrega a exatamente um worker.

## Deep Dive

### Inserindo: `insertOne`, `insertMany`, e batches ordenados versus não ordenados

`insertOne` adiciona um único documento e, se você não forneceu um, adiciona uma chave `_id` antes de armazená-lo:

```js
db.movies.insertOne({"title" : "Stand by Me"})
```

`insertMany` recebe um array e o insere em massa: o ponto do livro é idas e voltas: seu código faz uma ida ao servidor, em vez de uma por documento, e "enviar dezenas, centenas, ou até milhares de documentos de uma vez pode tornar inserts significativamente mais rápidos." O shell ecoa de volta um array `insertedIds` dos `ObjectId`s gerados.

O segundo parâmetro é um documento de opções, e a chave interessante é `ordered`. **Ordenado é o padrão.** Com inserts ordenados, o array define ordem de inserção e *nada além da primeira falha é inserido*. O exemplo do livro insere quatro filmes onde o terceiro reutiliza `"_id" : 1`:

```js
db.movies.insertMany([
  {"_id" : 0, "title" : "Top Gun"},
  {"_id" : 1, "title" : "Back to the Future"},
  {"_id" : 1, "title" : "Gremlins"},          // duplicate _id
  {"_id" : 2, "title" : "Aliens"}])
```

Isso lança um `BulkWriteError` com `code: 11000` (`E11000 duplicate key error`) em `"index" : 2`, e reporta `"nInserted" : 2`: "Aliens" nunca entrou, mesmo não tendo nada de errado com ele. Rode a mesma forma novamente com `{"ordered" : false}` e o MongoDB tenta todo documento independentemente: mesmo erro de escrita de chave duplicada no índice 2, mas `"nInserted" : 3`. Não ordenado também permite ao MongoDB reordenar os inserts para aumentar performance.

O livro observa que o lote tem teto de tamanho: "versões atuais do MongoDB não aceitam mensagens maiores do que 48 MB", e muitos drivers dividem um lote de tamanho excessivo em múltiplos batch inserts de 48 MB para você. Também aponta que `insertMany` é só-insert: agrupar tipos *diferentes* de operação juntos é a API separada de Bulk Write, fora de escopo para o capítulo.

### Validação de insert é mínima de propósito

O MongoDB "faz checagens mínimas no dado sendo inserido: checa a estrutura básica do documento e adiciona um campo `_id` se um não existe." A checagem estrutural principal é tamanho: **todo documento precisa ser menor do que 16 MB**, um limite que o livro chama de "meio arbitrário", pretendido para prevenir mau design de schema e manter performance consistente. Para escala, a régua do livro é que o texto inteiro de *Guerra e Paz* tem 3,14 MB. `Object.bsonsize(doc)` imprime o tamanho BSON de um documento em bytes a partir do shell.

A consequência que o livro tira de "checagens mínimas" é de segurança, não de modelagem: é fácil inserir dado inválido se você está tentando, então **só fontes confiáveis, seus servidores de aplicação, deveriam conseguir se conectar ao banco de dados.** Os drivers, não o servidor, são o que rejeita documentos de tamanho excessivo, strings não-UTF-8, e tipos não reconhecidos antes de qualquer coisa ser enviada.

### Removendo: `deleteOne`, `deleteMany`, e `drop`

Ambos recebem um documento de filtro como o primeiro parâmetro. `deleteOne({"_id" : 4})` retorna `{ "acknowledged" : true, "deletedCount" : 1 }`. A borda afiada é um filtro que corresponde a mais de um documento: `deleteOne` deleta *o primeiro documento encontrado*, e qual é esse "depende de vários fatores, incluindo a ordem em que os documentos foram inseridos, quais atualizações foram feitas nos documentos (para alguns motores de armazenamento), e quais índices são especificados": ou seja, não é algo sobre o qual você deveria raciocinar, apenas algo com o que você deveria evitar contar.

`deleteMany` remove tudo que corresponde, incluindo `deleteMany({})` para a collection inteira. Mas se o objetivo é uma collection vazia, `drop()` é mais rápido, ao custo de precisar recriar os índices da collection depois. De qualquer forma: "uma vez que dado foi removido, ele se foi para sempre." Não há desfazer, a não ser restaurar um backup.

### Substituição de documento versus operadores de update

Três métodos de update, e a diferença está inteiramente no segundo argumento:

- `replaceOne(filter, doc)`: o segundo argumento é um **documento inteiro** que substitui a correspondência.
- `updateOne(filter, modifiers)` / `updateMany(filter, modifiers)`: o segundo argumento é um **documento modificador** de operadores `$` descrevendo mudanças.

Atualizar um documento é atômico: se duas atualizações chegam de uma vez, qualquer uma que alcance o servidor primeiro é aplicada, depois a próxima: "a última atualização vai 'vencer'", sem corrupção de documento. (Se last-write-wins não é o que você quer, o livro aponta para o padrão de design de schema Document Versioning.)

`replaceOne` é a ferramenta para uma reestruturação por completo: o exemplo do livro puxa um documento de usuário para o shell, move `friends`/`enemies` para um subdocumento `relationships`, renomeia `name` para `username`, e escreve o objeto remodelado de volta. Sua armadilha vale a pena memorizar:

```js
// three documents all have {"name" : "joe"}
joe = db.people.findOne({"name" : "joe", "age" : 20});
joe.age++;
db.people.replaceOne({"name" : "joe"}, joe);   // E11001 duplicate key on update
```

O filtro correspondeu ao Joe de *65 anos* primeiro, e o MongoDB tentou sobrescrevê-lo com um documento carregando um `_id` existente diferente. O conserto é sempre filtrar por algo único, geralmente `_id`, que também é o filtro mais eficiente, já que valores de `_id` sustentam o índice primário da collection.

Para tudo menos uma reestruturação completa, use operadores de update. `$inc` em um contador de visualização de página é o exemplo canônico:

```js
db.analytics.updateOne({"url" : "www.example.com"}, {"$inc" : {"pageviews" : 1}})
// { "acknowledged" : true, "matchedCount" : 1, "modifiedCount" : 1 }
```

Os operadores que o capítulo cobre:

| Operador | Comportamento que vale a pena lembrar |
|---|---|
| `$set` | Define um campo, **criando-o se ausente**, e pode mudar o *tipo* do campo: o livro transforma uma string `"favorite book"` em um array com um único `$set`. Alcança dentro de subdocumentos por caminho com ponto (`"author.name"`). |
| `$unset` | Remove a chave completamente: `{"$unset" : {"favorite book" : 1}}`. |
| `$inc` | Cria a chave definida com o valor de incremento se ausente (`score` vai `0 → 50 → 10050` no exemplo de pinball). Funciona **só** em integer, long, double, ou decimal; aplicá-lo a uma string `"1"` falha com o código `16837`, "Cannot apply $inc to a value of non-numeric type", e o próprio valor de incremento precisa ser um número. |
| `$push` | Anexa a um array, criando o array se não existe. Modificadores: `$each` (empurra vários), `$slice` com um valor negativo (limita o array: `-10` mantém uma fila "top 10"), `$sort` (ordena antes de aparar). `$slice` e `$sort` exigem `$each`; você não pode usá-los sozinhos. |
| `$addToSet` | Empurra-se-ausente, tratando o array como um set. Combina com `$each` para adicionar vários valores únicos de uma vez: algo que o idioma mais antigo `{"$ne" : ...}` mais `$push` não consegue fazer. |
| `$pop` | `{"$pop" : {"key" : 1}}` do fim, `-1` do início. |
| `$pull` | Remove **todo** elemento correspondente, não só o primeiro: puxar `1` de `[1, 1, 2, 1]` deixa `[2]`. |
| `$setOnInsert` | Aplica-se só quando um upsert de fato insere (veja abaixo). |

Duas regras que cobrem a maioria dos erros de iniciante. Primeiro, **você sempre precisa usar um modificador `$`** para adicionar, mudar, ou remover chaves: `updateOne({"author.name" : "joe"}, {"author.name" : "joe schmoe"})` é um erro, e o livro é explícito de que isso foi a motivação para a API CRUD atual: "versões anteriores da API CRUD não capturavam esse tipo de erro. Métodos de update mais antigos simplesmente completariam uma substituição de documento inteira em tais situações." Segundo, operadores de array só funcionam em chaves com valor de array; use `$set`/`$inc` para escalares.

Para edições posicionais de array há três níveis. Um índice literal funciona como um caminho com ponto (`"comments.0.votes"`), mas você raramente sabe o índice sem consultar primeiro. O operador posicional `$` preenche o índice que o *filtro* correspondeu, e atualiza **só a primeira correspondência**, então um usuário com dois comentários tem um deles renomeado:

```js
db.blog.updateOne({"comments.author" : "John"}, {"$set" : {"comments.$.author" : "Jim"}})
```

O MongoDB 3.6 adicionou `arrayFilters` para "todo elemento correspondendo a um predicado", que é o que o operador posicional não consegue expressar:

```js
db.blog.updateOne(
   {"post" : post_id },
   { $set: { "comments.$[elem].hidden" : true } },
   { arrayFilters: [ { "elem.votes": { $lte: -5 } } ] }
)
```

### Upserts: o que de fato constroem

"Se nenhum documento é encontrado correspondendo ao filtro, um novo documento vai ser criado combinando o critério e os documentos atualizados. Se um documento correspondente é encontrado, ele vai ser atualizado normalmente." Upsert é o `upsert: true` do terceiro parâmetro, e seu valor é que remove tanto a ida e volta quanto a corrida na versão checar-então-agir:

```js
// the version an upsert replaces — one read, one write, and a race between processes
blog = db.analytics.findOne({url : "/blog"})
if (blog) { blog.pageviews++; db.analytics.save(blog); }
else      { db.analytics.insertOne({url : "/blog", pageviews : 1}) }

// the same thing, "faster and atomic"
db.analytics.updateOne({"url" : "/blog"}, {"$inc" : {"pageviews" : 1}}, {"upsert" : true})
```

A parte de "combinar o critério e os documentos atualizados" não é decoração: o novo documento é *construído a partir do filtro*, e então os modificadores são aplicados por cima. O exemplo do livro é incomumente instrutivo: `db.users.updateOne({"rep" : 25}, {"$inc" : {"rep" : 3}}, {"upsert" : true})` em uma collection vazia cria um documento com `rep: 25` a partir do filtro e então o incrementa, deixando `rep: 28`. Rode o comando idêntico de novo e ele insere *outro* documento, porque o filtro `{"rep" : 25}` não corresponde ao documento que acabou de criar, cujo `rep` agora é 28.

`$setOnInsert` cobre "defina este campo quando criado, nunca o toque de novo":

```js
db.users.updateOne({}, {"$setOnInsert" : {"createdAt" : new Date()}}, {"upsert" : true})
```

A primeira execução insere e marca `createdAt`. A segunda execução corresponde (`matchedCount: 1`, `modifiedCount: 0`) e deixa o timestamp original em paz. O livro adiciona uma ressalva sobre seu próprio exemplo: geralmente você não precisa de um campo `createdAt` de forma alguma, já que `ObjectId`s já embutem um timestamp de criação; `$setOnInsert` se justifica para preenchimento, inicializar contadores, e collections que não usam `ObjectId`s.

### Atualizando muitos documentos, e obtendo o documento de volta

`updateOne` modifica só a primeira correspondência; `updateMany` recebe os mesmos parâmetros com a mesma semântica e modifica todas elas: o livro o enquadra como a ferramenta de migração de schema e lançamento de recurso (`updateMany({"birthday" : "10/13/1978"}, {"$set" : {"gift" : "Happy Birthday!"}})` retornando `matchedCount: 3, modifiedCount: 3`).

Quando você precisa do documento de volta atomicamente, o ponto é uma corrida que o capítulo percorre em detalhe. Reivindicar um trabalho por "encontre o processo `READY` de maior prioridade, depois atualize-o para `RUNNING`" permite que duas threads leiam o mesmo documento antes de qualquer uma escrever, então ambas rodam o mesmo job. Protegê-lo rechecando `"status" : "READY"` dentro do filtro de update e fazendo loop funciona, mas "se torna complexo", e pode degenerar em uma thread fazendo todo o trabalho, enquanto outra inutilmente a persegue.

`findOneAndUpdate` faz a coisa toda em uma operação:

```js
db.processes.findOneAndUpdate(
   {"status" : "READY"},
   {"$set" : {"status" : "RUNNING"}},
   {"sort" : {"priority" : -1}, "returnNewDocument": true})
```

Repare no padrão: **`findOneAndUpdate` retorna o documento como ele estava *antes* da modificação.** Sem `returnNewDocument: true`, o documento retornado ainda mostra `"status" : "READY"`, que se lê como se a atualização tivesse falhado silenciosamente. `findOneAndReplace` se comporta da mesma forma em torno de uma substituição; `findOneAndDelete` não recebe documento de update e retorna o deletado.

O MongoDB 3.2 introduziu esses três métodos para substituir `findAndModify`, que o livro chama de "propenso a erro de usuário, porque é um método complexo combinando a funcionalidade de três tipos diferentes de operação: delete, replace, e update (incluindo upserts)." O MongoDB 4.2 estendeu `findOneAndUpdate` para aceitar um pipeline de agregação como o update, limitado a `$addFields` (alias `$set`), `$project` (alias `$unset`), e `$replaceRoot` (alias `$replaceWith`).

### Book vs. today: o shell mudou, os operadores não

A *semântica* do capítulo se sustentou: `$set`, `$inc`, `$push`/`$each`/`$slice`/`$sort`, `$addToSet`, `$pop`, `$pull`, `$setOnInsert`, `arrayFilters`, `ordered`, e `upsert` todos funcionam exatamente como escritos. O livro já estava afastando leitores dos nomes legados: diz explicitamente que `insert` e `remove` antecedem a API CRUD da 3.0 e "não deveriam ser usados em aplicações daqui para frente." Três diferenças desde 2019 valem a pena conhecer:

> **O próprio shell foi substituído.** As transcrições do livro (saída `WriteResult({...})`, `db.collection.save()`) vêm do shell `mongo` legado, que foi depreciado no MongoDB 5.0 e **removido no MongoDB 6.0** em favor do `mongosh`. O `mongosh` ainda aceita `insert()`, `update()`, `remove()`, e `save()`, mas a própria página de compatibilidade do MongoDB agora lista todos os quatro como **depreciados** com substitutos nomeados: então o helper de shell `save` que o livro apresenta como uma conveniência é um método para ler em código antigo, não um para escrever hoje. Seus substitutos documentados são `insertOne`/`insertMany`/`updateOne`/`updateMany`/`findOneAndUpdate`; o livro já mostra o equivalente direto, `replaceOne({"_id" : x._id}, x)`.

> **`returnNewDocument` ganhou uma grafia mais clara.** O `{"returnNewDocument": true}` do livro ainda funciona, mas o MongoDB atual documenta `returnDocument: "before" | "after"` como a alternativa (adicionada no `mongosh` 0.13.2, e a grafia que os drivers de linguagem usam). Se ambos são definidos, `returnDocument` vence. Isso é uma renomeação com um shim de compatibilidade, não uma depreciação, mas código novo deveria usar `returnDocument`.

> **O limite de lote agora é documentado como uma contagem de escrita, não uma contagem de bytes.** As "mensagens de 48 MB" do livro ainda são o teto do protocolo de fio, mas a página atual de *Operational Limits* enquadra a regra voltada ao usuário como um máximo de **100.000 escritas em um único lote**, com o driver dividindo qualquer coisa maior em grupos menores. O limite de 16 MB por documento, que o livro chama de "meio arbitrário (e pode ser aumentado no futuro)", não mudou: ainda é 16 MB.

## Trade-offs

- **Upserts só são idempotentes se o filtro corresponder ao que os modificadores produzem.** O exemplo `{"rep" : 25}` + `{"$inc" : {"rep" : 3}}` é todo o perigo em três linhas: rodá-lo de novo não atualiza o documento que criou, cria um segundo, porque o filtro não corresponde mais ao documento depois de sua própria modificação. Um upsert cujas chaves de filtro também são mutadas pelo update é um gerador de documento duplicado, não uma escrita idempotente. Filtros de upsert deveriam ser só em campos de identidade estáveis.
- **`upsert: true` silenciosamente converte "eu queria atualizar um documento existente" em "eu criei um novo".** Um `updateOne` simples com um erro de digitação no filtro retorna `matchedCount: 0`: um sinal alto, checável, de que algo está errado. Adicione `upsert: true` e o mesmo erro de digitação insere um documento novo, meio populado, construído a partir do filtro errado, e a escrita reporta sucesso. A conveniência de não precisar semear sua collection é paga com a perda do modo de falha "nada correspondeu".
- **Substituição versus modificador é uma diferença de um caractere com um raio de impacto de documento inteiro.** `replaceOne(filter, doc)` descarta todo campo não presente em `doc`; `updateOne(filter, {$set: {...}})` só toca no que você nomeia. O próprio relato do livro de *por que* a API CRUD foi redesenhada é que o método `update` anterior, recebendo um documento sem operadores `$`, realizava uma substituição completa, em vez de dar erro: que é exatamente como campos desaparecem. `updateOne` agora rejeita um documento de update sem operador; `replaceOne` vai alegremente fazer o que você literalmente pediu.
- **Cada escrita é atômica em um documento; nada aqui é atômico através de documentos.** `$inc` em um único contador é seguro sob concorrência sem nenhum locking de aplicação, e `findOneAndUpdate` genuinamente elimina a corrida de reivindicar-um-trabalho. Mas `updateMany` através de três documentos é três escritas atômicas separadas, não uma transação: um leitor pode observar a collection no meio do caminho, e uma falha no meio deixa os documentos anteriores mudados. Atomicidade multi-documento exige uma transação MongoDB explícita, que é um recurso diferente com um custo diferente.
- **Inserts ordenados falham seguro; inserts não ordenados falham rápido, e perdem dados diferentes.** Ordenado para no primeiro erro, então um documento ruim no índice 2 de 10.000 silenciosamente descarta 9.997 bons. Não ordenado insere tudo que é válido e reporta as falhas, mas o MongoDB pode reordenar o lote, então você não pode contar com ordem de inserção para nada downstream. De qualquer forma, `insertMany` lança em falha parcial: inspecionar `nInserted` e o array `writeErrors` importa mais do que capturar a exceção.
- **`deleteOne` com um filtro não único é comportamento indefinido na prática.** Qual documento é escolhido depende de ordem de inserção, atualizações anteriores, e os índices disponíveis. O mesmo raciocínio se aplica a `updateOne` e `findOneAndUpdate`: um filtro que corresponde a múltiplos documentos torna a *escolha* um detalhe de implementação, e só `_id` (ou uma chave genuinamente única) torna a operação determinística.
- **`drop()` é mais rápido do que `deleteMany({})`, e ambos são irreversíveis.** `drop` também leva os índices da collection junto, então qualquer índice do qual a carga de trabalho depende precisa ser recriado na collection agora vazia. Não há desfazer para nenhum dos dois; recuperação significa restaurar um backup.

## Documentation Links

- [Shannon Bradshaw, Eoin Brazil, and Kristina Chodorow, "MongoDB: The Definitive Guide", 3rd Edition (O'Reilly, 2020), Chapter 3, "Creating, Updating, and Deleting Documents", p. 29-51](https://www.oreilly.com/library/view/mongodb-the-definitive/9781491954454/) - doc
- [MongoDB Documentation, Insert Documents](https://www.mongodb.com/docs/manual/tutorial/insert-documents/) - doc
- [MongoDB Documentation, Update Documents](https://www.mongodb.com/docs/manual/tutorial/update-documents/) - doc
- [MongoDB Documentation, db.collection.findOneAndUpdate() (returnDocument vs. returnNewDocument)](https://www.mongodb.com/docs/manual/reference/method/db.collection.findOneAndUpdate/) - doc
- [MongoDB Documentation, $setOnInsert](https://www.mongodb.com/docs/manual/reference/operator/update/setOnInsert/) - doc
- [mongosh Documentation, Compatibility Changes with Legacy mongo Shell (deprecated insert/update/remove/save)](https://www.mongodb.com/docs/mongodb-shell/reference/compatibility/) - doc
- [MongoDB Documentation, Operational Limits (16 MB BSON document, 100,000 writes per batch)](https://www.mongodb.com/docs/manual/reference/limits/) - doc
