---
title: "Projetando sistemas distribuídos com sincronia aproximada em redes de data center"
summary: O artigo trata o data center como uma rede aproximadamente síncrona, constrói o Mostly-Ordered Multicast com roteamento e filas de prioridade e o usa no Speculative Paxos, que executa as requisições antes do acordo e confirma em dois atrasos de mensagem quando a rede mantém a ordem.
researchArea: Sistemas distribuídos
keywords: sincronia aproximada, mostly-ordered multicast, speculative paxos, replicação de máquina de estados, redes de data center, redes definidas por software, especulação e rollback
version: 1.0
updatedAt: 2026-11-20
---

## Resumo

Sistemas distribuídos são tradicionalmente projetados de forma independente da rede subjacente, assumindo o pior caso sobre o seu comportamento (por exemplo, assincronia completa). No entanto, muitas aplicações distribuídas de hoje rodam em data centers, onde a rede é mais confiável, previsível e extensível. Nesses ambientes, é possível projetar sistemas distribuídos em conjunto com a camada de rede, e isso pode trazer benefícios substanciais. Este artigo explora mecanismos em nível de rede para oferecer o Mostly-Ordered Multicast (MOM): uma propriedade de ordenação de melhor esforço para operações de multicast concorrentes. Com essa primitiva, projetamos o Speculative Paxos, um protocolo de replicação de máquina de estados que conta com a rede para ordenar as requisições no caso normal. Essa abordagem traz ganhos de desempenho substanciais: sob condições realistas de data center, o Speculative Paxos pode oferecer 40% menos latência e 2,6 vezes mais throughput que o protocolo Paxos padrão. Ele tem latência menor que um protocolo otimizado para latência (Fast Paxos) com o mesmo throughput de um protocolo otimizado para throughput (batching).

## Visão geral

Protocolos de replicação como o [Paxos](/papers/paxos-made-simple) e o [Viewstamped Replication](/papers/viewstamped-replication-revisited) assumem uma rede assíncrona, em que mensagens podem atrasar, ser perdidas ou chegar fora de ordem, e pagam por esse pior caso com atrasos de mensagem extras e com um líder que processa todas as mensagens. Serviços como o [Chubby](/papers/chubby-lock-service-loosely-coupled-distributed-systems), o [ZooKeeper](/papers/zookeeper-wait-free-coordination-internet-scale-systems) e o [Spanner](/papers/spanner-globally-distributed-database) rodam esses protocolos dentro de data centers, onde a topologia é estruturada, a perda por congestionamento pode ser reduzida com prioridades e um único operador controla os switches.

Este artigo do NSDI 2015, da University of Washington, defende que o data center é mais bem modelado como uma rede aproximadamente síncrona: ordenação forte no caso comum, ocasionalmente violada durante falhas. A ideia tem duas metades. A rede é projetada para entregar multicasts concorrentes numa ordem consistente na maior parte do tempo, e o protocolo por cima assume essa ordem, continua correto quando ela falha e se recupera quando isso acontece.

Vale conhecer antes: replicação de máquina de estados (veja a [abordagem de máquina de estados](/papers/state-machine-approach-fault-tolerant-services-tutorial)), linearizabilidade e por que o [FLP](/papers/flp-impossibility-of-distributed-consensus) faz a vivacidade depender da rede.

## Contribuição

- **Mostly-Ordered Multicast (MOM).** Uma propriedade de melhor esforço: se um receptor processa a mensagem m antes de m', os outros receptores ou processam as duas nessa ordem ou perdem uma delas. É uma propriedade empírica, não uma garantia, então as aplicações precisam tolerar violações.
- **Três projetos de rede.** O multicast ciente da topologia envia todas as cópias por switches equidistantes de todos os membros do grupo, de modo que todas cruzem o mesmo número de enlaces. O multicast de alta prioridade acrescenta uma fila de prioridade estrita para o tráfego MOM. A serialização na rede roteia todos os multicasts de um grupo por um único switch raiz escolhido pelo controlador SDN. Todos usam regras OpenFlow, e o controlador contorna switches com falha.
- **Speculative Paxos.** Cada réplica executa a requisição assim que ela chega e responde com o resultado e um hash-resumo do seu log. O cliente considera a operação confirmada quando um superquórum de f + ⌈f/2⌉ + 1 réplicas, entre 2f + 1, envia respostas idênticas. Uma sincronização periódica promove entradas a confirmadas, e uma reconciliação, estruturada como a troca de visão do Viewstamped Replication, combina os logs e desfaz a especulação quando a ordem divergiu.
- **Segurança sem a suposição.** O protocolo dá linearizabilidade com no máximo f falhas mesmo que a rede perca, atrase, reordene ou duplique mensagens. A vivacidade exige que mensagens reenviadas acabem chegando, como no Paxos.

## Metodologia

Os projetos de MOM rodaram numa bancada que emula 12 switches em uma fat tree com cinco switches físicos (quatro HP ProCurve 6600 e um Arista 7150S-24) e três remetentes e receptores, e num simulador em nível de pacote com 2.560 servidores e 119 switches, alimentado por tráfego de fundo derivado de medições de data centers da Microsoft. O simulador coincidiu com a bancada em até 8%.

