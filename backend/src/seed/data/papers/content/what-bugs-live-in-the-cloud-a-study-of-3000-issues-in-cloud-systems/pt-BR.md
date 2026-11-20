---
title: "Que bugs vivem na nuvem? Um estudo de mais de 3000 issues em sistemas de nuvem"
summary: Um estudo do SoCC 2014 que lê 21.399 issues de seis sistemas de nuvem da Apache (Hadoop MapReduce, HDFS, HBase, Cassandra, ZooKeeper, Flume), mantém 3.655 issues "vitais" e as classifica por aspecto, escopo, falha de hardware, tipo de bug de software e implicação, encontrando novas classes de bugs (consistência, escalabilidade, topologia), "killer bugs" que atingem vários nós e o banco público Cloud Bug Study (CBS DB).
researchArea: Distributed Systems
keywords: estudo de bugs em nuvem, CBS DB, killer bugs, bugs de concorrência distribuída, tratamento de erros, bugs de escalabilidade, limpware, análise de issue tracker
version: 1.0
updatedAt: 2026-11-20
---

## Abstract

Os autores conduzem um estudo abrangente de issues de desenvolvimento e de implantação de seis sistemas de nuvem populares e importantes (Hadoop MapReduce, HDFS, HBase, Cassandra, ZooKeeper e Flume). A partir dos repositórios de bugs, revisam ao todo 21.399 issues enviadas em um período de três anos (2011-2014). Entre elas, fazem uma análise profunda de 3.655 issues "vitais" (isto é, problemas reais que afetam implantações), com um conjunto de classificações detalhadas. O produto de um ano de estudo se chama Cloud Bug Study database (CBS DB), do qual derivam muitos achados específicos de sistemas de nuvem. Segundo os autores, é o maior estudo de bugs de sistemas de nuvem até então.

## Visão geral

O artigo é do SoCC 2014 (Seattle, novembro de 2014), de Haryadi S. Gunawi e dez coautores da Universidade de Chicago, de Wisconsin-Madison e da Surya University. O ponto de partida é uma pergunta simples: por que os sistemas de nuvem não são 100% confiáveis? As notícias sobre quedas de nuvem não têm o detalhe necessário, mas os sistemas de código aberto trazem issue trackers públicos com relatos, patches e discussões dos desenvolvedores, um "oásis" de informação, nas palavras dos autores.

Os seis sistemas representam tipos de arquitetura: MapReduce para frameworks de computação, HDFS para armazenamento escalável, HBase e Cassandra para key-value stores, ZooKeeper para sincronização e Flume para streaming. São parentes de código aberto de projetos que já estão no catálogo: [MapReduce](/papers/mapreduce-simplified-data-processing-large-clusters), [Google File System](/papers/google-file-system), [Bigtable](/papers/bigtable-distributed-storage-system-structured-data), [Dynamo](/papers/dynamo-amazons-highly-available-key-value-store) (o artigo cita os quatro) e [Chubby](/papers/chubby-lock-service-loosely-coupled-distributed-systems), citado para serviços de sincronização. Sobre os próprios sistemas, veja [Cassandra](/papers/cassandra-decentralized-structured-storage-system) e [ZooKeeper](/papers/zookeeper-wait-free-coordination-internet-scale-systems). O artigo é irmão de [Simple Testing Can Prevent Most Critical Failures](/papers/simple-testing-can-prevent-most-critical-failures), que ele cita para o ponto de que falhas de tratamento de erros são testáveis, e foi escrito para mostrar onde os bugs vivem, não para corrigi-los.

## Contribuição

- **CBS DB**: arquivos de classificação em texto, scripts de mineração de dados e utilitários de gráficos, com 25.309 anotações nas issues vitais, liberados publicamente.
- **Uma classificação multirrótulo** de cada issue vital: aspecto, escopo, tipo de hardware e modo de falha, tipo de bug de software, implicação, além de um rótulo por componente.
- **Novas classes de bugs** para sistemas de nuvem: consistência de dados, escalabilidade e topologia, e os "killer bugs", que afetam vários nós ou o cluster inteiro.
- **Lições para ferramentas**: as ferramentas de confiabilidade devem ser multidimensionais, e detectores de data race devem incluir injeção de falhas.

## Metodologia

Os autores pegam issues enviadas entre 1/1/2011 e 1/1/2014 nos issue trackers da Apache: 21.399 no total. Para o Hadoop MapReduce, usam o tracker do MapReduce, e não o do Hadoop, que tem sobretudo infraestrutura de desenvolvimento. Os rótulos brutos (data, tempo de resolução, prioridade, patches, número de respostas) vêm da API web do tracker.

Cada issue é lida à mão, com a discussão e os patches, e marcada como "vital" ou "miscelânea". Vitais são problemas reais de desenvolvimento e de implantação marcados com prioridade maior (major). Miscelânea é manutenção, refatoração, testes, documentação e também bugs reais fáceis de corrigir, que os desenvolvedores costumam marcar como minor. O artigo informa 83% de issues de miscelânea em média, o que deixa 3.655 vitais.

Os rótulos (Tabela 1): aspecto (confiabilidade, desempenho, disponibilidade, segurança, consistência, escalabilidade, topologia, QoS); escopo (uma máquina, várias máquinas, cluster inteiro); hardware (núcleo, disco, memória, rede, nó) com modo de falha (corrupção, limp, parada); tipo de bug de software (lógica, tratamento de erros, otimização, configuração, race, hang, espaço, carga); implicação (operação falha, desempenho, queda de componente, perda de dados, dado obsoleto, corrupção). Uma issue pode ter vários rótulos.

Ameaças à validade, como os autores as apresentam: cada issue é revisada em pelo menos duas passadas, as ambiguidades são discutidas até o time concordar, e cada issue citada foi discutida por 3 a 4 pessoas. O artigo não informa nenhuma medida de concordância.

