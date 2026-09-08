---
version: 1.0
updatedAt: 2026-08-20
title: "Caminho de Leitura, Last-Write-Wins e Read Repair no Cassandra"
summary: Em uma leitura, o coordenador pede a linha à réplica mais rápida e a toda outra réplica apenas um digest dela, resolve qualquer discordância escolhendo a célula com o timestamp mais recente (last write wins, com desempate lexicográfico), e então repara de forma transparente, via read repair, as réplicas que responderam com dados obsoletos como parte dessa mesma requisição, um mecanismo que é oportunista por design, hoje configurado pela opção de tabela read_repair do Cassandra 4.0 em vez do removido read_repair_chance do livro, e que nunca substitui o repair de anti-entropia agendado.
---
## Objective

Entender o que de fato acontece entre um `SELECT` do CQL e a linha que volta: como um coordenador escolhe quais réplicas perguntar, por que ele pergunta a uma delas pelo dado e ao resto apenas por um *hash* do dado, como ele reconcilia réplicas discordantes por timestamp ("last write wins"), e como uma réplica desatualizada é corrigida **durante essa mesma leitura** pelo read repair, em vez de por um job de manutenção separado. Depois, as regras de formato de query que decorrem do layout de armazenamento (`WHERE`, `ORDER BY`, `ALLOW FILTERING`, `IN`), e como a paginação impede que um conjunto de resultados grande derrube o cliente ou o cluster.

## Use Cases

- Explicar a um time por que uma leitura em `ONE` acabou de retornar um valor que eles sobrescreveram um segundo atrás, e por que a *próxima* leitura da mesma linha retorna o valor novo sem ninguém fazer nada.
- Escolher níveis de consistência de leitura e escrita juntos para uma dada tabela, usando a regra `R + W > RF`, em vez de definir os dois como `QUORUM` por hábito.
- Diagnosticar um incidente do tipo "o dado está errado em um nó" e decidir se é uma situação em que o read repair vai resolver, ou uma situação em que é preciso rodar `nodetool repair` agora.
- Revisar uma query que alguém fez funcionar acrescentando `ALLOW FILTERING`, e transformá-la de volta em uma questão de modelagem de dados.
- Dimensionar páginas para uma varredura grande no DataStax Java Driver, incluindo pré-buscar a próxima página para que o usuário nunca sinta a pausa, e persistir estado de paginação em um serviço web sem estado.
- Escrever um item de runbook para saúde de NTP/relógio, depois de entender que desvio de relógio no Cassandra é um problema de *corretude*, não uma sutileza de monitoramento.

## Deep Dive

Duas propriedades enquadram tudo o mais. Primeiro, leituras são fáceis de *rotear*: "clientes podem se conectar a qualquer nó do cluster para realizar leituras, sem precisar saber se um determinado nó atua como réplica para aquele dado." Se o nó que você atinge não é uma réplica, ele se torna o **coordenador** e lê de um nó que é, "identificado por intervalos de token."

Segundo, leituras são o lado caro do Cassandra: "no Cassandra, leituras geralmente são mais lentas do que escritas, devido ao I/O de arquivo ao ler SSTables." Cumprir uma leitura tipicamente significa seeks, esperar por outros nós de forma síncrona (quantos depende do nível de consistência e do fator de replicação), "e então realizar read repairs conforme necessário." Tudo abaixo é a maquinaria por trás dessa frase.

### Níveis de consistência de leitura

Os níveis de leitura parecem os níveis de escrita, mas se comportam de forma diferente por baixo dos panos. O conceito irmão sobre os níveis de consistência do Cassandra cobre o próprio modelo de consistência ajustável (o que `QUORUM` significa, como `LOCAL_*` interage com data centers, por que o modelo é por query em vez de por cluster), então o que importa aqui é apenas o que cada nível implica *para uma leitura*:

| Nível | Comportamento de leitura |
|---|---|
| `ONE`, `TWO`, `THREE` | Retorna o registro guardado pelo(s) primeiro(s) nó(s) que responder(em). O registro é checado contra o mesmo registro em outras réplicas; se alguma estiver desatualizada, um read repair as sincroniza para o valor mais recente. |
| `LOCAL_ONE` | Como `ONE`, com a exigência extra de que o nó respondente esteja no data center local. |
| `QUORUM` | Consulta todos os nós. Assim que `(fator de replicação / 2) + 1` respondem, retorna o valor com o timestamp mais recente, depois faz read repair nas réplicas restantes se necessário. |
| `LOCAL_QUORUM` | Como `QUORUM`, restrito ao data center local. |
| `EACH_QUORUM` | Um quorum precisa responder *em cada* data center. |
| `ALL` | Consulta todos os nós, espera por todos eles, retorna o registro com o timestamp mais recente, depois repara se necessário. Se qualquer nó falhar em responder, a leitura falha. |

