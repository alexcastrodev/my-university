---
title: "Skyloft: um framework de escalonamento geral e altamente eficiente no userspace"
summary: O Skyloft é uma library OS compatível com Linux, mais um módulo de kernel de 325 linhas, que executa políticas de escalonamento inteiramente no userspace, usando user interrupts da Intel (e um truque que leva o timer do local APIC ao userspace) para preemptar threads a cada poucos microssegundos e compartilhar cores entre aplicações.
researchArea: Sistemas operacionais
keywords: escalonamento em userspace, interrupções de usuário, uintr, preempção em escala de microssegundos, latência de cauda, work stealing, kernel bypass
version: 1.0
updatedAt: 2026-11-07
---

## Visão geral

Serviços de datacenter querem políticas de escalonamento sob medida para latência de cauda, throughput e eficiência de CPU, mas mudar o scheduler do Linux é difícil, e toda decisão tomada no kernel custa trocas de modo e perde localidade. Schedulers que rodam no userspace evitam esse custo, mas os autores argumentam que nenhum oferece as duas coisas de que um framework geral precisa. A primeira é a preempção em escala de microssegundos, para que uma requisição longa não bloqueie as curtas quando os tempos de serviço têm cauda pesada. A segunda é compartilhar cores entre várias aplicações, para que os cores ociosos de uma aplicação sensível à latência (LC) vão para uma de melhor esforço (BE) e voltem rápido diante de um pico. O Shinjuku e o Concord preemptam, mas dedicam cores a uma única aplicação, enquanto o Shenango realoca cores rapidamente, mas não tem preempção dentro de uma aplicação.

Este artigo do SOSP 2024 (Austin), da Tsinghua University e do Quan Cheng Laboratory, apresenta o Skyloft, um framework de escalonamento no userspace construído sobre as User Interrupts da Intel (UINTR, disponíveis no Sapphire Rapids) e executado junto do Linux em cores isolados.

Quatro termos merecem atenção. UINTR permite que o hardware entregue uma interrupção direto a um handler no userspace, e SENDUIPI é a instrução que envia uma. A LibOS do Skyloft é a parte no userspace, com uma API de threads no estilo POSIX, e o módulo de kernel do Skyloft é a pequena parte privilegiada. A Single Binding Rule é o invariante que mantém o scheduler do Linux fora do caminho.

Vale conhecer antes: head-of-line blocking e por que o processor sharing ajuda com tempos de serviço de cauda pesada, e como um SO entrega interrupções de timer. O [ghOSt](/papers/ghost-user-space-delegation-of-linux-scheduling) é a principal comparação de propósito geral do artigo, um framework que delega o escalonamento do Linux a agentes no userspace. O [Demikernel](/papers/demikernel-datapath-os-for-microsecond-datacenter-systems) é citado entre os SOs de dataplane cujas ideias de datapath o Skyloft reaproveita. Dois pareamentos meus, não do artigo: o [Rakaia](/papers/rakaia-in-kernel-scheduling-for-tcp-rpcs) combate o mesmo head-of-line blocking levando o escalonamento de mensagens para dentro do kernel em vez de para fora, e o [Snap](/papers/snap-microkernel-approach-to-host-networking) é outro sistema do Google que tira uma função do kernel (networking do host) e a leva ao userspace.

## Contribuição

- **User interrupts como primitiva de preempção.** O Skyloft suporta duas formas de preemptar. Um core dispatcher pode enviar user IPIs com SENDUIPI, o que serve a políticas centralizadas, mas custa um core e, como os autores notam, vira gargalo com muitos cores. Ou cada core pode receber a própria interrupção de timer no userspace, o que serve a políticas por CPU e dispensa o dispatcher.
- **Interrupções de timer de hardware no userspace.** Os autores dizem que nem trabalhos anteriores nem o manual da Intel cobrem isso. Apontar o registrador UINV para o vetor do timer faz o core reconhecer a interrupção, mas nada preenche o campo PIR do UPID, então o processamento de user interrupt não começa. A solução deles é ligar o bit SN (Suppress Notification) e fazer cada core executar SENDUIPI para si mesmo, o que preenche o PIR sem enviar um IPI de verdade, e o handler repete isso para o próximo tick. Isso exigiu alterar 163 linhas do patch UINTR do Linux.
- **Muitas aplicações, um core, uma thread ativa.** Os cores são isolados no boot. Cada aplicação cria uma kernel thread por core isolado, e a Single Binding Rule permite só uma kernel thread ativa por core, de modo que o scheduler do kernel é contornado. Trocar user threads dentro de uma aplicação fica no userspace. Trocar para a thread de outra aplicação chama o módulo de kernel, que suspende uma kernel thread e acorda a outra de forma atômica. Todas as aplicações linkam uma cópia idêntica da biblioteca e compartilham runqueues, metadados de aplicação e estado das threads em memória compartilhada, enquanto contextos e stacks continuam privados.
- **Uma interface de política pequena.** Uma política implementa task_init, task_terminate, task_enqueue, task_dequeue, task_block e task_wakeup, mais sched_init e sched_timer_tick, sched_balance para políticas por CPU e sched_poll para as centralizadas. Um handler global de user interrupt chama sched_timer_tick, recoloca a tarefa atual na fila se ele mandar preemptar e reentra no loop de escalonamento.
- **I/O e tamanho.** O DPDK faz polling da NIC em um core dedicado e entrega os pacotes aos cores isolados por ring buffers compartilhados, pelo hash RSS, com uma pilha TCP e UDP leve no userspace. A LibOS tem 9K linhas de C, o código de DPDK e rede mais 4K, e o módulo de kernel 325. A Tabela 4 lista as políticas: Round-Robin 141 linhas, CFS 430, EEVDF 579, Shinjuku 192, Shinjuku-Shenango 444 e uma política de work stealing preemptiva 150, contra 6.592 do CFS do Linux e 710 do Shinjuku do ghOSt.

