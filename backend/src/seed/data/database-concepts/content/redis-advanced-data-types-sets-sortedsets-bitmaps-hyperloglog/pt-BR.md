---
version: 1.0
updatedAt: 2026-08-20
title: "Tipos de Dados Avançados do Redis: Sets, Sorted Sets, Bitmaps e HyperLogLog"
summary: Sets, Sorted Sets, Bitmaps e HyperLogLog são quatro estruturas de dados distintas, não só mais comandos; Sets dão pertencimento único O(1) com álgebra de conjuntos de verdade (SINTER/SUNION/SDIFF); Sorted Sets mantêm uma skip list ordenada por score que funciona ao mesmo tempo como leaderboard ranqueado e índice de faixa; Bitmaps reaproveitam uma String como um bit por ID inteiro para análises booleanas compactas; e o HyperLogLog troca exatidão por uma estimativa de cardinalidade fixa de ~12 KB independentemente da escala.
---
## Objective

Ir além de "o Redis tem mais comandos do que só GET/SET" e entender que Sets, Sorted Sets, Bitmaps e HyperLogLog são quatro **estruturas de dados** genuinamente diferentes, cada uma otimizada para uma pergunta diferente. Um Set responde "X é membro, e qual é a sobreposição com outros grupos?" em O(1) com álgebra de conjuntos de verdade. Um Sorted Set responde "qual é o rank de X, e o que cai nessa faixa?" mantendo uma skip list ordenada por score, a mesma estrutura servindo tanto como um leaderboard ao vivo quanto como um índice de faixa. Um Bitmap responde "o usuário N fez isso?" gastando um bit por ID possível em vez de uma entrada de Set por membro real. HyperLogLog responde "aproximadamente quantas coisas distintas aconteceram?" jogando fora exatidão em troca de um ~12 KB fixo não importa o quão grande o conjunto fique. Escolher o errado não é um erro de estilo; é a diferença entre uma consulta de leaderboard e um scan completo de tabela, ou entre 12 KB e vários gigabytes para a mesma contagem.

## Use Cases

- **Pertencimento por álgebra de conjuntos**: "filtrar todos os voos que partem de uma cidade e chegam em outra", "agrupar todos os usuários que viram produtos parecidos", "checar se um usuário está em uma lista negra": a própria lista de casos de uso de Set do livro, todos apoiados em `SINTER`/`SUNION`/`SDIFF` fazendo o join em vez de código de aplicação.
- **Um sistema de rastreamento de promoções** (o exemplo resolvido do livro): cada promoção é um Set de IDs de usuário para os quais foi enviada, então "marcar uma promoção como enviada", "checar se um usuário recebeu um grupo de promoções", e "coletar métricas das promoções enviadas" são `SADD`, `SISMEMBER`, e `SINTER`/`SUNION` entre vários Sets de promoção: nenhuma tabela de join separada necessária.
- **Um leaderboard de jogo** (o exemplo resolvido do livro): "mostrar um leaderboard de um jogo online massivo que exibe os melhores jogadores, usuários com scores parecidos, ou os scores dos seus amigos": um único Sorted Set, ordenado pelo score do `ZADD`, responde "top N", "o rank desse jogador", e "jogadores ranqueados perto desse jogador" sem uma consulta ORDER BY separada.
- **Análises web em tempo real** (o exemplo resolvido do livro): "o usuário X realizou a ação Y hoje?" e "quantos usuários realizaram a ação Y essa semana?": um Bitmap indexado por data, um bit por ID de usuário, responde as duas com `SETBIT`/`GETBIT`/`BITCOUNT`, e `BITOP OR` entre dias responde "quantos usuários visitaram em qualquer um dos dois dias?" sem tocar em um Set de jeito nenhum.
- **Contagem de visitantes únicos em escala** (o exemplo resolvido do livro): contar quantos UUIDs distintos acessam um site por hora, por dia, por mês: um HyperLogLog por hora, mesclado com `PFMERGE` em totais diários e mensais, a um custo que fica constante independentemente de quantos visitantes de fato houve.
- **Autocomplete e índices de faixa**: Sorted Sets conseguem "construir um sistema de autocomplete usando milhões de palavras" ou uma lista de espera em tempo real, porque `ZRANGEBYSCORE`/`ZRANGEBYLEX` transformam a mesma estrutura em um índice ordenado, não só um ranking.

