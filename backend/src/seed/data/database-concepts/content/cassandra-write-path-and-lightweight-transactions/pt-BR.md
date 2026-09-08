---
version: 1.0
updatedAt: 2026-08-20
title: "Caminho de Escrita e Transações Leves no Cassandra"
summary: Uma escrita no Cassandra é rápida porque o coordenador só espera pelo passo commit-log-depois-memtable em cada réplica antes de confirmar, o descarregamento da SSTable acontece depois de o cliente já ter sido informado do sucesso, e transações leves trocam essa velocidade por linearizabilidade rodando uma negociação Paxos completa de quatro round trips (prepare/promise, read/results, propose/accept, commit/ack) restrita a uma única partição.
---
## Objective

Entender o que de fato acontece quando uma escrita chega ao Cassandra: o vai-e-volta coordenador/réplica, depois a sequência commit-log-depois-memtable dentro de cada réplica que torna escritas rápidas sem abrir mão de durabilidade, e aprender os dois mecanismos que o Cassandra oferece quando uma escrita simples não é suficiente: transações leves (compare-and-set apoiado em Paxos via `IF NOT EXISTS` / `IF <conditions>`) e batches (logados e não logados), incluindo precisamente o que cada um garante e o que não garante.

## Use Cases

- Escolher um nível de consistência de escrita para uma declaração específica e saber o que o nível compra do lado da *escrita* em particular: que `ONE` significa "commit log **e** memtable em um nó", que é o que o torna durável, e que `ANY` é o único nível onde um hint conta como uma escrita bem-sucedida.
- Explicar por que escritas no Cassandra são rápidas para alguém vindo de um banco de dados B-tree: "escrever dados é muito rápido no Cassandra, porque seu design não exige realizar leituras ou seeks de disco... todas as escritas em disco no Cassandra são apenas de anexação (append only)."
- Reforçar unicidade em uma chave primária (criar uma conta de usuário, reivindicar um número de confirmação de reserva) onde uma leitura-depois-escrita no código da aplicação teria uma corrida, e `IF NOT EXISTS` é a ferramenta correta.
- Proteger uma atualização contra um valor que você espera não ter mudado (o exemplo de contagem de inventário do livro) com `UPDATE ... IF <column> = <expected>`, e tratar os valores atuais retornados em caso de falha.
- Manter tabelas desnormalizadas sincronizadas: escrever a mesma reserva em `reservations_by_confirmation` e `reservations_by_hotel_date`, que é o caso de uso de batch que o livro de fato endossa.
- Diagnosticar um erro `Batch too large`, ou um time que recorreu a batches como um atalho de carga em massa e piorou o throughput.
- Ler o diretório de dados de um nó durante um incidente e saber para que serve cada arquivo componente de SSTable antes de decidir o que copiar.

## Deep Dive

### Níveis de consistência de escrita, especificamente em escritas

Os próprios níveis de consistência ajustáveis são cobertos no conceito companheiro sobre consistência do Cassandra; o que importa aqui é como eles se comportam no caminho de escrita. "Um nível de consistência mais alto significa que mais nós réplica precisam responder, indicando que a escrita foi completada. Níveis de consistência mais altos também vêm com uma redução de disponibilidade, já que mais nós precisam estar operacionais para a escrita ser bem-sucedida."

Dois níveis têm significado específico de escrita que vale a pena memorizar:

**`ANY` é o caso à parte.** Ele "garante que o valor seja escrito em no mínimo um nó réplica antes de retornar ao cliente, **permitindo que hints contem como uma escrita**." Se o nó alvo está fora do ar, o coordenador "vai fazer uma anotação para si mesmo, chamada hint, que vai armazenar até que aquele nó volte a ficar de pé, ou até que o hint armazenado passe da janela de expiração especificada pela propriedade `max_hint_window_in_ms`." Uma vez que o nó volta, o hint armazenado é reproduzido para ele. Em todo outro nível, um hint *não* conta para o nível de consistência, então `ANY` é a única configuração onde uma escrita "bem-sucedida" pode existir em zero réplicas.

**`ONE` é o piso de durabilidade.** "Usar o nível de consistência `ONE` em escritas significa que a operação de escrita vai ser escrita tanto no commit log quanto na memtable. Isso significa que escritas em `ONE` são duráveis, então esse nível é o mínimo a usar para atingir performance rápida e durabilidade. Se este nó cair imediatamente depois da operação de escrita e antes de a memtable ter sido descarregada para disco, o valor terá sido escrito no commit log, que pode ser reproduzido quando o servidor for trazido de volta."

O resto segue a forma que você esperaria: `TWO`/`THREE` são a mesma garantia em mais nós, `LOCAL_ONE` adiciona "o nó respondente está no data center local", `QUORUM` é `(fator de replicação / 2) + 1`, `LOCAL_QUORUM` restringe essa maioria ao DC local, `EACH_QUORUM` exige um quorum em *cada* DC, e `ALL` exige toda réplica: "se mesmo uma réplica não responder à operação de escrita, falhe a operação."

