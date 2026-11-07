---
title: "WriteGuards: suporte de armazenamento distribuído para caches fortemente consistentes"
summary: Os WriteGuards permitem que um sistema de armazenamento rejeite escritas que chegam atrasadas de um dono anterior de uma faixa de chaves, o que deixa caches em processo e remotos, construídos sobre um auto-sharder, servirem leituras linearizáveis da memória sem consultar o armazenamento.
researchArea: Sistemas distribuídos
keywords: writeguards, leituras linearizáveis, cache distribuído, fencing, auto-sharding, escritas atrasadas, tidb
version: 1.0
updatedAt: 2026-11-07
---

## Visão geral

Muitos serviços de datacenter precisam do estado confirmado mais recente no caminho da requisição, por exemplo as permissões atuais antes de cada chamada. Lê-lo de um banco transacional custa idas e voltas na rede e caudas de vários milissegundos, enquanto os caches são rápidos, mas em geral só eventualmente consistentes. Este artigo do OSDI 2026, da UC Berkeley, da Databricks e do ICSI, pergunta como um cache pode devolver leituras linearizáveis da memória, continuando fracamente acoplado ao armazenamento, escalando para bilhões de chaves e sobrevivendo ao resharding.

O obstáculo é a anomalia das escritas atrasadas. Depois que um auto-sharder move uma faixa de chaves para um novo pod, uma escrita emitida pelo dono anterior ainda pode estar em trânsito, e, se ela for confirmada depois que o novo pod leu e guardou o valor antigo, o cache fica desatualizado. Os autores respondem com os WriteGuards, uma pequena primitiva de fencing no armazenamento, e constroem sobre ela o CLink (um cache em processo) e o CRink-R e o CRink-L (caches remotos).

Três termos se repetem. Um slice é uma faixa de chaves que o auto-sharder atribui a um pod. Propriedade forte (strong ownership) significa que no máximo um pod é dono de uma chave por vez. A Latest State Invariant (LSI) diz que um valor em cache só pode ser servido se for igual ao valor confirmado mais recente no armazenamento.

Vale conhecer antes: linearizabilidade, leases e fencing tokens, controle de concorrência otimista e bancos chave-valor particionados por faixa, como o [TiDB](/papers/tidb-raft-based-htap-database) (o sistema que os autores modificaram), o [Spanner](/papers/spanner-globally-distributed-database) e o [FoundationDB](/papers/foundationdb-unbundled-transactional-kv-store).

## Contribuição

- **A primitiva WriteGuard.** Um tablet server mantém, em memória, um mapa de intervalos de faixas de chaves para valores de guarda opacos. `SetGuard(range, value)` sobrescreve as guardas de uma faixa, e toda escrita carrega uma guarda que precisa bater com a instalada para a sua chave. Aplicações que omitem guardas combinam com a guarda vazia padrão, então os clientes existentes continuam funcionando. O mapa é estado volátil, apagado na reinicialização.
- **Por que as soluções existentes ficam aquém.** O artigo examina verificar versões a cada leitura, transformar leituras em escritas de metadados, sequencers do Chubby por chave, fencing por timestamp no estilo do TrueTime e timeouts. Cada uma custa latência de leitura, exige estado por chave, depende de hardware de relógio especial ou apenas reduz a chance de uma escrita obsoleta.
- **CLink.** Um cache write-through ligado aos pods da aplicação. Em uma nova atribuição, o pod instala uma guarda nova sobre cada pedaço do slice do tamanho de um tablet e só então passa a guardar valores. Duas regras (as instalações precisam estar contidas em um período de propriedade e não se sobrepor) dão às guardas uma ordem total que coincide com a ordem no armazenamento, e uma terceira (toda instalação usa um valor novo) faz com que uma escrita atrasada de um dono anterior nunca possa coincidir.
- **Regras de serviço.** Uma escrita remove a chave do cache, e o resultado de uma leitura só é guardado se passar na checagem da LSI: havia uma guarda instalada, nenhuma escrita se sobrepôs a ela e a propriedade foi contínua. Todo acerto antes verifica se a propriedade não foi perdida.
- **Chaves quentes.** O auto-sharder isola uma chave quente e pode replicá-la. Um primário recebe todas as escritas e executa uma invalidação em duas fases entre as réplicas, e qualquer mudança na composição do grupo descarta as entradas em cache delas.
- **CRink-R e CRink-L.** O CRink-R executa o mesmo desenho como um serviço remoto compartilhado. O CRink-L guarda apenas versões em um pequeno serviço consistente e os valores em um cache lookaside comum, como o Redis: uma leitura busca os dois em paralelo e recorre ao armazenamento se as versões diferirem.

