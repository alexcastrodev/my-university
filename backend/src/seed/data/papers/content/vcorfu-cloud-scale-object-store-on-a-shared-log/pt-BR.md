---
title: "vCorfu: um object store em escala de nuvem sobre um shared log"
summary: O vCorfu é um object store fortemente consistente que grava cada atualização em uma réplica do log global e em uma réplica de stream por objeto, de modo que os servidores respondem a leituras sem playback no cliente, e que divide objetos enormes em máquinas de estados menores por meio da replicação de máquina de estados componível.
researchArea: Sistemas distribuídos
keywords: shared log, replicação de máquina de estados, streams materializados, object store, transações otimistas, sequenciador, opacidade
version: 1.0
updatedAt: 2026-11-03
---

## Visão geral

Um shared log transforma um armazenamento distribuído em uma única sequência de appends: cada atualização recebe uma posição em uma ordem total, e os clientes reconstroem o estado lendo essa sequência. O [Corfu](/papers/corfu-shared-log-design-for-flash-clusters) e o [Tango](/papers/tango-distributed-data-structures-over-a-shared-log) usam esse desenho para obter consistência forte e snapshots globais baratos. Este artigo do NSDI 2017 parte da fraqueza dele, que os autores chamam de playback: antes de responder a um pedido, o cliente precisa ler e aplicar atualizações, inclusive aquelas das quais o pedido não depende. Segundo o artigo, isso limitou os shared logs a cenários com poucos clientes ou pouco estado global, como serviços de metadados.

O vCorfu mantém o log global e acrescenta uma segunda cópia de cada atualização, organizada por objeto, para que um servidor com o histórico completo de um objeto faça o playback e responda diretamente.

Vale conhecer antes: replicação de máquina de estados, o sequenciador fora do caminho de dados do Corfu, controle de concorrência otimista e opacidade, que garante que transações nunca observem estado inconsistente.

## Contribuição

- **Streams materializados.** Cada objeto corresponde a um stream, e cada atualização vai para uma réplica de log, indexada pelo endereço global, e para uma réplica de stream, indexada pelo id e pelo endereço no stream. Assim o stream aceita leituras aleatórias e em bloco, ao contrário dos streams do Tango, que o artigo descreve como meras marcações dentro de um shared log, ligadas por backpointers.
- **Visões remotas.** O cliente pode manter o estado de um objeto na própria memória (visão local) ou deixar que a réplica de stream guarde o estado e aplique as atualizações (visão remota).
- **Um sequenciador que resolve transações.** Os tokens são emitidos condicionalmente: se os streams afetados mudaram desde o snapshot da transação, o cliente aborta sem escrever, então o log guarda só transações confirmadas.
- **Replicação de máquina de estados componível (CSMR).** Objetos são construídos a partir de outros objetos, como um map a partir de maps filhos que funcionam como buckets, ou uma B-tree a partir de objetos que são nós, com referências que seguem a versão mais recente ou a versão de um snapshot.

## Metodologia

O artigo descreve o projeto e avalia uma implementação em Java em dezesseis máquinas de 12 núcleos, com NICs de 10G ligadas a um único switch. Todos os benchmarks rodam em memória, com a persistência desativada, e os autores relatam que os custos de Java e de serialização deixaram o sistema limitado por CPU.

Para isolar a materialização, eles construíram uma variante com backpointers e chain replication, parecida com o Tango, e compararam as duas com entradas de 32 bytes. Rodaram o YCSB com entradas de 1 KB contra o Cassandra 2.1.9: o vCorfu usou um map CSMR em 12 réplicas com comprimento de chain 2, e o Cassandra usou 12 nós, fator de replicação 2, nível de consistência ALL e durable writes desligado. As transações foram testadas com leituras de snapshot, com uma referência de two-phase locking montada com Cassandra e um ZooKeeper de um só nó, e com uma carga simulada de analytics de publicidade. A CSMR foi comparada a um map SMR simples sob chaves uniformes e Zipf.

## Resultados

Estes são os resultados relatados pelos autores.