Padrões são definidos por cliente. No `cqlsh`, `CONSISTENCY;` reporta o nível atual e `CONSISTENCY LOCAL_ONE;` o define. No DataStax Java Driver é a opção de configuração `basic.request.consistency`: "se você não configurar isso, ele será definido como `LOCAL_ONE`", sobrescrevível por declaração com `statement.setConsistencyLevel(ConsistencyLevel.LOCAL_QUORUM)`.

### O caminho de escrita, entre nós e dentro de um nó

O caminho começa "quando um cliente inicia uma query de escrita para um nó Cassandra que serve como o coordenador para essa requisição. O nó coordenador usa o partitioner para identificar quais nós no cluster são réplicas, de acordo com o fator de replicação do keyspace." Dois detalhes são fáceis de perder e ambos importam operacionalmente:

- **O coordenador pode ele mesmo ser uma réplica**, "especialmente se o cliente está usando uma política de balanceamento de carga com reconhecimento de token."
- **A checagem de consistência acontece antes de qualquer coisa ser escrita.** "Se o coordenador sabe que não há réplicas suficientes de pé para satisfazer o nível de consistência solicitado, ele retorna um erro imediatamente."

Então: "o nó coordenador envia requisições de escrita simultâneas para **todas** as réplicas locais do dado sendo escrito." Não o suficiente para um quorum: todas elas. O nível de consistência governa quantas precisam *responder*, nunca quantas são *perguntadas*. Em um cluster multi-DC, "o nó coordenador local seleciona um coordenador remoto em cada um dos outros data centers para encaminhar a escrita para as réplicas naquele data center. Cada uma das réplicas remotas confirma a escrita diretamente ao nó coordenador original."

"O coordenador espera pelas réplicas responderem. Uma vez que um número suficiente de réplicas respondeu para satisfazer o nível de consistência, o coordenador confirma a escrita ao cliente. Se uma réplica não responder dentro do timeout, ela é presumida estar fora do ar, e um hint é armazenado para a escrita." Nós que perderam a escrita "serão reparados via um dos mecanismos de anti-entropia: hinted handoff, read repair, ou anti-entropy repair."

Dentro de cada réplica, a sequência é o design clássico de log-structured merge tree:

1. "o nó réplica recebe a requisição de escrita e **imediatamente escreve o dado no commit log**."
2. "Em seguida, o nó réplica escreve o dado em uma memtable. Se row caching está em uso e a linha está no cache, a linha é invalidada."
3. "Se a escrita faz o commit log ou a memtable ultrapassarem seus limiares máximos, um flush é **agendado** para rodar."
4. "Nesse ponto, a escrita é considerada bem-sucedida, e o nó pode responder ao nó coordenador ou ao cliente."
5. "**Depois de retornar**, o nó executa um flush, se um foi agendado. O conteúdo de cada memtable é armazenado como SSTables em disco, e o commit log é limpo."
6. Então a compaction é checada e realizada, se necessário.

O passo 4 é todo o truque: a confirmação acontece depois de duas operações em memória e de anexação, nunca depois de um seek de disco, e o flush é deliberadamente empurrado para depois da resposta.

A animação abaixo percorre essa sequência exata para uma escrita `QUORUM` com fator de replicação 3: o salto para o coordenador, o fan-out para as três réplicas, o trabalho commit-log-depois-memtable dentro de uma delas, os acks voltando, e o flush que acontece só depois de o cliente já ter sido informado de que a escrita foi bem-sucedida.