## Metodologia

O cache tem cerca de 6.000 linhas de C++, e os autores escreveram um auto-sharder com propriedade forte (cerca de 12.000 linhas de Scala) inspirado no Centrifuge. Para o armazenamento, estenderam o TiDB 7.5.1 com o SetGuard e a checagem de escrita, alterando 717 linhas de Rust no TiKV, 229 linhas de Go na camada SQL e 57 linhas de Go no Placement Driver, o que estimam em cerca de um mês-pessoa.

Os experimentos rodaram em clusters de produção com 9 pods de TiKV, 6 de TiDB, 3 de PD e 6 pods de aplicação de 16 vCPUs. A latência é medida no servidor da aplicação. As cargas são os traces da Meta e do Twitter (chave-valor simples) e um trace interno do Unity Catalog, que tem 99,4% de leituras, valores de cerca de 23KB e de 6 a 8 buscas no armazenamento por requisição. As bases de comparação são o armazenamento direto, uma verificação de versão a cada leitura e o Chrono (Dropbox), configurado com o timestamp de tentativa de 5 segundos que ele recomenda. Além da comparação entre os três traces, os autores usam apenas o Unity Catalog e cargas sintéticas.

## Resultados

Estes são os resultados relatados pelos autores.

- **Throughput por núcleo.** As leituras do CLink chegam a cerca de um milhão de operações por segundo por núcleo e a 22,8 milhões de QPS com 24 núcleos, escalando de forma quase linear. Os autores dizem que o protótipo não é otimizado e não pretende representar o estado da arte em desempenho de cache.
- **Overhead dos WriteGuards.** Com uma carga só de escritas e 75% de CPU no armazenamento, nem o throughput nem a latência são prejudicados. O SetGuard roda a cada mudança de atribuição, não a cada escrita.
- **Latência de leitura (P90).** O CLink chega a 0,5 µs a 4,2 µs, contra 4,8 ms a 10,3 ms do armazenamento e 3,3 ms a 9,0 ms das verificações de versão. O CRink-R e o CRink-L chegam a 0,65 ms a 3,2 ms, contra 2,3 ms a 5,5 ms do Chrono, o que os autores resumem como 3,6x a 5,2x menos que o armazenamento e 2,2x a 2,4x menos que o Chrono. O P99 fica de fora porque reflete sobretudo falhas de cache.
- **Taxa de acerto do Chrono.** Seus timestamps de 5 segundos deixam uma chave escrita sem poder ser cacheada por esse tempo, e os autores calculam que mais de uma escrita a cada 50 segundos em uma chave derruba a taxa de acerto abaixo de 90%.
- **Tráfego de escrita.** No trace do Unity Catalog com leituras convertidas em escritas, a latência do CLink se mantém estável conforme as escritas crescem. Em uma única chave quente, a latência sobe para 2 ms a 2,8 ms quando a taxa de acerto cai abaixo do percentil: o P99 com 80 QPS de escrita, o P90 e o P50 com 200 e 400.
- **Resharding.** Com 0,5% de churn de tráfego, o CLink mantém 100% de disponibilidade e baixa latência, porque as atribuições mudam em menos de 20 ms. Três serviços de produção moveram tipicamente menos de 0,2% da carga por minuto.
- **Replicação.** O auto-sharder adiciona réplicas conforme a carga de leitura sobe, e a latência de escrita cresce apenas de forma modesta. Os autores reduziram a capacidade dos pods para disparar 5 réplicas, o que normalmente exigiria mais de 80 milhões de QPS em uma chave.
- **Reinicializações.** Em 86 serviços particionados, reinicializações não planejadas acontecem cerca de uma vez a cada 750 a 2.000 reinicializações. Para um serviço de 100 pods, 1% das chaves fora do ar por 30 segundos ainda deixa a disponibilidade diária acima de 99,999%.