- **A materialização custa nas escritas.** A mensagem de commit impõe uma penalidade de cerca de 40% nas escritas em relação ao protocolo de backpointers. O throughput de escrita ainda cresceu com as réplicas, e os autores situam o gargalo dos dois esquemas na taxa de tokens do sequenciador.
- **Buracos custam caro aos backpointers.** Depois de um buraco (hole), o tempo mediano para ler um stream nessa variante foi de 210 ms com 32 streams, 14,8 s com 100K e 39,6 s com 500K.
- **Visões remotas atacam o playback.** Com visões locais, a latência de leitura passou de um segundo com 32 clientes. Com uma visão remota, o artigo relata throughput de leitura mantido e latência de milissegundos com 1K clientes.
- **YCSB.** O desempenho de escrita foi comparável ao do Cassandra. O Cassandra piorou na maioria das cargas dominadas por leitura porque precisa ler as duas réplicas para evitar dados antigos.
- **Transações somente leitura não conflitam.** Visões remotas sustentaram quase 10K transações de snapshot por segundo. Na referência com locks, a taxa de abort do escritor chegou a 92% com 200 leitores, enquanto o throughput do escritor no vCorfu ficou constante.
- **CSMR.** Abrir uma visão sobre 100 MB de atualizações levou quase 10 s no map SMR e no máximo 70 ms nos maps CSMR. Transações no map SMR abortaram metade das vezes com dois escritores, contra 2% com 1000 buckets e 16 escritores. O custo está nas operações sobre o objeto inteiro: um clear seguido de um size podia chegar perto de 30 s quando era preciso fazer playback de todos os buckets.

## Análise crítica

O artigo mostra uma forma concreta de combinar uma ordem global com localidade por objeto, mas a evidência é mais estreita do que a manchete.

- **O resultado contra o Cassandra é uma configuração só.** O resumo diz que o vCorfu supera o Cassandra, mas as escritas são apenas comparáveis, então a vantagem está nas leituras e vem em grande parte da leitura das duas réplicas que o nível de consistência ALL exige. O vCorfu também ganhou um caminho especial `fastPut()` para o benchmark.
- **Nada é persistido.** A persistência fica desligada nos dois lados, o que mantém a comparação equilibrada, mas os números descrevem protocolos em memória e limites de CPU, não um armazenamento gravando em mídia estável.
- **O sequenciador continua central.** Os autores colocam ali o gargalo de escrita, e agora ele também verifica transações, mas o artigo não informa nenhuma taxa de tokens. O [artigo do FuzzyLog](/papers/fuzzylog-partially-ordered-shared-log) depois citou o vCorfu entre os sistemas cujo sequenciador vira um ponto centralizado de coordenação, embora seu experimento emule o protocolo do Tango, não o do vCorfu.
- **Conflitos são detectados por objeto.** O artigo admite que uma detecção mais fina exigiria resolução no cliente ou um sequenciador mais pesado. Duas atualizações em chaves diferentes de um map, portanto, conflitam, e parte da redução de aborts da CSMR conserta esse limite.
- **A CSMR é medida só em maps.** A B-tree e sua saída do problema de atualização recursiva são descritas, não avaliadas. O número de buckets é fixado na criação, e o redimensionamento não é discutido.
- **O teste de falhas é parcial.** Só a falha de uma réplica de stream com visões locais é medida. O artigo admite que uma visão remota teria de ler o stream inteiro, e são as visões remotas que trazem os melhores resultados de leitura.
- **A referência com locks é dos próprios autores.** Um escritor e um serviço de locks de um nó só mostram como leitores prejudicam um esquema simples, não como se comporta um sistema transacional bem ajustado.
- **Dois números não batem.** A legenda da Figura 9 dá 50% de chance de percorrer 10k entradas com 500k streams, enquanto 39,6 s a 0,3 ms por entrada, o custo informado, implicam cerca de 130K entradas.

## Pesquisas futuras

- Quanto da vantagem de leitura e escrita sobrevive com a persistência ligada.
- Se a emissão de tokens e as verificações condicionais conseguem escalar além de um sequenciador mantendo os snapshots globais.
- Detecção de conflitos mais fina que um objeto, sem resolução no cliente nem sequenciador pesado.
- Redimensionar objetos CSMR em uso e medir árvores CSMR contra a afirmação sobre atualização recursiva.
- O custo de restaurar visões remotas e reconstruir réplicas depois de falhas.
