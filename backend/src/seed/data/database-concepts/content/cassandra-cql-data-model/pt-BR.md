---
version: 1.0
updatedAt: 2026-08-20
title: "A Linguagem de Query do Cassandra: Keyspaces, Partições, Colunas e Tipos CQL"
summary: O modelo de dados do Cassandra construído de baixo para cima, de coluna para linha, para partição, para tabela, para keyspace, para cluster, com a chave primária composta (partition key mais clustering columns) que decide tanto o posicionamento nos nós quanto a ordem em disco, timestamps e TTL por coluna, e o sistema de tipos CQL completo, dos tipos numéricos e textuais até uuid/timeuuid, counters, as três coleções, tuplas e tipos definidos pelo usuário congelados.
---
## Objective

Aprender o vocabulário do modelo de dados do Cassandra (cluster, keyspace, tabela, partição, linha, coluna) da forma como o CQL de fato o implementa, e entender por que as palavras que parecem emprestadas do SQL (tabela, coluna, chave primária, `SELECT`, `INSERT`) significam algo relevantemente diferente aqui. Ao longo do caminho, ganhar domínio prático do sistema de tipos do CQL: tipos numéricos, textuais, de tempo e identidade, os outros tipos simples, as três coleções, tuplas e tipos definidos pelo usuário, incluindo quais deles carregam restrições que vão te morder mais tarde.

## Use Cases

- Entrar em uma base de código Cassandra existente e precisar ler corretamente uma declaração `CREATE TABLE`, especificamente conseguir dizer quais colunas formam a partition key, quais são clustering columns, e portanto quais queries a tabela pode e não pode atender.
- Escolher um tipo para uma coluna nova: `uuid` versus `timeuuid` para um identificador, `text` versus `ascii` para uma string, `int` versus `bigint` versus `varint`, `timestamp` versus os tipos separados `date` e `time`.
- Decidir se um atributo de tamanho variável (endereços de email de um usuário, números de telefone, endereços marcados) deve ser uma coluna de coleção, uma tabela separada, ou clustering columns extras.
- Modelar um valor estruturado (um endereço, um conjunto de coordenadas) e escolher entre uma tupla, um tipo definido pelo usuário, e colunas achatadas.
- Expirar dados sem escrever um job de limpeza, usando TTL por coluna.
- Construir counters para visualizações de página, volume de log, ou estatísticas semelhantes, e conhecer de antemão as restrições que o tipo `counter` impõe à tabela inteira.
- Depurar um incidente do tipo "por que minha escrita sumiu / por que o valor mais antigo venceu?", em que a resposta é o timestamp por coluna do Cassandra e a resolução de conflitos por last-write-wins.

## Deep Dive

### Partindo do modelo relacional

O livro deliberadamente começa a partir da terminologia relacional, porque esse é o modelo mental com que a maioria dos leitores chega. Em um banco de dados relacional, o *banco de dados* é o container mais externo, geralmente correspondendo a uma única aplicação; ele contém tabelas; tabelas têm nomes e uma ou mais colunas nomeadas. Quando você adiciona dados, você especifica um valor para toda coluna definida, usando `null` onde você não tem um, e essa entrada se torna uma linha que você pode ler depois por seu identificador único (chave primária) ou por uma declaração SQL expressando critérios que a linha possa satisfazer. Atualizações atingem todas as linhas ou um subconjunto, dependendo do filtro da cláusula `WHERE`.

O aviso com que o capítulo abre vale a pena citar em espírito: para desenvolvedores e administradores vindos do mundo relacional, o modelo de dados do Cassandra pode ser difícil de entender inicialmente, porque "alguns termos, como *keyspace*, são completamente novos, e alguns, como *column*, existem em ambos os mundos, mas têm significados ligeiramente diferentes." E para pessoas vindas do Dynamo ou do Bigtable não é mais fácil: embora o Cassandra seja baseado nessas tecnologias, "seu próprio modelo de dados é significativamente diferente."

### Construindo o modelo de baixo para cima

O capítulo constrói o modelo de dados do Cassandra a partir de primitivas, em vez de simplesmente afirmá-lo.

Comece com uma **lista** de valores. Você poderia persisti-la e consultá-la depois, mas teria que inspecionar cada valor para saber o que ele representa, ou sempre armazenar cada valor no mesmo índice e manter documentação externa sobre o que cada célula significa, o que por sua vez significa fornecer nulos de espaço reservado para preservar o tamanho predeterminado do array quando um atributo opcional (um número de fax, um número de apartamento) está ausente. Útil, mas "não semanticamente rico."

