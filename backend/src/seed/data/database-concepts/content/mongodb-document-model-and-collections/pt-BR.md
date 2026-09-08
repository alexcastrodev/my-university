---
version: 1.0
updatedAt: 2026-08-20
title: "O Modelo de Documento: Documentos, Collections, e ObjectIds"
summary: O MongoDB troca linhas e tabelas por documentos e collections com schema dinâmico, usando documentos embutidos e arrays onde um modelo relacional faria JOIN, e um ObjectId de 12 bytes (timestamp de 4 bytes, 5 bytes aleatórios, contador de 3 bytes) para cunhar valores _id únicos sem coordenação entre servidores.
---
## Objective

Entender a unidade central de armazenamento do MongoDB (o documento) e os containers ao redor dele (collections com schemas dinâmicos, bancos de dados, namespaces), por que as decisões de design por trás disso foram tomadas (facilidade de uso, escalar horizontalmente, recursos ricos sem sacrificar velocidade), e como documentos embutidos mais arrays se tornam a primitiva de design de schema que substitui os JOINs que um banco de dados relacional usaria.

## Use Cases

- Ler uma base de código MongoDB existente e saber imediatamente o que `db.blog.posts` referencia: a collection `posts` no namespace de "subcollection" `blog` de qualquer banco de dados para o qual `db` atualmente aponta, e saber que `blog` em si não precisa existir.
- Decidir se um pedaço de dado relacionado (um endereço, um conjunto de avaliações) pertence *dentro* de um documento como um documento embutido ou array, ou em uma collection separada: a primeira decisão real de design de schema em qualquer projeto MongoDB.
- Explicar a um time vindo do PostgreSQL por que "sem schema" não significa "sem design de schema", e por que uma collection por tipo de documento ainda é o padrão certo, mesmo que o MongoDB permita alegremente misturá-los.
- Depurar uma query que não retorna nada porque um valor foi armazenado como a string `"5"`, em vez do número `5`, ou porque uma data foi armazenada como uma string: o MongoDB é sensível a tipo, e schemas dinâmicos significam que nada impede a escrita ruim.
- Ler o `_id` de um documento para recuperar aproximadamente quando o documento foi criado, sem ter adicionado um campo `createdAt`.

## Deep Dive

### As quatro decisões de design (Capítulo 1)

O livro abre nomeando o raciocínio por trás da forma do MongoDB, e o resto do modelo decorre disso:

- **Facilidade de uso.** Um documento substitui a "linha" por algo mais flexível. Documentos embutidos e arrays permitem que um único registro represente um relacionamento hierárquico complexo, o que "se encaixa naturalmente na forma como desenvolvedores em linguagens orientadas a objeto modernas pensam sobre seus dados." Não há schemas predefinidos: as chaves e valores de um documento não têm tipos ou tamanhos fixos, então campos podem ser adicionados ou removidos conforme necessário, e dezenas de modelos de dados podem ser tentados antes de um ser escolhido.
- **Projetado para escalar.** Escalar se resume a escalar *para cima* (uma máquina maior: o caminho de menor resistência, mas caro e eventualmente fisicamente limitado) ou escalar *para fora* (particionar entre mais máquinas: mais barato e mais escalável, mas "é mais difícil administrar mil máquinas do que cuidar de uma"). O MongoDB foi projetado para escalar para fora: o modelo de documento torna o dado mais fácil de dividir entre servidores, e o MongoDB balanceia dado e carga através de um cluster automaticamente. Criticamente, a topologia do cluster, até *se* existe um cluster de forma alguma por trás de uma conexão, é transparente para a aplicação, então mudar a topologia de implantação não muda a lógica da aplicação.
- **Rico em recursos.** Índices secundários (único, composto, geoespacial, texto completo, e índices em documentos e arrays aninhados), um framework de agregação construído sobre pipelines de processamento de dado, collections TTL para expirar dado como sessões, collections limitadas (capped, de tamanho fixo) para dado recente como logs, índices parciais limitados a documentos correspondendo a um filtro, e um protocolo para armazenar arquivos grandes com seus metadados.
- **Sem sacrificar velocidade.** Locking oportunista no motor de armazenamento WiredTiger para maximizar concorrência, RAM usada agressivamente como cache, seleção automática de índice. O livro é explícito de que isso é uma troca: o MongoDB "não pretende fazer tudo que um banco de dados relacional faz" e deliberadamente transfere parte do processamento e lógica para os drivers ou código de aplicação, e esse design simplificado é parte de por que é rápido.