## Resultados

- **Aspectos (Figura 1b e texto da seção 3).** Confiabilidade 45%, desempenho 22%, disponibilidade 16%, depois consistência 5%, escalabilidade 2%, topologia 1% e QoS 1%. O texto não dá número para segurança, que os autores deixam de discutir por falta de especialidade (só leitura de gráfico).
- **Consistência.** As causas são bugs de lógica em protocolos operacionais (43%), data races (29%) e tratamento de falhas (10%). Os autores notam que os sistemas muitas vezes detectam a inconsistência e continuam rodando.
- **Escalabilidade.** Causas: otimização (29%), espaço (21%) e carga (21%); implicações: desempenho (52%), queda (27%) e operações falhas (16%). Exemplos: um recálculo do Cassandra de complexidade Omega(n^3) que fazia nós oscilarem com 100-300 nós, uma recuperação de 16.000 mappers no MapReduce que levou mais de 7 horas, uma debandada no ZooKeeper quando 1000 clientes se desconectam.
- **Killer bugs: 139 issues.** Formas: ciclos de retroalimentação positiva (a recuperação gera carga que causa mais falhas), failover com bug (o failover do region server de metadados do HBase aparece quatro vezes), bugs repetidos depois do failover (três vezes no HBase), uma pequena janela de ponto único de falha, código de inicialização com bug, deadlock distribuído.
- **Hardware: 13% das issues, software 87% (Figura 3a).** Os modos de falha são parada, corrupção e "limp". Os autores não acharam relato de falha de CPU. O HDFS, por exemplo, assume que o I/O de disco termina em algum momento.
- **Tipos de bug de software.** Lógica 29%, tratamento de erros 18% (mais de 500 issues), otimização 15%, configuração 14%, data race 12%, hang 4%, espaço 4%, carga 4%. As data races distribuídas, de reordenação de mensagens somada a falhas, são mais de 50% dos bugs de data race.
- **Implicações.** Operações falhas 42%, desempenho 23%, queda 18%, perda de dados 7%, corrupção 5%, dado obsoleto 5%. Os mapas de calor (Figuras 2 e 5) mostram que quase toda causa pode levar a quase toda implicação; não extraí as contagens das células.
- **Outros usos do CBS DB.** Entre os componentes mais afetados estão Get (95) e Compaction (93) no Cassandra, RegionServer (418) e Master (239) no HBase, AM (141) no MapReduce (Tabela 2). Entre os 1% de bugs de software com mais respostas, otimização passa de 50%. As issues do MapReduce disparam de meados de 2011 a meados de 2012, o que os autores ligam à mudança para o Hadoop 2.0 (YARN).
- **A conclusão sobre prioridades.** A partir de casos como inconsistências ignoradas, os autores concluem que os sistemas de nuvem "favorecem disponibilidade em vez de correção". É uma inferência de exemplos, não uma taxa medida.

## Análise crítica

Pontos fortes: a escala, a leitura manual de patches e discussões em vez de contagem por palavra-chave, e a liberação dos dados, que permite refazer os recortes. Uma ressalva sobre essa liberação: o endereço do CBS DB no artigo (ucare.cs.uchicago.edu) não resolveu no meu ambiente em 2026-11-20, então não pude conferir os dados em si.

O que o artigo não afirma: as issues são as que foram reportadas e resolvidas em seis sistemas de código aberto da Apache entre 2011 e 2014, então os resultados não valem para sistemas fechados nem para versões posteriores. A classificação é manual e o artigo não informa medida de concordância. As porcentagens contam issues rotuladas, não incidentes, e uma issue de tracker não é uma queda em produção; uma issue pode ter vários rótulos. "Vital" é o filtro dos autores e deixa de fora bugs fáceis de corrigir. O artigo não afirma que determinado tipo de bug causa a maior parte da indisponibilidade de uma implantação real.

Trabalhos que o artigo cita como companheiros: SAMC (model checking, OSDI 2014) e Limplock (SoCC 2013). Não li nenhum dos dois. Contexto do catálogo, pareamento meu e não do artigo: [Gray Failure](/papers/gray-failure-achilles-heel-cloud-scale-systems) trata das falhas "limp" que a seção 5 descreve, e [Chaos Engineering](/papers/chaos-engineering-basiri) é uma prática próxima dos exercícios ao vivo que o artigo cita (ele nomeia o Chaos Monkey). Literatura posterior (marcada como tal, lida pelos resumos do catálogo e não pelos artigos): [Network-Partitioning Failures in Cloud Systems](/papers/analysis-of-network-partitioning-failures-in-cloud-systems) e [Metastable Failures in the Wild](/papers/metastable-failures-in-the-wild) estudam classes isoladas de falha com mais profundidade, e o estudo de retentativas [Retry Bugs](/papers/retry-bugs-insights-and-llm-informed-tooling) revisita o tratamento de erros.

## Pesquisas futuras

Os autores pedem ferramentas de confiabilidade que não sejam unidimensionais: as que acham erros de tratamento de falhas não devem olhar só para operações falhas, e detectores de data race precisam incluir injeção de falhas. Pedem também model checking distribuído, reprodução de bugs distribuídos, exercícios ao vivo de protocolos operacionais em escala, testes cientes de topologia, gestão automatizada de espaço, QoS de ponta a ponta em sistemas empilhados e mais estudo das issues de configuração e de tratamento de erros no CBS DB.

Perguntas em aberto, leitura minha e não do artigo: como a mistura de aspectos e de tipos de bug mudou nesses mesmos sistemas desde 2014, e como os achados se aplicam a serviços de nuvem proprietários, que não expõem um tracker público.