## Deep Dive

### Sets: sem ordem, únicos, e construídos para álgebra

"Um Set no Redis é uma coleção não ordenada de Strings distintas; não é possível adicionar elementos repetidos a um Set." Esse é o contrato inteiro: sem ordem, sem duplicatas. O que o torna rápido é a implementação, não a API: "Internamente, um Set é implementado como uma tabela hash, que é a razão pela qual algumas operações são otimizadas: adição, remoção e busca de membro rodam em O(1), tempo constante." Um Set consegue guardar até 2³²−1 elementos, e seu espaço em memória encolhe ainda mais quando todo membro é um inteiro (governado por `set-max-intset-entries`).

Os comandos principais, segundo as tabelas de comando de *Redis in Action*:

| Comando | Faz |
|---|---|
| `SADD key item [item ...]` | Adiciona itens, "retorna o número de itens adicionados que ainda não estavam presentes" |
| `SREM key item [item ...]` | Remove itens, retorna o número de fato removido |
| `SISMEMBER key item` | "Retorna se o item está no SET" |
| `SCARD key` | Número de itens no Set |
| `SMEMBERS key` | Todos os itens, como um Set |
| `SRANDMEMBER key [count]` | Um ou mais itens aleatórios; `count` positivo retorna itens distintos, negativo permite repetições |
| `SPOP key` | Remove e retorna um item aleatório |
| `SMOVE source dest item` | Move atomicamente um item entre dois Sets |

O que separa um Set de uma coleção comum é a camada de álgebra, a razão pela qual o livro a chama de "poder real" do tipo:

| Comando | Faz |
|---|---|
| `SDIFF key [key ...]` | Itens no primeiro Set não presentes em nenhum dos outros |
| `SINTER key [key ...]` | Itens presentes em *todo* Set dado |
| `SUNION key [key ...]` | Itens presentes em *pelo menos um* Set dado |
| `SDIFFSTORE` / `SINTERSTORE` / `SUNIONSTORE` | As mesmas três operações, mas persistindo o resultado em `dest-key` em vez de retorná-lo |

*Redis Essentials* percorre isso com um app de música em que cada usuário tem um Set `favorite_artists`. Max e Hugo cada um dá `SADD` em seus favoritos; `SINTER user:max:favorite_artists user:hugo:favorite_artists` retorna só `"Arctic Monkeys"`, o único artista que os dois curtem. `SDIFF` em uma ordem de chave retorna o que Max curte que Hugo não curte (`"Belle & Sebastian"`, `"Arcade Fire"`, `"Lenine"`); invertido, retorna as exclusividades de Hugo. `SUNION` retorna todos os seis artistas combinados, deduplicados de graça. **A ordem da chave importa para `SDIFF`**: não é comutativo como `SINTER`/`SUNION` são.

O **sistema de rastreamento de promoções** do livro transforma isso em uma aplicação: toda promoção é um Set dos IDs de usuário para os quais foi enviada. `markDealAsSent(dealId, userId)` é só um `SADD`. `sendDealIfNotSent` checa `SISMEMBER` antes de enviar, então uma promoção nunca é reenviada. `showUsersThatReceivedAllDeals(dealIds)` é um `SINTER` entre todo Set de promoção da lista: "um parceiro comercial pode querer uma lista de todos os usuários que receberam todas as suas promoções em uma dada semana." `showUsersThatReceivedAtLeastOneOfTheDeals` é a mesma consulta com `SUNION`. Nenhuma das duas precisa de uma tabela de join ou de um loop do lado da aplicação; a álgebra de conjuntos roda dentro do Redis e retorna a resposta diretamente.

### Sorted Sets: a mesma estrutura serve como leaderboard *e* índice de faixa

"Um Sorted Set é muito parecido com um Set, mas cada elemento de um Sorted Set tem um score associado. Em outras palavras, um Sorted Set é uma coleção de Strings não repetidas ordenadas por score." Os membros continuam únicos (sem valores duplicados), mas empates de score são desempatados pela "ordem lexicográfica dos valores dos elementos", que é uma regra de ordenação real e observável, não um detalhe de implementação: `ZADD leaders 100 "Alice"` e `ZADD leaders 100 "Zed"` deixa Alice ranqueada abaixo de Zed puramente porque `"Alice" < "Zed"` alfabeticamente.

