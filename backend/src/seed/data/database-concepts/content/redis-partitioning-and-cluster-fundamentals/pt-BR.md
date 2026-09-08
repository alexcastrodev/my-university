---
version: 1.0
updatedAt: 2026-08-20
title: "Fundamentos de Particionamento e Cluster no Redis"
summary: O Redis começou sem nenhuma história nativa de distribuição, então o livro percorre os esquemas de particionamento do lado do cliente que as pessoas usavam em vez disso (range, hash, presharding, consistent hashing, e tagging de hash) antes de mostrar os dois sistemas feitos sob medida que os substituíram: o Redis Cluster, que faz sharding de dados entre 16384 hash slots via HASH_SLOT = CRC16(key) mod 16384 (com hash tags {tag} forçando chaves relacionadas para o mesmo slot para operações multi-chave), e o Redis Sentinel, que lida com failover automático baseado em quorum em um par primário/réplica sem sharding, sem distribuir nenhum dado.
---
## Objective

Traçar o caminho que o livro percorre de "o Redis nunca foi projetado para ser distribuído" até um cluster de produção: primeiro os esquemas de particionamento do lado do cliente que as pessoas parafusavam por fora antes de o Redis ter alguma resposta nativa (range, hash, presharding, consistent hashing, e tagging), depois os dois sistemas feitos sob medida que substituíram todos eles. Entender o que cada um de fato resolve: os 16384 hash slots do Redis Cluster distribuem dados com roteamento automático e failover, enquanto o Redis Sentinel lida com failover baseado em quorum para um par primário/réplica comum sem fazer sharding de nada. E entender o mecanismo específico (CRC16(key) mod 16384, com uma `{tag}` opcional) que decide, para qualquer chave, em qual dos 16384 slots ela pousa, e como hash tags forçam duas chaves diferentes para o mesmo slot de propósito.

## Use Cases

- Explicar a uma equipe por que um cache Redis cresceu além da memória ou banda de rede de uma única instância, e escolher entre particionamento em nível de aplicação e Redis Cluster antes de escrever qualquer código de sharding.
- Projetar nomes de chave para uma operação multi-chave de Redis Cluster (`SUNION`, `MSET`, um script Lua tocando várias chaves) para que as chaves fiquem garantidas de pousar no mesmo slot: a convenção de tagging `{user123}` do livro, ainda o único mecanismo que o Redis Cluster oferece para isso.
- Montar um cluster básico de três masters à mão com `CLUSTER ADDSLOTS`, `CLUSTER MEET`, e `CLUSTER REPLICATE` para entender o que `redis-cli --cluster create` automatiza por baixo.
- Depurar um erro `CLUSTERDOWN` ou um redirect `MOVED`/`ASK` inesperado raciocinando sobre qual nó possui qual faixa de hash slot.
- Decidir se um dado deployment precisa de Sentinel (failover automático, sem sharding), Cluster (sharding mais failover), ou os dois em camadas: o Sentinel não é uma versão menor do Cluster, ele resolve um problema mais estreito de propósito.
- Revisar a resiliência de um cluster checando `cluster-migration-barrier` e contagens de réplica por master: o aviso do livro de que "um master sem pelo menos uma réplica não pode falhar" sem perder dados.
- Migrar hash slots entre nós durante um redimensionamento, usando a dança de quatro passos do `CLUSTER SETSLOT` (`IMPORTING` / `MIGRATING` / `MIGRATE` / `NODE`) que tanto o `redis-trib.rb` historicamente quanto o `redis-cli --cluster reshard` hoje realizam em seu nome.

## Deep Dive

### Antes do Redis Cluster: particionamento à mão

"Quando o Redis foi inicialmente projetado, ele não tinha nenhuma intenção de ser um armazenamento de dados distribuído; portanto, ele não consegue distribuir seus dados nativamente entre instâncias diferentes. Foi projetado para funcionar bem em um único servidor." Tudo nesta seção é o que as pessoas faziam sobre isso antes de o Redis Cluster existir: lógica em nível de cliente para **particionamento horizontal** (sharding): "distribuir chaves entre instâncias diferentes do Redis."

