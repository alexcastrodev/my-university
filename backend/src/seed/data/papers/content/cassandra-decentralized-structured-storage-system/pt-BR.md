---
title: "Cassandra - um sistema de armazenamento estruturado descentralizado"
summary: Lakshman e Malik descrevem o Cassandra, construído no Facebook para o Inbox Search: um armazenamento de famílias de colunas que une o particionamento, a replicação e o gossip do Dynamo a um modelo de dados no estilo do Bigtable e a um motor de armazenamento local baseado em log.
researchArea: Sistemas distribuídos
keywords: cassandra, família de colunas, hashing consistente, gossip, detector de falhas accrual, commit log, compactação, bloom filter
version: 1.0
updatedAt: 2026-11-20
---

## Resumo

O Cassandra é um sistema de armazenamento distribuído para gerenciar quantidades muito grandes de dados estruturados espalhados por muitos servidores comuns, oferecendo um serviço altamente disponível e sem ponto único de falha. Ele foi pensado para rodar sobre uma infraestrutura de centenas de nós (possivelmente em vários datacenters). Nessa escala, componentes pequenos e grandes falham continuamente. A forma como o Cassandra gerencia o estado persistente diante dessas falhas determina a confiabilidade e a escalabilidade dos sistemas de software que dependem dele. Embora em muitos aspectos se pareça com um banco de dados e compartilhe várias estratégias de projeto e implementação com eles, o Cassandra não oferece um modelo de dados relacional completo; em vez disso, dá aos clientes um modelo de dados simples, com controle dinâmico sobre o layout e o formato dos dados. O sistema foi projetado para rodar em hardware barato e sustentar alto throughput de escrita sem sacrificar a eficiência de leitura.

## Visão geral

Esta é a versão apresentada no LADIS 2009 (3º workshop ACM SIGOPS sobre Large Scale Distributed Systems and Middleware, 10 e 11 de outubro de 2009, junto do SOSP), a cópia aberta que foi lida. Uma versão com título curto, "Cassandra", saiu no ACM SIGOPS Operating Systems Review 44(2), abril de 2010, pp. 35-40 (DOI 10.1145/1773912.1773922 no Crossref). Ela fica atrás do acesso pago da ACM e não foi lida, então o que segue vale só para o texto do LADIS. O PDF é um rascunho curto: ainda traz o marcador "200X" do template de copyright da ACM.

O problema é o Inbox Search do Facebook, que permite buscar na caixa de entrada. O sistema precisava absorver um throughput de escrita muito alto (bilhões de escritas por dia), crescer junto com o número de usuários e, como os usuários são atendidos de datacenters geograficamente distribuídos, replicar entre datacenters para manter a latência da busca baixa. Foi lançado em junho de 2008 para cerca de 100 milhões de usuários, e o artigo diz que já passava de 250 milhões.

Os autores chamam o Cassandra de "uma síntese de técnicas bem conhecidas". A seção de trabalhos relacionados o compara com o [Dynamo](/papers/dynamo-amazons-highly-available-key-value-store) (membership por gossip, mas com relógios vetoriais e uma leitura antes de cada escrita, que os autores julgam limitante para cargas de muita escrita), o [Bigtable](/papers/bigtable-distributed-storage-system-structured-data) (estrutura e distribuição, mas com a durabilidade delegada a um sistema de arquivos distribuído) e o [Google File System](/papers/google-file-system), cujo master é tolerante a falhas graças ao [Chubby](/papers/chubby-lock-service-loosely-coupled-distributed-systems). Vale conhecer antes: hashing consistente, quóruns e os papers do Dynamo e do Bigtable.

## Contribuição

- **Modelo de dados.** Uma tabela é um mapa multidimensional distribuído, indexado por uma chave de linha (tipicamente de 16 a 36 bytes). Toda operação sob uma mesma chave é atômica por réplica. As colunas se agrupam em famílias de colunas, simples ou super (uma família dentro de outra), acessadas como `familia:coluna` ou `familia:supercoluna:coluna`. As colunas se ordenam por tempo ou por nome, e o Inbox Search usa a ordem por tempo para mostrar resultados. A API tem três chamadas: `insert(table, key, rowMutation)`, `get(table, key, columnName)` e `delete(table, key, columnName)`.
- **Particionamento.** Hashing consistente sobre um anel, com função de hash que preserva a ordem. Em vez das várias posições por nó do Dynamo, nós pouco carregados se movem no anel para aliviar os sobrecarregados, abordagem vinda do [Chord](/papers/chord-scalable-peer-to-peer-lookup-service).
- **Replicação.** Cada chave tem um coordenador que a replica em outros N-1 nós, com políticas "Rack Unaware", "Rack Aware" e "Datacenter Aware". Um líder eleito pelo [ZooKeeper](/papers/zookeeper-wait-free-coordination-internet-scale-systems) atribui as faixas para que nenhum nó fique com mais de N-1. O conjunto de réplicas de uma faixa é chamado, pegando o termo do Dynamo, de lista de preferência.
- **Membership e detecção de falhas.** O Scuttlebutt, um mecanismo de gossip com anti-entropia, espalha a pertinência e outros estados de controle. Um detector de falhas Φ accrual modificado transforma os intervalos entre mensagens de gossip em um nível de suspeita, não em um booleano. Os autores acharam a distribuição exponencial um ajuste melhor que a gaussiana e afirmam ser a primeira implementação desse detector num cenário de gossip.
- **Persistência local.** Commit log, estrutura em memória, arquivos de dados ordenados e imutáveis, um Bloom filter por arquivo e compactação no estilo do Bigtable.