A omissão mais conspícua é joins complexos. O livro observa que joins são suportados "de uma forma muito limitada" através do operador de agregação `$lookup` introduzido na 3.2, com joins mais complexos (múltiplas condições de join, subqueries não correlacionadas) adicionados na 3.6, e enquadra isso como uma decisão arquitetural, porque joins são difíceis de fornecer eficientemente em um sistema distribuído.

### Documentos

Um documento é *um conjunto ordenado de chaves com valores associados*. Em JavaScript mapeia para um objeto; em outras linguagens para um map, hash, ou dicionário:

```javascript
{"greeting" : "Hello, world!", "views" : 3}
```

Regras que o livro sinaliza explicitamente:

- Chaves são strings, e qualquer caractere UTF-8 é permitido, com exceções: `\0` (nulo) é proibido porque sinaliza o fim de uma chave, e `.` e `$` deveriam ser tratados como reservados (drivers vão reclamar se usados inadequadamente).
- O MongoDB é **sensível a tipo e a maiúsculas/minúsculas**: `{"count" : 5}` e `{"count" : "5"}` são documentos distintos, assim como `{"count" : 5}` e `{"Count" : 5}`.
- Documentos **não podem conter chaves duplicadas**, então `{"greeting" : "Hello, world!", "greeting" : "Hello, MongoDB!"}` não é um documento válido.

### Collections e schemas dinâmicos

Uma collection é um grupo de documentos: o análogo de uma tabela, se um documento é o análogo de uma linha. Collections têm **schemas dinâmicos**: documentos em uma collection podem ter qualquer número de formas diferentes, chaves diferentes, números diferentes de chaves, e valores de tipos diferentes. Ambos podem legalmente viver na mesma collection:

```javascript
{"greeting" : "Hello, world!", "views": 3}
{"signoff": "Good night, and good luck"}
```

O que levanta a pergunta óbvia que o livro faz diretamente: se qualquer documento pode ir em qualquer collection, por que ter mais de uma? Quatro razões:

1. **Sanidade de desenvolvedor e administrador.** Misturar tipos significa que toda query precisa ou filtrar para uma forma ou tratar várias. "Se estamos consultando por posts de blog, é um incômodo eliminar documentos contendo dado de autor."
2. **Velocidade de enumeração.** Obter uma lista de collections é muito mais rápido do que extrair a lista de *tipos* de documento dentro de uma collection. Três collections separadas vencem uma collection com um campo discriminante `"type"` guardando `"skim"`, `"whole"`, ou `"chunky monkey"`.
3. **Localidade de dado.** Buscar vários posts de blog de uma collection só de posts provavelmente vai exigir menos seeks de disco do que buscá-los de uma collection que também guarda dado de autor.
4. **Indexação.** Índices são definidos por collection, e criar um já impõe alguma estrutura (especialmente um índice único). Um tipo por collection indexa mais eficientemente.

A conclusão do livro vale a pena citar contra o marketing "sem schema": "embora não exigido por padrão, definir schemas para sua aplicação é boa prática e pode ser reforçado através do uso da funcionalidade de validação de documento do MongoDB e bibliotecas de mapeamento objeto-documento."

Restrições de nomenclatura: a string vazia é inválida; `\0` é proibido; nomes começando com `system.` são reservados para collections internas; collections de usuário deveriam evitar `$`.

