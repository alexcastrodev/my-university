---
version: 1.0
updatedAt: 2026-08-20
title: "Níveis de Consistência do Cassandra: Consistência Ajustável, Quóruns e Nós Coordenadores"
summary: O Cassandra separa o fator de replicação, definido uma vez por keyspace pelo SimpleStrategy ou pelo NetworkTopologyStrategy recomendado para produção, do nível de consistência, escolhido por query pelo cliente, de modo que um nó coordenador encaminha cada leitura ou escrita para as réplicas donas da partição e retorna assim que ONE, QUORUM (floor(RF/2 + 1)) ou ALL delas responderem, com R + W > RF sendo a fórmula para consistência forte, e o hinted handoff mais o repair cobrindo as réplicas que não responderam.
---
## Objective

Entender os dois botões que o Cassandra entrega separadamente: o **fator de replicação**, definido uma vez por keyspace pela estratégia de replicação, e o **nível de consistência**, escolhido pelo cliente em cada leitura e escrita individualmente, e aprender como um nó coordenador transforma esses dois números em um quorum real: quais réplicas são contatadas, quantas precisam responder antes de o cliente ouvir "ok", e o que acontece com as que não responderam.

## Use Cases

- Escolher uma estratégia de replicação no momento do `CREATE KEYSPACE` e defender a escolha: a recomendação do livro é `NetworkTopologyStrategy` "para keyspaces em implantações de produção, mesmo aquelas inicialmente criadas com um único data center, já que é mais simples adicionar um data center adicional se a necessidade surgir."
- Escolher um nível de consistência por query, em vez de por aplicação: uma escrita de sessão que não pode ser perdida em `QUORUM`, uma varredura analítica de dados de evento imutáveis em `ONE`, uma escrita de conformidade entre data centers em `EACH_QUORUM`.
- Explicar a um time migrando de um banco de dados ACID de nó único por que `R + W > RF` é a coisa mais próxima de "consistência forte" que o Cassandra oferece, e onde essa garantia para.
- Depurar uma `UnavailableException` ou uma leitura que retornou um valor que alguém jura ter sobrescrito, trabalhando de trás para frente através do RF, do nível de consistência de fato usado, e se uma réplica ficou fora do ar tempo suficiente para os hints expirarem.
- Dimensionar uma implantação multi-datacenter em que `LOCAL_QUORUM` mantém as leituras dentro de uma região, mas um subconjunto de escritas precisa ser durável em toda região antes de retornar.
- Revisar uma base de código cliente onde ninguém nunca definiu um nível de consistência, então toda query rodou silenciosamente no padrão do driver, em vez de em um nível que alguém escolheu deliberadamente.

## Deep Dive

### Estratégias de replicação: para onde vão as cópias

"Um nó serve como réplica para diferentes intervalos de dados. Se um nó cair, outras réplicas podem responder a queries daquele intervalo de dados." O **fator de replicação** é "o número de nós no seu cluster que vão receber cópias (réplicas) do mesmo dado. Se seu fator de replicação é 3, então três nós no anel terão cópias de cada linha."

O posicionamento se divide em uma parte fixa e uma parte plugável. **A primeira réplica é sempre o nó que reivindica o intervalo em que o token cai**: essa é decidida pelo partitioner. Toda réplica restante é posicionada pela **estratégia de replicação** (também chamada de estratégia de posicionamento de réplicas), que o livro observa ser um padrão de projeto strategy de livro-texto, no estilo Gang of Four: `org.apache.cassandra.locator.AbstractReplicationStrategy` é a classe abstrata, e cada algoritmo de posicionamento é uma subclasse.

Duas implementações vêm prontas de fábrica:

| Estratégia | O que faz | Veredito do livro |
|---|---|---|
| `SimpleStrategy` | "Posiciona réplicas em nós consecutivos ao redor do anel, começando pelo nó indicado pelo partitioner." | Cega à topologia; boa para um anel de teste. |
| `NetworkTopologyStrategy` | "Permite especificar um fator de replicação diferente para cada data center. Dentro de um data center, ela aloca réplicas em racks diferentes para maximizar disponibilidade." | **Recomendada para keyspaces de produção, mesmo os de um único data center.** |

