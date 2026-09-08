---
version: 1.0
updatedAt: 2026-08-20
title: "Arquitetura Distribuída do Cassandra: Gossip, Snitches, Tokens e Nós Virtuais"
summary: Como um cluster Cassandra concorda sobre associação (membership) e posicionamento de dados sem um coordenador: o protocolo gossip e o Phi Accrual Failure Detector para o estado do cluster, snitches para roteamento com reconhecimento de topologia, o token ring e o hashing consistente para posse determinística de partição, e nós virtuais para rebalanceamento equilibrado.
---
## Objective

Entender a camada por baixo de todo nível de consistência e cálculo de quorum: como um cluster Cassandra não tem mestre, mas ainda assim todo nó sabe (aproximadamente) o que todo outro nó está fazendo, via **gossip**; como um **token ring** transforma uma partition key em um nó dono determinístico através de hashing consistente; como **snitches** ensinam ao cluster sua própria topologia física, para que ele possa rotear requisições com inteligência; e como **nós virtuais (vnodes)** transformam uma máquina física em muitas fatias pequenas e independentemente rebalanceáveis desse anel. Níveis de consistência e quóruns (cobertos no conceito irmão) decidem *quantas* réplicas precisam responder; este conceito explica *quais* réplicas são essas, e como o cluster concordou sobre isso sem nunca eleger um líder.

## Use Cases

- Explicar a um time acostumado com um banco de dados primário/réplica por que o Cassandra não tem um único nó que "é dono" da associação do cluster, e por que essa ausência é o ponto, não um recurso faltando.
- Diagnosticar um nó que o `nodetool status` reporta como `DN` (fora do ar): entender que esse julgamento vem de o **Phi Accrual Failure Detector** lendo heartbeats de gossip, não de um timeout fixo, e que "com as configurações padrão, o Cassandra geralmente consegue detectar um nó que falhou em cerca de 10 segundos."
- Escolher um snitch ao subir um cluster real: o aviso do livro de que o `SimpleSnitch` de fábrica "não tem consciência de topologia... o que o torna inadequado para implantações com múltiplos data centers."
- Raciocinar sobre a saída de `nodetool ring` ou `nodetool status` mostrando centenas de intervalos de token por nó, e saber que isso são vnodes em ação, não uma má configuração.
- Dimensionar `num_tokens` ao adicionar hardware heterogêneo a um cluster existente: "você pode aumentar o número de vnodes... [ou] definir num_tokens mais baixo para diminuir o número de vnodes para máquinas menos capazes."
- Explicar por que inicializar ou desativar um nó em um cluster com vnodes toca muitos intervalos pequenos e bem espalhados, em vez de um único pedaço contíguo enorme, de propriedade de um único nó físico.

## Deep Dive

### Data centers e racks: a topologia sobre a qual o Cassandra é informado

Antes que qualquer parte da maquinaria peer-to-peer faça sentido, o Cassandra precisa de um vocabulário para o layout físico. "O Cassandra fornece dois níveis de agrupamento usados para descrever a topologia de um cluster: data center e rack. Um rack é um conjunto lógico de nós próximos uns dos outros, talvez em máquinas físicas em um único rack de equipamento. Um data center é um conjunto lógico de racks, talvez localizados no mesmo prédio e conectados por uma rede confiável." De fábrica, um cluster novo é um único data center (`"datacenter1"`) contendo um único rack (`"rack1"`): tudo o mais neste conceito é o Cassandra aprendendo e usando uma versão mais rica desse quadro.

### Gossip e detecção de falhas: como os nós aprendem uns sobre os outros

O Cassandra é peer-to-peer: nenhum nó é especial, então nenhum nó pode simplesmente ser perguntado "qual é o estado do cluster?" Em vez disso, "o Cassandra usa um protocolo gossip que permite que cada nó mantenha um registro de informações de estado sobre os outros nós do cluster. O gossiper roda a cada segundo em um timer." Protocolos gossip (também chamados de protocolos epidêmicos) "geralmente assumem uma rede falha, são comumente empregados em sistemas de rede descentralizados muito grandes, e frequentemente são usados como um mecanismo automático de replicação em bancos de dados distribuídos": o nome vem da fofoca humana, onde "pares podem escolher com quem querem trocar informações." O próprio termo data de 1987, cunhado pelo pesquisador da Xerox PARC Alan Demers.