Três detalhes que costumam confundir as pessoas:

- **`ANY` não é suportado para leituras.** Existe apenas no lado da escrita (onde um hint conta como uma escrita).
- **`ONE` significa "o primeiro que responde vence", desatualizado ou não.** "A operação de read repair é realizada *depois* que o registro é retornado, então quaisquer leituras subsequentes vão todas ter um valor consistente, independentemente do nó respondente." O valor obsoleto ainda foi para o cliente uma vez.
- **`ALL` converte um nó lento em uma query falhada.** "Um nó é considerado não responsivo se não responder a uma query antes do valor especificado por `read_request_timeout_in_ms` no arquivo de configuração. O padrão é 5 segundos."

O box do livro sobre alinhar os níveis é a regra prática: consistência forte vem de níveis de leitura e escrita *cuja soma excede o fator de replicação*. Em `RF=3`, leituras em `QUORUM` mais escritas em `QUORUM` dá `2 + 2 > 3`: forte. Escritas em `QUORUM` mais leituras em `ONE` dá `2 + 1`, que é meramente *igual* a 3, então não é forte: "se você só tem garantia de escritas em duas de três réplicas, certamente existe uma chance de que uma das réplicas não tenha recebido a escrita e ainda não tenha sido reparada, e uma leitura no nível de consistência `ONE` poderia ir exatamente para esse nó."

### O caminho de leitura, entre nós

O caminho de leitura começa quando o cliente envia uma query ao coordenador. Como o caminho de escrita, o coordenador "usa o partitioner para determinar as réplicas, e checa se há réplicas suficientes de pé para satisfazer o nível de consistência solicitado", e um coordenador remoto é escolhido por data center para leituras multi-DC.

Depois a parte que é específica de leituras:

> Se o próprio coordenador não é uma réplica, o coordenador envia uma **requisição de leitura para a réplica mais rápida, conforme determinado pelo snitch dinâmico**. O nó coordenador também envia uma **requisição de digest** para as outras réplicas. "Uma requisição de digest é parecida com uma requisição de leitura padrão, exceto que as réplicas retornam um digest, ou hash, do dado solicitado."

O coordenador calcula o digest do dado que recebeu da réplica mais rápida e o compara contra os digests das outras. **Se os digests concordam e o nível de consistência é atingido, o dado da réplica mais rápida é retornado.** Se discordam, o coordenador precisa realizar um read repair.

Esse é o truque de controle de custo que vale a pena internalizar: apenas *uma* réplica transmite dados reais de linha pela rede. A checagem de consistência em si custa um hash por réplica extra, não uma linha por réplica extra.

### O caminho de leitura, dentro de uma réplica

Quando uma réplica recebe a requisição de leitura, ela desce por uma escada, onde cada degrau existe para evitar o degrau abaixo dele:

1. **Row cache.** Se a linha está lá, retorna imediatamente. Ajuda linhas acessadas com frequência.
2. **Memtable + SSTables.** Existe exatamente uma memtable por tabela, então essa parte é trivial. Mas pode haver muitas SSTables em disco, cada uma potencialmente guardando uma porção do dado solicitado.
3. **Bloom filter**, por SSTable: "o primeiro passo ao buscar SSTables em disco é usar um Bloom filter para determinar se a partição solicitada *não existe* em uma dada SSTable, o que tornaria desnecessário buscar naquela SSTable."
4. **Key cache**: um mapa de `(descritor de arquivo SSTable, partition key)` para uma posição de offset no arquivo SSTable. Um acerto elimina seeks completamente.
5. **Partition summary → partition index.** Em um erro de key cache, um índice em disco de dois níveis: o *partition summary* de primeiro nível dá um offset dentro do *partition index* de segundo nível, que guarda o offset real na SSTable para a partition key.
6. **Leitura de SSTable naquele offset**, com o **chunk cache** (adicionado na versão 3.6) guardando chunks de SSTable acessados com frequência.