O raciocínio por trás dessa recomendação é operacional, não teórico: começar com `NetworkTopologyStrategy` significa que adicionar um segundo data center depois é um alter de keyspace e uma reconstrução, não uma troca de estratégia em um keyspace já em produção. (Uma terceira estratégia, `OldNetworkTopologyStrategy`, existe apenas por compatibilidade retroativa. O livro registra as renomeações históricas: `SimpleStrategy` era `RackUnawareStrategy`, `NetworkTopologyStrategy` era `DataCenterShardStrategy`, `OldNetworkTopologyStrategy` era `RackAwareStrategy`, todas efetivas na versão 0.7.)

**A estratégia é definida de forma independente para cada keyspace e é uma opção obrigatória ao criar um.** Essa é a primeira metade da história do ajuste fino: replicação é uma decisão de schema, tomada uma vez, por quem é dono do keyspace.

### Níveis de consistência: quantos precisam responder

A segunda metade é por query. "O Cassandra fornece níveis de consistência ajustáveis que permitem fazer essas trocas em um nível bem granular. Você especifica um nível de consistência em cada query de leitura ou escrita, que indica quanta consistência você precisa. Um nível de consistência mais alto significa que mais nós precisam responder a uma query de leitura ou escrita, dando mais segurança de que os valores presentes em cada réplica são iguais."

As duas direções são simétricas, mas não idênticas:

- **Leituras**: o nível "especifica quantos nós réplica precisam responder a uma requisição de leitura antes de retornar os dados."
- **Escritas**: ele "especifica quantos nós réplica precisam responder para que a escrita seja reportada como bem-sucedida ao cliente. Como o Cassandra é eventualmente consistente, atualizações para outros nós réplica podem continuar em segundo plano."

Essa última cláusula é a que as pessoas pulam. Uma escrita em `ONE` não é uma escrita para um nó; é uma escrita *enviada para toda réplica* que retorna assim que uma delas confirma. As demais continuam.

Os níveis que o livro apresenta aqui:

| Nível | Réplicas que precisam responder |
|---|---|
| `ONE`, `TWO`, `THREE` | "Um número absoluto de nós réplica que precisam responder a uma requisição." |
| `QUORUM` | "Uma resposta da maioria dos nós réplica." |
| `ALL` | "Uma resposta de todas as réplicas." |
| `ANY` | Um hint sozinho conta como uma escrita bem-sucedida (apenas para escritas; adicionado na 0.6). |
| `LOCAL_QUORUM` | Uma maioria dentro do data center local, nomeado aqui como um nível recomendado, detalhado no Capítulo 9. |

Quorum tem uma fórmula exata:

```
Q = floor(RF / 2 + 1)
```

"Nessa equação, Q representa o número de nós necessários para atingir quorum para um fator de replicação RF. Pode ser mais simples ilustrar isso com alguns exemplos: se RF é 3, Q é 2; se RF é 4, Q é 3; se RF é 5, Q é 3, e assim por diante."

Ler essa tabela de lado explica um erro comum de dimensionamento: RF=3 precisa de 2 para quorum e, portanto, tolera uma réplica morta; RF=4 precisa de 3 e *ainda* tolera apenas uma. A quarta cópia comprou armazenamento e amplificação de escrita, não disponibilidade em `QUORUM`. Fatores de replicação ímpares são os que se pagam.

O próprio box do livro nomeia a confusão que esta seção existe para prevenir:

> **"O fator de replicação é definido por keyspace. O nível de consistência é especificado por query, pelo cliente. O fator de replicação indica quantos nós você quer usar para armazenar um valor durante cada operação de escrita. O nível de consistência especifica quantos nós o cliente decidiu que precisam responder para se sentir confiante de uma operação de leitura ou escrita bem-sucedida. A confusão surge porque o nível de consistência é baseado no fator de replicação, não no número de nós no sistema."**