## Metodologia

O servidor tem duas CPUs Xeon Gold 5418Y de 24 cores a 2,0 GHz e 128 GB de RAM, com TurboBoost, estados de idle, escalonamento de frequência e transparent hugepages desligados, e uma NIC Intel 82599ES de 10 Gb/s. A maioria das execuções usa um Linux 6.0.0 modificado e DPDK 22.11, e um cliente separado de dois sockets envia carga Poisson em malha aberta.

As políticas por CPU são comparadas com Linux RR, CFS e EEVDF (padrão e ajustados) no schbench v1.0, com 24 cores, uma thread de mensagem e um número crescente de workers. As políticas centralizadas rodam uma carga sintética com 99,5% de requisições de 4 µs e 0,5% de 10 ms, com um dispatcher e 20 workers, contra o Shinjuku original (Linux 4.4), o agente Shinjuku do ghOSt (Linux 5.11) e uma versão não preemptiva sobre o CFS. Um segundo experimento colocaliza a aplicação LC com uma aplicação batch usando a estratégia de alocação de cores do Shenango. As aplicações reais são o Memcached 1.5.6 com a mistura USR (99,8% GET, 0,2% SET, 4 workers) e um servidor RocksDB 6.15.5 sobre UDP com 50% GET (0,95 µs) e 50% SCAN (591 µs) em 14 workers, ambos contra o Shenango com uma política de work stealing. Microbenchmarks medem os custos de interrupção, timer, threads e troca entre aplicações.

## Resultados

Estes são os resultados relatados pelos autores.

- **Latência de wakeup.** O RR, o CFS e o EEVDF do Skyloft mostram latência de wakeup no p99 significativamente menor que seus equivalentes do Linux, e o resumo dá 100 µs contra 10.000 µs. O EEVDF do Skyloft supera o CFS do Skyloft, o EEVDF do Linux se comporta como o CFS do Linux porque é limitado pela frequência do timer, e a latência é aproximadamente proporcional à fatia de tempo.
- **Aplicação única.** Um quantum de 30 µs deu os melhores resultados. O Skyloft e o Shinjuku têm desempenho parecido, o ghOSt chega a 80,1% do throughput máximo do Skyloft com latência de cauda no p99 três vezes maior em carga baixa, e o CFS do Linux chega a 58,7%.
- **LC mais batch.** O Skyloft iguala a latência de cauda da política centralizada original, supera o ghOSt em 19% no throughput máximo com latência de cauda no p99 33% menor, e mantém uma fatia de CPU do batch parecida com a do Linux e a do ghOSt. O Shinjuku não consegue dar nenhuma fatia à aplicação batch.
- **Memcached.** O Skyloft fica a até 2% do throughput máximo do Shenango e tem latência de cauda um pouco menor em carga baixa, já que o Shenango paga por ajustes de cores mesmo com uma só aplicação.
- **RocksDB.** Com quantum de 5 µs e meta de slowdown de 50× no p99,9, o Skyloft sustenta 1,9× a carga do Shenango. Emular o timer em um core dedicado (13 workers) perde 13% contra o timer do local APIC (14 workers).
- **Custo de preempção (ciclos, Tabela 6).** Um user IPI custa 167 para enviar, 661 para receber e 1.211 para entregar, contra 437, 1.582 e 1.345 de um IPI de kernel e 1.224, 6.359 e 5.274 de um sinal. Uma interrupção de timer de usuário custa 642 ciclos contra 5.057 do setitimer, e o SENDUIPI extra no handler soma cerca de 123.
- **Threads (ns, Tabela 7).** Para pthread, Go e Skyloft: yield 898, 108, 37, spawn 15.418, 503, 191, condvar 2.532, 262, 86, e mutex 28, 25, 27. Trocar entre aplicações leva 1.905 ns, contra 1.124 ns no Linux quando as duas threads estão prontas e 2.471 ns quando uma acorda a outra.

