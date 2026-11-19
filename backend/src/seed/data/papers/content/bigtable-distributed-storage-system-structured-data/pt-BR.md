---
title: "Bigtable: um sistema de armazenamento distribuído para dados estruturados"
summary: Chang e colegas descrevem o Bigtable, o mapa esparso, ordenado e multidimensional do Google construído sobre o GFS e o Chubby, que divide tabelas em tablets servidos por muitas máquinas, dá atomicidade só por linha e sustenta mais de sessenta produtos do Google.
researchArea: Sistemas distribuídos
keywords: bigtable, banco wide-column, tablets, sstable, memtable, armazenamento log-structured, transações de uma linha, chubby, gfs
version: 1.0
updatedAt: 2026-11-19
---

## Resumo

O Bigtable é um sistema de armazenamento distribuído para gerenciar dados estruturados, projetado para escalar a um tamanho muito grande: petabytes de dados em milhares de servidores comuns. Muitos projetos do Google guardam dados no Bigtable, entre eles a indexação da web, o Google Earth e o Google Finance. Essas aplicações fazem exigências muito diferentes ao Bigtable, tanto no tamanho dos dados (de URLs a páginas web e imagens de satélite) quanto na latência (do processamento em lote no backend ao serviço de dados em tempo real). Apesar dessas demandas variadas, o Bigtable tem oferecido com sucesso uma solução flexível e de alto desempenho para todos esses produtos do Google. Neste artigo descrevemos o modelo de dados simples do Bigtable, que dá aos clientes controle dinâmico sobre o layout e o formato dos dados, e descrevemos o projeto e a implementação do Bigtable.

## Visão geral

Em 2006 o Google tinha muitos produtos que precisavam guardar grandes volumes de dados estruturados, e um banco relacional não foi a ferramenta escolhida pelos autores. O artigo se apoia em outras peças de infraestrutura do Google que estão neste catálogo: o Bigtable guarda seus logs e arquivos de dados no [Google File System](/papers/google-file-system), usa o [serviço de locks Chubby](/papers/chubby-lock-service-loosely-coupled-distributed-systems) para eleger o master e acompanhar os servidores, e serve de entrada e saída de jobs de [MapReduce](/papers/mapreduce-simplified-data-processing-large-clusters). Foi apresentado no OSDI 2006, em Seattle, no mesmo encontro do artigo do Chubby.

O sistema já estava em produção desde abril de 2005, depois de cerca de sete pessoas-ano de projeto e implementação. Os autores dizem que mais de sessenta produtos e projetos do Google usam o Bigtable. Ele não é, de propósito, um banco relacional completo: oferece um mapa de linha, coluna e timestamp para uma string não interpretada, sem joins e sem transações gerais. Os autores também argumentam que o modelo chave-valor das tabelas hash distribuídas e das B-trees é limitado demais. O [Dynamo](/papers/dynamo-amazons-highly-available-key-value-store), da Amazon, um armazenamento chave-valor com projeto bem diferente, apareceu um ano depois e não é discutido neste artigo.

Vale conhecer antes: o que um sistema de arquivos distribuído como o GFS garante, a ideia de lease ou lock mantido por um serviço de locks, e a diferença entre um log de escrita antecipada e os arquivos de dados que ele protege.

## Contribuição

- **Um modelo de dados entre chave-valor e relacional.** Uma tabela é um mapa ordenado, esparso, distribuído, persistente e multidimensional, indexado por chave de linha, chave de coluna (escrita família:qualificador) e um timestamp de 64 bits. As linhas ficam em ordem lexicográfica, então os clientes escolhem chaves de linha para ganhar localidade, por exemplo guardando hostnames invertidos.
- **Atomicidade por linha.** Toda leitura ou escrita sob uma chave de linha é atômica, qualquer que seja o número de colunas. O Bigtable aceita transações de uma única linha, mas não transações gerais entre chaves de linha.
- **Tablets como unidade de distribuição.** A faixa de linhas de uma tabela é dividida dinamicamente em tablets de cerca de 100 a 200 MB por padrão, cada um atribuído a um tablet server por vez. Um master atribui tablets e equilibra a carga, mas os dados dos clientes não passam por ele.
- **Localização em três níveis.** Um arquivo no Chubby aponta para o root tablet, que aponta para tablets METADATA, que apontam para os tablets de usuário. Com tablets METADATA de 128 MB, o artigo calcula que o esquema endereça 2^34 tablets.
- **Representação de tablet em estilo log-structured.** As escritas vão para um commit log e um memtable. Memtables cheios viram SSTables imutáveis no GFS, e compactações em segundo plano limitam o número de arquivos que uma leitura precisa consultar.
- **Botões de ajuste para os clientes.** Locality groups, compressão por grupo, grupos em memória, filtros de Bloom e dois níveis de cache deixam o usuário moldar o desempenho pelo esquema.

## Metodologia

O artigo é uma descrição de sistema com medições e experiência de produção. As seções 2 a 5 cobrem o modelo de dados, a API de cliente, os blocos de construção (GFS, o formato SSTable e o Chubby) e a implementação: localização, atribuição e serviço de tablets e compactações. A seção 6 descreve refinamentos, como ordenar o commit log compartilhado para acelerar a recuperação e usar duas threads de escrita de log para esconder picos de latência do GFS.

A avaliação é um conjunto de micro-benchmarks. Os autores montaram um cluster com N tablet servers, cada um com 1 GB de memória, escrevendo em uma célula GFS de 1786 máquinas com dois discos IDE de 400 GB cada, com o mesmo número de máquinas cliente, em máquinas com dois chips Opteron dual-core de 2 GHz e Ethernet gigabit. Eles leram e escreveram valores de 1000 bytes com escritas sequenciais e aleatórias, leituras sequenciais e aleatórias, scans e leituras aleatórias da memória, com N igual a 1, 50, 250 e 500. A seção 8 descreve três usuários reais (Google Analytics, Google Earth e Personalized Search), e a seção 9 traz as lições.

