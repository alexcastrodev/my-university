---
version: 1.0
updatedAt: 2026-08-20
title: "Índices Especiais do MongoDB: Geoespaciais, Texto, TTL, Capped Collections e GridFS"
summary: Além da B-tree de uso geral: índices geoespaciais 2dsphere para consultas de localização, índices de texto para busca básica por palavras-chave (hoje explicitamente substituídos pelo MongoDB Search em produção), índices TTL para expiração automática, capped collections para filas de tamanho fixo ordenadas por inserção e GridFS para arquivos acima do limite de 16 MB por documento. Cada um tem armadilhas próprias que o livro aponta e que a documentação atual deixa ainda mais claras.
---
## Objective

Ir além do índice B-tree de uso geral visto em [Índices do MongoDB: B-Trees, Prefixos Compostos e o Query Planner](mongodb-indexing-fundamentals) e chegar às cinco ferramentas de propósito específico que o livro agrupa em um único capítulo porque nenhuma delas se comporta como um índice comum ou uma coleção comum: **índices geoespaciais 2dsphere/2d** para consultas de localização, **índices de texto** para busca básica por palavras-chave, **índices TTL** para expiração automática de documentos, **capped collections** para dados de tamanho fixo ordenados por inserção e **GridFS** para arquivos grandes demais para um único documento de 16 MB. Cada uma resolve um problema real que o índice composto comum não resolve, e cada uma traz suas próprias armadilhas.

## Use Cases

- Um app para encontrar restaurantes que precisa responder "em que bairro eu estou", "quantos restaurantes há perto de mim" e "encontre restaurantes em um raio de 5 milhas, ordenados pela distância": o exemplo recorrente do livro, resolvido com um índice `2dsphere` e `$geoIntersects`, `$geoWithin` e `$nearSphere`.
- Um armazenamento de sessões ou cache em que os documentos devem sumir sozinhos 24 horas depois de `lastUpdated`, sem cron job nem limpeza na aplicação: um índice TTL.
- Uma coleção capped de tamanho fixo usada como fila de trabalho ou buffer de log rotativo, em que entradas antigas devem sair em silêncio conforme novas chegam e um worker acompanha a coleção (tail) à espera de novas inserções.
- Uma coleção de artigos ou posts de blog em que os usuários precisam de uma busca simples por palavras-chave em `title` e `body`: um índice `text`, com a ressalva explícita, mais abaixo, de que não é mais aí que a busca full-text de produção deve ficar.
- Armazenar vídeos, PDFs ou imagens enviados por usuários que ultrapassam o limite de 16 MB por documento do MongoDB, continuando dentro do MongoDB em vez de montar um object store separado: GridFS.

## Deep Dive

### Índices geoespaciais: 2dsphere e 2d

O MongoDB tem dois tipos de índice geoespacial. O `2dsphere` "trabalha com geometrias esféricas que modelam a superfície da Terra com base no datum WGS84", o mesmo modelo de esferoide achatado que torna precisa a distância entre duas cidades. Índices `2d` pressupõem "uma superfície perfeitamente plana, em vez de uma esfera", e servem para coisas como mapas de jogos ou outros dados genuinamente bidimensionais, não para GeoJSON.

O `2dsphere` indexa geometrias GeoJSON (pontos, linhas e polígonos) armazenadas em um campo cujo nome você escolhe, embora os campos internos da forma (`type`, `coordinates`) sejam fixados pela especificação GeoJSON:

```js
{
  "name": "New York City",
  "loc": { "type": "Point", "coordinates": [50, 2] }
}
db.openStreetMap.createIndex({ "loc": "2dsphere" })
```

Três operadores de consulta cobrem os casos úteis, cada um recebendo um argumento `{"$geometry": geoJsonDesc}`:

- **`$geoIntersects`**: tudo que toca a forma consultada. "Isso encontraria todos os documentos contendo pontos, linhas e polígonos que tivessem algum ponto no East Village."
- **`$geoWithin`**: tudo que está totalmente contido. Diferente de `$geoIntersects`, este "não retorna coisas que apenas atravessam o East Village (como ruas) ou que se sobrepõem parcialmente a ele."
- **`$near`**: o único operador geoespacial que implica ordenação: "os resultados de `$near` são sempre retornados em ordem de distância, do mais próximo ao mais distante."