```viz
type: graph
node CLIENT Client 0 2
node COORD Coord 2 2
node REPA RepA 4 0
node REPB RepB 4 2
node REPC RepC 4 4
node CLOG CommitLog 6 1
node MEM Memtable 6 3
node SST SSTable 8 2
edge CLIENT COORD
edge COORD REPA
edge COORD REPB
edge COORD REPC
edge REPB CLOG
edge CLOG MEM
edge MEM SST
---
visit CLIENT | O cliente envia um INSERT em nível de consistência QUORUM. O fator de replicação é 3, então QUORUM é (3 / 2) + 1 = 2 réplicas que precisam responder.
traverse CLIENT COORD | Um cliente pode se conectar a qualquer nó. Qualquer nó que ele alcançar serve como o coordenador para esta requisição -- e pode ele mesmo ser uma das réplicas, especialmente sob uma política de balanceamento de carga com reconhecimento de token.
visit COORD | O coordenador usa o partitioner para identificar quais nós são réplicas para esta partição. Se ele já sabe que poucos estão de pé para satisfazer QUORUM, retorna um erro aqui -- antes de um único byte ser escrito em qualquer lugar.
traverse COORD REPA | O coordenador envia requisições de escrita simultâneas para TODAS as réplicas locais.
traverse COORD REPB | As três, não duas. O nível de consistência decide quantas precisam responder, nunca quantas são perguntadas.
traverse COORD REPC | A terceira réplica não responde nesta execução. A escrita ainda é enviada para ela.
visit REPB | Aproxime dentro de uma réplica. Este é o caminho de escrita da log-structured merge tree, e nunca realiza uma leitura ou um seek de disco.
traverse REPB CLOG | Primeira ação na chegada: o dado é escrito imediatamente no commit log.
visit CLOG | Um arquivo binário apenas de anexação sob data/commitlog, nomeado CommitLog-<version>-<timestamp>.log. Essa anexação é toda a garantia de durabilidade neste instante.
traverse CLOG MEM | Em seguida, o mesmo dado é escrito em uma memtable. Se row caching está ligado e esta linha está em cache, a linha em cache é invalidada.
visit MEM | A escrita agora é considerada bem-sucedida e o nó pode responder. Nada foi escrito em uma SSTable. Se um limiar foi cruzado, um flush foi AGENDADO, não executado.
traverse REPB COORD | A Réplica B confirma a escrita diretamente ao coordenador. Esse é o ack 1 dos 2 que QUORUM precisa.
visit REPA | A Réplica A fez exatamente os mesmos dois passos -- commit log, depois memtable -- em sua própria cópia.
traverse REPA COORD | Ack 2. Quorum atingido.
mark COORD | Duas das três responderam, o que satisfaz QUORUM. O coordenador não espera pela terceira.
traverse COORD CLIENT | O coordenador confirma a escrita ao cliente. Do ponto de vista do cliente, a escrita está feita, exatamente aqui.
mark CLIENT | Note o que é verdade neste momento: duas réplicas guardam o dado em memória mais commit log, uma réplica não o guarda de forma alguma, e nenhuma SSTable foi tocada.
mark REPC | A Réplica C nunca respondeu dentro do timeout, então é presumida fora do ar e um hint é armazenado para a escrita. Um hint NÃO conta como uma escrita de réplica bem-sucedida, a menos que o nível de consistência seja ANY. Será reconciliada por hinted handoff, read repair, ou anti-entropy repair.
traverse MEM SST | Só depois de responder o nó executa o flush que foi agendado anteriormente.
visit SST | O conteúdo da memtable é escrito como arquivos componentes de SSTable -- Data.db, Index.db, Filter.db e afins -- e o commit log é limpo. O cliente foi informado de "sucesso" vários passos atrás; este passo é o que transforma isso em permanência em disco sem que o cliente jamais espere por ele.
```

### Escrevendo arquivos em disco

Commit logs são arquivos binários sob `$CASSANDRA_HOME/data/commitlog`, nomeados `CommitLog-<version>-<timestamp>.log` (o exemplo do livro: `CommitLog-7-1566780133999.log`). "A versão é um inteiro representando o formato do commit log. Por exemplo, a versão para a versão 4.0 é 7."

SSTables vivem sob `$CASSANDRA_HOME/data/data`, um diretório por keyspace, depois um por tabela nomeado `<table>-<UUID>`: "o propósito do UUID é distinguir entre múltiplas versões de schema", por exemplo `hotel/hotels-3677bbb0155811e5899aa9fac1d00bce`. Cada SSTable é **vários arquivos**, nomeados `<version>-<generation>-<implementation>-<component>.db`:

- **version**: dois caracteres para a versão maior/menor do formato de SSTable; `na` para a versão 4.0.
- **generation**: "um número de índice que é incrementado toda vez que uma nova SSTable é criada para uma tabela."
- **implementation**: a implementação de `SSTableWriter`; a partir da 4.0 o valor é `big`, o "formato Bigtable".

E os componentes:

| Componente | Propósito |
|---|---|
| `Data.db` | O dado real, e "os únicos arquivos preservados pelos mecanismos de backup do Cassandra" |
| `Index.db` | Offsets de linha e coluna dentro de `Data.db`; lido em memória para que o Cassandra saiba exatamente onde buscar |
| `Summary.db` | Uma amostra do índice, para leituras mais rápidas |
| `Filter.db` | O Bloom filter para esta SSTable |
| `CompressionInfo.db` | Metadado sobre a compressão de `Data.db` |
| `Digest.crc32` | Um checksum CRC32 para `Data.db` |
| `Statistics.db` | Estatísticas usadas pelo `nodetool tablehistograms` |
| `TOC.txt` | Lista os arquivos componentes desta SSTable |

Repare na linha de `Data.db` se você algum dia construir um backup manualmente: é o único componente que os mecanismos de backup embutidos preservam. Versões anteriores à 2.2 prefixavam cada nome de arquivo com o nome do keyspace e da tabela; a 2.2 e posteriores abandonam isso, já que é inferível do diretório.

Se você está experimentando em um nó real e nenhuma SSTable apareceu ainda, `nodetool flush` força o flush, em vez de esperar por um limiar.