O gossip é implementado por `org.apache.cassandra.gms.Gossiper`, e toda rodada segue a mesma troca de três mensagens:

1. "Uma vez por segundo, o gossiper vai escolher um nó aleatório no cluster e inicializar uma sessão de gossip com ele. Cada rodada de gossip exige três mensagens."
2. "O iniciador do gossip envia ao amigo escolhido uma mensagem `GossipDigestSyn`."
3. "Quando o amigo recebe essa mensagem, ele retorna uma mensagem `GossipDigestAck`."
4. "Quando o iniciador recebe a mensagem de ack do amigo, ele envia ao amigo uma mensagem `GossipDigestAck2` para completar a rodada de gossip."

A palavra **aleatório** está fazendo um trabalho real nesse primeiro passo. A seleção de parceiro de gossip não tem nada a ver com posição no anel ou posicionamento de réplica: o parceiro de gossip de um nó, para uma dada rodada, pode ser seu vizinho no anel ou um nó do outro lado do anel. Essa aleatoriedade é exatamente o que faz um protocolo epidêmico convergir rapidamente em um cluster arbitrariamente grande sem um coordenador: a informação se espalha exponencialmente, não linearmente ao redor de um anel.

Como o gossip também é o substrato para a detecção de falhas, "a classe `Gossiper` mantém uma lista de nós que estão vivos e mortos." Quando ele decide que outro endpoint está morto, ele "condena" esse endpoint, marcando-o como morto localmente e registrando o fato. Essa decisão não é uma checagem ingênua de heartbeat perdido; o Cassandra usa o **Phi Accrual Failure Detector**, do Instituto Avançado de Ciência e Tecnologia do Japão (2004). Detectores de heartbeat tradicionais são binários: um heartbeat chegou, ou não chegou, e o nó é declarado morto ou vivo. A detecção por acréscimo (accrual) rejeita esse enquadramento: ela "decide que essa abordagem é ingênua, e encontra um lugar entre os extremos de morto e vivo: um nível de suspeita." O detector "produz um valor associado a cada processo (ou nó) chamado Phi", que é "projetado para ser adaptativo diante de condições de rede voláteis." Um `phi_convict_threshold` configurável ajusta a sensibilidade: valores mais baixos condenam mais rápido (e com mais frequência em caso de instabilidade de rede), valores mais altos são mais tolerantes, "não de forma linear." Com os padrões, "o Cassandra geralmente consegue detectar um nó que falhou em cerca de 10 segundos." A classe `org.apache.cassandra.gms.FailureDetector` expõe `isAlive()`, `interpret()` (calcula suspeita a partir de Phi), e `report()` (registra um heartbeat recebido).

### Snitches: consciência de topologia para roteamento

O gossip diz a um nó *que* outros nós existem e seu estado aproximado; um **snitch** diz *onde* eles estão. "O trabalho de um snitch é fornecer informação sobre sua topologia de rede, para que o Cassandra possa rotear requisições eficientemente... o snitch vai determinar a proximidade relativa de cada nó em um cluster, o que é usado para determinar de quais nós ler e escrever." Concretamente, em uma leitura o Cassandra consulta uma réplica pela linha completa e as outras apenas por digests de hash (para confirmar atualidade); o snitch é quem escolhe a réplica com maior probabilidade de responder mais rápido para essa leitura completa.

O padrão, `SimpleSnitch`, "não tem consciência de topologia; ou seja, não sabe sobre os racks e data centers em um cluster, o que o torna inadequado para implantações com múltiplos data centers." Snitches de produção (`GossipingPropertyFileSnitch` e específicos de nuvem para EC2, Google Cloud, Cloudstack) vivem em `org.apache.cassandra.locator`, cada um implementando `IEndpointSnitch`.

Por cima de qualquer snitch que você configure, o Cassandra sobrepõe o **snitching dinâmico**: o snitch escolhido é envolvido em um `DynamicEndpointSnitch` que "monitora a performance de requisições para os outros nós, até mantendo registro de coisas como quais nós estão fazendo compaction", usando esses dados de performance ao vivo (não apenas topologia estática) "para selecionar a melhor réplica para cada query" e evitar rotear para nós que estão ocupados ou degradados. Ele reutiliza "uma versão modificada do mecanismo de detecção de falhas Phi usado pelo gossip", com um *limiar de maldade* (badness threshold) configurável, controlando o quanto pior um nó normalmente preferido precisa performar antes de perder a preferência, e pontuações resetadas periodicamente, para que um nó recuperado possa reconquistar seu lugar.