Essa ordenação custa algo: "Adicionar, remover e atualizar um item em um Sorted Set roda em tempo logarítmico, O(log(N))": mais lento do que o O(1) de um Set, porque "os scores precisam ser comparados." Internamente um Sorted Set é "implementado como duas estruturas de dados separadas: uma skip list com uma tabela hash" (para busca ordenada rápida) "e uma ziplist" para conjuntos pequenos abaixo dos limiares `zset-max-ziplist-entries`/`-value`: a própria codificação muda conforme o conjunto cresce, o que vale a pena saber quando um benchmark em um conjunto pequeno codificado como ziplist não se reproduz em escala de produção.

Os comandos se dividem claramente em "gerenciar um membro" e "ler uma faixa":

| Comando | Faz |
|---|---|
| `ZADD key score member [...]` | Adiciona/atualiza membros com scores |
| `ZREM key member [...]` | Remove membros |
| `ZCARD key` | Número de membros |
| `ZINCRBY key incr member` | Ajusta o score de um membro |
| `ZSCORE key member` | O score de um membro |
| `ZRANK` / `ZREVRANK key member` | A posição de um membro, do menor para o maior ou do maior para o menor ("o membro com o menor score tem rank 0") |
| `ZRANGE` / `ZREVRANGE key start stop [WITHSCORES]` | Membros entre duas posições de rank, ascendente ou descendente |
| `ZRANGEBYSCORE` / `ZREVRANGEBYSCORE key min max [LIMIT offset count]` | Membros entre dois **scores**, não ranks |
| `ZCOUNT key min max` | Quantos membros caem em uma faixa de score, sem buscá-los |
| `ZREMRANGEBYRANK` / `ZREMRANGEBYSCORE` | Exclusão em massa por janela de rank ou de score |
| `ZINTERSTORE` / `ZUNIONSTORE dest numkeys key [...] [WEIGHTS ...] [AGGREGATE SUM\|MIN\|MAX]` | Interseção/união estilo Set entre Sorted Sets (e Sets comuns, tratados "como se fossem ZSETs com todos os scores iguais a 1") |

Essa última linha é o ponto que vale a pena parar para pensar: `ZRANGE`/`ZREVRANGE` tratam o Sorted Set como um **leaderboard** (acesso baseado em rank), enquanto `ZRANGEBYSCORE`/`ZCOUNT` tratam a mesma estrutura exata como um **índice de faixa** (acesso baseado em score): uma estrutura de dados, dois padrões de acesso, sem duplicação.

O **sistema de leaderboard** do livro exercita os dois lados. `addUser`/`removeUser` envolvem `ZADD`/`ZREM`. `showTopUsers(quantity)` chama `ZREVRANGE key 0 quantity-1 WITHSCORES`: maior score primeiro. `getUserScoreAndRank(username)` combina `ZSCORE` com `ZREVRANK` para reportar tanto um valor quanto uma posição: `"Details of Maxwell: Score: 10, Rank: #7"`. O método mais interessante é `getUsersAroundUser(username, quantity)`, que primeiro chama `ZREVRANK` para achar onde um jogador está, calcula uma janela centrada nesse rank, depois chama `ZREVRANGE` sobre essa janela, produzindo "Users around Felipe: #2 Ana (60), #3 Renata (50), #4 Felipe (40), #5 Patrik (30), #6 KC (20)." Esse é um recurso de leaderboard "jogadores perto de mim" construído inteiramente a partir de duas leituras baseadas em rank.

`ZINTERSTORE`/`ZUNIONSTORE` estendem a ideia de leaderboard para agregação: com dois ZSETs `zset-1` (`a:1, b:2, c:3`) e `zset-2` (`b:4, c:1, d:0`), `ZINTERSTORE` com o agregado padrão `SUM` produz `c:4, b:6`: scores de membros presentes nos dois conjuntos são somados. `ZUNIONSTORE` com `AGGREGATE MIN` em vez disso mantém o menor score visto para cada membro entre os dois conjuntos. Como um Set comum pode ser passado para qualquer um dos dois como se todo membro tivesse score 1, esses comandos também servem como uma forma de dobrar um sinal de **pertencimento** em um sinal de **ranking**, por exemplo, aumentando o score combinado de um item só por ele existir em um Set "em destaque".