### Transações leves: Paxos, e o que "caro" significa concretamente

O Cassandra "não suporta transações com semântica ACID completa", mas ele "fornece dois mecanismos que oferecem algum comportamento transacional: transações leves e batches." O mecanismo LWT, introduzido na 2.0, existe para resolver um problema específico que níveis de consistência sozinhos não conseguem: "consistência forte não é suficiente para prevenir condições de corrida em casos onde clientes precisam ler, e então escrever dados." Ler-depois-escrever no código da aplicação tem uma janela; uma LWT a fecha. A propriedade que ela fornece é **consistência linearizável**: "gostaríamos de garantir que nenhum outro cliente possa entrar entre nossas queries de leitura e escrita com sua própria modificação."

A semântica:

- Em `INSERT`, `IF NOT EXISTS` "vai garantir que você não sobrescreva uma linha existente com a mesma chave primária": o caso de unicidade, identidade de usuário, contas, registros de reserva. `IF EXISTS` é a imagem espelhada, "efetivamente limitando o comportamento de upsert do Cassandra."
- Em `UPDATE`, `IF <conditions>` checa uma ou mais condições unidas por `AND`, cada uma uma checagem em uma coluna usando `=`, `!=`, `>`, `>=`, `<`, `<=`, ou `IN`. "Isso é frequentemente usado para garantir que uma linha tenha um valor esperado que não pode mudar antes de uma escrita ocorrer": o caso de contagem de inventário.

```sql
INSERT INTO reservation.reservations_by_confirmation (confirm_number,
  hotel_id, start_date, end_date, room_number, guest_id) VALUES (
  'RS2G0Z', 'NY456', '2020-06-08', '2020-06-10', 111,
  1b4d86f4-ccff-4256-a63d-45c905df2677) IF NOT EXISTS;

 [applied]
-----------
      True
```

Rode uma segunda vez e `[applied]` volta `False`, **junto com a linha que a bloqueou**. Esse eco é um recurso deliberado: "se uma transação falha porque os valores existentes não corresponderam aos que você esperava, o Cassandra vai incluir os valores atuais para que você possa decidir se tenta de novo ou aborta sem precisar fazer uma requisição extra." A forma `UPDATE` se comporta da mesma forma:

```sql
UPDATE reservation.reservations_by_confirmation SET end_date='2020-06-12'
  WHERE confirm_number='RS2G0Z' IF end_date='2020-06-10';
```

Como o modelo normal do Cassandra é upsert, "a sintaxe `IF NOT EXISTS` disponível em `INSERT`, e a sintaxe `IF x=y` em `UPDATE` representam a principal diferença semântica entre essas duas operações." O CQL também aceita `IF NOT EXISTS` em `CREATE KEYSPACE` / `CREATE TABLE`, o que é útil ao scriptar atualizações de schema.

Do driver Java, uma declaração condicional é construída com `.ifNotExists()`, e o resultado carrega uma única linha com uma coluna booleana `applied`, também alcançável através de `resultSet.wasApplied()`.

**O custo é estrutural, não incidental.** Paxos "é um algoritmo de consenso que permite que nós pares distribuídos concordem sobre uma proposta, sem exigir um líder para coordenar uma transação": uma alternativa ao commit em duas fases. O Paxos básico tem dois estágios, prepare/promise e propose/accept: "um nó coordenador pode propor um novo valor aos nós réplica, assumindo o papel de líder. Outros nós podem atuar como líderes simultaneamente para outras modificações. Cada nó réplica checa a proposta, e se a proposta é a mais recente que ele viu, promete não aceitar propostas associadas a qualquer proposta anterior... Se a proposta é aprovada por uma maioria de réplicas, o líder confirma a proposta, mas com a ressalva de que primeiro precisa confirmar quaisquer propostas em andamento que precederam a sua própria proposta."

O Cassandra estende isso para obter semântica de leitura-antes-de-escrever (check-and-set) e para resetar o estado entre transações, "inserindo duas fases adicionais no algoritmo":

1. Prepare/Promise
2. Read/Results
3. Propose/Accept
4. Commit/Ack

"Assim, uma transação bem-sucedida exige **quatro round-trips** entre o nó coordenador e as réplicas. Isso é mais caro do que uma escrita normal, motivo pelo qual você deveria pensar cuidadosamente sobre seu caso de uso antes de usar LWTs."

Escritas condicionais também carregam um segundo nível de consistência: "declarações de escrita condicional usam um **nível de consistência serial** além do nível de consistência normal. O nível de consistência serial determina o número de nós que precisam responder na fase Paxos da escrita, quando os nós participantes estão negociando sobre a escrita proposta." `SERIAL` (o padrão) significa que um quorum de nós precisa responder; `LOCAL_SERIAL` restringe a transação ao data center local. Aplica-se também em leituras: "se o Cassandra detecta que uma query está lendo dado que é parte de uma transação não confirmada, ele confirma a transação como parte da leitura, de acordo com o nível de consistência serial especificado." Defina-o com `SERIAL CONSISTENCY` no `cqlsh`, a opção de driver `serial-consistency`, ou `Statement.setSerialConsistencyLevel()` por declaração.