### Anéis e tokens: hashing consistente, concretamente

Topologia (data centers, racks, snitches) é sobre *onde os nós estão*. Anéis e tokens são sobre *para onde os dados vão*. "O Cassandra representa os dados gerenciados por um cluster como um anel. Cada nó no anel recebe um ou mais intervalos de dados descritos por um token, que determina sua posição no anel." Por padrão um token é um inteiro de 64 bits, então o espaço vai de −2⁶³ a 2⁶³−1.

A posse é definida com precisão: "um nó reivindica posse do intervalo de valores menor ou igual a cada token e maior que o último token do nó anterior, conhecido como intervalo de token. O nó com o menor token possui o intervalo menor ou igual ao seu token e o intervalo maior que o token mais alto, também conhecido como o intervalo de retorno (wrapping range)." Esse retorno é o que faz disso um *anel*, em vez de uma linha: ande longe o suficiente no sentido horário passando do token mais alto e você retorna ao nó de token mais baixo.

O posicionamento em si é uma busca por hash: "os dados são atribuídos a nós usando uma função de hash para calcular um token para a partition key. Esse token de partition key é comparado aos valores de token dos vários nós, para identificar o intervalo, e portanto o nó, que possui o dado." O CQL expõe isso diretamente através da função `token()`. Consultá-la contra uma tabela `user` com chave por `last_name` mostra o mecanismo em ação:

```
cqlsh:my_keyspace> SELECT last_name, first_name, token(last_name)
FROM user;

 last_name | first_name | system.token(last_name)
-----------+------------+-------------------------
 Rodriguez |       Mary |    -7199267019458681669
     Scott |     Isaiah |     1807799317863611380
    Nguyen |       Bill |     6000710198366804598
    Nguyen |      Wanda |     6000710198366804598

(5 rows)
```

"Como você pode esperar, vemos um token diferente para cada partição, e o mesmo token aparece para as duas linhas representadas pelo valor de partition key 'Nguyen'." Ambas as linhas Nguyen compartilham uma partition key, então elas mapeiam por hash para o mesmo token e vivem no mesmo nó: uma ilustração direta e verificável de "a partition key determina o posicionamento" que não tem nada a ver com clustering columns (essas apenas ordenam linhas *dentro* de uma partição, uma vez que ela já foi localizada).

### Nós virtuais: muitos intervalos pequenos, em vez de um grande

O Cassandra antigo atribuía **um** token, e portanto um intervalo contíguo, por nó físico, "de forma bastante estática, exigindo que você calculasse tokens para cada nó." Isso era manual (definindo `initial_token` por nó no `cassandra.yaml`) e tornava adicionar ou substituir um nó caro, "já que rebalancear o cluster exigia mover muitos dados" em um único pedaço contíguo grande.

O Cassandra 1.2 introduziu **nós virtuais (vnodes)**: "em vez de atribuir um único token a um nó, o intervalo de token é quebrado em vários intervalos menores. Cada nó físico então recebe múltiplos tokens." Historicamente cada nó recebia 256 desses, 256 pequenos intervalos de token espalhados pelo anel, em vez de um único arco grande, habilitado por padrão desde a 2.0. A propriedade `num_tokens` no `cassandra.yaml` controla a quantidade por nó, então hardware heterogêneo pode ser ponderado diretamente: mais vnodes para uma máquina mais robusta, menos para uma mais fraca, e o Cassandra proporciona os dados reais que cada nó guarda de acordo (calculado por `org.apache.cassandra.dht.tokenallocator.ReplicationAwareTokenAllocator`).

O ganho é operacional: como a posse é espalhada por muitos intervalos pequenos em vez de concentrada em um só, "inicializar um nó novo, desativar um nó, e reparar um nó" tornam-se todas operações mais leves e distribuídas de forma mais equilibrada, "a carga associada a operações em múltiplos intervalos menores é espalhada de forma mais uniforme entre os nós do cluster", em vez de um único nó descarregando ou absorvendo uma única fatia enorme do anel de uma vez.

