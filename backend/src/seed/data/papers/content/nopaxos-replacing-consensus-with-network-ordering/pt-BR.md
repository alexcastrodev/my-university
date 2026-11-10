---
title: "Diga não ao custo do Paxos: substituindo consenso por ordenação na rede"
summary: O NOPaxos divide a replicação de máquina de estados entre uma rede que ordena mensagens sem garantir a entrega e um protocolo que cuida só das mensagens perdidas, e com um sequenciador protótipo chega a throughput a até 2% e latência a até 16 μs de um sistema não replicado.
researchArea: Sistemas distribuídos
keywords: nopaxos, replicação de máquina de estados, ordered unreliable multicast, sequenciamento na rede, redes definidas por software, consenso, data centers
version: 1.0
updatedAt: 2026-11-03
---

## Visão geral

A replicação de máquina de estados mantém um serviço disponível fazendo as réplicas aplicarem as mesmas operações na mesma ordem. Protocolos como o [Paxos](/papers/paxos-made-simple) supõem uma rede capaz de perder ou reordenar qualquer coisa, então coordenam a cada requisição. Atomic broadcast tornaria a replicação trivial, mas equivale a consenso e só leva o custo para outra camada.

Este artigo da Universidade de Washington, publicado no OSDI 2016, procura o meio-termo. Ele separa a replicação em ordenação e entrega confiável e passa à rede apenas a ordenação, deixando ao protocolo uma tarefa menor: decidir quais requisições executar e quais pular. O projeto mira um único data center com rede definida por software.

Vale conhecer antes: o caso normal do Multi-Paxos, linearizabilidade e a ideia de switch programável.

## Contribuição

- **Ordered unreliable multicast (OUM).** Todos os receptores de um grupo recebem as mensagens na mesma ordem, mensagens podem se perder e os receptores são notificados de uma perda. As garantias valem dentro de uma sessão, que termina se o sequenciador falhar.
- **Três sequenciadores.** Um programa P4 para switches programáveis, um middlebox Cavium Octeon e um programa Linux. Todos os pacotes de um grupo passam pelo sequenciador, que carimba cada um com um contador.
- **O caso normal.** Toda réplica registra a requisição e responde, e só o líder a executa. O cliente espera f + 1 respostas coincidentes, incluindo a do líder, então uma requisição leva uma ida e volta, sem mensagens entre réplicas.
- **Acordo de lacunas.** Depois de uma notificação de perda, uma réplica pede a requisição ao líder. Se o líder também a perdeu, ele confirma um NO-OP naquela posição do log e espera f respostas.
- **Troca de visão.** Uma visão combina um número de líder com um número de sessão, então um só mecanismo cobre a falha do líder e o fim de uma sessão.
- **Maioria simples.** Como a ordem é garantida, os clientes não precisam de superquórum, ao contrário do Fast Paxos e do Speculative Paxos.

## Metodologia

Os autores implementaram o NOPaxos em cerca de 5.000 linhas de C++. O testbed emula uma fat tree de 12 switches sobre três switches físicos, com o sequenciador Cavium ligado aos switches raiz e cinco réplicas (de 3 a 9 no teste de escalabilidade). As referências de comparação são Paxos, Fast Paxos, Paxos com batching, Speculative Paxos e um sistema não replicado.

Os experimentos cobrem latência e throughput com clientes em closed loop, descarte aleatório de pacotes, uma falha do sequenciador simulada notificando o controlador e um key-value store transacional (two-phase commit com controle de concorrência otimista) com carga baseada no Retwis e SLO de 10 ms. Uma simulação em nível de pacote, com 2.560 hosts e 119 switches, estima o custo de encaminhamento. O artigo esboça uma prova de correção e deixa a prova completa e uma especificação TLA+ para um relatório técnico.

## Resultados

Estes são os resultados relatados pelos autores, com o NOPaxos no sequenciador Cavium, salvo indicação.

