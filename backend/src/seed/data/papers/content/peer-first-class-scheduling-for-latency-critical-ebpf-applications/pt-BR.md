---
title: "PeeR: escalonamento de primeira classe para aplicações eBPF críticas em latência"
summary: O PeeR torna preemptíveis, e visíveis ao escalonador do Linux, os programas eBPF do caminho rápido de pacotes, fazendo-os ceder a CPU nas chamadas de helper e deixando o sched_ext decidir quanta CPU eles recebem e em que ordem retomam.
researchArea: Sistemas operacionais
keywords: ebpf, escalonamento, sched_ext, preempção, latência de cauda, xdp, kernel do linux
version: 1.0
updatedAt: 2026-11-07
---

## Visão geral

O eBPF permite que aplicações como key-value stores, balanceadores de carga e sistemas transacionais rodem dentro do kernel, em hooks como o XDP, que disparam em contexto de softirq logo após um evento de I/O. Esse contexto foi pensado para filtros de pacotes minúsculos: cada invocação roda até o fim, na ordem de chegada, não pode ser preemptada e tem seu tempo de CPU cobrado do processo de usuário que a interrupção por acaso atingiu, então o escalonador nunca a enxerga.

Este artigo do OSDI 2026 (20º USENIX Symposium, Seattle, julho de 2026), do MIT CSAIL e da Tufts University, argumenta que essa suposição de caminho rápido, a de que o trabalho em eBPF é curto e uniforme, não vale mais, porque os programas modernos são grandes e dependem dos dados. Ele apresenta o PeeR, um runtime que transforma cada invocação eBPF em uma tarefa escalonável sem alterar os programas, de modo que um scan longo não bloqueie mais uma consulta curta e uma aplicação eBPF não consiga mais deixar um job colocalizado sem CPU.

Termos para não confundir: uma chamada de helper (ou kfunc) é como um programa eBPF conversa com o kernel, o verifier é o verificador estático que prova a segurança dos programas antes de carregá-los, o sched_ext é a classe de escalonamento extensível do Linux, cujas políticas são escritas em eBPF, e uma PeeR-kthread é a thread de trabalho por CPU em que os programas que cederam a CPU são retomados.

Vale conhecer antes: como funcionam o verifier e o compilador JIT do eBPF, o que são XDP e softirq, e o [ghOSt](/papers/ghost-user-space-delegation-of-linux-scheduling), que delega o escalonamento de threads ao espaço do usuário mas, como os autores do PeeR observam sobre esse tipo de framework, não escalona a execução eBPF dentro do kernel.

## Contribuição

- **Uma medição da suposição quebrada.** Os autores analisam sete aplicações eBPF (Katran, Cilium, BMC Memcached, Redis-KFlex, DINT, eTran, XRP RocksDB). O maior programa do Cilium tem 7.622 instruções e 233 chamadas de helper, e os tempos de execução p50 e p99 de um mesmo programa chegam a diferir em 500×.
- **Preempção cooperativa nas chamadas de helper.** O JIT insere uma verificação de orçamento (budget) antes de cada chamada de helper ou kfunc, onde o verifier já garante um estado limpo. Nada é interrompido no meio de uma instrução, e a verificação é barata quando não dispara.
- **Um modelo híbrido de softirq e threads de trabalho.** As tarefas dentro do orçamento rodam em softirq, na ordem de chegada. Uma tarefa que estoura o orçamento salva seu estado (uma pilha de 512 bytes, 11 registradores e o contexto do hook) em um buffer de continuação e é retomada depois em uma PeeR-kthread. No XDP, o pacote é mantido como um `xdp_frame` e o driver recebe `XDP_YIELD`, que ele trata como pacote consumido.
- **Retomada segura.** Os ponteiros do estado salvo são rebaseados com a informação de tipos do verifier (`PTR_TO_CTX` e `PTR_TO_STACK`), o controle volta por trampolins que satisfazem o CFI, e o PeeR nunca cede a CPU enquanto há um ponteiro protegido por RCU vivo ou um spin lock retido.
- **Escalonamento em dois níveis.** O sched_ext é o macro-escalonador, que trabalha em granularidade de milissegundos sobre a CPU agregada de cada aplicação, alimentado por um ring buffer `runtime_event` por CPU e por um quantum `set_budget` (5 µs por padrão na avaliação). Dentro de cada PeeR-kthread, um micro-escalonador ordena as continuações por callbacks `enqueue` e `requeue`, FIFO por padrão, com o shortest-remaining-processing-time (SRPT) como política de exemplo.
- **Uma auditoria de hooks.** Uma tabela de projeto classifica os hooks: o XDP nativo e o tc/TCX em direct-action se encaixam no modelo, enquanto act_bpf, tracing e LSM não. Só o XDP nativo está implementado.