**Particionamento por range** é o esquema mais simples: escolha uma faixa de valores de chave (faixas de ID numéricas como `user:1`-`user:1000`, ou a primeira letra da chave) e roteie cada faixa para uma instância fixa. O livro é direto sobre os dois modos de falha: a distribuição costuma ser desigual ("a maioria das suas chaves está na mesma faixa ou algumas faixas têm muito poucas chaves"), e o esquema não tolera redimensionamento: "se o número de instâncias Redis muda, a distribuição por faixa precisa mudar de acordo... é provável que adicionar ou remover um host invalide uma boa parte dos dados."

**Particionamento por hash** conserta a desigualdade: `index = hashFunction(redisKey) % redisHosts.length`. "A eficiência desse método varia com a função hash que você escolhe": a implementação de referência do livro usa MD5, e ele recomenda "um número primo como o total de instâncias Redis... para minimizar colisões." Mas módulo-pela-contagem-de-hosts tem seu próprio modo de falha: mudar a lista de hosts remapeia quase tudo. O livro mediu isso diretamente: "em um teste pequeno, usando particionamento por hash, 75% do nosso dataset foi invalidado ao adicionar mais dois servidores à lista."

**Presharding** contorna isso fixando o tamanho do array em vez da contagem de hosts: lance muito mais instâncias Redis do que você precisa ("algumas pessoas têm mais de 100 instâncias por servidor", já que "o Redis é single-threaded e não usa todos os recursos disponíveis na máquina") e faça particionamento por hash sobre essa lista fixa e superdimensionada. Escalar significa trocar uma instância mais fraca por uma mais forte (replicar, promover, aposentar), nunca redimensionar o array. A troca é operacional: "significativamente mais instâncias para gerenciar e monitorar", e um mau ajuste para disaster recovery, já que um bloco danificado de instâncias só pode ser reparado trazendo de volta o mesmo número de substitutos: "por definição, o tamanho do cluster não pode variar."

**Consistent hashing** resolve o problema de redimensionamento diretamente. Tanto servidores quanto chaves são hasheados em pontos de um círculo (um "anel de hash"); uma chave pertence ao primeiro servidor no ou depois do seu ponto, movendo no sentido horário, dando a volta para o primeiro servidor se nenhum for encontrado. Adicionar ou remover um servidor "remapeia só uma pequena porção do dado... só K/n chaves são remapeadas, onde K é o número de chaves e n é o número de servidores": o exemplo do livro: um anel de 100 chaves e 4 servidores perde só ~25 chaves para um 5º nó, não 75. Implementações reais colocam muitos pontos por servidor ("nós virtuais": "tão poucos quanto três pontos por servidor, enquanto outros usam até 500") para manter o anel balanceado. Esse é o esquema que o livro de fato recomenda: "recomendamos consistent hashing como o melhor mecanismo de partição, porque nos dá a capacidade de adicionar e remover instâncias Redis sem remapear a maioria das chaves."

**Tagging** resolve um problema diferente: `SDIFF`, `SINTER`, `SUNION`, e qualquer outro comando multi-chave exigem que toda chave envolvida more na mesma instância. A convenção (uma tag entre chaves, `key_name:{tag}`) deixa a função hash ignorar tudo exceto a substring da tag, então `user:1{users}`, `user:2{users}`, e `user:3{users}` todos hasheiam identicamente e pousam no mesmo nó independentemente do esquema de particionamento. Essa convenção é exatamente o que o Redis Cluster depois padronizou como hash tags.

A lógica de particionamento pode morar em três camadas, segundo o livro: o **cliente** (o código de aplicação acima), um **proxy** (um intermediário que faz sharding de forma transparente: o livro percorre o **twemproxy**, o proxy licenciado sob Apache do Twitter, configurado com um pool YAML de servidores backend e um `distribution: ketama`, seu nome para consistent hashing), ou um **query router**: "o próprio armazenamento de dados... o Redis Cluster se comporta como um query router." Qualquer que seja a camada escolhida, o livro sinaliza a mesma restrição: "nem todo comando Redis vai estar disponível; alguns comandos não fazem sentido em um sistema particionado", particularmente os que recebem várias chaves que podem morar em hosts diferentes.

A recomendação de encerramento do livro antes de o Redis Cluster ser introduzido: use consistent hashing para um **cache** (misses são recuperáveis, então minimizar remaps é suficiente), mas para um **armazenamento de dados** "considere o Redis Cluster ou uma solução que garanta que o dado é replicado entre nós e que toda instância... saiba como rotear a consulta para a instância certa": porque para um armazenamento, "as chaves precisam sempre mapear para as mesmas instâncias Redis", o que nenhum dos esquemas do lado do cliente garante uma vez que a lista de hosts muda.

