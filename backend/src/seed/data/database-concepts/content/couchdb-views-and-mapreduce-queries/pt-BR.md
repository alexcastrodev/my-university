---
version: 1.0
updatedAt: 2026-08-20
title: "Views e Queries Map/Reduce no CouchDB"
summary: O CouchDB não tem linguagem de query ad-hoc para nada além de buscas simples por chave, toda query não trivial é uma view map/reduce predefinida, escrita em JavaScript com emit(), salva em um design document, e materializada incrementalmente em um índice B-tree conforme documentos mudam. Desde o CouchDB 2.0 (2016), as queries declarativas _find do Mango cobrem buscas simples sem JavaScript escrito à mão, mas elas mesmas são construídas sobre a mesma infraestrutura de views MapReduce e ainda não conseguem substituir views para padrões de agregação ou fan-out.
---
## Objective

Entender por que o CouchDB não tem linguagem de query ad-hoc para nada além das buscas mais simples, e como ele responde a essa lacuna: toda query não trivial é uma **view map/reduce** predefinida, escrita como funções JavaScript, salva em um design document, e materializada incrementalmente em um **índice B-tree**, conforme documentos são escritos. Aprender como `emit()` molda o índice, como redutores embutidos e customizados a agregam, e como a view resultante é consultada e fatiada sobre HTTP com `key`, `startkey`, `endkey`, e `descending`.

## Use Cases

- Buscar documentos por um campo diferente de `_id`, por exemplo, encontrar um documento de artista por `name`, em vez de por seu identificador gerado, o que `_all_docs` não consegue fazer, porque tem chave apenas por `_id`.
- Espalhar um único documento em muitas linhas de índice, como emitir uma linha por álbum dentro de um documento de artista, para que álbuns se tornem independentemente consultáveis e ordenáveis, mesmo existindo apenas embutidos no documento pai.
- Construir um agregado contado ou somado (total de reproduções por tag, receita total por região) combinando as chamadas `emit()` de uma map function com uma reduce function (`_count`, `_sum`, `_stats`, ou JS customizado), em vez de rodar uma query de varrer-e-agregar no momento da leitura.
- Paginar ou varrer por intervalo um conjunto de resultados grande (10.000+ artistas), usando `limit`, `startkey`, e `endkey`, contando com o fato de que o CouchDB mantém linhas de view em ordem de chave alfanumérica por construção.
- Decidir, em um projeto novo, se uma query é conhecida e estável o suficiente para merecer uma view permanente, versus ser simples o suficiente para um selector `_find` do Mango (veja Book vs. Today abaixo): a mesma disciplina antecipada de "conhecer suas perguntas" que a modelagem de padrão de acesso do DynamoDB exige, apenas reforçada por um mecanismo diferente.

## Deep Dive

### Não existe cláusula `WHERE`

CRUD do Dia 1 no CouchDB só te dá documentos por `_id`. O livro é explícito ao dizer que isso é a norma, não uma limitação temporária: "views são a forma principal pela qual documentos são acessados em todos os casos, exceto os triviais, como aquelas operações CRUD individuais que você viu no Dia 1." Todo banco de dados vem com uma view de graça, `_all_docs`, que produz uma linha por documento com chave por seu `_id`:

```
$ curl "${COUCH_ROOT_URL}/music/_all_docs"
{
  "total_rows": 1,
  "offset": 0,
  "rows": [
    {
      "id": "2ac58771c197f70461056f7c7e0001f9",
      "key": "2ac58771c197f70461056f7c7e0001f9",
      "value": { "rev": "7-d37c47883f4d30913c6a38644410685d" }
    }
  ]
}
```

Toda linha tem os mesmos três campos (`id`, `key`, `value`), e para `_all_docs` o `id` e a `key` acontecem de combinar. Para uma view customizada, quase nunca vão combinar, porque a chave é o que a map function escolheu emitir, não a identidade do documento.

### `emit()` é toda a linguagem de mapeamento

A map function de uma view roda uma vez por documento e chama `emit(key, value)` zero, uma, ou várias vezes. O exemplo condutor do livro é um banco de dados `music` de documentos de artista, cada um com um `name` e um array `albums`. O mapeador mais simples possível apenas ecoa o documento:

```js
function(doc) {
  emit(null, doc);
}
```

Reproduzir `_all_docs` manualmente significa emitir o `_id` como a chave e um pequeno objeto como o valor:

```js
function(doc) {
  emit(doc._id, { rev: doc._rev });
}
```

A primeira view genuinamente útil responde "encontre um artista pelo nome": algo que `_all_docs` estruturalmente não consegue fazer:

```js
// couchdb/artistsByNameMapper.js
function(doc) {
  if ('name' in doc) {
    emit(doc.name, doc._id);
  }
}
```

Consultá-la retorna linhas com chave por nome, em vez de por `_id`:

```
$ curl "${COUCH_ROOT_URL}/music/_design/artists/_view/by_name"
{
  "total_rows": 1,
  "offset": 0,
  "rows": [
    { "id": "2ac58771c197f70461056f7c7e0001f9", "key": "The Beatles", "value": "2ac58771c197f70461056f7c7e0001f9" }
  ]
}
```