## Metodologia

O PeeR é implementado no Linux 6.16 com cerca de 5000 linhas de C, e seu escalonador estende o scx_layered, da Meta. Os experimentos usam dois servidores com CPUs Xeon Gold 5420+ de 28 núcleos e 256 GB de RAM, ligados por NICs ConnectX-7 de 400 Gbps por meio de um switch Tofino 2, com um gerador de carga open-loop de chegadas Poisson e flow steering da NIC espalhando a carga entre os núcleos. O Redis-KFlex roda uma pilha TCP leve dentro do XDP.

As bases de comparação são o eBPF padrão, o KeyDB e o Memcached em espaço de usuário, o BMC e uma variante de adiamento por cpumap, que testa se a própria aplicação consegue resolver o bloqueio head-of-line. As cargas são uma mistura bimodal de Redis (99,5% de GET de 0,2 µs e 0,5% de SCAN de 200 µs), uma mistura 50/50 de Memcached (0,2 µs e 30 µs), uma mistura TPC-C emulada por um servidor de eco em XDP que gira por durações de perfis de transação, a colocalização com um job batch limitado por CPU e microbenchmarks de overhead e de tamanho do orçamento.

## Resultados

Estes são os resultados relatados pelos autores, comparados com o runtime eBPF padrão, salvo indicação em contrário.

- **Resultado de destaque.** O p99 das requisições sensíveis à latência cai de 3× a 19,8×, sem deixar requisições longas da mesma aplicação sem CPU.
- **Redis-KFlex.** O p99 do GET é 19,8× menor, o throughput é 3,77× o do KeyDB em espaço de usuário e 10,3% acima do eBPF padrão (a fila de recepção drenada significa menos descartes), e abaixo de 1000 krps a latência do SCAN também melhora.
- **Memcached.** O p99 do GET é 4,5× menor, e o KFlex com ou sem PeeR tem 3,46× o throughput do servidor em espaço de usuário, embora o throughput do PeeR fique um pouco abaixo do eBPF padrão.
- **Adiamento por cpumap.** Com 1,5 Mrps, o p99 do GET é de 403 µs, contra 581 µs do eBPF padrão e 31 µs do PeeR. Perto da saturação, o p99 do SCAN chega a 350 ms, contra 4 ms do PeeR.
- **Políticas no TPC-C.** FIFO com preempção supera a base de comparação, o SRPT reduz a latência média em 3× com 300 krps, e o round-robin ponderado é uma escolha prática quando o tempo de execução é desconhecido.
- **Colocalização.** Sem o PeeR, o job batch ao lado do BMC (sob uma política de divisão justa 50/50) cai para 30,9% de sua parte justa em throughput, e ao lado do Memcached sua CPU colapsa para 7%. Com o PeeR ele mantém sua parte, e uma meta do Redis-KFlex variada de 0% a 75% é acompanhada com erro de até 6%.
- **Overhead.** Um ciclo de preempção e retomada custa 247 ns (77 ns para preemptar, 170 ns para retomar), e a verificação sempre ativa soma um ciclo por chamada de helper, dois enquanto o escalonador escreve a flag.
- **Tamanho do orçamento.** O efeito tem forma de U. Para requisições de 5 µs, um orçamento de 500 ns satura em 275 krps, enquanto 10 µs iguala os 330 krps sem preempção. Em uma mistura bimodal, o p99 das requisições curtas chega ao mínimo de 31 µs com orçamento de 2 µs e sobe a 565 µs com 200 µs.

