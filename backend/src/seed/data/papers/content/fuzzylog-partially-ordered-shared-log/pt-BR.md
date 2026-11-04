---
title: "O FuzzyLog: um shared log parcialmente ordenado"
summary: O FuzzyLog troca a ordem total de um shared log por um DAG de nós coloridos, com uma cor por shard de dados e uma chain por região, e sua implementação, o Dapple, permite que aplicações escalem, enfraqueçam a consistência e tolerem partições de rede com pouco código.
researchArea: Sistemas distribuídos
keywords: shared log, ordem parcial, consistência causal, geo-replicação, algoritmo de Skeen, chain replication, CRDT
version: 1.0
updatedAt: 2026-11-03
---

## Visão geral

Sistemas de shared log como o [Corfu](/papers/corfu-shared-log-design-for-flash-clusters) e o [Tango](/papers/tango-distributed-data-structures-over-a-shared-log) constroem serviços de plano de controle como camadas finas sobre um único log totalmente ordenado. Neste artigo do OSDI 2018, Lockerman e colegas mantêm esse estilo de projeto, mas argumentam que uma ordem total em todo o sistema é cara, muitas vezes impossível e em geral desnecessária. Um sequenciador limita o throughput e acrescenta idas e voltas para clientes distantes; uma ordem total consistente com linearizabilidade fica sujeita a indisponibilidade durante partições de rede; e atualizações em dados disjuntos não precisam de ordem nenhuma.

O FuzzyLog é um grafo acíclico dirigido de atualizações. As cores representam shards de dados, e cada cor é um conjunto de chains totalmente ordenadas, uma por região, unidas por ligações cruzadas que registram causalidade. Cada região guarda uma cópia completa, atual para suas próprias chains e possivelmente defasada para as demais. Com uma cor em uma região, ele se reduz a um shared log comum.

Vale conhecer antes: shared logs e replicação de máquina de estados, consistência causal, a diferença entre linearizabilidade e serializabilidade, a conjectura CAP e CRDTs.

## Contribuição

- **A abstração.** Uma API pequena: `append` em uma ou mais cores, `sync` para reproduzir uma cor e receber um snapshot ID, e `trim`. Um nó novo ganha arestas cruzadas para o último nó que o cliente viu em cada chain remota.
- **Semântica por escopo.** Operações em uma cor entre regiões são causalmente consistentes. Dentro de uma região são serializáveis, e linearizáveis quando tocam uma única cor.
- **Projetos de aplicação.** O ShardedMap escala por cor, o AtomicMap acrescenta multi-puts, o TXMap reaproveita o protocolo de transações do Tango para ter serializabilidade estrita, o CRDTMap dá consistência causal+ e o CAPMap dá linearizabilidade sem partições e consistência causal+ durante elas.
- **Dapple.** Cada cor mora em uma partição de chainservers em memória, replicada por chain replication. As chains remotas chegam como shadow logs por sincronização periódica.
- **Uma variante tolerante a falhas do algoritmo de Skeen** para appends em várias cores. Leases, fencing e write-ahead logging permitem que outro cliente termine o append se o cliente de origem cair. Appends de uma cor levam uma fase, os de várias cores levam duas, e a recuperação, três.

## Metodologia

Os autores avaliam os projetos em instâncias Amazon EC2 c4.2xlarge, na maior parte dentro de uma região, com execuções geodistribuídas entre Ohio e Tóquio, a 168 ms de ping médio. O Dapple roda com duas réplicas por partição, salvo indicação em contrário.

Os experimentos comparam o Dapple com uma emulação do protocolo de append do Tango construída dentro do Dapple, com cinco partições mais um sequenciador sem réplica; rodam o AtomicMap com chaves e valores de 8 bytes em 8 a 16 chainservers sem replicação; rodam o CRDTMap em cinco servidores em regiões virtuais dentro de uma região EC2; rodam o CAPMap durante 14 segundos, com uma partição simulada do segundo 6 ao segundo 8; e rodam o DappleZK, um clone do ZooKeeper, contra o ZooKeeper em DRAM. Para a correção, escreveram provas convencionais e uma prova verificada por máquina em Coq do protocolo de recuperação, omitida por falta de espaço.

## Resultados

Estes são os resultados relatados pelos autores.