Depois a reconciliação que faz o resto do modelo funcionar: "uma vez que o dado foi obtido de todas as SSTables, o Cassandra **mescla o dado da SSTable e o dado da memtable selecionando o valor com o timestamp mais recente para cada coluna solicitada**." Last write wins não é uma regra exclusiva de sistemas distribuídos: é já assim que um único nó monta uma linha a partir de seus próprios arquivos imutáveis. Uma requisição de digest é tratada de forma idêntica, "com o passo adicional de que um digest é calculado sobre o dado resultante e retornado em vez do próprio dado."

### Read repair

Quando os digests discordam, o coordenador escala:

1. Ele faz uma **requisição de leitura completa de todos os nós réplica**.
2. Ele **mescla o dado selecionando um valor para cada coluna solicitada**: o valor com o timestamp mais recente. Se dois valores carregam o *mesmo* timestamp, "ele vai comparar os valores lexicograficamente e escolher o que tem o maior valor. Esse caso deveria ser extremamente raro."
3. O dado mesclado é o que volta para o cliente.
4. **Assincronamente, o coordenador identifica quaisquer réplicas que retornaram dado obsoleto e emite uma requisição de read-repair para cada uma delas, para atualizar seu dado com base no dado mesclado.**

O passo 4 é todo o ponto: a réplica desatualizada é corrigida *como efeito colateral de uma leitura normal da aplicação*. Ninguém o agendou. Isso é distinto do repair de anti-entropia completo (`nodetool repair`), que é um processo deliberado, de todo o cluster, rodado pelo operador.

A ordenação em relação ao cliente importa e depende do nível. "Se você está usando um dos dois níveis de consistência mais fortes (`QUORUM` ou `ALL`), então o read repair acontece **antes** de o dado ser retornado ao cliente. Se o cliente especifica um nível de consistência fraco (como `ONE`), então o read repair é opcionalmente realizado em segundo plano **depois** de retornar ao cliente."

A animação abaixo percorre uma única leitura `QUORUM` em `RF=3`, onde exatamente uma réplica está atrasada:

```viz
type: graph
node CLIENT Client 0 2
node COORD Coordinator 2 2
node RA ReplicaA 4 0
node RB ReplicaB 4 2
node RC ReplicaC 4 4
edge CLIENT COORD
edge COORD RA
edge COORD RB
edge COORD RC
---
visit CLIENT | SELECT start_date FROM reservations_by_confirmation WHERE confirm_number = 'RS2G0Z' no nível de consistência QUORUM. O cliente se conecta a qualquer nó que seu driver escolheu. Ele não precisa saber quais nós são réplicas.
traverse CLIENT COORD | Esse nó se torna o coordenador para esta leitura. Ele não é necessariamente uma réplica para esta partição.
visit COORD | O coordenador faz hash da partition key com o partitioner para obter um token, mapeia o token para as três réplicas, e confirma que réplicas suficientes estão de pé para satisfazer QUORUM, que em RF=3 é dois.
traverse COORD RA | O snitch dinâmico diz que a Réplica A é atualmente a mais rápida, então só A recebe uma requisição de leitura completa pelo dado real da linha.
visit RA | A erra o row cache, mescla sua memtable com as SSTables que sobreviveram ao Bloom filter, e retorna start_date = 2016-01-06 escrito no timestamp 1567886623298243.
traverse COORD RB | B recebe uma requisição de digest em vez disso: um hash do mesmo dado, não o dado. Uma linha cruza a rede para esta leitura, não importa quantas réplicas sejam consultadas.
visit RB | B tem o mesmo valor no mesmo timestamp 1567886623298243, então seu digest bate com o hash que o coordenador calculou sobre a resposta de A. Duas réplicas concordando já satisfazem QUORUM.
traverse COORD RC | C também é consultada, também com uma requisição de digest. QUORUM já era alcançável sem ela, mas consultar a terceira réplica é a única forma de a obsolescência naquela réplica ser notada.
mark RC | Discordância de digest. C ainda guarda start_date = 2016-01-05 no timestamp 1567876680189474. Ela estava fora do ar quando a atualização chegou e o hint expirou antes de ela voltar. Timestamp mais antigo significa obsoleto, não meramente diferente.
traverse RC COORD | A discordância escala a requisição de digest para uma leitura completa: o coordenador agora pede a C seu dado real, porque precisa saber o que sobrescrever.
visit COORD | Coluna por coluna, o coordenador mescla e o timestamp mais recente vence. 1567886623298243 vence 1567876680189474, então 2016-01-06 é a resposta. Isso é last-write-wins, decidido inteiramente pelo timestamp na célula.
traverse COORD RC | Read repair: o coordenador emite uma mutação de read-repair carregando o valor mesclado para a única réplica que estava atrasada. Mesma requisição, mesmo round trip, sem job agendado e sem operador envolvido.
visit RC | C agora guarda 2016-01-06 no timestamp 1567886623298243. A obsolescência foi corrigida porque alguém aconteceu de ler esta linha, que é exatamente por que uma linha que ninguém lê pode ficar obsoleta indefinidamente.
traverse COORD CLIENT | O cliente recebe 2016-01-06. Como o nível era QUORUM, o repair foi completado antes desse retorno; em ONE o mesmo repair teria rodado em segundo plano depois que o cliente já tinha sua resposta.
mark RA | A não precisou de repair nenhum. Ela guardou o timestamp mais novo o tempo todo e nunca recebeu escrita durante esta leitura.
mark RB | Nem B. Read repair só toca as réplicas que responderam com um timestamp mais antigo, que é por que seu custo escala com o quão inconsistente o cluster realmente está, não com quantas réplicas existem.
```