### Bitmaps: uma String vestida de array booleano

"Um Bitmap não é um tipo de dado real no Redis. Por baixo dos panos, um Bitmap é uma String... um conjunto de operações de bit sobre uma String." O Redis só fornece comandos "para manipular Strings como Bitmaps": arrays de bit onde cada offset é um bit, endereçável até 2³² bits (mais de 4 bilhões).

| Comando | Faz |
|---|---|
| `SETBIT key offset 0\|1` | Define um bit; cria o Bitmap se ele não existir |
| `GETBIT key offset` | Lê um bit |
| `BITCOUNT key` | Conta bits definidos como 1 |
| `BITOP OR\|AND\|XOR\|NOT dest key [key ...]` | Combina Bitmaps bit a bit em uma chave de destino |

O livro faz o caso de "por que não simplesmente usar um Set" com números, usando um site de 5 milhões de usuários onde 2 milhões visitam em um dado dia e cada ID de usuário precisaria de 4 bytes (32 bits) como membro de Set:

| Tipo de dado | Bits/usuário | Usuários armazenados | Memória total |
|---|---|---|---|
| Bitmap | 1 | 5.000.000 (pior caso: aloca até o maior ID de usuário tocado) | 625 kB |
| Set | 32 | 2.000.000 | 8 MB |

O Bitmap ganha por mais de 12x aqui, mas o livro tem o cuidado de mostrar onde isso se inverte. Reduza a contagem de visitas para 100 (o pior caso ainda toca o mesmo espaço de 5 milhões de IDs): o Bitmap continua em 625 kB, mas o Set agora é só 3,125 kB. **O custo de memória de um Bitmap é conduzido pelo maior offset tocado, não por quantos bits de fato são 1**: dados densos e limitados ao espaço de ID favorecem Bitmaps; pertencimento esparso favorece Sets.

O exemplo de **análises web** do livro torna `SETBIT`, `BITCOUNT` e `BITOP` concretos: `storeDailyVisit(date, userId)` chama `SETBIT visits:daily:<date> userId 1`; `countVisits(date)` chama `BITCOUNT` nessa chave para responder "quantos usuários distintos visitaram hoje"; e ler cada offset de volta com `GET` mais deslocamento de bits reconstrói a lista real de IDs de usuário que visitaram (`showUserIdsFromVisit`), algo que um `SMEMBERS` bruto em um Set faria mais diretamente, mas ao custo de memória do Set. `BITOP OR` entre as chaves de dois dias responde "quantos usuários distintos visitaram em qualquer um dos dois dias" sem materializar um Set de união de jeito nenhum: um OU bit a bit sobre duas strings de bytes, depois `BITCOUNT` no resultado. Uma ressalva repetida do livro: um Bitmap só registra que uma visita aconteceu, não quantas vezes; um contador `INCR` separado ainda é necessário para contagens de visitas totais, não contagens de visitantes únicos.

### HyperLogLog: trocando exatidão por um orçamento de memória fixo e minúsculo

"Um HyperLogLog não é de fato um tipo de dado real no Redis. Conceitualmente, um HyperLogLog é um algoritmo que usa aleatoriedade para fornecer uma aproximação muito boa do número de elementos únicos que existem em um Set." O Redis o expõe através de comandos apoiados em String da mesma forma que faz com Bitmaps. A propriedade principal: "ele só roda em O(1), tempo constante, e usa uma quantidade muito pequena de memória, até 12 kB de memória por chave": independentemente de essa chave estar rastreando cem elementos ou cem milhões.

A pegadinha é nomeada claramente: "O algoritmo HyperLogLog é probabilístico, o que significa que não garante 100% de precisão. A implementação Redis do HyperLogLog tem um erro padrão de 0,81%." Foi introduzido no Redis 2.8.9, e tem exatamente três comandos: `PFADD`, `PFCOUNT`, `PFMERGE` (o prefixo `PF` homenageia Philippe Flajolet, coautor do algoritmo).

| Comando | Faz |
|---|---|
| `PFADD key element [...]` | Adiciona elementos; retorna 1 se a cardinalidade estimada mudou |
| `PFCOUNT key [key ...]` | Uma chave: sua cardinalidade aproximada. Múltiplas chaves: a cardinalidade aproximada de sua **união** |
| `PFMERGE dest key [key ...]` | Mescla HyperLogLogs em `dest`, preservando a estimativa de cardinalidade da união |