## Resultados

Estes são os resultados e as observações relatados pelos autores.

- **Escala em produção.** Em agosto de 2006 havia 388 clusters que não eram de teste, com cerca de 24.500 tablet servers no total. Um grupo de 14 clusters ocupados, com 8069 tablet servers, viu mais de 1,2 milhão de requisições por segundo, com cerca de 741 MB/s de tráfego RPC de entrada e 16 GB/s de saída.
- **Vazão por servidor.** Com um tablet server, as leituras aleatórias chegaram a 1212 valores por segundo, porque cada leitura busca um bloco SSTable de 64 KB no GFS para aproveitar 1000 bytes. Leituras aleatórias da memória chegaram a 10811, escritas aleatórias a 8850 e scans a 15385. As escritas são rápidas porque todas vão para um único commit log com group commit.
- **A escala é real, mas não linear.** A vazão agregada cresce mais de cem vezes de 1 a 500 tablet servers, e as leituras aleatórias da memória quase 300 vezes. As leituras aleatórias escalam pior, cerca de 100 vezes para 500 vezes mais servidores, porque as transferências de 64 KB saturam enlaces gigabit compartilhados. A taxa por servidor cai: as escritas sequenciais vão de 8547 para 1905 por segundo, o que os autores atribuem a desequilíbrio de carga e a outros processos disputando CPU e rede.
- **Compressão.** Um esquema de duas passadas sobre páginas do Webtable, com páginas parecidas guardadas perto umas das outras, conseguiu redução de 10 para 1 no espaço, contra 3 para 1 ou 4 para 1 do Gzip típico em HTML.
- **A dependência do Chubby foi medida.** Em 14 clusters e 11 instâncias do Chubby, dados ficaram indisponíveis por causa do Chubby em 0,0047% das horas de servidor em média e 0,0326% no pior cluster.
- **Lições.** As falhas reais vão além de parada simples e partições (corrupção, desvio de relógio, máquinas travadas, bugs no Chubby), novas funcionalidades devem esperar até que o uso fique claro, já que a maioria das aplicações precisava só de transações de uma linha, e projetos simples importam. O primeiro protocolo de associação dos tablet servers, baseado em leases emitidos pelo master, era sensível demais a problemas de rede e ao tempo de recuperação do master, e o redesenhado ficou complexo demais, então os autores o trocaram por um mais simples, que depende só de recursos do Chubby muito usados.

## Análise crítica

O artigo é franco sobre os próprios limites, e as escolhas de projeto são claras. Ele também é um retrato de 2006, e alguns pontos merecem atenção.

- **Sem atomicidade entre linhas.** Os autores dizem que não há transações gerais, e que o uso mais importante das transações distribuídas pedidas pelos usuários é manter índices secundários, para o que planejam um mecanismo especializado. Aplicações com invariantes de várias linhas precisam construí-los no cliente.
- **A disponibilidade depende de um único serviço.** Se o Chubby fica indisponível por muito tempo, o Bigtable fica indisponível. A medição tranquiliza, mas vem dos clusters do próprio operador.
- **A avaliação é estreita.** Os benchmarks são micro-benchmarks em uma rede, em uma instalação, sem distribuições de latência, sem experimentos de injeção de falhas e sem comparação com outro sistema.
- **A replicação é só esboçada.** O artigo cita replicação no cliente e no servidor para o Personalized Search e diz que a replicação entre datacenters com vários masters está sendo construída, mas não descreve um modelo de consistência entre clusters.

Os próximos pontos vêm da literatura posterior, não do PDF. O artigo do [Spanner](/papers/spanner-globally-distributed-database), de 2012, diz que o Bigtable era difícil de usar em aplicações com esquemas em evolução ou que precisavam de consistência forte entre réplicas de longa distância, e apresenta um sistema com tabelas semirrelacionais e transações distribuídas. O Megastore (Baker et al., CIDR 2011), construído sobre o Bigtable, acrescentou transações ACID dentro de partições e replicação síncrona entre datacenters. Os autores também publicaram uma versão mais longa, na ACM Transactions on Computer Systems em 2008, que é um registro separado. Sistemas abertos como o Apache HBase e o Cassandra adotaram o modelo de dados do Bigtable, e a estrutura de memtable e SSTable virou um desenho comum de motor de armazenamento. O próprio artigo a relaciona com a log-structured merge tree.

Um leitor também nota que a garantia de operações atômicas por linha é enunciada de modo informal aqui: como ela se relaciona com a condição formal de [Linearizabilidade](/papers/linearizability-correctness-condition-concurrent-objects) é uma leitura, não algo que o artigo estabeleça.

## Pesquisas futuras

- Transações gerais e eficientes de várias linhas sobre um armazenamento ordenado e particionado, e índices secundários que permaneçam consistentes com os dados base.
- Replicação fortemente consistente entre datacenters para um modelo de dados no estilo Bigtable, como fizeram o Megastore e o Spanner.
- Lições de operação de serviços multiusuário: o artigo já acrescenta um mecanismo de cotas para tabelas compartilhadas e espera mais problemas de compartilhamento de recursos conforme os clusters de serviço crescem.
- Trabalhos de motor de armazenamento sobre o custo da compactação e da amplificação de leitura em desenhos log-structured, e sobre como filtros de Bloom e caches trocam memória por leituras de disco.
- Tratamento de falhas além da parada simples, incluindo corrupção e desvio de relógio, que a seção de lições nota não estarem cobertos pelas suposições de parada simples de muitos protocolos distribuídos.