Adicione uma segunda dimensão (nomes para os valores) e você tem um **mapa**. Agora as células podem se chamar `first_name`, `last_name`, `phone`, `email`. Mais rico, mas só funciona para uma única instância de uma entidade. Nada unifica uma coleção de pares nome/valor, e não há forma de repetir os mesmos nomes de coluna para uma segunda pessoa.

Então você precisa de uma chave referenciando um grupo de colunas tratadas em conjunto como um todo. Isso dá **linhas**: pares nome/valor são *colunas*, cada entidade guardando um conjunto de colunas é uma *linha*, e o identificador único de uma linha é a *row key* ou *chave primária*.

O Cassandra define uma **tabela** como uma divisão lógica associando dados semelhantes (uma tabela `user`, uma tabela `hotel`, uma tabela de catálogo de endereços), e nesse sentido uma tabela Cassandra é genuinamente análoga a uma tabela relacional. Mas o comportamento de armazenamento diverge imediatamente: você não precisa de um valor para toda coluna toda vez. Em vez de armazenar `null` para valores que você não conhece, "o que desperdiçaria espaço, você simplesmente não armazena aquela coluna para aquela linha." O resultado é uma **estrutura de array esparsa e multidimensional**, a forma característica do Cassandra e dos bancos de dados classificados como *wide column stores*.

Então vem a peça que muda tudo. O Cassandra usa um tipo especial de chave primária chamado **chave composta** (ou compound key) para representar grupos de linhas relacionadas, também chamados de **partições**. A chave composta consiste em:

- uma **partition key**, usada para determinar em quais nós as linhas são armazenadas, e que pode ela mesma consistir em múltiplas colunas;
- mais um conjunto opcional de **clustering columns**, usadas para controlar como os dados são ordenados para armazenamento dentro de uma partição.

O Cassandra também suporta uma **coluna estática**, para dados que não fazem parte da chave primária, mas são compartilhados por toda linha em uma partição. E um detalhe fácil de perder: onde nenhuma clustering column é fornecida, cada partição consiste em uma única linha.

Juntando tudo, a lista canônica de estruturas do livro, da mais interna para a mais externa:

| Estrutura | Definição |
|---|---|
| Column | Um par nome/valor |
| Row | Um container para colunas, referenciado por uma chave primária |
| Partition | Um grupo de linhas relacionadas armazenadas juntas nos mesmos nós |
| Table | Um container para linhas organizadas por partições |
| Keyspace | Um container para tabelas |
| Cluster | Um container para keyspaces, abrangendo um ou mais nós |

**Clusters.** A estrutura mais externa, às vezes chamada de *ring* (anel), porque o Cassandra atribui dados a nós organizando-os em um anel. O Cassandra é projetado para ser distribuído entre várias máquinas que operam juntas e aparecem como uma única instância para o usuário final.

**Keyspaces.** O container mais externo *para dados*, correspondendo de perto a um banco de dados no modelo relacional: um container para tabelas, com um nome e um conjunto de atributos definindo comportamento válido para o keyspace inteiro, como replicação.

**Tables.** Um container para uma coleção ordenada de linhas, cada uma das quais é ela mesma uma coleção ordenada de colunas. Linhas são organizadas em partições e atribuídas a nós de acordo com a(s) coluna(s) designada(s) como partition key; a ordenação *dentro* de uma partição é determinada pelas clustering columns.

### Partições são visíveis nos resultados de query

A tabela `user` do capítulo torna a distinção partição/linha concreta em vez de abstrata. A tabela é:

```sql
CREATE TABLE my_keyspace.user (
    last_name text,
    first_name text,
    middle_initial text,
    title text,
    PRIMARY KEY (last_name, first_name)
);
```

`last_name` é a partition key; `first_name` é a clustering column. Consultar apenas pela partition key pode retornar muitas linhas:

```sql
cqlsh:my_keyspace> INSERT INTO user (first_name, last_name, title)
  VALUES ('Wanda', 'Nguyen', 'Mrs.');
cqlsh:my_keyspace> SELECT * FROM user WHERE last_name='Nguyen';

 last_name | first_name | title
-----------+------------+-------
    Nguyen |       Bill |   Mr.
    Nguyen |      Wanda | Mrs.

(2 rows)
```

"Ao particionar usuários por `last_name`, você tornou possível carregar a partição inteira em uma única query fornecendo aquele `last_name`." Para obter exatamente uma linha, você precisa fornecer a chave primária inteira: `WHERE last_name='Nguyen' AND first_name='Bill'`.

