---
title: "Bodega: leituras linearizáveis locais em qualquer lugar e a qualquer momento com roster leases"
summary: O Bodega permite que réplicas escolhidas respondam leituras linearizáveis a partir do estado local, registrando-as como responders em um roster de todo o cluster, mantido consistente por leases all-to-all que viajam nos heartbeats, e segura as leituras que colidem com uma escrita em vez de redirecioná-las.
researchArea: Sistemas distribuídos
keywords: leituras linearizáveis, consenso, leases, replicação em área ampla, roster, leituras locais, multipaxos
version: 1.0
updatedAt: 2026-11-07
---

## Visão geral

Sistemas replicados entre zonas de disponibilidade pagam uma viagem de ida e volta de longa distância a cada quorum, e as leituras são a maior parte da maioria das cargas de trabalho. Servir a leitura da réplica mais próxima do cliente eliminaria esse custo, mas uma réplica só consegue fazer isso de forma linearizável se souber que seus dados são os mais recentes, e consultar um serviço externo anularia o objetivo e limitaria a tolerância a falhas à desse serviço.

Este artigo do OSDI 2026, de Guanzhou Hu (Amazon Web Services, trabalho feito em Wisconsin) e Andrea C. Arpaci-Dusseau e Remzi H. Arpaci-Dusseau (University of Wisconsin-Madison), defende que os read leases existentes ficam aquém. Os Leader Leases ajudam apenas no leader, e os Quorum Leases perdem o benefício quando até uma pequena parcela das escritas atinge a mesma chave.

Quatro termos sustentam o artigo. O **roster** é o metadado do cluster que nomeia o leader e, por faixa de chaves, os **responders** autorizados a ler localmente. Os **roster leases** são os leases all-to-all que fazem os nós concordarem sobre ele. O **optimistic holding** mantém no responder a leitura que encontra uma escrita em andamento, até que a escrita seja confirmada. O Bodega é o protocolo construído com eles.

Vale conhecer antes: MultiPaxos ([Paxos Made Simple](/papers/paxos-made-simple)) e [Raft](/papers/raft-understandable-consensus-algorithm), leader leases e, por contraste, como o [Spanner](/papers/spanner-globally-distributed-database) usa relógios sincronizados. O Bodega assume apenas desvio de relógio limitado.

## Contribuição

- **O roster.** Um leader mais, para cada faixa de chaves, um conjunto de responders, identificado por um ballot único. O leader conta como responder para todas as chaves. Ele generaliza a liderança para subconjuntos arbitrários de réplicas.
- **Uma regra de commit mais estrita para escritas.** Uma escrita na chave k é confirmada quando uma maioria a aceitou e todo responder de k, segundo o roster do leader, respondeu. Os autores chamam isso de preço inevitável de qualquer esquema de leitura local linearizável.
- **Roster leases.** Todo nó é grantor e grantee de todos os pares, usando as fases padrão de guard e renew. Um nó que detém pelo menos uma maioria de leases sabe que o roster está estável. Um nó que acabou de entrar em um roster também verifica se confirmou todos os slots até os limites de segurança informados pelos pares, para não servir um valor desatualizado.
- **O caminho de leitura.** O leader responde com o último valor confirmado, um não responder redireciona o cliente, e um responder responde se a escrita mais recente da chave está confirmada. Caso contrário, segura a leitura até a confirmação. Notificações antecipadas de accept, opcionais, deixam os followers avisarem os responders diretamente sobre os accepts, o que, segundo os autores, reduz à metade o tempo médio de espera com carga baixa. Um timeout no cliente tenta em outro nó se o leader demora.
- **Praticidade.** Os leases viajam nos heartbeats, e a maioria deles carrega só o ballot, porque rosters completos podem chegar a dezenas de KBs. Os servidores podem propor responders a partir de contagens de leitura por chave. Uma mudança proativa de roster leva duas rodadas de mensagens, uma para revogar e outra para iniciar.
- **Garantias.** Um resumo em pseudocódigo, uma prova concisa de linearizabilidade e de liveness das escritas que se apoia em resultados conhecidos sobre leases, e uma especificação em TLA+.

## Metodologia

Os autores construíram o Summerset, um key-value store replicado e genérico em relação ao protocolo, em Rust assíncrono. O Bodega tem cerca de 3,0 mil linhas nele, ao lado de MultiPaxos com Leader Leases, EPaxos, PQR e Quorum Leases (os dois últimos com uma variante cada), então toda base de comparação é implementação dos próprios autores.

Os experimentos usam dois ambientes de cinco nós: um cluster real de área ampla no CloudLab e um cluster GEO emulado com tempos de ida e volta do Google Cloud tirados de trabalho anterior. O microbenchmark usa 50 clientes em malha fechada, 10 perto de cada servidor, 1 mil chaves, valores de 128B e 0%, 1% ou 10% de escritas. Os heartbeats saem a cada 120 ms e os leases duram cerca de 2500 ms. Outros experimentos cobrem distribuições de latência, uma escrita interferente, proporções de escrita, tamanhos de valor, mudanças de roster, uma simulação de falhas e o YCSB contra etcd e ZooKeeper.

## Resultados

Estes são os resultados relatados pelos autores.