### Partitioners: a função de hash por trás do token

O **partitioner** é a peça que de fato calcula um token a partir de uma partition key: "uma função de hash para calcular o token de uma partition key." O Cassandra vem com vários em `org.apache.cassandra.dht` (DHT = tabela de hash distribuída); o `Murmur3Partitioner`, adicionado na 1.2, tem sido o padrão desde então, gerando hashes de 64 bits via o algoritmo Murmur e substituindo o antigo `RandomPartitioner`. É plugável (implemente `IPartitioner`), mas "o partitioner padrão não é trocado com frequência na prática, e... você não pode trocar o partitioner depois de inicializar um cluster": é uma decisão do primeiro dia, não um botão de ajuste posterior.

### O anel, em movimento: fazendo hash de uma escrita e propagando o estado do cluster via gossip

O trace abaixo roda duas histórias independentes sobre o mesmo anel de seis nós. Primeiro, a escrita de um cliente é submetida a hash e localizada percorrendo os limites de token no sentido horário até que um nó dono seja encontrado: o mecanismo por trás da saída de `token()` acima. Segundo, uma vez que a posse é decidida, o gossiper desse nó dono dispara em seu próprio timer de um segundo e escolhe um par **aleatório** para uma rodada de `Syn`/`Ack`/`Ack2`, caindo em um nó que *não* é seu vizinho no anel, para deixar claro que a topologia de gossip e a topologia de dados são dois grafos separados sobrepostos no mesmo cluster físico.

```viz
type: graph
node CLIENT Client -1 2.5
node N1 N1 4 1.5
node N2 N2 6 2.5
node N3 N3 6 4.5
node N4 N4 4 5.5
node N5 N5 2 4.5
node N6 N6 2 2.5
edge CLIENT N6
edge N6 N1
edge N1 N2
edge N2 N3
edge N3 N4
edge N4 N5
edge N5 N3
---
visit CLIENT | Um INSERT para alguma partition key. Como a própria query token() do livro mostra para last_name='Nguyen', uma partition key faz hash de forma determinística para um token de 64 bits -- o cliente não calcula isso sozinho, e ainda não sabe qual nó é o dono.
traverse CLIENT N6 | O cliente se conecta a qualquer nó que quiser; N6 responde e se torna o coordenador para esta query. Coordenador é um papel por query, não fixo.
visit N6 | N6 passa a partition key pelo partitioner do cluster (Murmur3Partitioner por padrão) para obter o token de 64 bits, e então precisa descobrir de qual nó o intervalo contém esse token.
traverse N6 N1 | Percorrendo o anel: compara o token contra o limite de N1. "Um nó reivindica posse do intervalo de valores menor ou igual a cada token e maior que o último token do nó anterior" -- não é este intervalo.
traverse N1 N2 | Também não é o intervalo de N2.
traverse N2 N3 | Nem o de N3.
traverse N3 N4 | Nem o de N4.
traverse N4 N5 | O token de N5 é o primeiro maior ou igual ao token da partition key -- este é o intervalo.
mark N5 | N5 possui esse intervalo de token e se torna a primeira réplica (primária) para a escrita. Em produção, a posição de N5 no anel é na verdade uma de ~16 pequenos intervalos vnode, não um único arco grande, mas a busca funciona de forma idêntica.
visit N5 | Posse decidida. Independentemente de qualquer query, o gossiper de N5 dispara em seu próprio timer de um segundo -- o gossip roda continuamente e não tem nada a ver com esta escrita.
traverse N5 N3 | Uma vez por segundo o gossiper "vai escolher um nó aleatório no cluster e inicializar uma sessão de gossip com ele." A escolha aleatória de N5 nesta rodada é N3 -- dois saltos de distância no anel, não um vizinho (os vizinhos reais de N5 no anel são N4 e N6). Topologia de gossip e topologia de anel são grafos não relacionados.
traverse N3 N5 | N3 responde com um GossipDigestAck: sua própria visão do estado do cluster, mais o que ele precisa de N5.
traverse N5 N3 | N5 envia GossipDigestAck2, completando a rodada. A visão de ambos os nós sobre quem está vivo, quem está morto, e o último estado que cada um reportou convergiu um pouco mais -- é também assim que N3 eventualmente saberia que um nó falhou, bem antes de precisar atender uma query que tocasse os intervalos daquele nó.
mark N3 | Nenhuma mensagem aqui tocou posicionamento de réplica ou níveis de consistência de forma alguma -- o único trabalho do gossip é espalhar metadados do cluster. A escrita acima e a rodada de gossip aqui são dois mecanismos independentes que acontecem de rodar em nós sobrepostos.
```