Por fim, o limite de escopo: "transações leves do Cassandra são limitadas a uma única partição. Internamente, o Cassandra armazena um estado Paxos para cada partição. Isso garante que transações em partições diferentes não podem interferir umas com as outras."

A segunda animação traça essas quatro fases. Compare diretamente com a primeira: a escrita `QUORUM` simples acima foi **um** round trip coordenador-para-réplica e não ofereceu nenhuma proteção contra um cliente concorrente escrevendo a mesma chave entre sua leitura e sua escrita. Esta paga quatro round trips e compra exatamente essa proteção.

```viz
type: graph
node CLIENT Client 0 2
node LEAD Leader 2 2
node PA RepA 4 0
node PB RepB 4 2
node PC RepC 4 4
node BALLOT PaxosState 6 1
node ROW Row 6 3
edge CLIENT LEAD
edge LEAD PA
edge LEAD PB
edge LEAD PC
edge PB BALLOT
edge PC ROW
---
visit CLIENT | O cliente envia INSERT ... IF NOT EXISTS. Essa cláusula IF é toda a diferença: transforma uma escrita comum em uma transação leve com semântica de leitura-antes-de-escrever, check-and-set.
traverse CLIENT LEAD | O coordenador assume o papel de líder Paxos para esta proposta. Paxos não precisa de um líder eleito -- outros nós podem liderar outras propostas ao mesmo tempo. A transação tem escopo de uma única partição.
visit LEAD | ROUND TRIP 1 de 4 -- Prepare/Promise. O líder propõe uma cédula (ballot) às réplicas desta única partição.
traverse LEAD PA | prepare(ballot)
traverse LEAD PB | prepare(ballot)
traverse LEAD PC | prepare(ballot). O nível de consistência serial, SERIAL por padrão, decide quantos precisam responder durante essa negociação. LOCAL_SERIAL o restringe ao data center local.
visit PB | Cada réplica checa a proposta. Se é a cédula mais recente que aquela réplica viu, ela promete não aceitar nenhuma proposta anterior -- e retorna a última proposta que recebeu que ainda está em andamento.
traverse PB BALLOT | Essa promessa é durável, não apenas em trânsito: o Cassandra mantém um estado Paxos por partição, na tabela system.paxos.
visit BALLOT | Um estado Paxos por partição é precisamente por que LWTs não conseguem abranger partições -- e por que transações em partições diferentes não podem interferir umas com as outras.
traverse PB LEAD | promise
traverse PA LEAD | Uma segunda promessa. Um quorum prometeu, então a fase 1 está completa -- e ainda absolutamente nada foi escrito.
mark LEAD | ROUND TRIP 2 de 4 -- Read/Results. Esta fase é a adição do Cassandra ao Paxos básico: ler o valor atual para que a condição IF possa de fato ser avaliada.
traverse LEAD PC | O líder lê o estado atual da linha a partir das réplicas.
visit PC | Este nó guarda a partição sendo escrita.
traverse PC ROW | Lê a linha com chave primária confirm_number = 'RS2G0Z'.
visit ROW | A condição é avaliada aqui. Se uma linha já existia, a declaração retorna [applied] = False junto com os valores existentes, para que o cliente possa tentar de novo ou abortar sem uma segunda requisição. Nesta execução nenhuma linha existe, então IF NOT EXISTS se sustenta.
traverse PC LEAD | results
mark LEAD | ROUND TRIP 3 de 4 -- Propose/Accept. Só agora o líder propõe o valor real.
traverse LEAD PA | propose(value)
visit PA | Uma réplica aceita, desde que não tenha desde então prometido uma cédula mais nova. Se um quorum aceita, o valor está decidido -- com a ressalva de que o líder precisa primeiro confirmar qualquer proposta em andamento que precedeu a sua própria.
traverse PA LEAD | accept
mark LEAD | ROUND TRIP 4 de 4 -- Commit/Ack. O valor decidido é finalmente aplicado através do caminho de escrita comum -- commit log depois memtable em cada réplica -- no nível de consistência regular da declaração.
traverse LEAD PB | commit
traverse LEAD PC | commit
traverse CLIENT LEAD | O cliente recebe de volta uma única linha com uma coluna booleana applied. Quatro round trips coordenador-para-réplica compraram linearizabilidade em uma partição; a escrita QUORUM simples na animação anterior fez o mesmo trabalho em um round trip e não ofereceu nada disso.
mark CLIENT | Use isso onde uma corrida de fato corromperia dados -- reivindicar um nome de conta único, um número de reserva, decrementar uma contagem de inventário -- e não como um modo de escrita padrão.
```