A comparação de memória do livro, contando 100.000 visitantes únicos por hora com UUIDs de 32 bytes:

| Tipo de dado | Por hora | Por dia (×24) | Por mês (×30) |
|---|---|---|---|
| HyperLogLog | 12 kB | 288 kB | 8,4 MB |
| Set | 3,2 MB | 76,8 MB | 2,25 GB |

Na escala de um mês, isso é 8,4 MB contra 2,25 GB para a *mesma contagem*: um Set paga por todo UUID distinto que armazena; um HyperLogLog paga uma taxa fixa não importa quantos valores distintos passem por ele.

O exemplo resolvido constrói buckets horários (`visits:2015-01-01T0` … `T23`) com `PFADD`, lê uma única hora ou um punhado de horas com `PFCOUNT`, depois consolida 24 chaves horárias em uma chave diária com `PFMERGE`: "Aggregated date 2015-01-01" seguido por um `PFCOUNT` na chave mesclada. Como `PFADD` ignora silenciosamente valores que já viu (`"a cardinalidade do HyperLogLog não muda, já que HyperLogLogs só levam em conta valores únicos"`), o mesmo loop de simulação que chama `addVisit` com repetições aleatórias ainda produz uma estimativa correta de visitantes únicos. O que um HyperLogLog nunca consegue fazer, por design, é devolver *quais* elementos ele contou: `PFCOUNT` retorna um número, nunca uma lista de membros. Essa é a troca que a estrutura torna explícita: abra mão de pertencimento e exatidão, mantenha a contagem e o limite fixo de memória.

### Livro vs. hoje

> Os dois livros antecedem uma expansão real do conjunto de ferramentas probabilísticas do Redis. O **Redis 8.0 (maio de 2025)** dobrou cinco estruturas de dados antes em módulos separados diretamente para dentro do core do Redis: "Cinco estruturas de dados probabilísticas: filtro Bloom, filtro Cuckoo, Count-min sketch, Top-k, e t-digest... Esses nove componentes estão incluídos em todas as distribuições binárias" (as notas de release contam Bloom/Cuckoo/Count-min/Top-k/t-digest junto com Search, JSON, time series e vector sets como as "8 novas estruturas de dados" agora padrão). Isso não é uma substituição do HyperLogLog: o HyperLogLog responde "quantas coisas distintas", enquanto um filtro Bloom ou Cuckoo responde uma pergunta diferente, "eu já vi essa coisa exata antes", em uma memória igualmente fixa e minúscula. Um filtro Cuckoo adiciona o que nem filtros Bloom nem HyperLogLog oferecem: exclusão de item. Onde os livros tinham exatamente uma ferramenta probabilística para exatamente um trabalho, o Redis atual vem com uma família delas.

> **`SINTERCARD`** (adicionado no Redis 7.0, depois dos dois livros) é a resposta moderna mais eficiente para uma pergunta que o livro só resolve com `SINTER key1 key2 | conte o resultado`: "retorna só a cardinalidade do resultado" de uma interseção sem nunca materializar a lista de membros, e seu `LIMIT` opcional deixa o Redis parar de contar cedo assim que um limiar é atingido: útil para uma checagem sim/não de "esses dois grupos se sobrepõem em pelo menos N" onde `SINTER` faria trabalho desnecessário construindo um array que você descartaria imediatamente.

## Trade-offs