> **Acesso a dados exige uma chave primária.** `SELECT`, `INSERT`, `UPDATE` e `DELETE` todos operam em termos de linhas. Para `INSERT` e `UPDATE`, *todas* as colunas de chave primária precisam ser especificadas para identificar a linha afetada. `SELECT` e `DELETE` podem operar em uma ou mais linhas dentro de uma partição, uma partição inteira, ou múltiplas partições via `WHERE` e `IN`.

Colunas que não são chave primária são opcionais: inserir `('Mary', 'Rodriguez')` sem `title` retorna `title` como `null`. Adicionar uma coluna depois é um `ALTER TABLE user ADD middle_initial text;`.

O capítulo então arma uma armadilha e a dispara. Dois inserts consecutivos:

```sql
INSERT INTO user (first_name, middle_initial, last_name, title)
  VALUES ('Bill', 'S', 'Nguyen', 'Mr.');
INSERT INTO user (first_name, middle_initial, last_name, title)
  VALUES ('Bill', 'R', 'Nguyen', 'Mr.');
```

Um `SELECT` depois retorna **uma** linha, com `middle_initial = 'R'`. Ambas as declarações especificam as mesmas colunas de chave primária, então o Cassandra fielmente atualizou a mesma linha: o segundo insert sobrescreveu o primeiro.

> **Insert, update e upsert.** Como o Cassandra usa um modelo de anexação (append), "não há diferença fundamental entre as operações de insert e update." Inserir uma linha cuja chave primária já existe substitui a linha; atualizar uma linha cuja chave primária não existe faz o Cassandra criá-la. Daí: o Cassandra suporta *upsert*, com uma pequena exceção (transações leves).

O estado final do exemplo trabalhado é duas partições, `Nguyen` e `Rodriguez`, onde a partição `Nguyen` guarda duas linhas, `Bill` e `Wanda`, e `Bill` tem valores tanto em `title` quanto em `middle_initial`, enquanto `Wanda` só tem um `title`. Essa assimetria é a estrutura esparsa em ação.

### Colunas carregam tempo: timestamps e TTL

Uma coluna é a unidade mais básica do modelo de dados: um nome e um valor, com o valor restrito a um tipo declarado. Mas cada coluna também carrega dois pedaços de metadado de tempo.

**Timestamps.** Toda escrita gera um timestamp *em microssegundos* para cada valor de coluna inserido ou atualizado. Internamente, o Cassandra usa esses timestamps para resolver mudanças conflitantes no mesmo valor: a abordagem **last write wins**. Você pode lê-los com `writetime()`:

```sql
cqlsh:my_keyspace> SELECT first_name, last_name, title, writetime(title) FROM user;

 first_name | last_name | title | writetime(title)
------------+-----------+-------+------------------
       Mary | Rodriguez |  null |             null
       Bill |    Nguyen |   Mr. | 1567876680189474
      Wanda |    Nguyen |  Mrs. | 1567874109804754
```

Uma coluna que nunca foi definida não tem timestamp. E colunas de chave primária não têm timestamp consultável de forma alguma:

```
cqlsh:my_keyspace> SELECT WRITETIME(first_name) FROM user;
InvalidRequest: code=2200 [Invalid query] message="Cannot use
  selection function writeTime on PRIMARY KEY part first_name"
```

Você também pode *fornecer* um timestamp com `USING TIMESTAMP`, mas repare na restrição que o livro sinaliza no texto: o timestamp precisa ser posterior ao existente, ou o `UPDATE` simplesmente será ignorado, silenciosamente.

> **Trabalhando com timestamps.** Definir o timestamp não é obrigatório. É "tipicamente usado para escritas em que há uma preocupação de que algumas das escritas possam causar a sobrescrita de dados novos por dados obsoletos. Esse é um comportamento avançado e deve ser usado com cautela." O livro também observa que não há forma no cqlsh de converter um valor de `writetime()` em um formato mais amigável.

**Time to live.** O TTL é armazenado por valor de coluna e indica por quanto tempo manter o valor; o padrão é `null`, significando que os dados escritos não expiram. `UPDATE user USING TTL 3600 SET middle_initial = 'Z' ...` define uma hora, e ler `TTL(middle_initial)` de volta imediatamente já mostra a contagem regressiva em andamento (a saída do livro mostra `3574`, os segundos que levou para digitar o segundo comando). `USING TTL` em um `INSERT` expira a *linha inteira*; o livro demonstra uma linha de 60 segundos que está presente no primeiro `SELECT` e some (`0 rows`) um minuto depois.