### Batches: o que são e o que não são

"Enquanto transações leves são limitadas a uma única partição, o Cassandra fornece um mecanismo de batch que permite agrupar múltiplas modificações em uma única declaração, seja endereçando a mesma partição ou partições diferentes."

As regras:

- Apenas `INSERT`, `UPDATE`, ou `DELETE` podem aparecer em um batch.
- Batches são logados ou não logados; batches logados "têm mais salvaguardas."
- "**Batches não são um mecanismo de transação**, mas você pode incluir declarações de transação leve em um batch. Múltiplas transações leves em um batch precisam se aplicar à mesma partição."
- Modificações de counter só vão em um *batch de counter*, que não pode conter mais nada. Os drivers DataStax não têm um tipo de batch de counter separado: "você simplesmente precisa lembrar de criar batches que incluam apenas modificações de counter ou apenas modificações que não sejam de counter."

Um batch logado é `BEGIN BATCH ... APPLY BATCH` em CQL, ou `BatchStatement` (ou `BatchStatementBuilder`) no driver Java. O caso de uso endossado é estreito e específico: "fazer múltiplas atualizações em uma única partição, ou manter múltiplas tabelas sincronizadas. Um bom exemplo é fazer modificações em tabelas desnormalizadas que armazenam o mesmo dado para padrões de acesso diferentes": escrever a mesma reserva tanto em `reservations_by_confirmation` quanto em `reservations_by_hotel_date`.

**O que "logado" de fato garante.** "Batches logados são atômicos, ou seja, se o batch é aceito, todas as declarações em um batch eventualmente vão ter sucesso." Mas leia a qualificação com cuidado: "isso não é a mesma definição de atomicidade a que você pode estar acostumado se tem background em banco de dados relacional. Enquanto todas as atualizações em um batch pertencentes a uma dada partition key são realizadas atomicamente, **não há garantia entre partições. Isso significa que modificações em partições diferentes podem ser lidas antes de o batch completar.**" Então é tudo-ou-nada eventual, sem isolamento: sem rollback, e leitores podem ver um batch meio aplicado.

Mecanicamente: "o coordenador envia uma cópia do batch chamada batchlog para dois outros nós, onde é armazenada na tabela `system.batchlog`. O coordenador então executa todas as declarações no batch, e deleta o batchlog dos outros nós depois que as declarações são completadas." Se o coordenador morre no meio do batch, esses nós o reproduzem. "Cada nó checa seu batchlog uma vez por minuto para ver se há batches que deveriam ter completado", usando um período de graça "igual a duas vezes o valor da propriedade `write_request_timeout_in_ms`"; qualquer coisa mais antiga é reproduzida e depois deletada. A segunda cópia do batchlog é redundância para o próprio mecanismo.

**Batches não logados pulam tudo isso.** "Em um batch não logado, os passos envolvendo o batchlog são pulados, permitindo que a escrita complete mais rapidamente. Usuários tentando inserir rapidamente muito dado são frequentemente tentados a usar batches não logados. O trade-off que você vai querer considerar é que não há garantia de que todas as escritas para partições diferentes vão completar com sucesso, o que poderia deixar o banco de dados em um estado inconsistente. **Esse risco não existe quando um batch contém mutações para uma única partição.**" Essa última frase tem uma consequência interessante: "se você solicita um batch logado com mutações para uma única partição, o Cassandra na verdade o executa como um batch não logado, para te dar um impulso extra de velocidade." Batches logados de partição única são de graça.

**Batches não são carga em massa (bulk loading).** "Usuários de primeira viagem frequentemente confundem batches com uma forma de obter performance mais rápida para atualizações em massa. Definitivamente não é o caso: batches na verdade diminuem a performance e podem causar pressão de garbage collection."

O tamanho tem teto em bytes, não em contagem de declaração: `batch_size_warn_threshold_in_kb` registra um WARN, e qualquer batch acima de `batch_size_fail_threshold_in_kb` "vai ser rejeitado e resultar em notificação de erro ao cliente." Os padrões são 5 KB e 50 KB. "Para declarações simples, o tamanho é o comprimento de cada query CQL, mas o tamanho vai ser menor para prepared statements, já que apenas o ID da declaração e os valores de parâmetro são enviados": outra razão para preparar.

### Book vs today

O caminho de escrita, a semântica de LWT, as garantias de batch, e os componentes de SSTable ainda são todos precisos no Cassandra 5.0. Quatro coisas mudaram desde a 3ª edição revisada (que visa a 4.0):

