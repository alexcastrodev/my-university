---
title: "Shenango: alcançando alta eficiência de CPU para cargas de datacenter sensíveis à latência"
summary: O Shenango realoca núcleos entre aplicações a cada 5 µs. Um núcleo dedicado, o IOKernel, vigia as filas de threads e de pacotes e concede um núcleo quando algo esperou duas verificações seguidas, enquanto runtimes por aplicação com roubo de trabalho executam os threads, de modo que o memcached mantém a latência de cauda próxima à do ZygOS e os ciclos ociosos vão para o processamento em lote.
researchArea: Sistemas operacionais
keywords: alocação de núcleos, eficiência de CPU, kernel bypass, IOKernel, roubo de trabalho, latência de cauda, threads em nível de usuário
version: 1.0
updatedAt: 2026-11-19
---

## Resumo

Aplicações de datacenter exigem dos sistemas operacionais latências de cauda em escala de microssegundos e altas taxas de requisições, e a maioria delas lida com cargas de grande variância em várias escalas de tempo. Atingir essas metas de forma eficiente em CPU é um problema em aberto. Por causa do alto custo dos kernels atuais, a melhor solução disponível para latências em microssegundos é a rede com kernel bypass, que dedica núcleos de CPU às aplicações para fazer spin-polling da placa de rede. Mas essa abordagem desperdiça CPU: mesmo com cargas médias modestas, é preciso dedicar núcleos suficientes para o pico esperado. O Shenango alcança latências comparáveis com uma eficiência de CPU muito maior. Ele realoca núcleos entre aplicações em granularidade muito fina, a cada 5 µs, permitindo que ciclos não usados por aplicações sensíveis à latência sejam aproveitados por aplicações de processamento em lote. Isso é possível graças a (1) um algoritmo eficiente que detecta quando as aplicações se beneficiariam de mais núcleos e (2) um componente privilegiado, o IOKernel, que roda em um núcleo dedicado, direciona pacotes da placa de rede e orquestra as realocações. Com aplicações sensíveis à latência como o memcached, observamos que o Shenango atinge latência de cauda e vazão comparáveis às do ZygOS, uma pilha de rede com kernel bypass de ponta, mas consegue trocar linearmente vazão da aplicação sensível à latência por vazão da aplicação em lote, aumentando enormemente a eficiência de CPU.

## Visão geral

Uma requisição a um serviço de datacenter se espalha por muitos outros, então a latência de cauda (o percentil 99,9) precisa ficar em escala de microssegundos mesmo para requisições que gastam poucos microssegundos de CPU. O Linux só consegue isso quando a maioria dos núcleos fica ociosa. Pilhas com kernel bypass como o [IX](/papers/ix-protected-dataplane-operating-system) e o [Arrakis](/papers/arrakis-operating-system-is-the-control-plane) evitam o escalonador do kernel, mas fazem spin-polling da placa de rede, então um núcleo entregue a uma aplicação fica ocupado mesmo sem pacotes. Os autores lembram que o Linux rebalanceia a cada cerca de 4 ms e que Arachne e IX ajustam núcleos a cada 50 a 100 ms.

Este artigo do NSDI 2019, do MIT CSAIL, ataca a peça que faltava: mover núcleos entre aplicações no ritmo da própria carga, que pode mudar em microssegundos (o artigo cita threads do Bing ficando executáveis, 15 de uma vez, em 5 µs). Ele parte da ideia de dois níveis das [scheduler activations](/papers/scheduler-activations-user-level-management-of-parallelism), com um alocador de núcleos por cima e um escalonador de threads dentro de cada aplicação, e liga o alocador ao caminho da rede.

Convém saber antes: RSS (a placa distribui fluxos por hash em filas por núcleo), spin-polling e a diferença entre eficiência de CPU (ciclos gastos em trabalho da aplicação) e utilização de CPU (ciclos não ociosos).

## Contribuição