Dois mecanismos, um anel: a caminhada pelo token (passos 1-9) é determinística e conduzida por query: a mesma chave sempre aterrissa no mesmo nó, sempre, não importa quem coordena. A rodada de gossip (passos 10-14) é probabilística e contínua: qual nó fala com qual é aleatório a cada segundo, e ela roda independentemente de algum cliente estar escrevendo alguma coisa. Confundir os dois é um erro comum no início: adjacência no token ring (usada para posicionamento de réplica de `SimpleStrategy`) não é adjacência no grafo de gossip (usado para propagação de estado do cluster).

### Book vs today

> **O padrão de vnode caiu de 256 para 16 no Cassandra 4.0.** O livro registra o padrão histórico com precisão ("cada nó tem recebido 256 desses tokens"), mas sinaliza que isso pode mudar. E mudou: o Cassandra 4.0 (CASSANDRA-13701) baixou o `num_tokens` padrão de fábrica para **16**, confirmado diretamente na documentação de referência atual do `cassandra.yaml`. A mudança foi combinada com o algoritmo determinístico de alocação de token mencionado neste mesmo capítulo do livro (introduzido na 3.x): a alocação aleatória precisava de uma grande quantidade de tokens por nó para balancear um anel estatisticamente, enquanto o alocador consegue balancear um anel bem com muito menos tokens, posicionados deliberadamente. Menos vnodes por nó também significa menos overhead de bootstrap/repair (menos SSTables para transmitir, streaming mais rápido), que foi a motivação operacional direta. Clusters existentes pré-4.0 mantêm o `num_tokens` com que foram construídos; 16 só se aplica a clusters novos ou reconfiguração explícita.
> **O snitch padrão e a recomendação de produção permanecem inalterados.** A documentação atual do Apache Cassandra ainda traz o `SimpleSnitch` como padrão e ainda orienta implantações de produção para o `GossipingPropertyFileSnitch`, combinando com a descrição do livro do `SimpleSnitch` como inadequado além de um único data center. Nada aqui mudou.
> **O Murmur3Partitioner ainda é o padrão, inalterado desde a 1.2.** A documentação atual confirma isso diretamente, junto com a mesma nota de compatibilidade retroativa que o livro dá para `RandomPartitioner` e outros partitioners legados.
> **A troca de três mensagens do gossip (`Syn`/`Ack`/`Ack2`) e o timer de uma vez por segundo continuam sendo o mecanismo documentado.** A documentação de arquitetura atual descreve a mesma tarefa de gossip por segundo, por nó, trocando informação de heartbeat e estado de endpoint com pares escolhidos aleatoriamente, incluindo tentativas probabilísticas em direção a nós de outra forma inacessíveis: a descrição do protocolo pelo livro não ficou desatualizada.

## Trade-offs