## Metodologia

O artigo é uma descrição de sistema com notas de experiência, não um estudo experimental. A seção 5 percorre particionamento, replicação, membership, bootstrap, escalonamento e persistência local. A 5.7 traz detalhes de implementação: Java, pipeline em estágios no estilo SEDA, E/S não bloqueante, UDP para mensagens de controle e TCP para replicação e roteamento. A seção 6 reúne lições e um caso de produção, o Inbox Search, com uma única tabela de latências de leitura medidas. Não há suíte de benchmark (nada de YCSB) nem comparação com outro sistema.

## Resultados

Tudo abaixo é o relato dos próprios autores.

- **Caminho de escrita.** A escrita vai primeiro para um commit log, em disco dedicado porque as escritas são sequenciais, e só depois para uma estrutura em memória. Quando ela passa de um limite calculado pelo tamanho e pelo número de objetos, é despejada em disco com um índice por chave de linha. Os logs são rotacionados num tamanho configurável, e 128MB "parece funcionar muito bem". O modo "fast sync" bufferiza as escritas do log e arrisca perder dados num crash.
- **Caminho de leitura.** Consulta-se primeiro a estrutura em memória e depois os arquivos, do mais novo para o mais antigo, com um Bloom filter em memória por arquivo para pular os que não têm a chave. Há índices de coluna a cada 256K e blocos de no máximo 128 chaves. A compactação junta arquivos de tamanho parecido (nunca um de 100GB com um de menos de 50GB), com compactações maiores periódicas. Leituras e escritas são "praticamente sem locks" porque os arquivos nunca são alterados. O artigo não usa os nomes memtable nem SSTable.
- **Fluxo da requisição.** Qualquer nó recebe a requisição. Escritas síncronas esperam um quórum, e as assíncronas servem a usos de alto throughput. Leituras vão à réplica mais próxima ou a todas, esperando um quórum, "conforme as garantias de consistência exigidas pelo cliente". Vale a resposta mais recente pelo timestamp, e réplicas defasadas são reparadas.
- **Detecção de falhas.** Num experimento com 100 nós, os detectores que os autores testaram antes, incluindo o [SWIM](/papers/swim-scalable-weakly-consistent-infection-style-process-group-membership-protocol) e um de estilo gossip, levaram cerca de dois minutos para detectar um nó falho. O detector accrual com Φ igual a 5 levou cerca de 15 segundos. Φ de 1, 2 e 3 correspondem a cerca de 10%, 1% e 0,1% de chance de suspeita equivocada.
- **Inbox Search.** Sete TB de dados de caixas de entrada de mais de 100M de usuários foram carregados do MySQL por jobs Map/Reduce. Em produção: 50+TB num cluster de 150 nós entre datacenters das costas leste e oeste. O streaming de bootstrap move cerca de 40 MB/s a partir de um único nó.

| Latência | Interactions | Term search |
| --- | --- | --- |
| Mín | 7,69 ms | 7,78 ms |
| Mediana | 15,69 ms | 18,27 ms |
| Máx | 26,13 ms | 44,41 ms |

## Análise crítica

O que o artigo não diz pesa tanto quanto o que ele diz.

- **A consistência é rala.** As leituras vão à "réplica mais próxima ou a um quórum", mas o texto nunca dá tamanhos de quórum, não nomeia níveis e não diz o que uma leitura devolve depois de uma escrita com quórum. Atualizações concorrentes se resolvem por timestamp, sem relógios vetoriais e sem discutir defasagem de relógio. A atomicidade é por chave e por réplica, e transações entre chaves eram um pedido em aberto. Hinted handoff e anti-entropia por árvores de Merkle para os dados não são mencionados.
- **A evidência é uma tabela.** A conclusão diz que os autores "demonstraram empiricamente" alto throughput de atualização com baixa latência, mas o artigo só reporta latência de leitura de uma aplicação: sem throughput de escrita, sem curva de escala, sem experimento de falha além do tempo de detecção. Há mínimo, mediana e máximo, sem percentis, e não se informa carga nem hardware.
- **Artigo de engenharia, sem avaliação externa.** Todas as afirmações vêm de quem construiu o sistema, e as comparações com Dynamo e Bigtable são descritivas. Um rascunho de seis páginas não detalha custos de reparo, remoção ou compactação, e o artigo diz que reparar nós após falhas de disco é só "uma operação administrativa".
- **Peças centralizadas.** Os autores admitem que alguma coordenação é essencial e apoiam-se no ZooKeeper para eleição de líder, metadados de faixas e tokens, então o "descentralizado" tem limites.

Literatura posterior, lida na documentação do Apache Cassandra (cassandra.apache.org, arquitetura, página do Dynamo), não em um paper: ela descreve escritas enviadas a todas as réplicas independentemente do nível de consistência, com níveis como ONE, QUORUM e ALL apenas definindo quantas respostas o coordenador espera, resolução last-write-wins, hinted handoff e nós virtuais (vários tokens por nó), que substituem a movimentação do anel guiada por carga descrita aqui. A versão do OSR e outros artigos posteriores não foram lidos.

## Pesquisas futuras

- O que o cliente de fato observa em leituras da "réplica mais próxima", e quão defasadas elas podem ser?
- Como o modelo de supercolunas ordenadas por tempo se compara a projetos posteriores de wide-column?
- O detector accrual se sustenta com milhares de nós, além do teste de 100?
- Em que ponto a política de compactação e o tamanho dos Bloom filters deixam de compensar em cargas de muita leitura?
