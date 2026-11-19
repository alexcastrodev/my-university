---
title: "Resilient Distributed Datasets: uma abstração tolerante a falhas para computação em memória em clusters"
summary: Zaharia e colegas propõem os RDDs, conjuntos de dados particionados e somente leitura, criados por transformações de granularidade grossa, para que um cluster mantenha dados em memória entre computações e recupere partições perdidas reexecutando a linhagem, sem replicar dados. Implementado no Spark, o modelo supera o Hadoop em até 20× em jobs iterativos, segundo os autores.
researchArea: Sistemas distribuídos
keywords: resilient distributed datasets, spark, linhagem, computação em memória, dependências estreitas e largas, tolerância a falhas, algoritmos iterativos
version: 1.0
updatedAt: 2026-11-19
---

## Abstract

Apresentamos os Resilient Distributed Datasets (RDDs), uma abstração de memória distribuída que permite aos programadores fazer computações em memória em grandes clusters de forma tolerante a falhas. Os RDDs são motivados por dois tipos de aplicação que os frameworks atuais tratam de forma ineficiente: algoritmos iterativos e ferramentas interativas de mineração de dados. Nos dois casos, manter os dados em memória pode melhorar o desempenho em uma ordem de grandeza. Para obter tolerância a falhas de modo eficiente, os RDDs oferecem uma forma restrita de memória compartilhada, baseada em transformações de granularidade grossa, e não em atualizações de granularidade fina sobre um estado compartilhado. Mesmo assim, mostramos que os RDDs são expressivos o bastante para capturar uma ampla classe de computações, incluindo modelos de programação especializados recentes para jobs iterativos, como o Pregel, e novas aplicações que esses modelos não capturam. Implementamos os RDDs em um sistema chamado Spark, que avaliamos com diversas aplicações de usuários e benchmarks.

## Visão geral

Em 2012, MapReduce e Dryad já eram muito usados, mas a única forma de reaproveitar dados entre dois jobs era gravá-los em um sistema de arquivos distribuído, pagando replicação, I/O de disco e serialização. Isso prejudica o aprendizado de máquina e os algoritmos de grafos iterativos (PageRank, k-means, regressão logística) e as consultas interativas sobre o mesmo subconjunto de dados. Este artigo do NSDI 2012, da UC Berkeley (San Jose, abril de 2012), busca uma abstração geral para esse reaproveitamento, em vez de um framework especializado para cada padrão, como o Pregel ou o HaLoop.

Contexto neste catálogo: o [MapReduce](/papers/mapreduce-simplified-data-processing-large-clusters) é o modelo em lote e a ideia de reexecução em que o artigo se apoia, e lê sua entrada de um sistema de arquivos no estilo do [Google File System](/papers/google-file-system). Um armazenamento como o [Bigtable](/papers/bigtable-distributed-storage-system-structured-data), centrado em atualizações de células de granularidade fina, é o tipo de carga que o artigo deixa para outros sistemas (a Seção 2.4 cita RAMCloud, Percolator e Piccolo).

Vale conhecer antes: o modelo do MapReduce, o que é um shuffle, a diferença entre registrar atualizações e recomputar a partir das entradas, e closures em Scala.

## Contribuição