## Análise crítica

O artigo é franco sobre os custos de seu desenho. Ele admite três.

- **A propriedade forte custa disponibilidade.** Depois de uma queda não planejada, o lease antigo precisa expirar, o que deixa a faixa indisponível por dezenas de segundos. Os autores argumentam que isso é raro, usando dados de reinicializações da frota.
- **Chaves quentes com escrita perdem o cache.** O CLink não guarda uma chave enquanto uma escrita se sobrepõe a ela, então uma chave muito escrita é servida do armazenamento, e as réplicas acrescentam latência de invalidação às escritas.
- **Limites de escopo e do protótipo.** O artigo cobre um único datacenter, descarta os metadados de guarda na migração de tablets, deixa sem exploração o limite de guardas retidas e diz que seus números de throughput não refletem um cache otimizado.

Os pontos a seguir são uma leitura das evidências, não afirmações do artigo.

- **A correção é argumentada em prosa.** A seção 6.4 argumenta que os valores satisfazem a LSI na entrada e na hora de servir. Não encontrei prova mecanizada, verificação de modelo nem teste de linearizabilidade relatados, e o argumento pressupõe a consistência de atribuição e a checagem barata de propriedade do auto-sharder dos próprios autores.
- **As quedas são estimadas, não medidas.** O experimento de resharding cobre movimentos planejados. Nenhum experimento que li derruba um pod e mede a janela de expiração do lease, então a afirmação de disponibilidade se apoia em estatísticas da frota.
- **Um único sistema de armazenamento.** O "fácil de adicionar" se apoia em cerca de 1.000 linhas alteradas no TiDB, cujos tablets já são faixas de chaves. O overhead dos WriteGuards vem de uma única rodada só de escritas, e o Unity Catalog é um trace interno que outros não podem reexecutar.
- **Uma única base de comparação para caches remotos.** O Chrono é comparado com seu padrão de 5 segundos, e a diferença mudaria com outro limite, o que não é explorado. O resumo também junta 2,2x a 2,4x em uma única afirmação contra o armazenamento e contra caches remotos, enquanto o corpo do texto dá 3,6x a 5,2x contra o armazenamento.
- **O destaque é um P90 em traces com muita leitura.** As "três ordens de grandeza" comparam memória no processo da aplicação com uma leitura pela rede. Nenhuma base de comparação é um cache eventualmente consistente, então o preço da consistência sobre um cache em processo comum não fica isolado.
- **Alguns limites são afirmados.** As taxas de escrita em uma chave que quebram o CLink "excedem de longe" as taxas de produção, mas nenhuma taxa é mostrada.

## Pesquisas futuras

- Cache entre datacenters sobre bancos globais, que o artigo menciona e deixa fora do escopo.
- Limitar as guardas mantidas depois de splits e merges, e mover o estado das guardas junto com tablets em migração.
- As otimizações que o artigo lista: agrupamento de requisições, versões no cache, guardas por chave depois de uma escrita que falha e marcação das leituras com sua guarda.
- Um segundo sistema de armazenamento, com injeção de quedas e um verificador de linearizabilidade, e uma comparação com caminhos baseados em log para leituras linearizáveis em memória, como o [Tango](/papers/tango-distributed-data-structures-over-a-shared-log), cujas views verificam o fim do log antes de cada leitura.