Essa última frase é essencial. `QUORUM` em um cluster de 100 nós com RF=3 significa **2 nós**, não 51.

### Consistência ajustável: R + W > RF

"A consistência é ajustável no Cassandra porque os clientes podem especificar o nível de consistência desejado tanto em leituras quanto em escritas." A fórmula que o livro dá para combiná-los:

```
R + W > RF  =>  strong consistency
```

"Nessa equação, R, W e RF são a contagem de réplicas de leitura, a contagem de réplicas de escrita, e o fator de replicação, respectivamente; todas as leituras do cliente verão a escrita mais recente nesse cenário, e você terá consistência forte."

O mecanismo é sobreposição de conjuntos. Com RF=3, escrever em `QUORUM` (W=2) e ler em `QUORUM` (R=2) dá 2 + 2 = 4 > 3, então o conjunto de leitura e o conjunto de escrita precisam compartilhar pelo menos uma réplica, e essa réplica tem o valor mais novo, que o coordenador resolve por timestamp. A recomendação prática do livro: "a forma recomendada de obter consistência forte no Cassandra é escrever e ler usando os níveis de consistência `QUORUM` ou `LOCAL_QUORUM`."

Algumas combinações que satisfazem a desigualdade e outras que não, com RF=3:

| CL de escrita | CL de leitura | W + R | Forte? |
|---|---|---|---|
| `QUORUM` (2) | `QUORUM` (2) | 4 > 3 | Sim, a resposta usual |
| `ALL` (3) | `ONE` (1) | 4 > 3 | Sim, leituras baratas, escritas frágeis |
| `ONE` (1) | `ALL` (3) | 4 > 3 | Sim, escritas baratas, leituras frágeis |
| `ONE` (1) | `QUORUM` (2) | 3 = 3 | **Não**, sem sobreposição garantida |
| `ONE` (1) | `ONE` (1) | 2 < 3 | **Não**, apenas eventual |

### Queries e nós coordenadores

"Um cliente pode se conectar a qualquer nó do cluster para iniciar uma query de leitura ou escrita. Esse nó é conhecido como o **nó coordenador**. O coordenador identifica quais nós são réplicas para o dado que está sendo escrito ou lido, e encaminha as queries para eles."

O coordenador é um papel por query, não um papel de todo o cluster: não existe mestre. O que ele faz se divide por operação:

- **Escrita**: "o nó coordenador contata *todas* as réplicas, conforme determinado pelo nível de consistência e pelo fator de replicação, e considera a escrita bem-sucedida quando um número de réplicas compatível com o nível de consistência confirma a escrita."
- **Leitura**: "o coordenador contata réplicas suficientes para garantir que o nível de consistência exigido seja atingido, e retorna os dados ao cliente."

A animação abaixo é uma única escrita em `QUORUM` com RF=3, em um keyspace usando `NetworkTopologyStrategy`, com uma réplica fora do ar. Seis círculos: o cliente, o coordenador, as três réplicas `R1`/`R2`/`R3` donas dessa partição, e, não um nó do cluster, o **hint** que o coordenador guarda localmente para a réplica que nunca respondeu.