- **A abstração RDD.** Uma coleção de registros particionada e somente leitura, criada apenas por transformações determinísticas (map, filter, join) sobre armazenamento estável ou outros RDDs. O RDD guarda como foi derivado (sua linhagem), de modo que um programa não pode referenciar um RDD que não saiba reconstruir após uma falha. O usuário controla a persistência (memória, disco, replicação, prioridade) e o particionamento por chave.
- **Linhagem em vez de replicação.** A tolerância a falhas registra as transformações, não os dados. Uma partição perdida é recomputada a partir dos pais, em paralelo em outros nós, sem desfazer o programa inteiro.
- **Dependências estreitas e largas.** Na dependência estreita cada partição pai alimenta no máximo uma partição filha (map, filter, join com co-particionamento), então ela roda em pipeline em um nó e se recupera barato. A dependência larga exige um shuffle (groupByKey, join sem particionamento), e uma falha pode obrigar a recomputar partições de todos os ancestrais.
- **Uma interface comum pequena.** Cinco operações (partitions, preferredLocations, dependencies, iterator e partitioner, Tabela 3) permitem escrever a maioria das transformações em menos de 20 linhas, sem lógica especial no escalonador.
- **Spark.** Cerca de 14.000 linhas de Scala sobre o Mesos, com transformações preguiçosas, ações (count, collect, reduce, save), escalonador em estágios, gerenciamento de memória por LRU e um interpretador Scala interativo. Pregel e HaLoop são bibliotecas de 200 linhas cada sobre ele.

## Metodologia

A Seção 2 define os RDDs e os compara com a memória compartilhada distribuída (Tabela 1). As Seções 3 e 4 mostram a API e a representação interna com mineração de logs, regressão logística e PageRank. A Seção 5 trata do escalonador, do interpretador, do gerenciador de memória e dos checkpoints.

O escalonador transforma o grafo de linhagem de uma ação em um DAG de estágios, cortando nos shuffles e nas partições já em memória, executa as transformações estreitas em pipeline dentro de um estágio e posiciona tarefas com delay scheduling. As saídas de shuffle são materializadas nos nós pais, como as saídas de map do MapReduce. Uma tarefa que falha roda de novo em outro nó enquanto as saídas dos estágios pais existirem, senão as partições faltantes são recomputadas. Falhas do escalonador ainda não são toleradas.

A avaliação (Seção 6) usa a Amazon EC2, principalmente nós m1.xlarge (4 núcleos, 15 GB de RAM), HDFS com blocos de 256 MB e caches do SO limpos. Compara o Spark com o Hadoop 0.20.2 e com o HadoopBinMem (dados binários em um HDFS em memória), com 10 iterações sobre 100 GB em 25 a 100 máquinas, e depois PageRank, um teste de falha em 75 nós, execuções com memória limitada, três aplicações de usuários e consultas interativas.

## Resultados

Todos os números abaixo são relatados pelos autores.

- **Regressão logística.** Primeira iteração: Hadoop 80 s, HadoopBinMem 139 s, Spark 46 s. Iterações seguintes em 100 máquinas: 76 s, 62 s e 3 s, ou seja, o Spark é 25,3× e 20,7× mais rápido que o Hadoop e o HadoopBinMem.
- **K-means.** Primeira iteração: 115 s, 182 s e 82 s. Iterações seguintes: 106 s, 87 s e 33 s, um ganho de 1,9× a 3,2× sobre o Hadoop conforme o tamanho do cluster, porque o job é limitado por computação.
- **Por que não basta um Hadoop em memória.** Jobs Hadoop custam pelo menos 25 s mesmo sem fazer nada, o HDFS acrescenta cerca de 2 s em uma entrada de 256 MB, o parsing de texto cerca de 7 s e a conversão para objetos Java cerca de 3 s, quase o custo da própria regressão. O Spark guarda objetos já desserializados.
- **PageRank.** Em um dump de 54 GB da Wikipedia (cerca de 4 milhões de artigos, 10 iterações), com 30 nós: Hadoop 171 s, Spark básico 72 s (2,4×), Spark com particionamento controlado 23 s (7,4×). Com 60 nós: 80 s, 28 s e 14 s.
- **Falha.** Em 75 nós com 100 GB, uma máquina morta no início da 6ª iteração do k-means elevou essa iteração de cerca de 58 s para 80 s, e depois ela voltou a 58 s. Os grafos de linhagem tinham todos menos de 10 KB.
- **Memória insuficiente.** Regressão logística sobre 100 GB em 25 máquinas: 68,8 s com 0% dos dados em memória, 58,1 s com 25%, 40,7 s com 50%, 29,7 s com 75% e 11,5 s com 100%, uma degradação gradual.
- **Aplicações de usuários.** Um relatório da Conviva sobre 200 GB comprimidos foi de 20 horas no Hadoop para 30 minutos em duas máquinas Spark (40×, 96 GB de RAM). A modelagem de tráfego escalou quase linearmente de 20 a 80 nós. A classificação de spam do Twitter (50 GB, 250.000 URLs, 10^7 atributos) escalou pior por causa do custo fixo de comunicação.
- **Uso interativo.** Varrer 1 TB de visualizações de páginas da Wikipedia em 100 máquinas levou de 5 a 7 segundos por consulta, contra 170 s lendo do disco.