O livro monta um exemplo completo de busca de restaurantes a partir disso: descobrir o bairro atual do usuário com `$geoIntersects` sobre um ponto e, em seguida, encontrar todo restaurante `$geoWithin` o polígono desse bairro. Para uma busca por raio, há duas opções que trocam garantias de ordem por requisitos de índice:

```js
// sem ordem, raio em radianos (milhas / 3963.2)
db.restaurants.find({
  location: { $geoWithin: { $centerSphere: [[-73.93414657, 40.82302903], 5/3963.2] } }
})

// ordenado do mais próximo ao mais distante, $maxDistance em metros
db.restaurants.find({
  location: {
    $nearSphere: {
      $geometry: { type: "Point", coordinates: [-73.93414657, 40.82302903] },
      $maxDistance: 5 * 1609.34
    }
  }
})
```

Índices geoespaciais se compõem com campos comuns exatamente como qualquer outro índice, e é assim que você estreita "restaurantes em Hell's Kitchen" para "**pizza** em Hell's Kitchen":

```js
db.openStreetMap.createIndex({ "tags": 1, "location": "2dsphere" })
```

Vale internalizar a tabela do próprio livro sobre quais operadores usam geometria esférica e quais usam geometria plana, já que um índice `2d` entrega matemática de plano em silêncio: `$near`/`$geoNear`/`$nearSphere` são esféricos quando recebem um ponto GeoJSON e um índice `2dsphere`, e planos quando recebem coordenadas legadas e um índice `2d`; `$geoWithin: {$box/$polygon/$center}` é sempre plano; `$geoWithin: {$centerSphere}` e `$geoIntersects` são sempre esféricos. Misturar um índice `2d` com pressupostos esféricos, ou o contrário, produz respostas geometricamente erradas em vez de um erro: "não use um índice 2d se você pretende armazenar dados GeoJSON, ele só consegue indexar pontos."

Mais uma restrição que vale conhecer antes que ela te surpreenda em produção: **`$near` não funciona em uma coleção shardada**, e o comando `geoNear` / estágio de agregação `$geoNear` exigem que a coleção tenha *no máximo um* índice `2dsphere` e *no máximo um* índice `2d`, porque nenhuma das duas sintaxes inclui o campo de localização, o que seria ambíguo caso contrário. Operadores de consulta simples como `$near` e `$geoWithin` recebem um campo de localização, então permitem vários índices geoespaciais na mesma coleção.

**Livro vs. hoje.** Esta parte do capítulo envelheceu bem: o `2dsphere` continua sendo o índice geoespacial recomendado pelo MongoDB hoje, e a documentação atual vai além do livro: "você pode usar o índice `2dsphere` tanto para consultas esféricas *quanto* para consultas bidimensionais", convertendo internamente pares de coordenadas legados em pontos GeoJSON, o que torna o `2dsphere` o padrão mais seguro até para alguns casos de plano. Duas restrições que a documentação atual explicita e que o livro não destaca: índices geoespaciais **não conseguem cobrir uma consulta** (um `FETCH` é sempre necessário), e um índice geoespacial **não pode ser usado como shard key**.

### Busca full-text com índices de texto

Índices `text` permitem buscar em campos string "rapidamente e oferecem suporte a requisitos comuns de mecanismos de busca, como tokenização adequada ao idioma, stop words e stemming", um avanço real em relação a uma varredura com regex no estilo `LIKE`. Criar um é sintaxe comum de `createIndex`, opcionalmente com pesos por campo que influenciam a pontuação de relevância:

```js
db.articles.createIndex({ "title": "text", "body": "text" })
db.articles.createIndex(
  { "title": "text", "body": "text" },
  { "weights": { "title": 3, "body": 2 } }
)
```

Os pesos não podem ser alterados sem remover e recriar o índice, então o conselho do livro é ajustá-los primeiro em um conjunto de dados de amostra. Uma forma curinga indexa todo campo string, inclusive em documentos aninhados e arrays: `db.articles.createIndex({"$**": "text"})`.