```viz
type: graph
node CLIENT Client 0 3
node COORD Coord 2 3
node R1 R1 4 1
node R2 R2 4 3
node R3 R3 4 5
node HINT Hint 2 6
edge CLIENT COORD
edge COORD R1
edge COORD R2
edge COORD R3
edge COORD HINT directed
---
visit CLIENT | Um INSERT em CL=QUORUM. O keyspace tem RF=3, então Q = floor(3/2 + 1) = 2 réplicas precisam confirmar. O cliente se conecta a qualquer nó que quiser e não sabe nada sobre quais nós são donos dessa partição.
traverse CLIENT COORD | Qualquer nó ao qual o cliente se conectou se torna o coordenador para esta query. É um papel por query, não fixo -- a próxima query pode ser coordenada por um nó completamente diferente.
visit COORD | O coordenador faz o hash da partition key para um token e pergunta à estratégia de replicação do keyspace quem é dono desse intervalo de token. NetworkTopologyStrategy responde R1, R2, R3 -- três réplicas posicionadas em três racks diferentes.
traverse COORD R1 | Para uma escrita, o coordenador contata TODAS as réplicas, não apenas as duas que o quorum exige. O nível de consistência decide quantas precisam responder; ele nunca decide quantas são perguntadas.
traverse COORD R2 | R2 recebe a mesma mutação.
traverse COORD R3 | R3 também -- exceto que R3 está fora do ar, com seu switch de rack tendo falhado um minuto atrás. O coordenador ainda não sabe disso; ele descobre por não receber resposta.
visit R1 | R1 aplica a mutação e confirma. Isso é 1 dos 2 acks que o quorum exige. Em CL=ONE o coordenador já estaria retornando sucesso ao cliente aqui, com esse único ack.
visit R2 | R2 confirma. 2 de 2 -- quorum satisfeito, e a escrita é reportada como bem-sucedida ao cliente. R1 e R2 agora formam um conjunto que precisa se sobrepor a qualquer leitura QUORUM futura dessa partição.
mark R3 | R3 nunca responde. Em CL=ALL essa mesma escrita teria FALHADO por causa dessa única réplica silenciosa, mesmo que dois terços do conjunto de réplicas a tenham aceitado sem reclamar. Esse é o preço de disponibilidade do nível mais forte.
traverse COORD HINT | Como uma réplica dona desse dado perdeu a escrita, o coordenador escreve um hint: uma pequena nota registrando a mutação mais o fato de que ela pertence a R3.
visit HINT | O hint não é um nó no anel -- ele vive no próprio armazenamento de hints do coordenador. Não conta para o nível de consistência (apenas CL=ANY trata um hint isolado como uma escrita bem-sucedida) e é descartado assim que max_hint_window passa, três horas por padrão.
visit CLIENT | O sucesso retorna ao cliente. A linha está em 2 de 3 réplicas. R3 converge depois: por replay do hint assim que o gossip o reportar de volta como ativo, por read repair na próxima leitura de quorum que tocar nessa partição, ou por um repair rodado por um operador.
```

Mude um número e a história inteira muda. Em `ONE` o trace termina no passo 7: mais rápido, e com uma janela real na qual uma leitura `ONE` subsequente roteada para `R3` retorna o valor antigo. Em `ALL` o trace nunca completa: o silêncio de `R3` falha a operação por completo, e um único nó morto tirou as escritas dessa partição do ar. `QUORUM` fica entre eles por construção: réplicas suficientes para garantir sobreposição com uma leitura `QUORUM`, poucas o bastante para sobreviver a `floor((RF-1)/2)` falhas.

O livro tem o cuidado de rotular tudo isso como o caminho feliz: "Essas, é claro, são as descrições de 'caminho feliz' de como o Cassandra funciona." Os mecanismos abaixo são o que cobre o resto.

### Hinted handoff

"Considere o seguinte cenário: uma requisição de escrita é enviada ao Cassandra, mas um nó réplica onde a escrita propriamente pertence não está disponível devido a partição de rede, falha de hardware, ou algum outro motivo." A resposta é um hint, e a metáfora do livro para isso é um Post-it: o coordenador escreve "eu tenho a informação de escrita destinada ao nó B. Vou segurar essa escrita, e vou perceber quando o nó B voltar a ficar online; quando isso acontecer, vou enviar a ele a requisição de escrita." A entrega é disparada pelo gossip detectando que o nó B voltou. **O Cassandra guarda um hint separado para cada partição a ser escrita.**