### Dois sistemas feitos sob medida, dois trabalhos diferentes

"Em 2011, Salvatore Sanfilippo começou a trabalhar em um projeto que resolveria esses problemas, mas o Redis ainda era subdesenvolvido... ele decidiu atacar só o failover automático e criou um projeto chamado Redis Sentinel." O projeto completo de armazenamento de dados distribuído se tornou o Redis Cluster, terminado depois. O livro é explícito de que essas não são a mesma ferramenta em níveis diferentes de maturidade; elas resolvem problemas diferentes de propósito: "o objetivo do Sentinel é fornecer failover automático confiável em uma topologia master/slave sem fazer sharding de dado. O objetivo do Cluster é distribuir dado entre instâncias Redis diferentes e realizar failover automático se algum problema acontecer com qualquer instância master." O Sentinel alcançou estabilidade no Redis 2.8 (2013); o Cluster no Redis 3.0 (2015).

### O enquadramento pelo teorema CAP

O livro mede os dois sistemas contra o CAP: "um sistema distribuído não consegue garantir todos os seguintes ao mesmo tempo: **Consistência**: uma leitura tem garantia de retornar a escrita mais recente; **Disponibilidade**: toda operação recebe uma resposta dizendo se teve sucesso ou falhou; **Tolerância a partição**: o sistema continua operando através de uma partição de rede." Já que partições são inevitáveis em um deployment real, um sistema precisa abrir mão de algo, e o veredito do livro tanto para o Sentinel quanto para o Cluster é direto: "teoricamente, o Redis Sentinel e o Redis Cluster não são nem consistentes nem disponíveis sob partições de rede" no sentido estrito, embora configurações específicas minimizem o dano em cada direção.

Concretamente: nenhum dos dois consegue garantir **disponibilidade**, "porque existe um quorum que precisa concordar sobre uma eleição de master, e dependendo da decisão do quorum, parte do sistema pode ficar indisponível." Nenhum consegue garantir **consistência**, porque "duas ou mais partições [podem] aceitar escritas ao mesmo tempo", e "quando a rede se recupera... algumas dessas escritas serão perdidas (conflitos não são resolvidos automaticamente, nem expostos para os clientes)." O Redis Cluster se inclina para disponibilidade sobre consistência estrita onde consegue (aceitando escritas em qualquer partição que ainda tenha quorum), que é a leitura prática do livro do sistema como inclinado para AP, mesmo não sendo puramente AP também.

### Redis Sentinel: failover baseado em quorum, sem sharding

Antes do Sentinel, promover uma réplica depois de uma falha de master era manual: `SLAVEOF NO ONE` na réplica escolhida, depois reapontar toda outra réplica e todo cliente à mão. O Sentinel automatiza exatamente isso, e nada sobre posicionamento de dado: "o Sentinel não distribui dado entre nós já que o nó master tem todo o dado e as slaves têm uma cópia do dado; o Sentinel não é um armazenamento de dados distribuído."

Um deployment de Sentinel tipicamente roda um processo Sentinel por instância Redis, se comunicando um com o outro via Pub/Sub em um canal chamado `__sentinel__:hello`. A configuração central são quatro diretivas:

```
sentinel monitor mymaster 127.0.0.1 6379 2
sentinel down-after-milliseconds mymaster 30000
sentinel failover-timeout mymaster 180000
sentinel parallel-syncs mymaster 1
```

- `sentinel monitor <name> <ip> <port> <quorum>`: nomeia o master e define o **quorum**: "o menor número de sentinels que precisam concordar que o master atual está fora do ar antes de começar uma nova eleição de master." Note precisamente o que o quorum governa: a documentação atual do Redis é mais precisa sobre isso do que o livro: o quorum só é usado para *detectar* a falha; de fato *realizar* o failover exige um passo separado onde um Sentinel é eleito líder e recebe **autorização de uma maioria de todos os processos Sentinel**, não só a contagem de quorum. Um quorum de 1 com apenas dois Sentinels tecnicamente pode autorizar um failover mas é uma configuração quebrada por motivos que o livro aborda a seguir (split-brain).
- `down-after-milliseconds`: por quanto tempo um master precisa falhar em responder `PING` antes de um Sentinel considerá-lo fora do ar.
- `failover-timeout`: protege contra oscilação: um master que fez failover recentemente é excluído de ser reeleito se outro failover for necessário antes de o timeout passar.
- `parallel-syncs`: quantas réplicas são reconfiguradas para o novo master simultaneamente; valores baixos mantêm mais réplicas disponíveis para clientes durante a transição.