`emit()` também pode ser chamado mais de uma vez por documento, que é como dado aninhado, embutido, se torna independentemente indexável. Este mapeador produz uma linha por álbum, extraída do array `albums` de cada artista:

```js
// couchdb/albumsByNameMapper.js
function(doc) {
  if ('name' in doc && 'albums' in doc) {
    doc.albums.forEach(function(album){
      var
        key = album.title || album.name,
        value = { by: doc.name, album: album };
      emit(key, value);
    });
  }
}
```

Um documento dos Beatles com três álbuns produz três linhas na view, cada uma com chave independente por título de álbum e ordenável junto com os álbuns de todo outro artista:

```
$ curl "${COUCH_ROOT_URL}/music/_design/albums/_view/by_name"
{
  "total_rows": 3,
  "offset": 0,
  "rows": [
    { "id": "2ac...", "key": "Abbey Road", "value": { "by": "The Beatles", "album": { "title": "Abbey Road", "year": 1969 } } },
    { "id": "2ac...", "key": "Help!", "value": { "by": "The Beatles", "album": { "title": "Help!", "year": 1965 } } },
    { "id": "2ac...", "key": "Sgt. Pepper's Lonely Hearts Club Band", "value": { "by": "The Beatles", "album": { "title": "Sgt. Pepper's Lonely Hearts Club Band", "year": 1967 } } }
  ]
}
```

Indo um nível mais fundo, um mapeador pode percorrer arrays arbitrariamente aninhados (álbuns contendo faixas contendo tags) e emitir uma linha para cada folha:

```js
// couchdb/tagsByNameMapper.js
function(doc) {
  (doc.albums || []).forEach(function(album){
    (album.tracks || []).forEach(function(track){
      (track.tags || []).forEach(function(tag){
        emit(tag.idstr, 1);
      });
    });
  });
}
```

Esse é o passo de preparação para redução: cada ocorrência de uma tag emite o valor `1`, e um redutor (`_count` ou `_sum` embutido, ou JS customizado) então colapsa todas as linhas compartilhando uma chave em um único agregado: o clássico padrão de contagem de palavras aplicado a tags em vez de palavras.

### Views são documentos salvos, não queries em tempo de execução

Um ponto estrutural crucial: uma view não é enviada com cada requisição da forma que uma string de query SQL é. Ela é salva uma vez, como uma função JavaScript, dentro de um **design document**: um documento comum cujo `_id` começa com `_design/` e que, portanto, replica como qualquer outro documento. "Design documents sempre têm IDs que começam com `_design/` e contêm uma ou mais views. O nome do índice distingue essa view de outras hospedadas no mesmo design document. Decidir quais views pertencem a quais design documents é em grande parte específico da aplicação e sujeito a gosto." Consultá-la significa atingir uma forma de URL fixa: `/<database>/_design/<design_doc>/_view/<view_name>`.

### O índice é uma B-tree, construída incrementalmente

Uma vez salva, o CouchDB não recalcula uma view do zero a cada requisição. A saída do map é armazenada como um **índice B-tree**, e quando um documento muda, apenas a map function daquele documento roda de novo: o resto do índice permanece intocado. Esse modelo de atualização incremental também é o que garante a ordenação: "o CouchDB vai garantir que os registros sejam apresentados em ordem alfanumérica pelas chaves emitidas. Na prática, essa é a indexação que o CouchDB oferece. Ao desenhar suas views, é importante escolher chaves emitidas que façam sentido quando ordenadas." Como a B-tree já está ordenada por chave, fatiar uma view é barato e não exige um passo separado de `ORDER BY`: `key` retorna correspondências exatas, `startkey`/`endkey` delimitam um intervalo, `limit` limita a contagem de linhas, e `descending=true` inverte a travessia (com `startkey`/`endkey` trocados para combinar). Consultar com `limit=5&startkey="C"` contra uma importação de 10.000 artistas pula direto para o meio do alfabeto sem varrer tudo antes disso: o campo `offset` da resposta até reporta o quão longe no conjunto ordenado completo esse salto aterrissou.

### Reduce functions transformam a saída do map em agregados

O mapeador de uma view sozinho te dá uma lista filtrada, re-chaveada, ordenada. Adicionar um redutor a transforma em uma query de agregado. Os redutores embutidos do CouchDB cobrem os casos comuns (`_count`, `_sum`, `_stats` para min/max/soma/contagem/soma-de-quadrados em uma passagem); um redutor JavaScript customizado recebe `(keys, values, rereduce)`, onde `rereduce` distingue uma primeira passagem sobre a saída bruta do map de uma passagem posterior que combina resultados intermediários já reduzidos de nós irmãos da B-tree: o mecanismo que permite à redução permanecer eficiente conforme a árvore cresce. A única restrição rígida: uma reduce function precisa genuinamente reduzir (colapsar muitos valores em um escalar ou objeto pequeno, de tamanho fixo), porque retornar algo como uma lista crescente de únicos derrota o design incremental da B-tree e o CouchDB vai recusar.