> **Book vs. today: o read repair em segundo plano baseado em "chance" que o livro descreve foi removido no Cassandra 4.0.** O capítulo diz que a porcentagem de leituras que resulta em repairs em segundo plano "é determinada pelas opções `read_repair_chance` e `dc_local_read_repair_chance` da tabela." Essas opções de tabela não existem mais: a CASSANDRA-13910 removeu o read repair em segundo plano probabilístico na 4.0, e na atualização as configurações são simplesmente ignoradas e desaparecem. O que as substituiu é uma opção de tabela literalmente chamada `read_repair`, com dois valores: `BLOCKING` (o padrão), onde "a leitura vai bloquear em escritas enviadas para outras réplicas até que o CL seja atingido pelas escritas", e `NONE`, onde "o coordenador vai reconciliar quaisquer diferenças entre réplicas, mas não vai tentar repará-las." O mecanismo que a animação mostra permanece inalterado; só o botão mudou. Duas consequências que vale a pena conhecer: `BLOCKING` é o que fornece **leituras de quorum monotônicas** (leituras de quorum sucessivas não vão retroceder no tempo, mesmo depois de uma escrita falha que alcançou apenas uma minoria de réplicas), e o read repair agora é disparado nos níveis `TWO`, `THREE`, `LOCAL_QUORUM`, e `QUORUM`, mas **não** em `ONE` ou `LOCAL_ONE`. Então o "em `ONE` o repair acontece em segundo plano depois" do livro é o comportamento pré-4.0; hoje uma leitura em `ONE` simplesmente não repara nada.

> **Dois nomes de configuração nesta seção foram renomeados desde então.** `read_request_timeout_in_ms: 5000` agora é `read_request_timeout: 5000ms`: o Cassandra 4.1 moveu o `cassandra.yaml` para valores de duração tipados, então o sufixo `_in_ms` sumiu do nome da propriedade e a unidade vive no valor. O padrão permanece inalterado em 5 segundos. Da mesma forma, `cross_node_timeout`, que o livro observa ter padrão `false`, tanto tem seu padrão invertido para `true` quanto é renomeado para `internode_timeout` em versões atuais. Essas são renomeações e uma inversão de padrão, não mudanças de comportamento.

### Replicação transiente, brevemente

O capítulo apresenta a **replicação transiente**, onde uma réplica transiente "só armazena dados quando réplicas regulares ou completas estão indisponíveis" e depois descarta sua cópia assim que o repair incremental move o dado para as réplicas completas, expressa no fator de replicação como, por exemplo, `'replication_factor' : '5/2'` (cinco réplicas totais: três completas, duas transientes). Em leituras, "pelo menos uma réplica completa é exigida, mas além disso, quaisquer réplicas, incluindo completas ou transientes, podem ser usadas para atingir o nível de consistência solicitado." A razão de isso pertencer a uma discussão de read repair é a restrição: na versão 4.0, **read repair, batches, transações leves, e counters não podem ser usados dentro de keyspaces que têm replicação transiente definida**. Era experimental e desabilitada por padrão quando o livro foi lançado, e ainda é: essa não é uma funcionalidade para desenhar um caminho de leitura em torno dela.