Um cliente usando Sentinel não se conecta diretamente a uma instância Redis; ele pergunta a um Sentinel qual instância atualmente detém o papel `master` ou `slave` para um grupo nomeado, depois se conecta lá. Essa é a "diferença importante" que o livro sinaliza: exige uma biblioteca de cliente ciente do Sentinel.

**Split-brain.** O livro demonstra perda de dado concretamente: uma partição de rede isola o master de suas réplicas; as réplicas (que ainda conseguem falar umas com as outras) elegem um novo master; o cliente, ainda conectado ao master *antigo* e isolado, continua escrevendo. Quando a partição se cura, "a maioria dos sentinels vai concordar que o antigo master... deveria se tornar uma slave do novo master... todas as escritas enviadas pelo cliente são perdidas, porque não há sincronização de dado nesse processo." O failover do Sentinel é real e automático, mas não é um substituto de uma garantia de consistência.

### Redis Cluster: hash slots e a regra CRC16

O método de particionamento do Redis Cluster é particionamento por hash aplicado a uma constante fixa: **16384** slots, sempre. "Todo master em um cluster possui uma porção dos 16.384 slots." A regra para a qual slot uma chave pertence:

```
HASH_SLOT = CRC16(key) mod 16384
```

O próprio exemplo resolvido do livro, de um cluster rodando: `CRC16("hello") % 16384 = 866` e `CRC16("foo") % 16384 = 12182`: rotear `SET foo bar` a partir de um nó que não possui o slot 12182 produz `-> Redirected to slot [12182] located at 127.0.0.1:30003`.

Regras que decorrem diretamente da contagem fixa de slots: um master com zero slots não armazena nada e redireciona toda consulta; todo master precisa de pelo menos um slot para ser útil; **todos os 16384 slots precisam estar atribuídos entre todos os masters para o cluster estar saudável**; e não há rebalanceamento automático: "você precisa atribuir manualmente x número de slots para cada master" (ou delegar isso a `redis-cli --cluster` / `redis-trib.rb`, ambos ainda só emitindo `CLUSTER ADDSLOTS`/`SETSLOT` por baixo).

Diferente do Sentinel, "o Redis Cluster só exige um único processo para rodar" por nó, mas cada nó abre duas portas: a porta de cliente normal, e uma segunda (porta de cliente **mais 10000**) usada puramente para o barramento binário de gossip nó-a-nó (detecção de falha, coordenação de failover, mensagens de migração de slot). Nós formam uma malha completa sobre esse barramento. Um cluster saudável precisa de pelo menos três masters, e é fortemente recomendado que todo master tenha pelo menos uma réplica: "se qualquer nó master sem pelo menos uma réplica falhar, o dado será perdido", porque não há nada para promover.

### Hash tags: forçando chaves para o mesmo slot

Qualquer comando tocando várias chaves ao mesmo tempo (`MSET`, `SUNION`, um script Lua) exige que todas essas chaves morem no mesmo slot, porque o Redis Cluster não tem nenhum mecanismo de transação entre slots. Hash tags são a versão embutida do Redis Cluster da convenção de tagging do lado do cliente anterior do livro: envolva a parte da chave que você quer hasheada em `{chaves}`, e só essa substring é alimentada ao CRC16.

```
SADD {user123}:friends:usa "John" "Bob"
SADD {user123}:friends:brazil "Max" "Hugo"
SUNION {user123}:all_friends {user123}:friends:usa {user123}:friends:brazil
```

Todas as três chaves hasheiam só em `user123` e estão garantidas de pousar no mesmo slot, então o `SUNION` acima é uma operação válida de nó único no Redis Cluster mesmo que os três nomes de chave sejam de resto strings não relacionadas.

O traço abaixo roda o `redisClusterSlot()` do projeto (uma implementação real, verificada à mão, do algoritmo exato acima (`crc16(key) & 16383`, honrando uma `{tag}` quando presente)) sobre seis chaves representativas, contra o espaço real de 16384 slots:

```viz
type: formula
capacity = 16384
slot = redisClusterSlot(item)
---
session:alice
{user1000}.profile
{user1000}.orders
cart:9981
foo
leaderboard:global
```

Rodado pelo motor real, esse traço produz:

| Chave | Slot |
|---|---|
| `session:alice` | 15036 |
| `{user1000}.profile` | 3443 |
| `{user1000}.orders` | 3443 |
| `cart:9981` | 7185 |
| `foo` | 12182 |
| `leaderboard:global` | 5355 |

Duas coisas valem a pena ler diretamente dessa tabela. Primeiro, `foo` pousa no slot 12182: o número exato da própria sessão `redis-cli` do livro acima, porque isso não é uma aproximação do algoritmo do Redis, *é* o algoritmo do Redis (CRC16/XMODEM, verificado à mão contra o vetor de teste padrão `crc16('123456789') === 0x31c3`). Segundo, e mais importante: `{user1000}.profile` e `{user1000}.orders` são chaves diferentes sem nada textualmente em comum fora da tag, e pousam no slot idêntico, 3443: o ponto inteiro das hash tags, provado ao rodar a função real em vez de afirmado.

### Topologia de cluster, failover, e administração

O livro percorre a administração de cluster em nível de comando antes de introduzir qualquer ferramenta wrapper, o que vale a pena saber porque é o que toda ferramenta wrapper faz por baixo: `CLUSTER ADDSLOTS` atribui uma faixa de slots ao nó conectado; `CLUSTER SET-CONFIG-EPOCH` planta em cada master um número de época distinto para que reivindicações de slot conflitantes sejam resolvidas deterministicamente (a maior época vence); `CLUSTER MEET <ip> <port>` apresenta um nó a outro, depois do que o protocolo de gossip propaga a associação completa para todo nó na malha sem precisar de um `MEET` entre todos os pares. Um cluster cujos slots não estão todos cobertos reporta `cluster_state:fail` de `CLUSTER INFO` e recusa toda consulta com `CLUSTERDOWN`.

**Réplicas** são adicionadas iniciando uma instância nova em modo cluster, dando `CLUSTER MEET` nela, lendo o ID do nó do master alvo de `CLUSTER NODES`, depois rodando `CLUSTER REPLICATE <master-node-id>` no nó novo. **Resharding** de um slot por vez é um handshake de quatro passos: `CLUSTER SETSLOT <slot> IMPORTING <source-id>` no destino, `CLUSTER SETSLOT <slot> MIGRATING <dest-id>` na origem, depois `MIGRATE` (ou `CLUSTER GETKEYSINSLOT`/`COUNTKEYSINSLOT` mais `MIGRATE` por chave) para mover quaisquer chaves existentes, e finalmente `CLUSTER SETSLOT <slot> NODE <dest-id>` transmitido para todo master para que a nova posse seja acordada em todo lugar. Remover um nó exige fazer resharding de todos os seus slots primeiro, depois `CLUSTER FORGET <node-id>` em todo master restante dentro de 60 segundos (o Redis mantém uma lista de banimento de curta duração para impedir que o nó esquecido seja regossipado de volta).

**O posicionamento de réplica importa para resiliência.** Uma réplica por master tolera um master falhando uma vez: a réplica promovida agora tem zero réplicas próprias, então uma segunda falha nesse shard perde dados de vez (ou, se `cluster-require-full-coverage yes`, derruba o cluster inteiro). O padrão recomendado pelo livro é **réplicas sobressalentes**: dê a um master réplicas extras em vez de uma cada uniformemente, e deixe `cluster-migration-barrier` controlar como uma sobressalente é reatribuída para cobrir qualquer master que acabou de perder sua única réplica.

Leituras podem ser escaladas conectando diretamente a uma réplica e emitindo `READONLY`: a réplica então serve leituras para slots que possui em vez de sempre redirecionar para seu master (revertido por `READWRITE`), ao custo de dado potencialmente obsoleto.

### Livro vs. hoje