> **Usando TTL.** TTL é armazenado por coluna para colunas que não são chave primária. "Atualmente não há mecanismo para definir TTL no nível de linha diretamente depois do insert inicial; em vez disso, você precisaria reinserir a linha, aproveitando o comportamento de upsert do Cassandra." Assim como com o timestamp, não há forma de obter ou definir o TTL de uma coluna de chave primária, e o TTL só pode ser definido para uma coluna quando você de fato fornece um valor para ela.

### Tipos CQL

**Numéricos.** Espelhando de perto o Java:

| Tipo CQL | Significado |
|---|---|
| `int` | Inteiro assinado de 32 bits (como no Java) |
| `bigint` | Inteiro longo assinado de 64 bits (`long` do Java) |
| `smallint` | Inteiro assinado de 16 bits (`short` do Java) |
| `tinyint` | Inteiro assinado de 8 bits (como no Java) |
| `varint` | Inteiro assinado de precisão variável (`java.math.BigInteger`) |
| `float` | Ponto flutuante IEEE-754 de 32 bits (como no Java) |
| `double` | Ponto flutuante IEEE-754 de 64 bits (como no Java) |
| `decimal` | Decimal de precisão variável (`java.math.BigDecimal`) |

`smallint` e `tinyint` foram adicionados no Cassandra 2.2. **Não existe um tipo enumerado** no CQL; a prática comum é armazenar valores de enum como strings: em Java, `Enum.name()` na saída e `Enum.valueOf()` na volta.

**Textuais.** Dois tipos, e uma recomendação:

- `text`, `varchar`: sinônimos para uma string de caracteres UTF-8.
- `ascii`: uma string de caracteres ASCII.

"UTF-8 é o padrão de texto mais recente e amplamente usado, e suporta internacionalização, então recomendamos usar `text` em vez de `ascii` ao construir tabelas para dados novos. O tipo `ascii` é mais útil se você está lidando com dados legados que estão em formato ASCII."

**Tempo e identidade.** Esses são os tipos que importam para definir partition keys únicas.

- `timestamp`: uma coisa distinta do timestamp de escrita por coluna discutido acima; aqui é um *valor*. Codificável como um inteiro assinado de 64 bits, mas geralmente mais útil quando digitado em um de vários formatos ISO 8601: `2015-06-15 20:05-0700`, `2015-06-15 20:05:07-0700`, `2015-06-15 20:05:07.013-0700`, e as variantes separadas por `T`. A melhor prática nomeada no livro: **sempre forneça fusos horários** em vez de depender da configuração de fuso horário do sistema operacional.
- `date`, `time`: adicionados no Cassandra 2.2. Versões até a 2.1 só tinham `timestamp`, que combinava uma data e uma hora do dia; `date` e `time` permitem representá-las de forma independente. Ambos suportam formatos ISO 8601. Uma observação específica de Java: embora os tipos de `java.time` existam desde o Java 8, o tipo `date` mapeia para um tipo **customizado** do Cassandra, para preservar compatibilidade com JDKs mais antigos, e `time` mapeia para um `long` do Java representando nanossegundos desde a meia-noite.
- `uuid`: um identificador universalmente único de 128 bits. O tipo `uuid` do CQL é um UUID **Tipo 4**, baseado inteiramente em números aleatórios, e é tipicamente escrito como hex separado por traços, por exemplo `1a6300ca-0572-4736-a393-c0b7229e193e`. Frequentemente usado como uma chave substituta, sozinho ou combinado com outros valores. O livro é franco ao dizer que "como UUIDs têm um comprimento finito, eles não têm garantia absoluta de serem únicos", ao mesmo tempo em que observa que utilitários de sistema operacional e linguagem fornecem unicidade adequada na prática. A função `uuid()` do CQL gera um.
- `timeuuid`: um UUID **Tipo 1**, baseado no endereço MAC do computador, na hora do sistema, e em um número de sequência para prevenir duplicatas. Frequentemente usado como um *timestamp livre de conflitos*. O CQL fornece as funções de conveniência `now()`, `dateOf()` e `unixTimestampOf()`, e a disponibilidade dessas funções "é uma razão pela qual `timeuuid` tende a ser usado com mais frequência do que `uuid`."

> **Chaves primárias são para sempre.** "Depois de criar uma tabela, não há forma de modificar a chave primária, porque isso controla como os dados são distribuídos dentro do cluster, e mais importante ainda, como são armazenados em disco." Esta é a irreversibilidade mais consequente do modelo, sozinha.