## Análise crítica

A ideia central se encaixa bem: as fronteiras de helper do verifier são justamente onde a preempção é segura. O artigo admite vários limites.

- **Um só hook está implementado.** Só existe o XDP nativo. Os casos de tc/TCX e XRP são defendidos por auditoria (os autores afirmam que não implementaram o adaptador do XRP), e LWT e netfilter ficam como trabalho futuro.
- **A granularidade depende da densidade de helpers.** A preempção só acontece em chamadas de helper, e as maiores lacunas são de 484 instruções no Katran e 286 no eTran. O scan de blocos do XRP executa um laço de cerca de 100 instruções até 2.000 vezes sem nenhuma chamada de helper. Um programa que mantém um ponteiro RCU vivo através de um helper também abre mão desse ponto de cessão, o que o RCU sleepable poderia eliminar.
- **A semântica muda.** As invocações agora podem se intercalar, então programas que assumiam acesso atômico ao estado compartilhado ou ordem de conclusão por núcleo precisam sincronizar explicitamente.
- **A cauda profunda paga a conta.** O p99.9 do SCAN é 2,3× o da base de comparação perto da saturação (5952 µs contra 2562 µs com 3,1 Mrps), e o p99.9 do StockLevel é de 1,5× a 1,7× maior. O melhor orçamento depende da carga, e as tarefas nunca migram entre CPUs.

Os pontos a seguir são uma leitura das evidências, não afirmações do artigo.

- **As razões de destaque são pontos únicos.** O 19,8× é informado sem a carga em que foi tomado, e o p99 do eBPF padrão cresce com a carga (Figura 1), então a razão depende do ponto de operação. O texto não liga o extremo inferior da faixa de 3× a 19,8× a nenhum experimento nomeado: as razões declaradas são 19,8×, 4,5× e 3× na latência média do TPC-C com SRPT.
- **As cargas são sintéticas ou emuladas.** O TPC-C é um servidor de eco que gira por durações tiradas de medições anteriores, e as misturas bimodais têm duas classes de requisição. Katran, Cilium, DINT, eTran e XRP são caracterizados na Tabela 1, mas não fazem parte da avaliação.
- **O SRPT depende de uma boa estimativa.** A política de exemplo usa uma estimativa de trabalho restante fornecida pela aplicação, e o artigo não testa estimativas erradas. O round-robin ponderado é oferecido como alternativa.
- **A colocalização é estreita.** Cada experimento junta uma aplicação eBPF a um job batch. Duas aplicações eBPF competindo, ou carga desbalanceada entre núcleos quando as tarefas não podem migrar, não são mostradas.
- **O overhead é uma média.** Os 247 ns vêm de um servidor de eco preemptado uma vez por pacote, com média de mais de um milhão de medições, sem distribuição informada.
- **A cooperação tem um teto.** O verifier limita os laços, então um laço longo sem helpers termina, mas o artigo não mede por quanto tempo um programa assim pode segurar um núcleo.

## Pesquisas futuras

- O RCU sleepable, para remover a regra contra ceder a CPU com ponteiros RCU vivos, como o artigo propõe.
- Mais hooks: os adaptadores de tc e XRP, LWT e netfilter, e programas limitados por I/O que suspendem no meio da execução enquanto esperam o disco, o que, segundo a discussão, poderia trazer o serviço de arquivos para dentro do kernel.
- Escolher o orçamento automaticamente, já que a curva em U coloca o melhor valor em 2 µs para uma carga e o padrão é 5 µs.
- eBPF multi-tenant: várias aplicações eBPF competindo, migração entre CPUs das continuações e SRPT sob estimativas ruidosas.