### Queries de intervalo, ordenação, e filtragem

A cláusula `WHERE` lê intervalos *dentro de uma partição*, às vezes chamados de slices. Contra `available_rooms_by_hotel_date` com `PRIMARY KEY (hotel_id, date, room_number)`, sendo `hotel_id` a partition key, `date` e `room_number` clustering columns:

```sql
SELECT * FROM available_rooms_by_hotel_date
  WHERE hotel_id='AZ123' AND date>'2016-01-05' AND date<'2016-01-12';
```

Isso funciona: a partition key está fixada, e o intervalo é na *primeira* clustering column. Isto não funciona:

```sql
SELECT * FROM available_rooms_by_hotel_date
  WHERE hotel_id='AZ123' AND room_number=101;

InvalidRequest: code=2200 [Invalid query] message="PRIMARY KEY column
  "room_number" cannot be restricted as preceding column "date" is not restricted"
```

Duas regras governam a cláusula: **todos os elementos da partition key precisam ser identificados**, e **uma dada clustering key só pode ser restringida se todas as clustering keys anteriores forem restringidas por igualdade**. Isso não é arbitrário: "essas restrições são baseadas em como o Cassandra armazena dados em disco", e "as condições na clustering column são restritas àquelas que permitem ao Cassandra selecionar uma ordenação contígua de linhas." Uma query legal é uma que o motor de armazenamento consegue responder como uma varredura contígua.

A válvula de escape é `ALLOW FILTERING`, que permite omitir um elemento da partition key (`WHERE date='2016-01-25' ALLOW FILTERING` busca em todo hotel). O veredito do livro: "o uso de `ALLOW FILTERING`, no entanto, não é recomendado, já que tem potencial de resultar em queries muito caras. Se você se encontrar precisando de tal query, vai querer revisitar seu modelo de dados para garantir que projetou tabelas que suportam suas queries."

`IN` testa igualdade contra múltiplos valores, e carrega um custo em cada um dos seus dois usos. Em uma clustering column ele "pode resultar em performance mais lenta em queries, já que os valores de coluna especificados podem corresponder a áreas não contíguas dentro da linha." Na partition key ele "faria com que o nó coordenador tivesse que falar com um número maior de nós para atender sua query", e a alternativa sugerida pelo livro vale a pena lembrar, porque converte um fan-out de coordenador em acertos diretos de réplica: "você pode considerar disparar requisições separadas para as diferentes partições em threads paralelas na sua aplicação, para que o driver possa contatar diretamente uma réplica como o coordenador para cada query."

`ORDER BY` só pode sobrescrever a ordem de classificação já especificada nas clustering columns no momento do `CREATE TABLE`: `ORDER BY date DESC` inverte a ordem em disco, não ordena por algo em que a tabela não tem clustering.

### Paginação

"Em versões antigas do Cassandra, clientes precisavam ter cuidado de limitar cuidadosamente a quantidade de dados solicitados de cada vez. Para um conjunto de resultados grande, é possível sobrecarregar tanto nós quanto clientes, até o ponto de ficar sem memória."

`LIMIT 10` limita um conjunto de resultados, mas "a limitação da palavra-chave `LIMIT` (o trocadilho é intencional) é que não há forma de obter páginas adicionais contendo as linhas extras além da quantidade solicitada."

**Paginação automática**, adicionada na versão 2.0, é o mecanismo real: o cliente solicita um subconjunto, e "o servidor quebra o resultado em páginas que são retornadas conforme o cliente as solicita." No `cqlsh`, `PAGING` mostra status e tamanho de página (padrão 100), `PAGING 1000` o muda, `PAGING OFF` o desabilita.

No DataStax Java Driver, o tamanho de busca padrão para um `CqlSession` é `basic.request.page-size`, **com padrão de 5000**, sobrescrevível por statement com `statement.setPageSize(2000)`. "O tamanho de página não é necessariamente exato; o driver pode retornar um pouco mais ou um pouco menos linhas do que solicitado." Iterar um `ResultSet` em um `for` comum é suficiente: quando o driver "detecta que não há mais itens restantes na página atual, ele solicita a próxima página."

A pausa em uma fronteira de página é visível para usuários, então o driver expõe pré-busca:

```java
for (Row row : resultSet) {
  if (resultSet.getAvailableWithoutFetching() < 100 && !resultSet.isFullyFetched())
    resultSet.fetchMoreResults();
  // process the row
}
```

Menos de 100 linhas restantes na página atual e mais páginas por vir dispara uma busca assíncrona, então a próxima página já está a caminho enquanto a atual ainda está sendo consumida.

Para um serviço web sem estado que não pode manter uma sessão entre invocações, o **estado de paginação** pode ser extraído e devolvido depois:

```java
ByteBuffer nextPage = resultSet.getExecutionInfo().getPagingState();
// ... later, on a different request:
statement.setPagingState(pagingState);
```

Com um aviso rígido: "seja em forma de string ou de array de bytes, o estado não é algo que você deveria tentar manipular ou reutilizar com uma statement diferente, já que não há garantia de que tenha o mesmo formato entre versões diferentes do Cassandra. Fazer isso pode resultar em uma exceção." Trate-o como um token opaco vinculado a uma statement e a uma versão de cluster.

## Trade-offs

- **Last-write-wins é trivialmente simples e transforma desvio de relógio em um bug de corretude, não de performance.** A resolução de conflito no Cassandra é uma comparação: a célula com o timestamp maior vence, com uma comparação lexicográfica dos valores como desempate para o caso "extremamente raro" de timestamps idênticos. Não há vector clock, nenhum irmão (sibling), nenhum callback de merge: a escrita perdedora simplesmente desaparece silenciosamente. Isso é barato e previsível, e significa que um nó ou cliente cujo relógio está atrasado pode escrever um valor que é *mais novo na realidade, mas mais antigo pelo timestamp*, então o banco de dados o descarta e nenhum erro nunca é levantado. A mitigação do livro é inteiramente operacional: "os relógios em todos os nós e clientes deveriam ser sincronizados usando o Network Time Protocol (NTP) ou outros métodos. Lembre que o Cassandra só sobrescreve colunas se o timestamp do novo valor for mais recente do que o timestamp do valor existente. **Sem relógios sincronizados, escritas de nós ou clientes atrasados podem ser perdidas.**" Essa é toda a defesa. Qualquer coisa que exija corretude genuína de ler-modificar-escrever (uma checagem de unicidade, um compare-and-set) precisa de transações leves, não de LWW. E como `USING TIMESTAMP` permite que uma aplicação forneça seus próprios timestamps, um bem-intencionado "vamos usar nosso próprio relógio" pode te entregar o mesmo modo de falha sem nenhuma das salvaguardas do NTP. `WRITETIME(column)` é a ferramenta de depuração para tudo isso; note que não pode ser aplicada a colunas de chave primária.
- **Read repair só repara o que alguém lê.** O mecanismo é oportunista por construção: o coordenador aprende que uma réplica está desatualizada porque uma query aconteceu de tocar aquela partição naquela réplica. Uma linha quente se autocura quase imediatamente; uma linha fria pode ficar errada pelo tempo que ninguém a pedir. É por isso que o read repair é um complemento, não um substituto, ao repair de anti-entropia agendado (`nodetool repair`), e o prazo não é estético: `gc_grace_seconds` tem padrão de 10 dias, depois do qual tombstones são coletados na compaction, e uma réplica que perdeu uma deleção e nunca foi reparada dentro dessa janela pode ressuscitar dados deletados. "A suposição é que 10 dias é tempo suficiente para você trazer um nó que falhou de volta ao ar antes que a compaction rode." Read repair não estende essa janela.
- **Leituras de digest cortam largura de banda, não round trips.** Pedir a `n-1` réplicas um hash em vez de uma linha é uma economia real e grande em custo de rede e serialização: uma linha cruza a rede independentemente do fator de replicação. O que isso *não* economiza é o próprio fan-out: essas réplicas ainda fazem todo o trabalho de row-cache/Bloom-filter/SSTable para calcular o digest, e o coordenador ainda espera por elas conforme o nível de consistência. E a economia se inverte na discordância: uma discordância de digest escala para uma leitura completa de *todas* as réplicas mais mutações de repair, então um cluster que é cronicamente inconsistente paga tanto a rodada de digest quanto a rodada completa.
- **A escolha entre `ONE` / `QUORUM` é uma escolha sobre quem come a obsolescência.** Em `ONE` o primeiro que responde vence, mesmo obsoleto, e, no Cassandra 4.0 e posteriores, nenhum read repair roda de forma alguma para esse nível, então a linha nem chega a ser corrigida de passagem. Em `QUORUM`, o read repair bloqueante te dá leituras de quorum monotônicas, mas toda leitura agora potencialmente espera por escritas de repair para outras réplicas antes de retornar. Latência em troca de corretude, e a taxa de câmbio é definida por query, não por cluster.
- **`ALL` transforma disponibilidade em um passivo.** Exigir que toda réplica responda significa que um único nó lento ou reiniciando falha a query completamente depois de `read_request_timeout` (5 segundos por padrão). Em um banco de dados escolhido especificamente por continuar de pé quando nós estão fora do ar, `ALL` abre mão da propriedade que você comprou. `QUORUM` mais escritas em `QUORUM` obtém consistência forte em `RF=3` sem essa fragilidade.
- **`ALLOW FILTERING` torna uma query ilegal em legal sem torná-la acessível.** As restrições do `WHERE` existem porque o motor de armazenamento só consegue responder de forma barata queries que mapeiam para um intervalo contíguo de linhas. Contorná-las não cria um índice; cria uma varredura que lê e descarta linhas, e seu custo cresce com o dado, não com o resultado. É um diagnóstico de que sua tabela não combina com sua query; a resposta certa é outra tabela, não outra palavra-chave.
- **Paginação protege o cluster e adiciona um problema de gerenciamento de estado.** A paginação automática é o que impede que um conjunto de resultados grande derrube um nó ou cliente por falta de memória, e o driver a esconde bem o suficiente para que um `for` comum sobre um `ResultSet` simplesmente funcione. Os custos são reais, mas limitados: um soluço de latência em toda fronteira de página, a menos que você faça pré-busca com `getAvailableWithoutFetching()`/`fetchMoreResults()`, um tamanho de página que é aproximado, não exato, e, se você persiste estado de paginação para sobreviver a uma requisição sem estado, um token opaco sem garantia de formato entre versões do Cassandra, que vai lançar exceção se reutilizado com uma statement diferente ou reproduzido através de uma atualização. Não o coloque em uma URL de vida longa.
- **Leituras são estruturalmente o lado mais lento, e o conserto custa dinheiro em vez de esperteza.** "No Cassandra, leituras geralmente são mais lentas do que escritas devido ao I/O de arquivo ao ler SSTables." Os remédios que o livro nomeia (adicionar nós, usar instâncias de computação com mais memória, habilitar os caches de row/key/chunk) são todos "manter mais coisa em memória", ou seja, decisões de hardware e ajuste de cache com seus próprios trade-offs (o row cache em particular é uma má escolha para partições largas ou tabelas intensivas em escrita, já que qualquer escrita em uma partição em cache a invalida). A velocidade de leitura do Cassandra é uma propriedade do modelo de dados e do orçamento de cache, não da query.