**Subcollections** são uma convenção de nomenclatura, não um recurso: `blog.posts` e `blog.authors` são duas collections independentes cujos nomes acontecem de compartilhar um prefixo. Não há relacionamento entre elas e uma collection `blog`, que "nem precisa existir." A convenção é essencial na prática, porém: o GridFS usa subcollections para separar metadado de arquivo de chunks de conteúdo, e drivers dão a isso açúcar sintático (`db.blog.posts` resolve para a collection `blog.posts`).

### Bancos de dados e namespaces

Uma instância MongoDB hospeda vários bancos de dados, cada um agrupando zero ou mais collections. A regra prática: **todo dado de uma única aplicação no mesmo banco de dados**; bancos de dados separados são para aplicações ou usuários separados em um servidor.

Restrições de nome de banco de dados: não vazio; não pode conter `/`, `\`, `.`, `"`, `*`, `<`, `>`, `:`, `|`, `?`, `$`, espaço, ou `\0` ("basicamente, fique com ASCII alfanumérico"); não diferencia maiúsculas/minúsculas; máximo de 64 bytes. O livro explica *por que* essas existem: historicamente, antes do WiredTiger, nomes de banco de dados se tornavam arquivos no sistema de arquivos.

Três bancos de dados reservados: `admin` (autenticação, autorização, e algumas operações administrativas), `local` (dado por servidor, incluindo dado de replicação de replica set, e ele mesmo nunca é replicado), e `config` (usado por clusters fragmentados para armazenar informação de shard).

Concatenar um nome de banco de dados com um nome de collection dá o nome totalmente qualificado, chamado de **namespace**: a collection `blog.posts` no banco de dados `cms` tem namespace `cms.blog.posts`.

### Tipos de dado

Documentos são "parecidos com JSON", mas JSON puro só tem seis tipos: null, boolean, numérico, string, array, objeto, que o livro sinaliza como insuficiente para um banco de dados: sem tipo de data, apenas um tipo de número (sem distinção float/integer ou 32-bit/64-bit), sem expressões regulares, sem funções. O MongoDB adiciona tipos, mantendo a natureza de chave/valor:

| Tipo | Representação no shell | Nota do livro |
|---|---|---|
| Null | `{"x" : null}` | Representa tanto um valor nulo quanto um campo inexistente |
| Boolean | `{"x" : true}` | |
| Number | `{"x" : 3.14}`, `{"x" : 3}` | O shell tem padrão de ponto flutuante de 64 bits; use `NumberInt` (4 bytes) ou `NumberLong` (8 bytes) para inteiros de verdade |
| String | `{"x" : "foobar"}` | Qualquer string UTF-8 |
| Date | `{"x" : new Date()}` | Inteiro de 64 bits, milissegundos desde a epoch Unix; **fuso horário não é armazenado** |
| Regular expression | `{"x" : /foobar/i}` | Sintaxe de regex JavaScript |
| Array | `{"x" : ["a", "b", "c"]}` | |
| Embedded document | `{"x" : {"foo" : "bar"}}` | |
| ObjectId | `{"x" : ObjectId()}` | ID de documento de 12 bytes |
| Binary data | — | Não pode ser manipulado do shell; a única forma de armazenar strings não-UTF-8 |
| Code | `{"x" : function() { }}` | JavaScript arbitrário em queries e documentos |

A pegadinha de data que o livro sinaliza é uma pegadinha do JavaScript, não do MongoDB: sempre chame `new Date()`, nunca `Date()`: o segundo retorna uma representação em *string*, e "strings não correspondem a datas e vice-versa", que silenciosamente quebra remoção, atualização, e consulta.

### Documentos embutidos e arrays: o substituto do JOIN

É aqui que o modelo de documento deixa de ser uma diferença de sintaxe e se torna uma diferença de design. Um endereço aninhado dentro de uma pessoa:

```javascript
{
    "name" : "John Doe",
    "address" : {
        "street" : "123 Park Street",
        "city" : "Anytown",
        "state" : "NY"
    }
}
```

Em um banco de dados relacional isso seria duas linhas em duas tabelas (`people` e `addresses`) unidas no momento da leitura. No MongoDB é um documento, uma leitura.