> **`redis-trib.rb` se foi; sua funcionalidade se moveu para `redis-cli --cluster`.** O livro ensina `redis-trib.rb create --replicas 1 ...`, `redis-trib.rb reshard`, `redis-trib.rb add-node`, chamando-o de "a ferramenta oficial de gerenciamento de cluster" enquanto observa que ainda era "muito imaturo." A partir do Redis 5.0, o `redis-trib.rb` não é mais distribuído nem suportado; sua lógica foi portada de Ruby para C, diretamente dentro do `redis-cli`, como a família de subcomandos `--cluster`. A documentação atual do Redis confirma que a mesma superfície de comando que o livro descreve ainda existe, só renomeada: `redis-cli --cluster create`, `--cluster reshard --cluster-from --cluster-to --cluster-slots --cluster-yes`, `--cluster add-node`, `--cluster del-node`, `--cluster check`, `--cluster fix`, `--cluster call`, `--cluster import`. Quem digitar os comandos exatos `redis-trib.rb` do livro em uma instalação Redis atual precisa da tradução `--cluster`, não de um modelo mental diferente.
>
> **A semântica de quorum do Sentinel é a mesma, descrita com mais precisão hoje.** `sentinel monitor <name> <ip> <port> <quorum>` e as diretivas `down-after-milliseconds`/`failover-timeout`/`parallel-syncs` estão inalteradas na documentação atual do Redis. A documentação atual é explícita sobre uma nuance que o livro declara de forma mais frouxa: o quorum é usado só para *detectar* que o master está fora do ar; de fato autorizar um failover exige adicionalmente um **voto de maioria entre todos os processos Sentinel**, não só uma quantidade igual ao quorum. Vale a pena saber ao dimensionar um deployment de Sentinel: um número par de Sentinels, ou um quorum definido sem considerar a contagem total de Sentinel, é uma forma comum de acabar com uma configuração tecnicamente com quorum mas praticamente quebrada.
>
> **Hash slots, CRC16, e hash tags estão inalterados.** 16384 slots, `CRC16(key) mod 16384`, e a sintaxe de hash tag `{tag}` são exatamente como o livro descreve e exatamente como a visualização deste conceito prova; nada aqui se moveu.

## Trade-offs