## Documentation Links

- [Jeff Carpenter and Eben Hewitt, "Cassandra: The Definitive Guide", Revised 3rd Edition (O'Reilly, 2022), Chapter 9, "Writing and Reading Data" (Reading), p. 305-328](https://www.oreilly.com/library/view/cassandra-the-definitive/9781492097143/) - doc
- [Apache Cassandra Documentation, Reads](https://cassandra.apache.org/doc/latest/cassandra/architecture/dynamo.html#reads) - doc
- [Apache Cassandra Documentation, Read Repair](https://cassandra.apache.org/doc/latest/cassandra/architecture/dynamo.html#read-repair) - doc
- [Apache Cassandra Documentation, Read Repair (table read_repair option, monotonic quorum reads)](https://cassandra.apache.org/doc/latest/cassandra/managing/operating/read_repair.html) - doc
- [Apache Cassandra Documentation, cassandra.yaml configuration (read_request_timeout)](https://cassandra.apache.org/doc/latest/cassandra/managing/configuration/cass_yaml_file.html) - doc
- [Apache Cassandra Documentation, CQL SELECT statement and WHERE restrictions](https://cassandra.apache.org/doc/latest/cassandra/developing/cql/dml.html#select-statement) - doc
- [DataStax Java Driver, Paging](https://docs.datastax.com/en/developer/java-driver/latest/manual/core/paging/) - doc
- [CASSANDRA-13910, Remove read_repair_chance / dclocal_read_repair_chance](https://issues.apache.org/jira/browse/CASSANDRA-13910) - doc