O que faz isso funcionar, em vez de apenas ser blobs aninhados, é que o MongoDB **entende a estrutura**: consegue alcançar dentro de documentos embutidos e arrays para construir índices, rodar queries, e realizar atualizações. Para arrays, isso significa consultar por documentos onde `3.14` é um elemento do array `"things"` em `{"things" : ["pie", 3.14]}`, indexar a chave `"things"` para acelerar isso, e realizar atualizações atômicas que modificam o conteúdo do array no lugar. Arrays podem guardar tipos misturados e aninhar, e são usados intercambiavelmente para operações ordenadas (lists, stacks, queues) e não ordenadas (sets).

O livro nomeia o custo na mesma respiração: **mais repetição de dado**. Se endereços fossem uma tabela relacional separada, corrigir um erro de digitação em um endereço o corrige para todos que o compartilham via o join. Com o MongoDB, "precisaríamos corrigir o erro no documento de cada pessoa."

### `_id` e ObjectIds

Todo documento armazenado no MongoDB **precisa** ter uma chave `"_id"`, única dentro de sua collection. O valor pode ser qualquer tipo, mas tem padrão `ObjectId`. Duas collections diferentes podem cada uma guardar um documento com `_id` de `123`; nenhuma pode guardar dois.

Por que não uma chave primária auto-incrementada? Porque o MongoDB foi projetado como um banco de dados distribuído, e "é difícil e demorado sincronizar chaves primárias auto-incrementadas entre múltiplos servidores." Um ObjectId é projetado para ser leve, ao mesmo tempo em que consegue ser gerado de forma globalmente única entre máquinas, sem coordenação.

Um ObjectId tem **12 bytes**, que renderiza como 24 dígitos hexadecimais (2 por byte): a string parece duas vezes maior do que o dado de fato é. O layout:

| Bytes | Conteúdo |
|---|---|
| 0-3 | Timestamp: segundos desde a epoch Unix |
| 4-8 | Valor aleatório |
| 9-11 | Contador, começando a partir de um valor aleatório |

Cada peça justifica seu lugar:

- O **timestamp de 4 bytes** vem primeiro, o que faz ObjectIds ordenarem em ordem *aproximada* de inserção: não uma garantia forte, mas suficiente para torná-los eficientes de indexar, e embute um horário implícito de criação de documento que a maioria dos drivers expõe um método para extrair.
- Os **5 bytes aleatórios** mais o timestamp dão unicidade entre máquinas e processos para um dado segundo. Repare que servidores **não** precisam de relógios sincronizados para ObjectIds funcionarem: o valor real do timestamp não importa, só que ele frequentemente é novo (uma vez por segundo) e crescente.
- Os **3 bytes de contador**, começando em um valor aleatório para evitar colidir entre máquinas, fornecem unicidade *dentro* de um segundo em um único processo, permitindo até 256³ = **16.777.216** ObjectIds únicos por processo por segundo.

Se nenhum `_id` está presente no momento da inserção, um é adicionado automaticamente. O livro observa que isso "pode ser tratado pelo servidor MongoDB, mas geralmente vai ser feito pelo driver do lado do cliente": significando que o ID geralmente existe no processo da sua aplicação antes de a escrita sequer sair dele.

### O shell

O MongoDB vem com um shell JavaScript (`mongo` no livro) que é tanto um interpretador JavaScript completo (`Math.sin(Math.PI / 2)`, funções recursivas definidas pelo usuário, declarações multi-linha) quanto um cliente MongoDB autônomo. Na inicialização, ele se conecta ao banco de dados `test` e atribui essa conexão à `db` global. `use video` é açúcar sintático emprestado de shells SQL, que não adiciona funcionalidade; `db.movies` retorna a collection `movies`. CRUD é `insertOne` / `find` e `findOne` / `updateOne` / `deleteOne` e `deleteMany`, e inserir um documento como `{"title": "Star Wars: Episode IV - A New Hope", "director": "George Lucas", "year": 1977}` retorna o `insertedId` atribuído pelo servidor como um `ObjectId`.