- **Esquemas de particionamento do lado do cliente trocam complexidade por controle, e todos eles perdem essa troca para o Redis Cluster uma vez que você não precisa do controle.** Particionamento por range é trivial de implementar e de forma confiável desigual. Particionamento por hash é uniforme mas quebra no redimensionamento: o próprio teste do livro perdeu 75% de um dataset ao adicionar dois servidores. Presharding conserta o redimensionamento fixando o tamanho do array de antemão, ao custo de "significativamente mais instâncias para gerenciar" com "nenhum conjunto ótimo de ferramentas para fazer isso" (escrito antes de o Redis Cluster existir para ser essa ferramenta). Consistent hashing é a melhor das opções do lado do cliente (remapeando só K/n chaves no redimensionamento), mas ainda é uma biblioteca que você possui, ajusta (contagem de nó virtual), e mantém correta em todo cliente. O Redis Cluster é para onde todos os quatro convergem: particionamento de tamanho fixo, tolerante a redimensionamento, suportado por ferramenta, mas como infraestrutura que você implanta em vez de código que você escreve. A própria recomendação do livro é proporcional a isso: use consistent hashing quando perda de dado no remap é barata (um cache), recorra ao Cluster quando não é (um armazenamento).
- **O Redis Cluster e o Sentinel resolvem problemas diferentes, e usar o errado custa a garantia que você de fato precisava.** O Sentinel dá failover automático em um par primário/réplica sem sharding: nenhuma distribuição de dado de jeito nenhum. O Cluster dá sharding mais failover, mas a um custo operacional real: uma malha completa de nós, um barramento de gossip em uma segunda porta por nó, atribuição manual de slot sem rebalanceamento automático, e um cliente que precisa entender redirects `MOVED`/`ASK`. Recorrer ao Cluster porque "é o mais novo" quando o requisito real é só failover automático em um dataset que cabe em uma instância compra complexidade de sharding de graça. Recorrer ao Sentinel quando o dataset cresceu além de uma instância não compra sharding de jeito nenhum: o Sentinel "não é um armazenamento de dados distribuído."
- **Hash tags resolvem operações multi-chave concentrando carga, exatamente a troca que a própria técnica de tagging do livro já tinha.** Toda chave compartilhando uma tag pousa em um slot em um master: necessário para `SUNION`/`SINTER`/`MSET` entre essas chaves, mas também significa que o tráfego e a memória dessa tag não podem ser espalhados pelo cluster. Uma tag com escopo em `{user123}` (um punhado de chaves por usuário) se espalha bem porque há muitas tags distintas. Uma tag com escopo em `{global}` usada em uma população enorme de chave anula o ponto inteiro de clustering para esse dado: um master carrega tudo. Hash tags são um bisturi para operações multi-chave específicas, não uma convenção geral de nomenclatura de chave.
- **Nenhum rebalanceamento automático de slot significa que a uniformidade do cluster é só tão boa quanto quem quer que tenha rodado um reshard por último.** Diferente de um anel de consistent hash, que se autocorrige conforme membros são adicionados, a posse de slot do Redis Cluster é uma atribuição manual que persiste até que alguém (ou um script, ou `redis-cli --cluster rebalance`) a mova. Adicione um quarto master a um cluster de três masters e ele possui zero slots (e portanto serve zero tráfego) até que slots sejam explicitamente reatribuídos a ele. Isso é mais previsível do que rebalanceamento automático (nenhuma migração surpresa sob carga) e mais trabalho (nada acontece até você fazer acontecer).
- **`cluster-require-full-coverage` é um botão direto do teorema CAP, e o livro mostra o modo de falha das duas configurações.** Definido como `yes` (o padrão), os slots de um único master ficarem inacessíveis derruba o *cluster inteiro*: cobertura totalmente consistente, zero disponibilidade para slots que estavam perfeitamente saudáveis. Definido como `no`, o cluster continua no ar e serve tudo exceto os slots inacessíveis, que dão erro individualmente: disponibilidade para a maioria das chaves, ao custo de um cluster que está "no ar" enquanto falha silenciosamente em um subconjunto definido de seu keyspace. Nenhuma configuração é mais correta; são a mesma troca que o CAP nomeia, expressa como um booleano.
- **O quorum do Sentinel protege contra falsos failovers, não contra perda de dado durante uma partição real.** O passo a passo de split-brain do livro é a versão afiada disso: o quorum detecta corretamente que o master está inacessível e promove corretamente uma réplica (o mecanismo funciona exatamente como projetado), e as escritas do cliente para o master antigo e isolado ainda são perdidas quando a partição se cura, porque "não há sincronização de dado nesse processo." O trabalho do Sentinel nunca foi prevenir isso; sempre foi só tornar o failover automático em vez de manual. Tratar failover automático como uma garantia de consistência é a lacuna que o livro gasta uma seção inteira fechando.
- **Posicionamento manual de réplica (réplicas sobressalentes, `cluster-migration-barrier`) está disponível e, como posicionamento manual de bloco em outros sistemas, é fácil de errar por omissão.** Um cluster uniforme de uma réplica por master parece resiliente e tem uma lacuna real: o primeiro failover em qualquer shard deixa esse shard com zero réplicas até que um operador ou uma política de réplica sobressalente o conserte. O conserto custa uma decisão de design (quais masters ganham sobressalentes, e quantas) feita uma vez, no momento de criação do cluster: barato antes de haver dado, uma reconfiguração ao vivo depois.

## Documentation Links

- [Vinicius Da Silva, Henrique Cassela, Adhitya Rachman Nugraha, Naga Venkata Sudheer Yaramada, "Redis Essentials" (Packt Publishing, 2015), Chapter 8, "Scaling Redis (Beyond a Single Instance)", Partitioning through Automatic sharding with twemproxy, p. 148-168; Chapter 9, "Redis Cluster and Redis Sentinel", full chapter, p. 169-196](https://www.packtpub.com/product/redis-essentials/9781784392503) - doc
- [Redis Documentation: Scale with Redis Cluster](https://redis.io/docs/latest/operate/oss_and_stack/management/scaling/) - doc
- [Redis Documentation: Redis Cluster specification (hash slots, hash tags, CRC16)](https://redis.io/docs/latest/operate/oss_and_stack/reference/cluster-spec/) - doc
- [Redis Documentation: High availability with Redis Sentinel](https://redis.io/docs/latest/operate/oss_and_stack/management/sentinel/) - doc
- [Redis Documentation: `redis-cli` cluster management mode](https://redis.io/docs/latest/operate/oss_and_stack/reference/cli-tools/) - doc