**Outros tipos simples.**

- `boolean`: o cqlsh não diferencia maiúsculas/minúsculas na entrada, mas produz `True` / `False` na saída.
- `blob`: um array arbitrário de bytes, útil para mídia ou arquivos binários. O Cassandra não valida nem examina os bytes. Representado como dígitos hex, por exemplo `0x00000ab83cf0`; `textAsBlob()` codifica dados textuais em um.
- `inet`: endereços IPv4 ou IPv6. O cqlsh aceita qualquer formato IPv4 legal (com ou sem pontos, decimal, octal, hexadecimal), mas sempre *produz* decimal com pontos, por exemplo `192.0.2.235`. IPv6 é oito grupos de quatro dígitos hex separados por dois-pontos, com o colapso de zeros consecutivos da especificação aplicado na leitura.
- `counter`: um inteiro assinado de 64 bits cujo valor **não pode ser definido diretamente**, apenas incrementado ou decrementado. "O Cassandra é um dos poucos bancos de dados que fornece incrementos livres de disputa entre data centers." Usado para visualizações de página, tweets, mensagens de log. As restrições são rígidas: um counter não pode fazer parte de uma chave primária, e, se um counter é usado, **todas** as colunas que não são de chave primária precisam ser counters. Daí a tabela separada:

```sql
CREATE TABLE user_visits (
  user_id uuid PRIMARY KEY, visits counter);

UPDATE user_visits SET visits = visits + 1
  WHERE user_id=ebf87fee-b372-4104-8a22-00c1252e3e05;
```

Não há operação para zerar um counter; você pode aproximar uma lendo o valor e decrementando por essa quantia, mas "isso não tem garantia de funcionar perfeitamente, já que o counter pode ter sido alterado em outro lugar entre a leitura e a escrita."

> **Um aviso sobre idempotência.** Incremento e decremento de counter *não* são idempotentes. Em um sistema distribuído, um nó pode falhar em responder com sucesso ou falha, e a resposta típica do cliente é tentar novamente: "como não se sabe se a primeira tentativa teve sucesso, o valor pode ter sido incrementado duas vezes." O livro observa que a única outra operação CQL não idempotente é **adicionar um item a uma list**.

**Coleções.** Em vez de `email2`, `email3`, e assim por diante (uma abordagem que "não escala muito bem e pode causar bastante retrabalho"), o CQL oferece três tipos de coleção.

- `set<text>`: elementos não são ordenados quando armazenados, mas são retornados em ordem ordenada (texto em ordem alfabética). Sets podem guardar tipos simples, tipos definidos pelo usuário, e até outras coleções. Uma vantagem nomeada: "a capacidade de inserir itens adicionais sem precisar ler o conteúdo primeiro." Atribuir substitui o set inteiro (`SET emails = {'mary@example.com'}`); concatenar adiciona (`SET emails = emails + {'mary.rodriguez.AZ@gmail.com'}`); subtração remove (`SET emails = emails - {'mary@example.com'}`); `SET emails = {}` o esvazia.
- `list<text>`: uma lista ordenada, armazenada por padrão na ordem de inserção. Anexar com `phone_numbers + ['480-111-1111']`, prependar invertendo os operandos, substituir por índice com `SET phone_numbers[1] = '480-111-1111'`, remover por valor com subtração, ou deletar por índice com `DELETE phone_numbers[0] FROM user WHERE ...`.

> **Operações caras em list.** "Como uma list armazena valores por posição, existe o potencial de que atualizar ou deletar um item específico em uma list exija que o Cassandra leia a lista inteira, execute a operação solicitada, e escreva a lista inteira de novo." Caro com muitos valores: "por essa razão, muitos usuários preferem usar os tipos `set` ou `map`, especialmente em casos onde há potencial de atualizar o conteúdo da coleção."

- `map<timeuuid, int>`: pares chave-valor onde chaves e valores podem ser qualquer tipo, **exceto** `counter`. O exemplo do livro rastreia durações de sessão de login com chave por `now()`:

```sql
ALTER TABLE user ADD login_sessions map<timeuuid, int>;
UPDATE user SET login_sessions = { now(): 13, now(): 18}
  WHERE first_name = 'Mary' AND last_name = 'Rodriguez';
```

Itens individuais do map podem ser referenciados por chave. Coleções são "muito úteis em casos em que precisamos armazenar um número variável de elementos dentro de uma única coluna."

**Tuplas.** Um conjunto de comprimento fixo de valores de vários tipos. Um endereço como `tuple<text, text, text, int>` funciona:

```sql
ALTER TABLE user ADD address tuple<text, text, text, int>;
UPDATE user SET address = ('7712 E. Broadway', 'Tucson', 'AZ', 85715)
  WHERE first_name = 'Mary' AND last_name = 'Rodriguez';
```

Mas o veredito do livro é incomumente direto: é "estranho tentar lembrar os valores posicionais dos vários campos de uma tupla sem ter um nome associado a cada valor. Também não há forma de atualizar campos individuais de uma tupla; a tupla inteira precisa ser atualizada. Por essas razões, tuplas são usadas com pouca frequência na prática." O capítulo abandona a coluna imediatamente e segue em frente.

**Tipos definidos pelo usuário.** UDTs são "mais fáceis de usar do que tuplas, já que você pode especificar os valores por nome em vez de posição", e têm **escopo do keyspace** em que são definidos: `CREATE TYPE my_keyspace.address` é a forma totalmente qualificada, e `DESCRIBE KEYSPACE` mostra o tipo como parte da definição do keyspace.

```sql
CREATE TYPE address (
  street text,
  city text,
  state text,
  zip_code int);
```

Tentar usá-lo dentro de um map falha:

```
cqlsh:my_keyspace> ALTER TABLE user ADD addresses map<text, address>;
InvalidRequest: code=2200 [Invalid query] message="Non-frozen
  collections are not allowed inside collections: map<text, address>"
```

A explicação é o insight-chave desta seção: **um tipo definido pelo usuário é, ele mesmo, considerado uma coleção**, porque sua implementação é parecida com a de um set, list ou map. Aninhar um dentro de um map é aninhar uma coleção dentro de uma coleção.

> **Congelando coleções.** Versões anteriores à 2.2 não suportam totalmente aninhar coleções: especificamente, atributos individuais de uma coleção aninhada não podem ser acessados, "porque a coleção aninhada é serializada como um único objeto pela implementação. Portanto, a coleção aninhada inteira precisa ser lida e escrita por completo." O congelamento (freezing) foi introduzido como um *mecanismo de compatibilidade futura*: marcar uma coleção aninhada como `frozen` diz ao Cassandra para armazenar aquele valor como um blob de dados binários, com a intenção de que um futuro mecanismo de "descongelamento" permitisse acesso a atributos individuais. Uma coleção também pode ser usada como chave primária **se estiver congelada**.

Então a forma que funciona é `map<text, frozen<address>>`, e a tabela final fica:

```sql
CREATE TABLE my_keyspace.user (
    last_name text,
    first_name text,
    addresses map<text, frozen<address>>,
    emails set<text>,
    id uuid,
    login_sessions map<timeuuid, int>,
    middle_initial text,
    phone_numbers list<text>,
    title text,
    PRIMARY KEY (last_name, first_name)
) WITH CLUSTERING ORDER BY (first_name ASC)
    AND bloom_filter_fp_chance = 0.01
    AND caching = {'keys': 'ALL', 'rows_per_partition': 'NONE'}
    AND compaction = {'class': '...SizeTieredCompactionStrategy',
      'max_threshold': '32', 'min_threshold': '4'}
    AND compression = {'chunk_length_in_kb': '16',
      'class': 'org.apache.cassandra.io.compress.LZ4Compressor'}
    AND gc_grace_seconds = 864000
    ...;
```

Vale reparar nessa saída: `CLUSTERING ORDER BY (first_name ASC)` não é decoração, é a ordem física de ordenação em disco dentro de cada partição `last_name`, e é o que torna eficientes as queries de intervalo em `first_name` dentro de uma partição.

### Book vs. today

O capítulo é escrito contra o Cassandra 4.0, e o modelo em si (cluster, keyspace, tabela, partition key, clustering columns, colunas estáticas, congelamento) permanece inalterado no Cassandra 5.0. Quatro pontos mudaram:

> **A saída de `DESCRIBE TABLE` no livro é de um cluster pré-4.0.** Ela inclui `read_repair_chance` e `dclocal_read_repair_chance`. Ambos foram removidos no Cassandra 4.0 pela CASSANDRA-13910: o read repair *em segundo plano*, probabilístico, foi eliminado por completo, e `read_repair_chance` foi substituído por uma opção de tabela `read_repair` cujos valores são `BLOCKING` (o padrão) e `NONE`. Se você rodar `DESCRIBE TABLE` em um cluster moderno, não verá as propriedades antigas. Nada no modelo de dados mudou, apenas aquela listagem específica de propriedades.