`$text` tokeniza a string da consulta por espaços e pontuação e, por padrão, combina os tokens com OR. Colocar uma frase entre aspas a torna um termo obrigatório com AND, e a semântica se compõe: `{"$search": "\"impact crater\" lunar meteor"}` significa `"impact crater" AND ("lunar" OR "meteor")`. Para obter um AND lógico entre palavras individuais, coloque cada uma entre aspas separadamente. Os resultados **não são ordenados por relevância por padrão**: você precisa projetar e ordenar explicitamente pelo metadado `textScore`:

```js
db.articles.find(
  { $text: { $search: "\"impact crater\" lunar" } },
  { title: 1, score: { $meta: "textScore" } }
).sort({ score: { $meta: "textScore" } }).limit(10)
```

Como um índice de texto tem "um número de chaves proporcional às palavras nos campos indexados", ele é caro de construir e caro de manter: toda escrita em um campo indexado refaz a tokenização e o stemming, então coleções com índice de texto têm throughput de escrita mensuravelmente pior que coleções só com índices escalares ou compostos, e shardar uma coleção com índice de texto significa reindexar o texto de cada documento migrado para um novo shard. Dá para otimizar um padrão de acesso específico particionando o índice com um campo de prefixo (`{"date": 1, "post": "text"}`, mais rápido para buscas limitadas por data) ou cobrindo campos extras projetados com um sufixo (`{"post": "text", "author": 1}`), e as duas coisas podem ser combinadas.

**Livro vs. hoje: esta é a correção importante.** A própria documentação atual do MongoDB agora diz claramente: *"Recomendamos usar índices do MongoDB Search ou do MongoDB Vector Search em vez de índices de texto."* Índices `text` não foram removidos e continuam funcionando exatamente como descrito acima, mas não são mais onde a busca full-text de produção deve ficar. Veja [MongoDB Search e Vector Search: $search, $vectorSearch e Recuperação para RAG](mongodb-atlas-search-and-vector-search) para o substituto baseado em Lucene (antes chamado Atlas Search), que oferece fuzzy matching, autocomplete, facetas e busca semântica/vetorial que índices `text` básicos nunca terão. Três restrições que a documentação atual explicita mais que o livro: uma coleção pode ter **apenas um** índice de texto (embora ele possa cobrir vários campos), índices de texto **sempre** se comportam como índices sparse (a opção `sparse` é ignorada), e um índice de texto **não consegue cobrir uma consulta**, sempre exigindo a leitura do documento. Se você está construindo hoje uma nova funcionalidade de busca por palavras-chave, comece pelo MongoDB Search, não pelo `text`.

### Capped collections e tailable cursors

Uma capped collection tem tamanho fixo definido na criação e se comporta como uma fila circular: "se ficarmos sem espaço, o documento mais antigo será apagado e o novo tomará o lugar dele." Documentos não podem ser removidos manualmente, e updates que aumentariam o tamanho de um documento são proibidos; as duas restrições existem justamente para garantir a ordem de inserção sem manter uma lista de espaços livres.

```js
db.createCollection("my_collection", { "capped": true, "size": 100000 })
db.createCollection("my_collection2", { "capped": true, "size": 100000, "max": 100 })
db.runCommand({ "convertToCapped": "test", "size": 10000 })
```

Se `size` e `max` forem definidos, o limite atingido primeiro dispara a remoção dos mais antigos. Uma capped collection não pode ser redimensionada depois de criada (remova e recrie se os requisitos mudarem), e não existe forma de "descapar" uma.

**Tailable cursors**, inspirados em `tail -f`, continuam abertos depois de esgotados e seguem retornando documentos recém-inseridos. Eles só funcionam em capped collections, "já que a ordem de inserção não é rastreada em coleções normais", e expiram após 10 minutos sem resultados, então o código cliente precisa refazer a consulta quando o cursor morre. O livro já olha para frente aqui: "para a grande maioria dos usos, change streams... são recomendados em vez de tailable cursors, pois oferecem muito mais controle e configuração e funcionam com coleções normais."