- **As aplicações são pequenas.** O ShardedMap tem 193 linhas, o AtomicMap 201, o CRDTMap 284, o TXMap 417, o CAPMap 424 e o DappleZK 1881.
- **O sequenciador é o limite na emulação.** O Tango emulado não escalou além de quatro clientes. O Dapple escalou de forma quase linear sem appends de várias cores, foi 2X mais rápido com 1%, empatou com o Tango com 10% e ficou atrás com 100%, quando a ordem parcial exigida é quase uma ordem total.
- **O AtomicMap escala.** O artigo relata mais de 5,5M puts/s e quase 1M multi-puts de 2 chaves/s em 16 servidores Dapple.
- **A carga vira defasagem.** Um pico de puts no CRDTMap não atrasou os gets do leitor e apareceu como staleness.
- **O CAPMap troca de modo.** Sem partição, as duas regiões tiveram consistência forte, e a secundária pagou os 168 ms de ida e volta. Durante a partição, a secundária passou para uma chain local, com latência bem menor e consistência mais fraca, enquanto a primária manteve a consistência forte.
- **DappleZK.** O resumo dá 3M/s de escritas em uma única chave e 150K/s de renames atômicos entre shards em 6 nós. O ZooKeeper entregou 36K e 66K ops/s com uma e duas partições.

## Análise crítica

O resultado central é crível: quando uma carga se particiona bem, tirar o sequenciador global tira o gargalo dele. A evidência para as afirmações mais amplas é mais irregular.

Limites que o próprio artigo declara:

- **Os números do AtomicMap são sem replicação.** O artigo admite que a implantação rodou sem replicação por causa de limites de instâncias no EC2. A durabilidade também é uma suposição: os chainservers ficam em memória, e a implementação conta com DRAM com bateria.
- **A falha é mais argumentada que medida.** Um cliente que cai bloqueia as cores envolvidas até a recuperação, e o artigo admite um pico de latência e um possível livelock. A recuperação só é medida como latência em uma implantação com pouca carga, e supõe-se que partições replicadas não falham.
- **Os autores relativizam a distância para o ZooKeeper.** Eles esperam que a vitória com uma partição venha em grande parte de Rust contra Java e de protótipo contra código de produção, e os renames no ZooKeeper foram emulados com um delete e um create.

Pontos que decorrem da leitura da avaliação:

- **A comparação com o Tango é uma emulação.** O artigo conclui que sequenciadores centralizados em shared logs existentes limitam a escalabilidade de forma fundamental, mas o experimento mostra um gargalo de sequenciador dentro do Dapple, não o comportamento do Tango nem do [vCorfu](/papers/vcorfu-cloud-scale-object-store-on-a-shared-log), que o artigo coloca na mesma classe. A vantagem também some com 10% de appends em várias cores.
- **O "impossible" é mais estreito do que parece.** Significa indisponível durante uma partição. Na motivação, as taxas exigidas do sequenciador são contas sobre larguras de banda e tamanhos de payload supostos, comparadas a medições publicadas de sequenciadores reais.
- **A garantia do AtomicMap aparece de dois jeitos.** A introdução o chama de linearizável, enquanto a Seção 4.1 diz que ele é serializável, não linearizável nem estritamente serializável.
- **A ordem parcial passa trabalho para a aplicação.** O requisito de escalabilidade supõe carga distribuída por igual entre as cores, e a avaliação não testa assimetria de carga. O `sync` reproduz uma cor, logo a API como descrita não oferece snapshot entre cores, a propriedade que o [vCorfu](/papers/vcorfu-cloud-scale-object-store-on-a-shared-log) tira de sua ordem total.
- **A evidência geográfica é escassa.** O CRDTMap rodou em regiões virtuais, e o CAPMap em duas regiões, com uma partição de dois segundos. O custo de armazenamento não é informado, embora a eficiência de espaço seja um requisito declarado.

## Pesquisas futuras

- Repetir o experimento do AtomicMap com replicação e durabilidade, na mesma escala.
- Lidar com cores muito disputadas, por exemplo movendo ou dividindo uma cor entre partições.
- Se é possível oferecer snapshots entre cores sem trazer de volta a coordenação global.
- Consistência causal entre shards, que os autores esboçam como COPSMap e deixam para trabalho futuro.
- O CAPMap com mais de duas regiões e com falha da região primária.