> **`dateOf()` e `unixTimestampOf()` são as grafias depreciadas.** O livro as lista junto com `now()` como as funções de conveniência de `timeuuid`. Elas ainda funcionam, mas as substitutas introduzidas no Cassandra 2.2 são `toDate()`, `toTimestamp()` e `toUnixTimestamp()`, que são as que a documentação atual usa e que também funcionam de forma uniforme em `timeuuid`, `timestamp` e `date`. Isso é uma renomeação, não uma mudança de comportamento. O Cassandra 4.0 também adicionou `currentTimestamp()`, `currentDate()`, `currentTime()` e `currentTimeUUID()` para o "agora" do lado do servidor do tipo correspondente.

> **UDTs não congelados são suportados no nível superior.** O enquadramento do livro ("um tipo definido pelo usuário é considerado uma coleção") vem de um período em que colunas UDT eram sempre, na prática, blobs congelados. A CASSANDRA-7423, resolvida no Cassandra 3.6, tornou um UDT usado como uma coluna simples não congelado, então você pode atualizar um único campo (`SET home_address.city = 'Phoenix'`) em vez de reescrever o valor inteiro. Duas condições se aplicam: o UDT não pode conter campos de coleção, e precisa ser declarado unfrozen no `CREATE TABLE`. A restrição que o livro de fato demonstra continua em vigor: *dentro* de uma coleção, ou como parte de uma chave primária, o UDT precisa ser `frozen`, e o prometido mecanismo de "descongelamento" para coleções genuinamente aninhadas ainda não existe.

> **A lista de tipos cresceu.** `duration` (meses, dias, nanossegundos) chegou no Cassandra 3.10 e está ausente da lista de "outros tipos de dados simples" do livro; não pode ser usado em uma chave primária nem ordenado por, porque durations não são comparáveis. O Cassandra 5.0 adicionou `vector<float, n>` para armazenamento de embeddings, combinado com Storage-Attached Indexes (SAI) para busca aproximada de vizinhos mais próximos: a única capacidade de modelagem genuinamente nova desde o livro, e a razão pela qual uma tabela Cassandra agora pode sustentar uma carga de trabalho de recuperação que antes não conseguia.

## Trade-offs