**Livro vs. hoje.** A documentação atual do MongoDB reforça essa recomendação mais que o livro: *"De modo geral, índices TTL oferecem melhor desempenho e mais flexibilidade que capped collections"*, e mais: *"capped collections serializam operações de escrita e, por isso, têm pior desempenho em inserts, updates e deletes concorrentes que coleções não capped. Antes de criar uma capped collection, avalie se você pode usar um índice TTL."* O livro já indicava índices TTL pelo motivo de desempenho no WiredTiger; a documentação atual acrescenta explicitamente o argumento de concorrência e lista outras restrições que vale conhecer: não é possível escrever em capped collections dentro de transações multi-documento, e o estágio de agregação `$out` não consegue escrever em uma. Capped collections continuam não shardadas, sem mudança desde o livro, o que ainda vale hoje.

### Índices TTL

Um índice TTL expira documentos automaticamente com base em um campo de data, um mecanismo de expiração bem mais flexível que o limite de tamanho de uma capped collection, "útil para casos de cache, como armazenamento de sessões":

```js
// timeout de 24 horas
db.sessions.createIndex({ "lastUpdated": 1 }, { "expireAfterSeconds": 60 * 60 * 24 })
```

Atualizar `lastUpdated` a cada atividade reinicia o relógio; quando o valor fica 24 horas desatualizado, o documento é removido. `expireAfterSeconds` pode ser alterado depois sem remover o índice, via `collMod`:

```js
db.runCommand({
  "collMod": "someapp.cache",
  "index": { "keyPattern": { "lastUpdated": 1 }, "expireAfterSeconds": 3600 }
})
```

"O MongoDB varre o índice TTL uma vez por minuto, então você não deve depender de precisão de segundos." A documentação atual detalha melhor: a tarefa em segundo plano roda a cada 60 segundos e, por índice, para depois de apagar 50.000 documentos ou de gastar um segundo naquele índice, o que vier primeiro, então um grande acúmulo de documentos expirados é drenado aos poucos ao longo de várias varreduras, não de uma vez. Você pode ter vários índices TTL em uma coleção, mas "eles não podem ser índices compostos". Essa restrição não mudou desde o livro, e a documentação atual confirma: "Índices TTL são índices de campo único. Índices compostos não suportam TTL e ignoram a opção `expireAfterSeconds`." O campo `_id` também não pode ter um índice TTL.

### Armazenando arquivos com GridFS

O GridFS resolve um problema específico: documentos do MongoDB (e, portanto, o documento que guardaria o arquivo) são limitados a 16 MB, e o GridFS "é uma especificação para armazenar e recuperar arquivos que excedem" esse limite, "dividindo-os em pedaços (chunks) e armazenando cada chunk como um documento separado." O livro apresenta o trade-off com clareza: o GridFS "pode simplificar sua stack" se você já usa MongoDB e quer reaproveitar a replicação e o sharding dele para failover de arquivos, mas "o desempenho é menor" que o de um sistema de arquivos, e como um arquivo é dividido em vários documentos de chunk, "o MongoDB... não consegue travar todos os chunks de um arquivo ao mesmo tempo": updates significam apagar e salvar de novo, não edições no lugar.

A CLI `mongofiles` é o jeito mais rápido de experimentar:

```
$ mongofiles put foo.txt
$ mongofiles list
$ mongofiles get foo.txt
```

Por baixo, duas coleções fazem o trabalho. `fs.chunks` (por padrão) guarda os pedaços binários:

```js
{ "_id": ObjectId("..."), "n": 0, "data": BinData("..."), "files_id": ObjectId("...") }
```

`fs.files` guarda um documento de metadados por arquivo, com `_id`, `length`, `chunkSize` (padrão de 255 KiB), `uploadDate` e, historicamente, `md5`. Qualquer metadado personalizado (tipo MIME, contagem de downloads, nota dos usuários) pode ficar junto desses.

**Livro vs. hoje.** A mecânica não mudou: o tamanho de chunk padrão de 255 KiB e o limite de 16 MB por documento, que motiva o GridFS, continuam atuais. Mas o campo `md5`, que o livro apresenta como metadado obrigatório, agora está **deprecated**: a documentação atual diz *"o algoritmo MD5 é proibido pelo FIPS 140-2. Os drivers do MongoDB tornam o suporte a MD5 deprecated e vão remover a geração de MD5 em versões futuras. Aplicações que precisam de um digest do arquivo devem implementá-lo fora do GridFS e armazená-lo em `files.metadata`."* Outros dois campos de `fs.files` que o livro não marca como legados também estão deprecated pelo mesmo motivo ("use `files.metadata`"): `contentType` e `aliases`. E uma restrição que a documentação atual explicita e o livro não menciona: o GridFS não suporta transações multi-documento.