> **O Paxos v2 corta os round trips pela metade, mas ainda é opt-in.** O Cassandra 4.1 lançou uma implementação Paxos reformulada (CEP-14), selecionada com a configuração `paxos_variant`. Os comentários do `cassandra.yaml` enunciam o custo explicitamente: `v1` (ainda o padrão na 5.0) é "Paxos legado. Espere 4RTs para uma escrita e 3RTs para uma leitura": exatamente os quatro round trips que o livro descreve, enquanto `v2` é "Paxos otimizado. Espere 2RTs para uma escrita, e 1RT ou 2RT para uma leitura", e é marcado "(recomendado)". Trocar é um procedimento contínuo (rolling) documentado (todos os nós na 4.1+, `nodetool repair --full -pr` em cada nó, então definir `paxos_variant: v2` e reinício contínuo) e reverter não precisa de migração de dado. O conselho do livro de "pense cuidadosamente antes de usar LWTs" ainda se sustenta; o preço em um cluster moderno e corretamente configurado é aproximadamente metade do que o livro cita.

> **As propriedades do `cassandra.yaml` neste capítulo foram renomeadas na 4.1.** A CASSANDRA-15234 separou nomes de parâmetro de suas unidades. `max_hint_window_in_ms` agora é `max_hint_window: 3h`, `write_request_timeout_in_ms` agora é `write_request_timeout: 2000ms`, e os limiares de batch são `batch_size_warn_threshold: 5KiB` e `batch_size_fail_threshold: 50KiB`: mesmos padrões, nomes novos e unidades explícitas. Nomes antigos continuam suportados através de uma camada de compatibilidade retroativa, então os nomes do livro ainda funcionam; simplesmente não são mais o que você vai ver em um `cassandra.yaml` atual.

> **Números de generation de SSTable não são mais necessariamente números.** O livro descreve `generation` como "um número de índice que é incrementado toda vez que uma nova SSTable é criada para uma tabela". O Cassandra 4.1 adicionou identificadores no estilo ULID, globalmente únicos e ordenáveis lexicograficamente, para evitar colisões de nome de arquivo entre backups e depois de ciclos de truncate/reinício, habilitados com `uuid_sstable_identifiers_enabled: true` (desligado por padrão). O inteiro sequencial ainda é o que você obtém de fábrica.

> **`big` não é mais o único formato de SSTable.** O livro afirma que o componente de implementação é `big`, "o 'formato Bigtable'". O Cassandra 5.0 adicionou um formato `bti` indexado por trie, selecionado via `sstable: selected_format:`. O padrão continua sendo `big`, e a documentação observa que com o formato BIG, índices de colação grandes não podem ser armazenados em cache eficientemente, recomendando BTI para partições muito grandes. Isso é uma adição, não uma depreciação.

## Trade-offs