O que isso compra: "Isso permite que o Cassandra esteja sempre disponível para escritas, e geralmente permite que um cluster sustente a mesma carga de escrita mesmo quando alguns dos nós estão fora do ar. Também reduz o tempo em que um nó que falhou ficará inconsistente depois de voltar a ficar online."

Duas regras que costumam pegar as pessoas de surpresa:

1. **"Em geral, hints não contam como escritas para fins de nível de consistência."** A única exceção é `ANY`, "que foi adicionado na 0.6. Esse nível de consistência significa que um hinted handoff sozinho vai contar como suficiente para o sucesso de uma operação de escrita." Repare no asterisco: "a escrita é considerada durável, mas o dado pode não estar legível até que o hint seja entregue à réplica alvo." Uma escrita durável que você não consegue ler é uma garantia estranha, e é exatamente o que `ANY` promete.
2. **Hints expiram.** "Se um nó fica fora do ar por algum tempo, os hints podem se acumular consideravelmente em outros nós. Então, quando os outros nós percebem que o nó que falhou voltou a ficar online, eles tendem a inundar aquele nó com requisições, bem no momento em que ele está mais vulnerável." Então o Cassandra "limita o armazenamento de hints a uma janela de tempo configurável", e o hinted handoff pode ser desabilitado completamente. A classe é `org.apache.cassandra.hints.HintsService`.

Daí a conclusão do próprio livro: "Embora o hinted handoff ajude a aumentar a disponibilidade do Cassandra, devido às limitações mencionadas ele não é suficiente sozinho para garantir a consistência dos dados entre réplicas." É um mecanismo de disponibilidade, não um mecanismo de consistência.

### Anti-entropy, repair e árvores de Merkle

A rede de segurança sob tudo o mais. Protocolos anti-entropy "são um tipo de protocolo gossip para reparar dados replicados. Eles funcionam comparando réplicas de dados e reconciliando diferenças observadas entre as réplicas", modelados na Seção 4.7 do paper do Dynamo. A sincronização de réplicas vem em dois modos:

- **Read repair**: "sincronização de réplicas conforme o dado é lido. O Cassandra lê dados de múltiplas réplicas para atingir o nível de consistência solicitado, e detecta se alguma réplica tem valores desatualizados. Se um número insuficiente de nós tem o valor mais recente, um read repair é realizado imediatamente para atualizar as réplicas desatualizadas."
- **Anti-entropy repair** (repair manual): "uma operação iniciada manualmente, realizada em nós como parte de um processo regular de manutenção", rodada com `nodetool repair`. Ela dispara uma compaction de validação, durante a qual "o servidor inicia uma conversa TreeRequest/TreeResponse para trocar **árvores de Merkle** com réplicas vizinhas. A árvore de Merkle é um hash representando os dados naquela tabela. Se as árvores de nós diferentes não coincidirem, elas precisam ser reconciliadas (ou 'reparadas')."

Uma árvore de Merkle é "uma estrutura de dados representada como uma árvore binária... as folhas são os blocos de dados a serem resumidos. Todo nó pai na árvore é um hash de seus nós filhos diretos, o que compacta fortemente o resumo." A árvore do Cassandra difere da do Dynamo em escopo: **cada tabela tem sua própria árvore, criada como um snapshot durante a compaction de validação e mantida apenas pelo tempo necessário para enviá-la a nós vizinhos**, o que "reduz I/O de rede." Implementação: `org.apache.cassandra.utils.MerkleTree`.

A forma operacional do repair pertence a um tópico de manutenção, não a este. O que importa aqui é a cadeia: o nível de consistência cobre a requisição, o hinted handoff cobre uma interrupção curta, o repair cobre tudo o que os hints perderam.

### Book vs today