- **Detecção de congestionamento a cada 5 µs.** O IOKernel olha as filas de execução de threads e as filas de entrada de pacotes de cada runtime. Se algum item já estava na fila na verificação anterior, o runtime está "congestionado" e ganha mais um núcleo. Os autores preferem a duração da espera ao tamanho da fila, porque o tamanho exige um limiar ajustado por tipo de requisição. Um pacote para um runtime sem núcleos ganha um na hora.
- **O IOKernel.** Um processo privilegiado em um núcleo dedicado que gira sem parar. Ele consulta a placa (via DPDK), direciona cada pacote a um núcleo do runtime dono, consulta só as filas de saída dos núcleos ativos e escolhe qual núcleo conceder: primeiro o hyperthread irmão, depois o último núcleo que a aplicação usou, depois qualquer núcleo ocioso.
- **Runtime por aplicação.** Ligado ao processo, não confiável, com uthreads em filas por núcleo, roubo de trabalho, execução até o fim, sockets TCP e UDP bloqueantes, mutexes e RCU. Os núcleos são garantidos ou de rajada. Um kthread sem trabalho se estaciona e devolve o núcleo. O processamento de pacotes, TCP incluído, pode ser roubado entre núcleos, o que quebra o hash consistente de fluxos e é pago com ressequenciamento.
- **Implementação em Linux comum.** 2.244 linhas no IOKernel, 6.155 no runtime e 4.762 de bibliotecas compartilhadas, em C com bindings para C++ e Rust. A preempção usa SIGUSR1, o estacionamento usa eventfd e o TCP foi escrito do zero (controle de fluxo e retransmissão rápida, sem controle de congestionamento).

## Metodologia

Duas análises e uma bancada. Um simulador (M/M/n/FCFS, chegadas de Poisson, serviço exponencial de média 10 µs, limite de 100 µs no percentil 99,9) limita a eficiência de qualquer alocador que ajuste uma vez por milissegundo. A avaliação usa um servidor com Xeon E5-2650v4 de 12 núcleos (só o primeiro socket, hyperthreads ligados, TurboBoost e C-states desligados, placa de 10 Gbit/s) e seis máquinas clientes gerando carga de Poisson em malha aberta. Tudo fica confinado a 16 hyperthreads, e o IOKernel toma dois. As bases de comparação são Linux, Arachne e ZygOS. As cargas são o memcached (mix USR: 99,8% de GET), um spin-server com tempos de serviço constante, exponencial e bimodal e o servidor DNS gdnsd, cada um ao lado do job em lote swaptions do PARSEC. Microbenchmarks cobrem threads, balanceamento de pacotes e o intervalo de alocação.

## Resultados

São resultados reportados pelos autores, tirados do texto, salvo quando marcados como lidos em gráfico.

- **Memcached.** Mais de 5 milhões de requisições/s com mediana de 37 µs e percentil 99,9 de 93 µs. O ZygOS mantém latência parecida só até cerca de 4 milhões, embora escale a uma vazão maior com alto custo de latência, porque o IOKernel do Shenango é o gargalo com serviço abaixo de cerca de 2 µs. A vazão do lote cai linearmente conforme a carga do memcached sobe, enquanto o ZygOS não rende nada de lote.
- **Linux e Arachne.** Com 0,4 milhão de requisições/s, o Linux tem 83 µs no percentil 99,9 sozinho e mais de 2 ms com trabalho em lote. O Arachne fica abaixo de 200 µs com lote.
- **Rajadas.** A carga saltando de 100 mil para 5 milhões de requisições/s quase não acrescenta latência de cauda (abaixo de 125 µs, segundo a introdução). O Arachne pode levar mais de 500 ms para adicionar núcleos e mostra milissegundos de latência de cauda.
- **Simulação.** Com 5 µs, a eficiência do Shenango supera o limite superior de 1 ms, conforme o texto e a Figura 1.
- **DNS.** O gdnsd chega a 5,7 milhões de requisições/s com 73 µs no percentil 99,9, 6,33 vezes os 900 mil do Linux.
- **Mecanismos.** Uma realocação de núcleo leva 5,9 µs e menos de 2 µs de tempo do IOKernel. Custo por operação em ns (Shenango contra Go): mutex 37 contra 24, yield 52 contra 109, condvar 100 contra 281, spawn-join 148 contra 462. Menos de 3% dos pacotes chegam fora de ordem com 24 conexões. Intervalos maiores custam pelo menos 150 µs de latência de cauda, contra até 6% menos trabalho em lote com 5 µs.
- **Taxa de pacotes.** O IOKernel trata até 6,5 milhões de pacotes/s, o bastante para uma placa de 10 Gbit/s com pacotes de 114 bytes.