Dois hábitos de shell que vale a pena carregar adiante: digitar um nome de função *sem* parênteses imprime seu código-fonte JavaScript (uma forma rápida de relembrar a ordem de parâmetro), e `.mongorc.js` no diretório home roda em toda inicialização, comumente usado para desativar helpers perigosos como `db.dropDatabase` e `DBCollection.prototype.drop`: proteção contra dedo gordo, explicitamente não contra usuários maliciosos.

### Book vs. today

Quatro coisas para corrigir ou confirmar ao ler este capítulo em 2026:

> **O shell `mongo` se foi: agora é `mongosh`.** Tudo que o livro mostra no shell (`$ mongo`, `mongo --nodb`, `mongo script1.js`, o banner `MongoDB shell version: 4.2.0`) refere-se ao shell legado, que foi depreciado no MongoDB 5.0 e **removido na 6.0**. O substituto é o `mongosh`, um REPL baseado em Node.js. Os conceitos e a maioria dos nomes de método permanecem inalterados, mas os formatos de saída diferem: o resultado de `updateOne` do livro `WriteResult({"nMatched": 1, "nUpserted": 0, "nModified": 1})` é saída do shell legado; o `mongosh` retorna `{ acknowledged: true, matchedCount: 1, modifiedCount: 1, upsertedCount: 0 }`. Isso é uma substituição, não uma depreciação no lugar.

> **O layout de ObjectId nesta edição continua exatamente certo.** Vale a pena afirmar isso, porque material MongoDB mais antigo (e muitos posts de blog) descreve o ObjectId como *timestamp + identificador de máquina + ID de processo + contador*, que era o layout pré-3.4. A 3ª edição documenta o atual: timestamp de 4 bytes, aleatório de 5 bytes, contador de 3 bytes, e a documentação atual do MongoDB concorda byte por byte, adicionando um detalhe que o livro omite: timestamp e contador são armazenados **big-endian**, diferente de outros valores BSON.

> **O limite de namespace de 120 bytes é um número da era MMAPv1.** O livro afirma que namespaces são "limitados a 120 bytes de comprimento e, na prática, deveriam ter menos de 100 bytes." O MongoDB atual permite **255 bytes** para collections e views não fragmentadas, e 235 bytes para collections fragmentadas. O limite de nome de banco de dados de 64 bytes que o livro dá permanece inalterado. Relacionadamente, o livro lista `system.namespaces` como uma collection interna viva; isso era um artefato do MMAPv1 e não existe sob o WiredTiger. O prefixo `system.` continua reservado.

> **Joins são menos limitados do que "de uma forma muito limitada" do livro sugere, mas o ponto arquitetural se sustenta.** O `$lookup` continuou ganhando capacidade desde a 3.6 (agora consegue mirar em collections fragmentadas, e subqueries correlacionadas são muito mais ergonômicas), e a validação de schema amadureceu em validadores baseados em `$jsonSchema` com `validationLevel`/`validationAction`: o MongoDB rejeita documentos inválidos por padrão uma vez que um validador é anexado, ou pode ser configurado para só registrar um aviso. Mas o raciocínio subjacente do livro não mudou: o modelo ainda espera que você embuta em vez de fazer join para o caminho de leitura comum, e validadores são opt-in por collection, não um schema que o banco de dados impõe para você.

## Trade-offs