O Speculative Paxos é uma biblioteca C++ de cerca de 10.000 linhas que também implementa Paxos, Paxos com batching (a estratégia de janela deslizante do PBFT, lotes de até 64) e Fast Paxos. Os experimentos usaram três réplicas (f = 1) na bancada, com 2 a 300 clientes em laço fechado, e depois três nós atrás de um único switch com reordenação artificial de pacotes. Foram construídas três aplicações: um servidor de timestamps, um gerenciador de locks e um key-value store transacional com two-phase commit, testado com um microbenchmark e com uma carga baseada no Retwis sob um SLO de 10 ms.

## Resultados

São os resultados relatados pelos autores. Itens marcados como leitura de gráfico vêm só das figuras.

- **Reordenação do multicast.** Na bancada, o IP multicast convencional reordenou até 25% dos pacotes. O MOM ciente da topologia reduziu isso em 2 a 3 ordens de grandeza (o artigo situa os dois primeiros projetos em cerca de 0,01% a 0,1%), e a serialização na rede eliminou a reordenação. Nenhum switch isolado reordenou tráfego, nem em taxas que saturam o enlace. Na simulação, a ciência da topologia deu uma ordem de grandeza, o QoS mais um pouco, e a serialização deixou só a perda por congestionamento. Com a serialização, a diferença de latência entre receptores ficou abaixo de 2,5 µs.
- **Latência.** Com carga baixa a média, 135 µs no Speculative Paxos, 220 µs no Paxos e 171 µs no Fast Paxos (mediana, três réplicas).
- **Throughput.** Cerca de 100.000 requisições/s no Speculative Paxos contra cerca de 38.000 no Paxos e no Fast Paxos. O batching chega a um pico equivalente, mas a 90.000 requisições/s sua latência é 3,5 vezes maior.
- **Sensibilidade à reordenação.** Com reordenação rara, 3 vezes o throughput do Paxos e do Fast Paxos. Ele continua à frente do Paxos até a taxa de reordenação passar de 0,1%. Leitura de gráfico da Figura 9: com 1% de reordenação cai para menos de 10.000 requisições/s, abaixo do Paxos, em torno de 28.000.
- **Aplicações.** O código de rollback é 10 de 154 linhas (servidor de timestamps), 75 de 606 (gerenciador de locks) e 248 de 2.011 (key-value store). Uma transação confirma em 1,01 ms, contra 1,44 ms no Paxos e 1,12 ms no Fast Paxos. Sob o SLO de 10 ms, a leitura de gráfico da Figura 10 põe o throughput máximo perto de 5.800 transações/s no Speculative Paxos, 4.800 com batching, 2.900 no Fast Paxos e 2.000 no Paxos.

## Análise crítica

O artigo declara seus próprios limites: a especulação exige suporte a rollback na aplicação, a reconciliação custa mais que um conflito do Fast Paxos e o protocolo é mais lento em ambientes com muitos conflitos. Ele sugere explorar operações que comutam, como faz o [Egalitarian Paxos](/papers/egalitarian-paxos-more-consensus-in-egalitarian-parliaments), para tolerar mais reordenação.

Os pontos a seguir são uma leitura da evidência, não afirmações do artigo.

- **A correção não depende da sincronia, o desempenho depende.** O ganho de 3 vezes só vale enquanto a reordenação fica abaixo de cerca de 0,1%, e a bancada situa os dois primeiros projetos de MOM em 0,01% a 0,1%, bem nessa borda, com só a serialização removendo a reordenação fora de falhas.
- **Termos que o artigo não usa.** Ele não constrói relógios sincronizados nem declara latência limitada como propriedade. Seu modelo é de ordenação, apoiado em limites medidos de fila (cerca de 1,2 µs por enlace, 2,4 µs do core ao ToR).
- **Implantação pequena.** O protocolo roda com três réplicas, em que o superquórum são as três, então, pela minha leitura, qualquer falha de uma réplica tira o caminho rápido. O texto diz que o processamento especulativo exige menos de ⌈f/2⌉ falhas.
- **Falhas e escopo.** O tratamento de falhas de switch é descrito (o controlador reroteia, alguns milissegundos citando outro trabalho), mas não é medido de ponta a ponta com o Speculative Paxos, e o switch único de serialização é uma escolha de projeto, não um caso de falha testado. A replicação geodistribuída não é coberta, já que o argumento depende de um único domínio administrativo.
- **Contagens inconsistentes.** O texto diz que a simulação tem 119 switches, enquanto a legenda da Figura 5 diz 160.

Literatura posterior, conferida no texto da fonte: o [NOPaxos](/papers/nopaxos-replacing-consensus-with-network-ordering) (OSDI 2016, em parte dos mesmos autores) diz que o Speculative Paxos assume só ordenação de melhor esforço e que o NOPaxos exige uma garantia de ordem vinda de um plano de dados programável. Sua avaliação relata o throughput do Speculative Paxos caindo bastante depois de 0,5% de pacotes perdidos e chegando ao do Paxos com 1%. Não li o [Eris](/papers/eris-coordination-free-consistent-transactions) nem o [Hydra](/papers/hydra-serialization-free-network-ordering) além dos resumos do catálogo.

## Pesquisas futuras

- Quanto uma rede de produção real reordena tráfego MOM ao longo de meses, inclusive durante falhas de switch?
- Explorar operações que comutam para elevar a taxa de reordenação tolerável, como o artigo sugere.
- Grupos maiores, em que o superquórum seja menor que o grupo inteiro.
- Se uma ordem garantida, como no NOPaxos, compensa a capacidade extra exigida dos switches em comparação com a ordenação de melhor esforço.