> **`SimpleStrategy` passou de "não recomendada" para ativamente cercada.** A recomendação do livro agora é a oficial, dita de forma mais direta: a documentação da Apache diz que `SimpleStrategy` "é útil apenas para clusters de teste onde você ainda não sabe o layout de data center do cluster" e que "todas as implantações de produção devem usar o `NetworkTopologyStrategy`"; a referência de CQL a chama de "geralmente uma escolha pouco sábia para produção, já que não respeita layouts de data center e pode levar a latência de query extremamente variável." Desde o Cassandra 4.1, um operador pode reforçar isso com o guardrail `simplestrategy_enabled` no `cassandra.yaml` (padrão `true`, ou seja, ainda permitido), junto com `minimum_replication_factor_warn_threshold`/`_fail_threshold` e suas contrapartes `maximum_` (todos `-1`, desabilitados, por padrão). Também existe `default_keyspace_rf`, cujo padrão de fábrica é `1`, com um comentário recomendando `3` em produção. Isso é uma recomendação se solidificando em ferramentas, não uma depreciação.

> **Os próprios níveis de consistência não mudaram, mas agora podem ser proibidos centralmente.** `ONE`, `TWO`, `THREE`, `QUORUM`, `ALL`, `LOCAL_ONE`, `LOCAL_QUORUM`, `EACH_QUORUM` e `ANY` (apenas para escritas) continuam todos atuais, e `R + W > N` ainda é como a documentação da Apache descreve a consistência ajustável. O que é novo desde a 4.1 é que o nível de consistência não é mais puramente uma decisão do cliente: `read_consistency_levels_warned`/`read_consistency_levels_disallowed` e `write_consistency_levels_warned`/`write_consistency_levels_disallowed` são guardrails no `cassandra.yaml`, vazios por padrão (todos os níveis permitidos), que deixam um operador avisar sobre ou rejeitar `ONE` e `ANY` em todo o cluster. Também existe `ideal_consistency_level` (comentado por padrão, com `EACH_QUORUM` como exemplo), que rastreia uma métrica por keyspace de se as escritas *teriam* atingido um nível mais forte do que o solicitado, uma forma de medir o custo de subir um nível antes de de fato subi-lo.

> **`EACH_QUORUM` não é mais exclusivo para escrita.** Versões mais antigas do Cassandra rejeitavam `SELECT` em `EACH_QUORUM` completamente; suporte a leitura chegou na 3.0.0-rc2 (CASSANDRA-9602, fechando a antiga CASSANDRA-6970 como duplicata). Ainda é raro na prática para leituras, porque exigir um quorum *em cada data center* significa que a região mais lenta define sua latência de leitura, e qualquer região única fora do ar falha a leitura, o que é exatamente por que `LOCAL_QUORUM` é o nível para o qual o livro orienta.

> **O read repair em segundo plano foi removido no Cassandra 4.0.** A descrição de read repair do livro diz que, quando nós suficientes já têm o valor mais recente, "os reparos podem ser realizados em segundo plano depois que a leitura retorna." Isso descreve o comportamento pré-4.0. As notas de lançamento do Cassandra 4.0 são explícitas: "o repair em segundo plano foi removido. As opções de tabela `dclocal_read_repair_chance` e `read_repair_chance` foram removidas e agora são rejeitadas" (CASSANDRA-13910). Hoje o read repair é *apenas bloqueante*, e acontece no caminho de leitura quando réplicas discordam durante uma leitura em um nível de consistência acima de `ONE`. A consequência prática é que leituras em `ONE` não reparam mais nada probabilisticamente em segundo plano: a convergência para essas partições agora repousa inteiramente sobre hints e repair agendado.

> **A replicação transiente muda o que "RF=3" significa, onde está habilitada.** O Cassandra 4.0 adicionou replicação transiente, na qual algumas réplicas armazenam apenas dados não reparados; a sintaxe CQL escreve RF como `'<total_replicas>/<transient_replicas>'`, por exemplo `'DC1' : '3/1'`. Isso não está nesta parte do livro, e a documentação ainda a rotula como "um recurso experimental que não está pronto para uso em produção", com limitações significativas em torno de read repair, LWTs, batches logados e counters. Vale a pena reconhecer em uma definição de keyspace; não vale a pena habilitar.