- **Perto do não replicado.** Throughput a até 2% e latência a até 16 μs do sistema não replicado.
- **Contra outros protocolos.** Latência de 111 μs, contra 240 μs do Paxos e 193 μs do Fast Paxos. Throughput de 4,7 vezes o do Paxos e 24% acima do Speculative Paxos.
- **Custo do sequenciador.** O middlebox adiciona 8 μs na mediana e 16 μs no percentil 99, uma medição distinta da diferença citada acima. Um sequenciador em end-host custa 36% a mais de latência.
- **Perda de pacotes.** Com taxa de perda de 1%, o NOPaxos fica mais ou menos no nível do sistema não replicado, enquanto o Speculative Paxos cai para o throughput do Paxos.
- **Número de réplicas.** O NOPaxos mantém o throughput conforme réplicas são adicionadas, enquanto Paxos e Fast Paxos degradam em proporção ao número de réplicas.
- **Failover do sequenciador.** O throughput cai a zero, a operação normal volta depois de cerca de 110 ms e o throughput de pico depois de cerca de 270 ms. A maior parte da demora vem da atualização de rotas.
- **Aplicação.** O key-value store obtém mais de 4 vezes o throughput do Paxos, 45% a mais que o Speculative Paxos e fica a até 4% do sistema não replicado.
- **Custo de encaminhamento (simulação).** Em 88% dos casos, passar pelo sequenciador não adicionou latência para alcançar um quórum de 3 entre 5 receptores.

## Análise crítica

A ideia central tem bom respaldo: ordenar é barato de oferecer e tira do protocolo a maior parte do trabalho. As afirmações principais pedem mais cuidado.

O próprio artigo declara alguns limites.

- **O sequenciador no switch não foi medido.** Sem o hardware, "we cannot evaluate their performance". A afirmação de custo quase zero se apoia em uma analogia com switches que escrevem timestamps, e todo número medido vem de um middlebox. O artigo do [Eris](/papers/eris-coordination-free-consistent-transactions), um ano depois, diz que o hardware para seu próprio sequenciador, relacionado a este, está "not yet commercially available".
- **A segurança depende da rede.** Ela vale "provided the OUM guarantees continue to hold", em um modelo de falhas só com crashes.

O restante é uma leitura das evidências.

- **O consenso muda de lugar, não desaparece.** O controlador é replicado com Paxos, e o acordo de lacunas e as trocas de visão são coordenação. O que some é a coordenação no caminho comum, e o título exagera nesse ponto.
- **A conclusão vai além dos números.** Ela chama a latência de equivalente à de um sistema não replicado, "proving that replication does not have to come with a performance cost". Só que 16 μs são cerca de 14% dos 111 μs do NOPaxos, e a seção 6.1 não descreve a operação replicada nem qualquer uso de armazenamento estável, então os 2% podem não se transferir para operações mais caras.
- **O failover parece otimista.** A seção 4.3 espera o reencaminhamento "within a few milliseconds", mas a recuperação medida leva cerca de 110 ms, na maior parte na atualização de rotas. A falha foi simulada notificando o controlador, então o tempo de detecção fica de fora.
- **Os testes de falha são estreitos.** A falha do líder, o custo da troca de visão e o custo da sincronização não são medidos. A seção 6.2 afirma resiliência a "packet drops and reorderings", mas só foram injetadas perdas aleatórias, até 1%.
- **Um grupo só.** O key-value store ainda usa two-phase commit entre shards, e o Eris argumenta depois que o OUM não serve para ordenar entre shards.

## Pesquisas futuras

- Como um sequenciador real dentro do switch se compara à projeção feita aqui?
- Até onde o failover pode encolher quando detecção e atualização de rotas forem ambas medidas?
- Como o OUM se comporta com perdas correlacionadas e tráfego real de fundo?
- Como a recuperação depois da queda do líder cresce com o log não sincronizado?
- Uma garantia de ordenação parecida pode existir sem controle da rede, ou entre data centers?
- O que acontece com a segurança se um sequenciador se comportar mal em vez de parar?