## Trade-offs

- **Você precisa conhecer suas queries antes de escrever seu modelo de dados: não há válvula de escape no momento da query.** Todo caminho de acesso precisa de uma view desenhada e salva antecipadamente; não existe equivalente de digitar um `WHERE name = ?` ad-hoc contra um campo que ninguém indexou. Essa é a mesma troca de planejamento antecipado que a modelagem de padrão de acesso do DynamoDB faz (veja [DynamoDB Data Modeling Approach](/database-concepts/dynamodb-data-modeling-approach)): ambos os sistemas se recusam a deixar você adiar a decisão de "o que eu vou consultar?" para o momento da leitura, em troca de caminhos de leitura que permanecem rápidos (uma busca pré-construída em B-tree, não uma varredura) conforme o dado cresce.
- **Um padrão de acesso esquecido é uma view nova e uma reconstrução de índice, não uma query de acompanhamento rápida.** Perceber depois do fato que você também precisa de artistas por gênero significa escrever e implantar uma nova map function, e então esperar o CouchDB construir aquele índice sobre todo documento existente: mais parecido com uma migração do que com um `CREATE INDEX`.
- **Mapeadores de fan-out trocam simplicidade no momento da escrita por flexibilidade de query.** Emitir uma linha por álbum, ou uma linha por tag vários níveis abaixo, significa que uma única atualização de documento toca muitas linhas de índice na reconstrução. Esse é o preço de conseguir consultar dado aninhado independentemente de seu documento pai.
- **Reduce functions têm um teto real.** A exigência de que um redutor colapse para um resultado pequeno, de tamanho fixo, descarta alguns agregados intuitivamente razoáveis (por exemplo, "me dê a lista de toda tag única" como uma saída de reduce): esses precisam de uma forma de view diferente (agrupar por chave, sem reduce), em vez de um redutor esperto.
- **Design documents são documentos reais, com comportamento de replicação real.** Isso é uma conveniência genuína: views vêm junto com o banco de dados e replicam automaticamente, mas também significa que um design document é versionado e mesclado como qualquer outro documento, incluindo enfrentar conflitos de atualização durante a replicação.

### Book vs. today: queries Mango fecharam parte dessa lacuna em 2016

O livro apresenta views map/reduce como *a* forma de consultar o CouchDB, ponto final: preciso para a edição, mas o CouchDB 2.0 (2016) adicionou um segundo caminho que o capítulo nunca menciona: **Mango**, uma linguagem de query JSON declarativa estilo MongoDB, exposta através do endpoint `POST /_find`. O Mango começou a vida na Cloudant como "Cloudant Query", foi doado ao projeto CouchDB, e foi lançado sob seu codinome de desenvolvimento. Ele genuinamente fecha parte da troca de "você precisa conhecer suas queries antecipadamente" que este conceito descreve: um selector como `{"selector": {"name": "The Beatles"}}` responde uma busca de igualdade simples sem escrever e implantar uma map function manualmente primeiro.

Não é um substituto para views, porém, e a documentação atual do Apache CouchDB é explícita ao dizer que o Mango é construído *em cima* da mesma infraestrutura que este conceito cobre: "índices Mango, com tipo de índice `json`, são construídos usando views MapReduce." Um selector Mango escolhe o índice de melhor correspondência que consegue encontrar (o índice primário de fábrica, ou um índice secundário criado pelo Mango), e por baixo dos panos esse índice ainda é uma view map/reduce com sua própria B-tree. Então a relação precisa hoje é: o Mango cobre filtragem direta e buscas de igualdade/intervalo sem escrever JavaScript, enquanto views map/reduce escritas à mão, como descritas neste conceito, continuam necessárias para agregação genuína (somas, contagens, redutores customizados) e para padrões de fan-out como as chamadas `emit()` de array aninhado mostradas acima, que um selector JSON plano não consegue expressar. Escolher entre eles é, em si, uma versão menor da mesma decisão de julgamento "quão bem eu já conheço essa query."

## Documentation Links

- [Luc Perkins, Eric Redmond, Jim R. Wilson, "Seven Databases in Seven Weeks", 2nd Edition (Pragmatic Bookshelf, 2018), Chapter 5, "CouchDB", Day 2: "Creating and Querying Views", p. 145-158](https://pragprog.com/titles/rwdata2/seven-databases-in-seven-weeks-second-edition/) - doc
- [Apache CouchDB Documentation, Views Introduction (map/reduce, emit, B-tree indexing)](https://docs.couchdb.org/en/stable/ddocs/views/intro.html) - doc
- [Apache CouchDB Documentation, View Functions Reference (built-in reducers: _sum, _count, _stats)](https://docs.couchdb.org/en/stable/ddocs/ddocs.html#view-functions) - doc
- [Apache CouchDB Documentation, /{db}/_find (Mango queries)](https://docs.couchdb.org/en/stable/api/database/find.html) - doc
- [CouchDB Blog, "Feature: Mango Query" (August 2016, CouchDB 2.0)](https://blog.couchdb.org/2016/08/03/feature-mango-query/) - doc