- **Destaque.** As requisições médias de leitura dos clientes ficam de 5,6× a 13,1× mais rápidas do que com abordagens anteriores em clusters reais de área ampla, sob interferência moderada de escritas. O Bodega iguala o Leader Leases para clientes perto do leader ou de um não responder.
- **Robusto a escritas.** Com 10% de escritas, o Bodega mantém as leituras com latência próxima de zero perto dos responders, enquanto os Quorum Leases quase voltam ao nível do Leader Leases.
- **Throughput.** No cenário WAN com 10% de escritas, o Leader Leases, limitado pelo leader, satura perto de 1,8 mil requisições por segundo, o Quorum Leases perto de 3,4 mil e o Bodega perto de 6 mil, com latência 1,5× melhor.
- **Uma escrita interferente.** As leituras dos Quorum Leases sobem para cerca de 40 ms, a média do tempo de ida e volta até o leader. A perturbação do Bodega dura cerca de 25 ms, e as leituras seguradas são liberadas depois.
- **Custos de escrita.** As escritas ficam um pouco mais lentas do que no Leader Leases, porque precisam alcançar os responders. Os ganhos de throughput diminuem conforme a proporção de escritas chega a 50%, e mais responders ou mais chaves cobertas trocam latência de escrita por latência de leitura.
- **Mudanças de roster.** Uma mudança explícita termina em cerca de 75 ms. Depois da queda de um responder, as escritas bloqueiam e as leituras continuam locais, sem interrupção, por cerca de 1,1 s, até que um timeout de heartbeat inicie uma mudança, e então vem uma espera de 2,6 s pela expiração dos leases.
- **Falhas frequentes.** Uma simulação Monte Carlo com taxas de falha exageradas ainda dá até 2,2× o throughput do Leader Leases.
- **Sistemas de produção.** No YCSB, o Bodega iguala, e às vezes supera, o ZooKeeper sequencialmente consistente e acompanha o etcd com leituras desatualizadas. Sem escritas, esses dois servem leituras em cerca de 0,3 ms, contra cerca de 1,2 ms do Bodega, o que os autores atribuem ao batching de requisições de 1 ms.

## Análise crítica

A ideia é limpa: ela tira o custo das leituras locais de cada escrita e o coloca em um roster que muda raramente. O artigo é aberto sobre vários limites.

- **As escritas pagam pelas leituras.** Uma escrita precisa alcançar todos os responders, então responders distantes custam latência de escrita, e a melhora some em cargas dominadas por escritas ou dentro de um único datacenter. A escolha dos responders fica como questão de política.
- **Liveness e escopo.** As mudanças de roster baseadas em heartbeat arriscam a liveness sob partições parciais de rede, problema que os autores dizem que pre-votes poderiam resolver. Transações estão fora do escopo.
- **Quedas travam as escritas.** A regra de commit faz a queda de um responder bloquear as escritas até o roster mudar, o que a Figura 16 mostra.

Os pontos a seguir são uma leitura das evidências, não afirmações do artigo.

- **O comportamento sob falhas é pouco medido.** O experimento real é uma queda de um responder com um único cliente. O resultado com falhas frequentes é uma simulação com paralisações assumidas (3 s por falha, 100 ms por recuperação de responder) construída a partir de números sem falhas. No cenário YCSB uniforme todo nó é responder, então qualquer queda trava as escritas por segundos, enquanto um protocolo de quorum por maioria não travaria com a queda de um follower. O artigo não pesa isso contra o ganho nas leituras.
- **A faixa de destaque é difícil de rastrear.** O resumo diz interferência moderada e a introdução diz leve. A Figura 9 traz resultados por localização, e o texto não diz qual base de comparação e qual proporção de escritas dão cada ponta de 5,6× a 13,1×.
- **As comparações misturam implementações.** As razões contra os outros protocolos de lease são justas porque eles compartilham a base de código. Os autores creditam parte da diferença para o ZooKeeper ao overhead do runtime Java, e o etcd (desatualizado) e o ZooKeeper não são linearizáveis, então essa comparação mostra que o Bodega é competitivo, não que o protocolo é mais rápido.
- **Apenas cinco nós.** Todas as rodadas usam cinco nós, com 1 mil chaves nos microbenchmarks e 10 mil no YCSB. O artigo diz que o overhead dos leases é desprezível, mas nenhum experimento varia o tamanho do cluster nem o isola.
- **As suposições não são estressadas.** Nenhuma rodada injeta desvio de relógio. A verificação de modelo cobre 3 nós, 3 ballots e 2 escritas mais 2 leituras, levando 43 horas e cerca de 4,27 bilhões de estados, então o comportamento com cinco nós se apoia no esboço de prova.
- **A política é pouco testada.** A heurística padrão exige mais de 95% de leituras e acrescenta servidores perto de mais de 20% das leituras. O roster Zipfian do YCSB foi montado à mão com os 20% de chaves mais acessadas, então a política automática não é avaliada sob mudanças de carga.

## Pesquisas futuras

- Políticas que escolham responders e a cobertura de chaves automaticamente, incluindo sua estabilidade sob cargas variáveis e nós fail-slow.
- Os roster leases como mecanismo geral para metadados que mudam raramente, como composição do cluster, tamanhos assimétricos de quorum ou dicas de desempenho dos nós, como os autores sugerem.
- Leituras com desatualização limitada, que os autores esboçam como varrer o fim do log em busca de um número limitado de versões da chave.
- Medir clusters maiores, injeção de desvio de relógio e falhas repetidas, o que testaria diretamente as afirmações sobre overhead e disponibilidade.