## Análise crítica

A seção de Discussão é aberta sobre o que está inacabado. Ela admite o seguinte.

- **Confiança e bloqueio.** Uma aplicação maliciosa poderia adulterar a runqueue compartilhada. O Intel MPK poderia protegê-la, mas a biblioteca e a aplicação dividem o espaço de endereços, então a aplicação poderia mudar as permissões com WRPKRU, o que trabalhos anteriores só tratam em parte. Um page fault ou uma chamada de sistema bloqueante trava o core sob a Single Binding Rule, e as correções (io_uring, SPDK, userfaultfd) são propostas.
- **Custos ainda pagos.** O timer é configurado pelo kernel, e trocar de aplicação suspende e acorda kernel threads, o que os autores dizem que uma operação direta no kernel poderia melhorar. Threads do Linux não gerenciadas, com afinidade de CPU manual em cores isolados, podem interferir, então eles desaconselham definir afinidade.

Os pontos a seguir são uma leitura das evidências, não afirmações do artigo.

- **O ganho de wakeup é, em boa parte, ganho de timer.** A Tabela 5 dá ao Skyloft um timer de 100.000 Hz contra no máximo 1.000 Hz no Linux, e a Figura 6 mostra a latência acompanhando a fatia de tempo. O número de 100 µs contra 10.000 µs aparece no resumo e em um gráfico, e o corpo diz apenas "significativamente menor" e "ordens de magnitude".
- **As bases diferem em kernel e época.** O Shinjuku rodou no Linux 4.4, o ghOSt no 5.11 e o Skyloft no 6.0.0, por razões que os autores dão (compatibilidade com o Dune, esforço de portar). Os ganhos de 19% e 33% sobre o ghOSt não isolam essa diferença.
- **Multiaplicação é pouco testada.** A colocalização só aparece com uma carga LC sintética e uma aplicação batch. Memcached e RocksDB rodaram sozinhos, então aplicações reais colocalizadas, mais de duas aplicações e a troca de 1.905 ns diante de um quantum de 5 µs não são medidos.
- **Pequeno e de uma única plataforma.** Um servidor Sapphire Rapids, com 4, 14 ou 20 workers. A alegação de escalabilidade sobre dispatchers se apoia em ciclos por interrupção e em um resultado em que perder um de 14 cores custa 13%, mais que os 7% de capacidade que esse core representa, o que o artigo não detalha.
- **Os rivais mais próximos são discutidos, não executados.** LibPreemptible, que os autores chamam de mais parecido em mecanismo, Concord, Caladan e Perséphone não aparecem como bases de comparação, então o "primeiro framework geral" se apoia em uma tabela de funcionalidades (Tabela 1).
- **Linhas de código enganam um pouco.** As políticas de 141 a 579 linhas ficam sobre a LibOS de 9K linhas e o módulo de kernel, enquanto o CFS do Linux e o ghOSt são subsistemas inteiros.
- **Pequenas inconsistências.** A introdução diz 1,2× sobre o Shenango no RocksDB, enquanto o resumo e a Seção 5.3 dizem 1,9×, e aqui vale o número do corpo. Ela também diz "quase 10×" para o timer, o que dá cerca de 7,9× pela Tabela 6 (5.057 sobre 642). O Skyloft é o "menor em quase todas" as operações de thread, e o mutex do Go (25 ns) o supera (27 ns).
- **Dependência fora da árvore.** Os resultados exigem Sapphire Rapids e um patch UINTR que os autores modificaram, e o esforço de portar Memcached e RocksDB não é informado.

## Pesquisas futuras

- Permitir que as aplicações reiniciem o timer sem o kernel, para o que os autores apontam os User-Timer Events dos futuros processadores da Intel.
- Proteger a runqueue compartilhada com MPK ou VMFUNC e medir o custo, e tratar page faults e I/O bloqueante sem quebrar a Single Binding Rule.
- Delegar interrupções de periféricos (I/O APIC, MSI) ao userspace para drivers sem polling, e uma troca direta de kernel threads mais barata entre aplicações.
- Uma avaliação com muitos cores e várias aplicações reais colocalizadas, contra LibPreemptible, Concord e Caladan em um mesmo kernel.