## Análise crítica

O que o artigo admite: o IOKernel é um núcleo dedicado (dois hyperthreads aqui) e um gargalo para requisições muito curtas; não foi avaliado em máquinas NUMA com vários sockets; um kthread que ignora o sinal de preempção ainda não tem mitigação; os buffers de entrada ficam em uma única região compartilhada somente leitura; o zero-copy foi abandonado; e a preempção dentro da aplicação, como no [Shinjuku](/papers/shinjuku-preemptive-scheduling-for-usecond-scale-tail-latency), fica para trabalho futuro.

Os pontos a seguir são uma leitura das evidências, não afirmações do artigo.

- **O escalonamento é por máquina.** O IOKernel decide só entre as aplicações de um servidor. Nada sobre posicionamento entre máquinas, e nenhum resultado em nível de cluster.
- **Escopo da avaliação.** Os testes usam uma aplicação sensível à latência por vez ao lado de um único job em lote (swaptions, limitado por CPU), placa de 10 Gbit/s e mitigações do Meltdown desligadas. O artigo não mostra duas aplicações sensíveis à latência disputando núcleos, e a interferência de cache e de banda de memória não é medida.
- **Bases de comparação.** O ZygOS rodou em um kernel mais antigo por ser instável nos recentes, e o Linux foi ajustado pelos próprios autores, um limite normal desse tipo de comparação.
- **Custo do núcleo dedicado.** Em 16 hyperthreads, dois (12,5%, conta minha) vão para o IOKernel. O artigo mostra o Linux na frente em vazão de lote nas cargas mais baixas por causa disso.

Literatura posterior, marcada como tal. As análises de [Skyloft](/papers/skyloft-general-scheduling-framework-in-user-space) e [Concord](/papers/concord-microsecond-scale-tail-latency-with-approximate-optimal-scheduling) neste catálogo dizem, respectivamente, que o Shenango realoca núcleos rápido mas não tem preempção dentro da aplicação, e que Shenango e Caladan são sistemas de fila lógica única aos quais o Concord só planeja se estender. O [Orthrus](/papers/orthrus-detecting-silent-user-data-corruption-in-the-cloud) roda seus validadores em threads de usuário do Shenango, segundo a análise daqui. Do Caladan (Fried, Ruan, Ousterhout e Belay, OSDI 2020) li apenas o resumo na página do USENIX, não o texto: ele descreve um núcleo escalonador que gerencia a contenção na hierarquia de memória e entre hyperthreads, e relata reduzir a latência de cauda de 580 ms para 52 µs contra o Parties.

## Pesquisas futuras

- Escalar o IOKernel: um por socket, ou offloads na placa que exponham o acúmulo de filas, como sugerem os autores.
- Preempção e armazenamento local de thread dentro do runtime para cargas de cauda pesada, que os autores deixam em aberto.
- Comparar a alegação de eficiência com as abordagens dentro do kernel e no estilo ghOSt ([ghOSt](/papers/ghost-user-space-delegation-of-linux-scheduling), [Rakaia](/papers/rakaia-in-kernel-scheduling-for-tcp-rpcs)): elas chegam a latência parecida sem um núcleo em spin?
- Segurança e contabilização em nível de pacote, que o artigo presume tratadas fora de banda.