## Trade-offs

- **Índices geoespaciais dão poder real de consulta ao custo de cobertura e flexibilidade de sharding.** O `2dsphere` transforma "restaurantes em um raio de 5 milhas" em uma busca indexada rápida, em vez de um cálculo de distância na aplicação sobre todo documento, mas o índice nunca cobre uma consulta (todo resultado ainda custa um `FETCH`) e não pode servir como shard key, então uma coleção com muitas consultas geográficas precisa de uma estratégia de shard key separada.
- **Índices `text` são uma conveniência, não um mecanismo de busca, e o MongoDB agora diz isso diretamente.** Eles servem bem para "encontre artigos que mencionam estas palavras" em uma coleção pequena ou média em que a qualidade da relevância não importa muito. Não substituem o MongoDB Search baseado em Lucene, e construir hoje uma nova funcionalidade de busca por palavras-chave sobre `text` significa construir algo de que você provavelmente terá que migrar depois. O limite de um índice por coleção já é um sinal: o MongoDB espera que você tenha exatamente uma necessidade de busca secundária e simples por coleção, não um produto de busca.
- **Capped collections trocam flexibilidade por throughput de escrita em discos rotacionais, uma troca que importava mais em 2019 do que importa hoje com WiredTiger.** Você não tem nenhum controle sobre *o que* expira (só tamanho/quantidade), não pode shardá-las, e a documentação atual confirma que agora elas serializam escritas e têm desempenho pior que coleções normais sob concorrência. Índices TTL cobrem quase o mesmo terreno com controle por documento e sem essa penalidade; capped collections ainda fazem sentido para filas de trabalho de tamanho realmente fixo e com tail, mas hoje são a ferramenta mais estreita, não o padrão.
- **Índices TTL são flexíveis, mas não são tempo real.** Um intervalo de varredura de 60 segundos, mais um teto por varredura de 50.000 documentos ou um segundo de trabalho de remoção, faz com que "expirar esta sessão" signifique *em breve*, não *agora*: ótimo para caches e sessões, errado para qualquer coisa que exija remoção precisa ao segundo (que precisa de remoção na aplicação).
- **GridFS troca uma stack unificada por um custo real de desempenho e atomicidade.** Ele poupa você de rodar um segundo sistema de armazenamento, mas toda leitura/escrita de arquivo envolve no mínimo operações em documentos de duas coleções, updates exigem apagar e salvar tudo de novo já que os chunks não podem ser travados juntos, e, como a documentação atual deixa explícito, ele fica totalmente de fora dentro de uma transação multi-documento. Para arquivos abaixo de 16 MB, guardá-los diretamente em um documento (ou simplesmente usar um object store como o S3) costuma ser mais simples.

## Documentation Links

- [Shannon Bradshaw, Eoin Brazil e Kristina Chodorow, "MongoDB: The Definitive Guide", 3ª edição (O'Reilly, 2020): Capítulo 6, "Special Index and Collection Types", p. 133-159](https://www.oreilly.com/library/view/mongodb-the-definitive/9781491954454/): doc
- [MongoDB Documentation: Geospatial Indexes](https://www.mongodb.com/docs/manual/core/indexes/index-types/index-geospatial/): doc
- [MongoDB Documentation: Geospatial Queries](https://www.mongodb.com/docs/manual/geospatial-queries/): doc
- [MongoDB Documentation: Text Indexes](https://www.mongodb.com/docs/manual/core/index-text/): doc
- [MongoDB Documentation: TTL Indexes](https://www.mongodb.com/docs/manual/core/index-ttl/): doc
- [MongoDB Documentation: Capped Collections](https://www.mongodb.com/docs/manual/core/capped-collections/): doc
- [MongoDB Documentation: GridFS](https://www.mongodb.com/docs/manual/core/gridfs/): doc
- [MongoDB Documentation: MongoDB Search Overview](https://www.mongodb.com/docs/search/): doc