- **Nenhum coordenador para associação de cluster significa nenhum ponto único de falha para isso, mas também nenhuma visão global instantânea.** O gossip garante acordo eventual, não imediato, sobre o estado do cluster: um nó que acabou de falhar ainda está, por uma janela medida em segundos, "vivo" de acordo com nós que ainda não fofocaram sobre ele. Essa janela é o preço da descentralização, e é por isso que a detecção de falha é probabilística (um *nível de suspeita* Phi), em vez de uma flag instantânea e autoritativa.
- **O Phi Accrual Failure Detector troca uma resposta binária limpa por uma que se adapta a condições reais de rede.** Um detector de timeout fixo é simples de raciocinar, mas frágil sob instabilidade: uma única conexão lenta pode parecer idêntica a um nó morto. A detecção por acréscimo evita condenações falsas durante lentidão transitória ao custo de um parâmetro ajustável, menos intuitivo (`phi_convict_threshold`), que precisa ser entendido, não apenas configurado e esquecido.
- **`SimpleSnitch` é fácil e errado para qualquer coisa além de um cluster de laptop.** Exige zero configuração e funciona para um anel de teste de um único data center, mas é cego à topologia por design: não consegue tomar boas decisões de posicionamento de réplica ou roteamento de leitura entre racks ou data centers. Escolhê-lo para uma implantação de produção multi-datacenter não é um trade-off de performance, é uma lacuna de corretude: o posicionamento de réplica do `NetworkTopologyStrategy` depende de o snitch conhecer a topologia sobre a qual está posicionando réplicas.
- **O snitching dinâmico adiciona adaptabilidade ao custo de uma segunda camada de estado para raciocinar.** Topologia estática (rack/DC) é estável e previsível; dados de performance ao vivo (qual nó está em meio a uma compaction, qual está lento agora) mudam constantemente. Envolver o snitch estático em um dinâmico te dá os dois, mas depurar "por que essa leitura foi para aquela réplica" agora exige checar duas entradas diferentes, em vez de uma.
- **Vnodes trocam simplicidade do modelo mental por elasticidade operacional.** Um token por nó é fácil de raciocinar e fácil de desenhar em um quadro branco; muitos tokens pequenos por nó não são, mas são o que faz adicionar um nó tomar uma fatia proporcional de *todo* nó existente, em vez de dividir ao meio o intervalo gigante de um vizinho azarado. A própria mudança de padrão de 256 para 16 é um trade-off dentro de um trade-off: menos tokens significa operações de streaming mais rápidas, mas só permanece equilibrado porque o alocador determinístico (não posicionamento aleatório) está fazendo o trabalho: reverter para atribuição aleatória de token com `num_tokens: 16` rebalancearia muito pior do que com 256.
- **Hashing consistente via um token ring dá posicionamento determinístico, livre de coordenador, mas só tão equilibrado quanto a distribuição de token de fato é.** O mecanismo garante que *um* nó possui uma dada chave, sempre o mesmo nó, sem exigir um serviço de busca de metadados. Não garante que a posse esteja distribuída uniformemente, a menos que os tokens em si (manualmente, historicamente, ou hoje via o alocador determinístico) estejam de fato bem distribuídos: um anel mal balanceado é um risco real e silencioso com atribuição manual de token único, exatamente o modo de falha que vnodes e o alocador existem para fechar.
- **A aleatoriedade do gossip é eficiente em escala e pouco intuitiva em pequena escala.** A seleção aleatória de par é o que faz a convergência do gossip ser aproximadamente logarítmica no tamanho do cluster, em vez de linear: a propriedade que o torna viável para clusters muito grandes. Em um cluster de teste de 3 ou 4 nós, porém, "aleatório" só parece todo nó conversando com todo outro nó constantemente, o que pode fazer o tráfego de gossip parecer desproporcionalmente tagarela em relação à pequena quantidade de estado de fato sendo trocado.

## Documentation Links

- [Jeff Carpenter and Eben Hewitt, "Cassandra: The Definitive Guide", Revised 3rd Edition (O'Reilly, 2022), Chapter 6, "The Cassandra Architecture" (Data Centers and Racks through Partitioners)](https://www.oreilly.com/library/view/cassandra-the-definitive/9781492097143/) - doc
- [Apache Cassandra Documentation, Dynamo: Gossip, Failure Detection, Snitches, Token Ring, and Virtual Nodes](https://cassandra.apache.org/doc/latest/cassandra/architecture/dynamo.html) - doc
- [Apache Cassandra Documentation, Snitch](https://cassandra.apache.org/doc/latest/cassandra/managing/operating/snitch.html) - doc
- [Apache Cassandra Documentation, cassandra.yaml Configuration Reference (num_tokens, endpoint_snitch, partitioner)](https://cassandra.apache.org/doc/latest/cassandra/managing/configuration/cass_yaml_file.html) - doc
- [Apache Cassandra Documentation, Adding, Replacing, Moving and Removing Nodes](https://cassandra.apache.org/doc/latest/cassandra/operating/topo_changes.html) - doc
- [CASSANDRA-13701, Lower default num_tokens](https://issues.apache.org/jira/browse/CASSANDRA-13701) - doc