## Trade-offs

- **`R + W > RF` garante sobreposição de conjunto, não o modelo de consistência que um banco de dados ACID de nó único oferece.** O que a desigualdade de fato compra é que as réplicas respondendo à sua leitura precisam incluir pelo menos uma que respondeu à sua escrita, então o timestamp mais novo está no merge e o coordenador o retorna. O que ela *não* compra: linearizabilidade em uma sequência de leitura-depois-escrita, isolamento entre clientes concorrentes, ou qualquer garantia sobre a escrita em andamento de um cliente *diferente*. O livro é explícito, algumas páginas depois, que "consistência forte não é suficiente para prevenir condições de corrida em casos onde clientes precisam ler, e então escrever dados": isso exige transações leves e Paxos, com quatro round trips em vez de um. Trate `QUORUM`/`QUORUM` como "minhas leituras não vão retroceder", não como "o banco de dados agora é ACID."
- **O nível de consistência é uma decisão do cliente por query, o que significa que também é uma decisão por desenvolvedor.** O botão é genuinamente granular, essa é toda sua atração, mas nada no schema o reforça. Um serviço lendo em `ONE` de um keyspace que todo mundo mais escreve em `QUORUM` quebra `R + W > RF` só para esse caminho, silenciosamente, e o sintoma aparece no relatório de bug de um time diferente como uma leitura obsoleta ocasional. Os guardrails de nível de consistência da 4.1 existem exatamente porque "o cliente decide" acabou precisando de um override de operador; antes disso, a única aplicação era revisão de código.
- **`ONE` é o nível mais rápido e um risco de corretude real, não teórico.** Ele retorna no primeiro ack, tolera RF-1 falhas, e é a escolha certa para dados genuinamente idempotentes ou append-only: logs, métricas, eventos imutáveis. Mas entre a escrita e a convergência, qualquer leitura em `ONE` roteada para uma réplica que a perdeu retorna o valor antigo, sem erro e sem aviso. Como a 4.0 removeu o read repair em segundo plano, essa janela só fecha via replay de hint ou um repair agendado, e hints expiram depois de `max_hint_window` (3h por padrão) e podem ser desabilitados completamente. `ONE`/`ONE` em dados mutáveis é um bug que se reproduz uma vez por mês.
- **`ALL` dá a garantia mais forte abrindo mão completamente da disponibilidade.** Toda réplica precisa responder, então com RF=3, um único nó em manutenção, um único reboot de switch de rack, ou uma única pausa lenta de GC falha a operação. Também torna sua latência a latência da réplica mais lenta, sempre. Esse é o botão que o livro está ensinando: `ALL` não é "`QUORUM`, mas mais seguro", é um ponto diferente no trade-off do CAP, onde você escolheu consistência em vez de disponibilidade para essa query. A maioria das cargas de trabalho que recorrem a `ALL` na verdade queria `QUORUM` mais uma agenda de repair.
- **`LOCAL_QUORUM` versus `EACH_QUORUM` é o custo multi-datacenter que surpreende as pessoas.** `LOCAL_QUORUM` mantém a operação inteira dentro de um data center: nenhum round trip entre regiões no caminho crítico, e um data center remoto ficando inacessível não falha a escrita, porque a replicação para ele continua de forma assíncrona. `EACH_QUORUM` exige uma maioria em *cada* data center antes de a escrita retornar, então sua latência de escrita se torna o round trip de WAN até a região mais distante, e qualquer região única fora do ar falha as escritas do cluster inteiro. O posicionamento honesto é que `EACH_QUORUM` é para o pequeno conjunto de escritas em que durabilidade entre regiões é um requisito rígido, e `LOCAL_QUORUM` é para tudo o mais; usar `EACH_QUORUM` amplamente converte uma implantação multirregional de "mais disponível" para "menos disponível do que uma única região."
- **Aumentar o RF não é o mesmo que aumentar disponibilidade, e a matemática de quorum pune números pares.** `Q = floor(RF/2 + 1)` dá Q=2 em RF=3 e Q=3 em RF=4: ambos toleram exatamente uma falha de réplica em `QUORUM`, mas RF=4 custa um terço a mais de armazenamento, um terço a mais de tráfego de escrita, e mais um nó que precisa responder em toda leitura de quorum. Ir para RF=5 (Q=3) de fato compra uma segunda falha tolerada, a um custo em regime permanente correspondentemente mais alto. Escolha fatores de replicação ímpares, e dimensione o RF em função de quantas falhas simultâneas você de fato precisa sobreviver, não em função do tamanho do cluster.
- **Hinted handoff melhora disponibilidade e pode piorar a recuperação.** É o que permite que escritas sejam bem-sucedidas enquanto uma réplica está fora do ar, e encurta a janela de inconsistência quando essa réplica retorna. Mas o livro nomeia o modo de falha claramente: hints se acumulam nos nós sobreviventes e "eles tendem a inundar aquele nó com requisições, bem no momento em que ele está mais vulnerável." As mitigações do Cassandra (uma janela de hint limitada, throttling de entrega, a capacidade de desligar hints) são todas *parciais*, e cada uma delas troca parte do benefício de consistência para proteger o nó em recuperação. Um nó fora do ar por mais tempo do que `max_hint_window` perdeu escritas permanentemente, que só o repair pode restaurar, e é por isso que "temos hinted handoff" nunca é um substituto para uma agenda de repair.
- **Consistência ajustável move uma decisão do banco de dados para o seu design, permanentemente.** Um banco de dados relacional faz essa escolha uma vez, em seu motor. O Cassandra faz você tomá-la por query, para sempre, o que é genuinamente mais poderoso e genuinamente mais trabalho: todo novo padrão de acesso é mais uma decisão de julgamento, cada uma dessas decisões pode estar errada de uma forma que só aparece sob partição, e nenhuma delas é visível no schema. A vantagem é que um único keyspace pode atender uma leitura de saldo de conta em `QUORUM` e uma varredura de telemetria em `ONE` sem comprometimento. O custo é que "que consistência este sistema fornece?" deixa de ter uma única resposta.