- **"Sem JOINs" é uma vitória de escala e uma conta de amplificação de escrita.** Embutir um endereço em cada pessoa torna a leitura uma busca de documento único, sem join, e torna corrigir um endereço compartilhado uma escrita de N documentos, em vez de um único `UPDATE` de linha. O livro diz isso claramente. A decisão é realmente "onde você quer pagar?": relacional paga em toda leitura para manter escritas baratas, o MongoDB paga em escritas de fan-out para manter leituras baratas. Essa troca é boa quando o dado embutido é genuinamente de propriedade do pai (os itens de linha de um pedido) e se torna hostil quando é compartilhado e mutável (um endereço de empresa em 50.000 documentos de funcionário).
- **Nenhuma integridade referencial significa que o banco de dados não vai pegar sua referência pendurada.** Não há chave estrangeira. Se você *de fato* divide dado entre collections (o que as quatro razões de "por que collections separadas" te empurram a fazer), nada impede deletar um documento que outros documentos apontam, e nada cascateia. Essa checagem se move para código de aplicação ou um ODM, onde é reforçada apenas tão consistentemente quanto seu time é disciplinado, e só para escritas que passam pela sua aplicação, nunca para o conserto ad-hoc no `mongosh` durante um incidente.
- **Schemas dinâmicos aceleram a semana um e taxam o ano dois.** Tentar "dezenas de modelos para o dado" sem migrações é uma vantagem real enquanto a forma é desconhecida. Uma vez que a aplicação amadurece, o schema existe, quer o banco de dados saiba disso ou não: só é implícito, e agora espalhado por toda versão de todo documento já escrito. Você ainda precisa de uma história de migração; só que a sua precisa tratar documentos em formas *mistas* simultaneamente, em vez de uma tabela que está atomicamente em uma forma ou na outra. Validadores de schema (`$jsonSchema`) ajudam daqui para frente, mas não fazem nada sobre os documentos já em disco, a menos que você defina `validationLevel` deliberadamente e faça backfill.
- **Sensibilidade a tipo mais nenhum reforço de schema é um gerador de falha silenciosa.** `{"count": 5}` e `{"count": "5"}` são distintos, e nada rejeita o segundo. Uma coluna `INTEGER` relacional teria falhado a escrita na fronteira; o MongoDB a aceita e a query que filtra por `count: 5` simplesmente retorna menos linhas silenciosamente. Essa é a fonte mais comum de "o dado está lá, mas a query não retorna nada": o mesmo se aplica a datas armazenadas como strings via `Date()`, em vez de `new Date()`.
- **ObjectIds compram geração de ID livre de coordenação e abrem mão de ordenação estrita.** Geração do lado do cliente, sem ida e volta a um servidor de sequência, é exatamente o que torna sharding prático, e o timestamp na frente dá localidade para o índice. Mas a ordem de classificação é só ordem *aproximada* de inserção: dois documentos criados no mesmo segundo em máquinas diferentes ordenam por bytes aleatórios, não por qual foi de fato primeiro. Se sua aplicação precisa de ordenação de inserção verdadeira, `_id` não é isso.
- **Uma collection por tipo de documento é uma convenção, não uma restrição, o que significa que é seu trabalho.** O MongoDB não vai te impedir de misturar posts de blog e autores em uma collection. Cada uma das quatro razões do livro (higiene de query, velocidade de enumeração, localidade de dado, indexação por collection) é um benefício que você obtém *escolhendo* reforçar uma disciplina à qual o banco de dados é indiferente.

## Documentation Links

- [Shannon Bradshaw, Eoin Brazil, and Kristina Chodorow, "MongoDB: The Definitive Guide", 3rd Edition (O'Reilly, 2020), Chapter 1-2, "Introduction" and "Getting Started", p. 24-49](https://www.oreilly.com/library/view/mongodb-the-definitive/9781491954454/) - doc
- [MongoDB Documentation, Documents](https://www.mongodb.com/docs/manual/core/document/) - doc
- [MongoDB Documentation, ObjectId](https://www.mongodb.com/docs/manual/reference/method/ObjectId/) - doc
- [MongoDB Documentation, Databases and Collections](https://www.mongodb.com/docs/manual/core/databases-and-collections/) - doc
- [MongoDB Documentation, BSON Types](https://www.mongodb.com/docs/manual/reference/bson-types/) - doc
- [MongoDB Documentation, Limits and Thresholds (namespace and database name limits)](https://www.mongodb.com/docs/manual/reference/limits/) - doc
- [MongoDB Documentation, Schema Validation](https://www.mongodb.com/docs/manual/core/schema-validation/) - doc
- [mongosh Documentation, Compatibility Changes with the Legacy mongo Shell](https://www.mongodb.com/docs/mongodb-shell/reference/compatibility/) - doc