- **A semelhança relacional é a armadilha.** Tabelas, colunas, tipos, `SELECT`, `INSERT`, `WHERE`: a superfície do CQL é deliberadamente moldada como SQL, e isso torna as diferenças fáceis de não perceber, em vez de fáceis de aprender. Não existem joins ad-hoc, e a cláusula `WHERE` não é um filtro geral: ela endereça partições e posições de clustering, então um predicado para o qual o schema não foi desenhado é rejeitado ou exige um índice ou uma varredura completa. O design de schema aqui é conduzido pelas queries que você pretende rodar, não pelas entidades do seu domínio, que é a inversão que o conceito irmão de modelagem de dados cobre adequadamente. O ponto a levar deste capítulo é mais restrito: conhecer o vocabulário não é conhecer o modelo, e ler um `CREATE TABLE` corretamente significa ler a cláusula `PRIMARY KEY` primeiro.
- **`INSERT` que sobrescreve silenciosamente é upsert funcionando como projetado, e isso remove uma rede de segurança que você tinha em SQL.** Dois inserts com a mesma chave primária produzem uma linha, sem erro, sem violação de chave duplicada. O modelo de anexação torna insert e update a mesma operação, o que é o que permite que escritas sejam baratas e livres de coordenação, mas também significa que um bug de aplicação que reutiliza uma chave destrói dados em vez de falhar ruidosamente. Transações leves (`IF NOT EXISTS`) são a válvula de escape, e custam um round trip de Paxos, então são uma exceção deliberada, não um padrão.
- **Coleções compram conveniência a um custo real que um background relacional não vai antecipar.** Elas parecem a resposta óbvia para "um usuário tem vários endereços de email", e para conjuntos pequenos, limitados e majoritariamente escritos uma única vez, são. Mas a coleção inteira vive em uma partição e é lida e escrita como uma unidade na maioria das operações; listas são piores, já que uma atualização ou remoção posicional pode exigir ler a lista inteira, aplicar a mudança, e reescrevê-la. Sobrescrever uma coleção inteira também escreve uma tombstone cobrindo o conteúdo antigo, que então precisa sobreviver a `gc_grace_seconds` antes que a compaction possa removê-la, então uma coluna de coleção frequentemente reatribuída silenciosamente fabrica a carga de tombstones que aparece depois como latência de leitura. Não existe uma query que diga "me dê os usuários cujos emails contêm X" sem um índice. A regra prática que o livro sugere e a experiência confirma: prefira `set` ou `map` a `list` quando o conteúdo for mudar, mantenha coleções pequenas e limitadas, e promova qualquer coisa ilimitada a clustering columns em sua própria tabela.
- **Counters são um banco de dados separado dentro do banco de dados.** Incrementos livres de disputa entre data centers são genuinamente raros e valiosos, mas as restrições se propagam para o design de schema: nenhum counter em uma chave primária, e toda coluna que não é chave na tabela também precisa ser um counter, então counters forçam uma tabela dedicada, como mostra o `user_visits` do livro. Some incrementos não idempotentes a isso, e uma nova tentativa depois de uma falha de rede ambígua pode contar em dobro. Counters são corretos para estatísticas aproximadas e errados para qualquer coisa que precise fechar contas.
- **UDTs adicionam estrutura, mas não integridade.** Um `frozen<address>` te dá campos nomeados em vez do jogo de adivinhação posicional de uma tupla, e mantém os componentes de um valor composto juntos. O que ele não te dá é nada parecido com uma chave estrangeira SQL: sem integridade referencial, sem cascade, sem garantia de que o valor de `state` é um estado real, ou de que duas linhas referenciando "o mesmo" endereço concordam. Um UDT é uma forma, aplicada apenas até onde os tipos de campo declarados vão. Qualquer invariante entre linhas é trabalho da sua aplicação, permanentemente.
- **Congelamento é um andaime de compatibilidade futura em que você precisa viver hoje.** `frozen` significa que o valor é armazenado como um blob binário opaco: lido e escrito por completo, campos individuais inacessíveis. Isso é bom para um endereço pequeno, significativamente desperdiçador para uma estrutura aninhada grande atualizada campo por campo. O livro apresenta o congelamento como temporário ("no futuro, quando coleções aninhadas forem totalmente suportadas, haverá um mecanismo para 'descongelar'"), mas esse futuro não chegou, e um schema construído em torno de coleções congeladas profundamente aninhadas está se comprometendo com reescritas do valor inteiro indefinidamente.
- **TTL por coluna é elegante e assimétrico.** Expirar valores individuais sem um job de limpeza é uma vantagem real sobre os jobs de exclusão agendados do mundo relacional. Mas o TTL não pode ser definido em colunas de chave primária, não pode ser aplicado a uma linha depois do insert inicial sem reinserir a linha inteira, e só se aplica a uma coluna quando você de fato fornece um valor para ela. E expiração não é grátis: um valor expirado se torna uma tombstone, então uma tabela com TTL de alta rotatividade troca um job de limpeza por pressão de compaction e varredura de tombstones no caminho de leitura.
- **"Chaves primárias são para sempre" concentra o risco na primeira decisão que você toma.** Você pode fazer `ALTER TABLE ... ADD` de uma coluna livremente, remover uma, e adicionar tipos a um keyspace: o schema está longe de ser rígido. Mas a partition key e as clustering columns determinam o posicionamento dos dados no cluster e o layout em disco, e não podem ser mudadas. Errar nelas não é um `ALTER`; é uma tabela nova mais uma migração completa de dados em produção. Gaste tempo desproporcional ali.

## Documentation Links

- [Jeff Carpenter and Eben Hewitt, "Cassandra: The Definitive Guide", Revised 3rd Edition (O'Reilly, 2022), Chapter 4, "The Cassandra Query Language", p. 94-128](https://www.oreilly.com/library/view/cassandra-the-definitive/9781492097143/) - doc
- [Apache Cassandra Documentation, CQL Data Types](https://cassandra.apache.org/doc/latest/cassandra/developing/cql/types.html) - doc
- [Apache Cassandra Documentation, CQL Data Definition (keyspaces, tables, primary keys)](https://cassandra.apache.org/doc/latest/cassandra/developing/cql/ddl.html) - doc
- [Apache Cassandra Documentation, CQL Data Manipulation (INSERT, UPDATE, DELETE, USING TTL and TIMESTAMP)](https://cassandra.apache.org/doc/latest/cassandra/developing/cql/dml.html) - doc
- [Apache Cassandra Documentation, CQL Functions (writetime, ttl, uuid, now, toTimestamp)](https://cassandra.apache.org/doc/latest/cassandra/developing/cql/functions.html) - doc
- [Apache Cassandra Documentation, Vector CQL Data Type](https://cassandra.apache.org/doc/latest/cassandra/reference/vector-data-type.html) - doc