- **Uma transação leve custa aproximadamente quatro vezes o custo de rede de uma escrita normal, e o livro diz isso claramente.** "Uma transação bem-sucedida exige quatro round-trips entre o nó coordenador e as réplicas. Isso é mais caro do que uma escrita normal, motivo pelo qual você deveria pensar cuidadosamente sobre seu caso de uso antes de usar LWTs." Isso não é uma preocupação de micro-otimização: em um cluster entre regiões, quatro round trips coordenador-para-réplica em `SERIAL` (em vez de `LOCAL_SERIAL`) significa quatro latências de WAN serializadas em uma declaração. A postura correta é identificar o pequeno conjunto de escritas onde uma corrida genuinamente corrompe dados (reivindicar um nome de usuário único, um número de confirmação, decrementar inventário) e usar LWTs exatamente ali. Espalhar `IF NOT EXISTS` em todo insert "por segurança" converte seu caminho de escrita rápido no mais lento. O Paxos v2 na 4.1+ melhora isso para aproximadamente dois round trips, o que muda a magnitude, mas não a forma da decisão.
- **LWTs também são uma armadilha de disputa, não apenas uma armadilha de latência.** O estado Paxos é por partição, que é a propriedade que mantém transações em partições diferentes independentes, mas significa que LWTs concorrentes na *mesma* partição disputam diretamente, com propostas invalidando umas às outras e tentando de novo. Uma partição quente sob carga de LWT degrada muito pior do que a mesma partição sob escritas simples. Desenhe a partition key de forma que transações concorrentes sejam naturalmente espalhadas, em vez de tratar o throughput de LWT como um problema de ajuste.
- **`ANY` é o único nível de consistência que pode reportar sucesso com o dado em nenhuma réplica de forma alguma.** Todo outro nível exige uma escrita real de commit-log-mais-memtable em pelo menos um nó; `ANY` aceita um hint como a escrita. Se toda réplica está fora do ar, o hint fica no coordenador, e expira depois de `max_hint_window` (3h por padrão), se o nó nunca voltar. A escrita então simplesmente some, tendo sido confirmada como bem-sucedida. `ANY` compra disponibilidade durante uma interrupção parcial e paga por isso com uma confirmação que não significa o que uma confirmação normalmente significa.
- **O caminho commit-log-depois-memtable é durável e rápido, mas sua durabilidade é inteiramente do commit log.** No instante em que uma réplica confirma, o dado existe na memtable daquele nó (volátil) e em seu commit log (em disco, apenas anexação). Nada está em uma SSTable. Uma queda antes do flush é totalmente recuperável, o commit log é reproduzido no reinício, mas apenas na medida em que o próprio commit log estava em armazenamento estável. Isso significa que configurações de sincronização de commit log, comportamento do sistema de arquivos, e cache de escrita em nível de disco são a superfície real de durabilidade, não a memtable. E o flush é agendado *depois* da resposta, então quedas de throughput e pressão de GC de um flush grande aparecem como latência em escritas que já tiveram sucesso.
- **Batches não logados são a forma mais fácil de acidentalmente construir uma falsa transação multi-linha.** Parecem transacionais (`BEGIN BATCH ... APPLY BATCH`), pulam o batchlog completamente, e oferecem "nenhuma garantia de que todas as escritas para partições diferentes vão completar com sucesso, o que poderia deixar o banco de dados em um estado inconsistente." O modo de falha é silencioso: funciona bem em testes, e então uma falha de coordenador deixa duas tabelas desnormalizadas permanentemente discordando, sem nenhum registro de que um batch já esteve em trânsito. Se um batch abrange partições e você se importa com tudo aterrissando, precisa ser logado. Se não abrange partições, logar é de graça de qualquer forma: o Cassandra o rebaixa para não logado por você.
- **Mesmo um batch logado não é uma transação relacional.** "Todas as atualizações em um batch pertencentes a uma dada partition key são realizadas atomicamente", mas "não há garantia entre partições... modificações em partições diferentes podem ser lidas antes de o batch completar." Não há isolamento e nenhum rollback: leitores podem observar um batch parcialmente aplicado, e um batch que foi aceito eventualmente vai completar, quer você queira ou não. Batches logados te dão conclusão eventual, não uma fronteira de transação.
- **Fazer batching por throughput é ativamente contraproducente.** "Batches na verdade diminuem a performance e podem causar pressão de garbage collection", e a variante logada "coloca trabalho adicional no coordenador para orquestrar a execução das várias declarações", mais duas escritas extras de batchlog. Os limites de tamanho (`5KiB` warn, `50KiB` fail) existem precisamente para parar esse padrão antes que desestabilize um nó. O benefício genuíno ("economiza tráfego de ida e volta entre o cliente e o nó coordenador") é real, mas pequeno perto de escritas assíncronas individuais concorrentes, que é o que uma carga em massa deveria usar em vez disso.
- **Enviar a escrita para todas as réplicas enquanto espera apenas por um quorum é uma assimetria deliberada com um custo.** Toda escrita consome o equivalente ao fator de replicação em rede e CPU, independentemente do nível de consistência; só a *espera* é encurtada. Baixar o nível de consistência, portanto, melhora latência e disponibilidade sem reduzir a carga do cluster de forma alguma. Também significa que uma réplica lenta não desacelera sua escrita, mas continua acumulando hints, o que é um custo adiado que aterrissa mais tarde, no momento de replay do hint, em um nó que acabou de voltar e já está se recuperando.

## Documentation Links

- [Jeff Carpenter and Eben Hewitt, "Cassandra: The Definitive Guide", Revised 3rd Edition (O'Reilly, 2022), Chapter 9, "Writing and Reading Data" (Writing), p. 285-304](https://www.oreilly.com/library/view/cassandra-the-definitive/9781492097143/) - doc
- [Apache Cassandra Documentation, Dynamo: Writes](https://cassandra.apache.org/doc/latest/cassandra/architecture/dynamo.html#writes) - doc
- [Apache Cassandra Documentation, Lightweight Transactions](https://cassandra.apache.org/doc/latest/cassandra/architecture/dynamo.html#lightweight-transactions) - doc
- [Apache Cassandra Documentation, Storage Engine (commit log, memtables, SSTables)](https://cassandra.apache.org/doc/latest/cassandra/architecture/storage-engine.html) - doc
- [Apache Cassandra Documentation, cassandra.yaml File Configuration](https://cassandra.apache.org/doc/latest/cassandra/managing/configuration/cass_yaml_file.html) - doc
- [Apache Cassandra Documentation, Liberating cassandra.yaml Parameters' Names from Their Units](https://cassandra.apache.org/doc/4.1/cassandra/configuration/configuration.html) - doc
- [Apache Cassandra Blog, Apache Cassandra 4.1: New SSTable Identifiers](https://cassandra.apache.org/_/blog/Apache-Cassandra-4.1-New-SSTable-Identifiers.html) - doc
- [Apache Cassandra Wiki, CEP-14: Paxos Improvements](https://cwiki.apache.org/confluence/display/CASSANDRA/CEP-14:+Paxos+Improvements) - doc
- [CQL Reference, BATCH](https://cassandra.apache.org/doc/latest/cassandra/developing/cql/dml.html#batch) - doc