- **A álgebra de Set é O(1) por elemento mas o join em si não é de graça.** `SINTER`/`SUNION`/`SDIFF` empurram o join para dentro do Redis em vez da aplicação, que é todo o apelo, mas o custo escala com o tamanho dos conjuntos sendo combinados, e por padrão o resultado completo é materializado e cruza a rede. Quando só a *contagem* de uma interseção é necessária (uma checagem de "quanta sobreposição", não a lista de membros), `SINTERCARD` evita construir e retornar esse conjunto de resultado: uma ferramenta mais nova e mais estreita do que o que o livro ensina com `SINTER`.
- **Sorted Sets compram dois padrões de acesso (rank e faixa) por um custo de escrita O(log N), mas a codificação interna não é fixa.** Um Sorted Set abaixo dos limiares `zset-max-ziplist-entries`/`-value` é uma ziplist; acima disso, uma skip list mais tabela hash. Código e benchmarks validados em um leaderboard pequeno podem se comportar diferentemente uma vez que tráfego real empurra o conjunto além desse limiar: a garantia O(log N) se mantém de qualquer jeito, mas o fator constante e o layout de memória não.
- **Empates de score são desempatados lexicograficamente, silenciosamente.** Dois membros com scores idênticos são ordenados alfabeticamente por valor, não por ordem de inserção ou arbitrariamente, como o exemplo Alice/Zed do livro mostra. Um leaderboard que espera ordem de inserção como desempate vai receber ordem alfabética em vez disso, a menos que os scores sejam tornados únicos (por exemplo, codificando um timestamp nos bits baixos do score).
- **A eficiência de um Bitmap depende inteiramente da densidade de ID, não de quantos bits estão definidos.** O mesmo espaço de 5 milhões de IDs custa 625 kB não importa se 2 milhões de usuários visitaram ou 100, porque o pior caso é conduzido pelo maior offset tocado. Bitmaps ganham decisivamente quando o domínio mapeia claramente para IDs inteiros pequenos e densos (IDs de usuário, dia do ano); eles perdem feio contra um Set uma vez que IDs são esparsos, não sequenciais, ou vêm de um espaço muito maior do que o pertencimento real (UUIDs, IDs hasheados): ali, `SETBIT` em um offset enorme só desperdiça memória que um Set nunca alocaria.
- **O ~12 KB fixo do HyperLogLog é a troca inteira: exatidão e pertencimento se vão, permanentemente.** `PFCOUNT` retorna uma estimativa com aproximadamente 0,81% de erro padrão e nunca consegue responder "quem foi contado": não há como enumerar membros de volta de um HyperLogLog, diferente de um Set ou Bitmap. Essa é a troca certa para "aproximadamente quantos", e a estrutura completamente errada no momento em que um recurso precisa de "quais".
- **Escolher entre esses quatro (mais um Set comum) é uma decisão de modelagem que os livros fazem você percorrer na mão, com uma tabela de memória, toda vez.** Os dois livros repetem o mesmo exercício (escrever bits/bytes-por-membro × cardinalidade esperada para cada estrutura candidata) porque não existe uma única resposta "sempre certa": pertencimento único com álgebra quer um Set, acesso ranqueado/de faixa quer um Sorted Set, booleano denso por ID quer um Bitmap, e contagem aproximada em larga escala quer HyperLogLog (ou, hoje, uma das outras estruturas probabilísticas do Redis 8 se a pergunta for pertencimento em vez de cardinalidade).

## Documentation Links

- [Maxwell Dayvson Da Silva and Hugo Lopes Tavares, "Redis Essentials" (Packt Publishing, 2015), Chapter 2, "Advanced Data Types (Earning a Black Belt)," p. 27-53](https://www.packtpub.com/product/redis-essentials/9781784392451) - doc
- [Josiah L. Carlson, "Redis in Action" (Manning Publications, 2013), Chapter 3, "Commands in Redis," sections 3.3 Sets and 3.5 Sorted sets, p. 46-54](https://www.manning.com/books/redis-in-action) - doc
- [Redis Documentation: Sets](https://redis.io/docs/latest/develop/data-types/sets/) - doc
- [Redis Documentation: Sorted sets](https://redis.io/docs/latest/develop/data-types/sorted-sets/) - doc
- [Redis Documentation: Bitmaps](https://redis.io/docs/latest/develop/data-types/bitmaps/) - doc
- [Redis Documentation: HyperLogLog](https://redis.io/docs/latest/develop/data-types/probabilistic/hyperloglogs/) - doc
- [Redis Documentation: SINTERCARD](https://redis.io/docs/latest/commands/sintercard/) - doc
- [Redis Documentation: Bloom filter](https://redis.io/docs/latest/develop/data-types/probabilistic/bloom-filter/) - doc
- [Redis Documentation: Cuckoo filter](https://redis.io/docs/latest/develop/data-types/probabilistic/cuckoo-filter/) - doc
- [Redis Open Source 8.0 release notes](https://redis.io/docs/latest/operate/oss_and_stack/stack-with-enterprise/release-notes/redisce/redisos-8.0-release-notes/) - doc