## Análise crítica

O artigo é explícito sobre o escopo: a Seção 2.4 diz que os RDDs são menos adequados a atualizações assíncronas de granularidade fina sobre estado compartilhado, como um armazenamento para aplicação web ou um crawler incremental, que ele deixa para bancos de dados, RAMCloud, Percolator e Piccolo.

- **Dependências largas pouco medidas.** O texto diz que uma falha pode forçar recomputação total em linhagens longas com dependências largas e recomenda checkpoints, e o exemplo do PageRank mostra exatamente esse padrão. O único experimento de falha é com k-means, e o checkpoint automático ainda está sob investigação.
- **Os 20× são de uma carga só.** O k-means ganha de 1,9× a 3,2×, e o PageRank 2,4× só com memória. A comparação é com o Hadoop 0.20.2 na configuração dos autores.
- **O teste de falha é pequeno.** Uma máquina, uma iteração, uma aplicação. A Figura 11 rotula a iteração lenta com 81 s, enquanto o texto diz 80 s.
- **Falhas do escalonador não são toleradas.** O artigo só diz que replicar o grafo de linhagem seria simples.
- **Resultados de usuários são relatos.** Os números da Conviva e do Monarch vêm de implantações de usuários, não de comparações controladas.

Leituras minhas, não do artigo: a recuperação por recomputação depende de as transformações serem determinísticas, e a nota 9 admite que o depurador planejado não reproduz funções de usuário não determinísticas. A comparação com a replicação também supõe que guardar a linhagem seja barato, o que só foi mostrado para jobs de dezenas de iterações.

O que o artigo não afirma: não é um sistema de streaming (processamento em lote de streams aparece só como uso possível), não é um motor SQL (SQL é um uso planejado do interpretador), não compartilha RDDs entre instâncias do Spark e não dá garantias para aplicações com atualizações de granularidade fina.

Literatura posterior, que não faz parte deste PDF: os Discretized Streams (SOSP 2013) tratam streaming como pequenos jobs em lote sobre conjuntos de dados no estilo RDD, com recuperação paralela. O Spark SQL (SIGMOD 2015) acrescenta uma API declarativa de DataFrames integrada ao código procedural do Spark e um otimizador chamado Catalyst. Para streaming fora do Spark, o catálogo tem o [Dataflow Model](/papers/dataflow-model-unbounded-out-of-order-data), posterior (2015), voltado a dados ilimitados e fora de ordem.

## Pesquisas futuras

- Discretized Streams e Spark SQL, para streaming e processamento relacional construídos sobre o modelo. O artigo do Structured Streaming (SIGMOD 2018) continua essa linha e não foi lido para esta análise.
- Experimentos com seleção automática de checkpoints, que o artigo lista como em investigação usando o que o escalonador sabe sobre tamanhos e tempos de computação.
- Depuração baseada em linhagem, a ideia da Seção 7.2 de reexecutar uma tarefa em um depurador de processo único.
- O comportamento sob falhas com linhagem de dependências largas e várias falhas simultâneas.
- O compartilhamento de RDDs entre instâncias do Spark por um gerenciador de memória unificado, que o artigo cita como trabalho futuro.