## Documentation Links

- [Jeff Carpenter and Eben Hewitt, "Cassandra: The Definitive Guide", Revised 3rd Edition (O'Reilly, 2022), Chapter 6, "The Cassandra Architecture" (Replication Strategies through Anti-Entropy/Repair), p. 174-185](https://www.oreilly.com/library/view/cassandra-the-definitive/9781492097143/) - doc
- [Apache Cassandra Documentation, Consistency (tunable consistency and consistency levels)](https://cassandra.apache.org/doc/latest/cassandra/architecture/dynamo.html#tunable-consistency) - doc
- [Apache Cassandra Documentation, Data Replication (SimpleStrategy vs NetworkTopologyStrategy)](https://cassandra.apache.org/doc/latest/cassandra/architecture/dynamo.html#replication-strategy) - doc
- [Apache Cassandra Documentation, CQL Data Definition (CREATE KEYSPACE replication options)](https://cassandra.apache.org/doc/latest/cassandra/developing/cql/ddl.html) - doc
- [Apache Cassandra Documentation, cassandra.yaml Configuration Reference (max_hint_window, guardrails, ideal_consistency_level)](https://cassandra.apache.org/doc/latest/cassandra/managing/configuration/cass_yaml_file.html) - doc
- [Apache Cassandra Documentation, Hints](https://cassandra.apache.org/doc/latest/cassandra/managing/operating/hints.html) - doc
- [Apache Cassandra Documentation, Repair](https://cassandra.apache.org/doc/latest/cassandra/managing/operating/repair.html) - doc
- [Apache Cassandra Documentation, Transient Replication (experimental)](https://cassandra.apache.org/doc/latest/cassandra/managing/operating/transientreplication.html) - doc
