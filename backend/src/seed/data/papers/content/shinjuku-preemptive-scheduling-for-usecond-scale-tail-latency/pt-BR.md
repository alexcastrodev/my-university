---
title: "Shinjuku: escalonamento preemptivo para latência de cauda em escala de microssegundos"
summary: O Shinjuku é um sistema operacional de espaço de endereçamento único que usa hardware de virtualização (interrupções postadas sob o Dune) para preemptar requisições a cada 5 a 15 µs a partir de um despachante centralizado, de modo que requisições curtas deixam de ficar atrás de longas, com até 6,6x a vazão e 88% menos latência de cauda que o ZygOS no RocksDB.
researchArea: Sistemas operacionais
keywords: latência de cauda, escalonamento preemptivo, despachante centralizado, Dune, interrupções postadas, escalonamento de requisições, SO de dataplane
version: 1.0
updatedAt: 2026-11-19
---

## Resumo

Os dataplanes propostos recentemente para aplicações em escala de microssegundos, como IX e ZygOS, usam políticas não preemptivas para escalonar requisições nos cores. Em muitos cenários reais, em que os tempos de serviço seguem distribuições de alta dispersão ou de cauda pesada, eles deixam requisições curtas bloqueadas atrás de requisições longas, o que leva a uma latência de cauda ruim. O Shinjuku é um sistema operacional de espaço de endereçamento único que usa suporte de hardware à virtualização para tornar a preempção prática em escala de microssegundos. Isso permite ao Shinjuku implementar políticas de escalonamento centralizadas que preemptam requisições com a frequência de a cada 5 µs e funcionam bem tanto para distribuições de tempo de serviço de cauda leve quanto pesada. Demonstramos que o Shinjuku traz ganhos significativos de latência de cauda e de vazão sobre IX e ZygOS em uma ampla gama de cenários de carga. No caso de um servidor RocksDB que processa consultas pontuais e de intervalo, o Shinjuku chega a 6,6x mais vazão e 88% menos latência de cauda.

## Visão geral

Uma requisição de usuário se espalha por muitos servidores, então o mais lento define o tempo de resposta, e cada serviço precisa de latência de cauda de dezenas a poucas centenas de microssegundos. Dataplanes com kernel bypass chegam lá com RSS, que distribui fluxos em filas por core atendidas por ordem de chegada e sem interrupção (d-FCFS). O [IX](/papers/ix-protected-dataplane-operating-system) é o caso canônico, e o ZygOS acrescenta roubo de trabalho para aproximar uma fila compartilhada (c-FCFS). Ambos são não preemptivos: quando os tempos de serviço têm alta dispersão (bimodal, log-normal, Zipf, Pareto), uma requisição curta presa atrás de uma longa herda o atraso dela. A teoria de filas diz que o compartilhamento de processador (PS) serve a essas cargas, e o PS exige preempção, que o Linux só oferece em escala de milissegundos (CFS com alvo de 6 ms e mínimo de 0,75 ms).

Este artigo do NSDI 2019, de Stanford e MIT, torna a preempção barata o bastante para ser usada a cada poucos microssegundos. Ele pertence à linha iniciada pelo [Exokernel](/papers/exokernel-os-architecture-application-level-resource-management) e seguida por [Arrakis](/papers/arrakis-operating-system-is-the-control-plane) e IX, e ecoa a lição do [receive livelock](/papers/eliminating-receive-livelock-in-an-interrupt-driven-kernel). Escalonadores posteriores comparam-se ao Shinjuku ou o reimplementam: [Skyloft](/papers/skyloft-general-scheduling-framework-in-user-space), [Concord](/papers/concord-microsecond-scale-tail-latency-with-approximate-optimal-scheduling) e [ghOSt](/papers/ghost-user-space-delegation-of-linux-scheduling) (que traz uma política no estilo Shinjuku), e o [Rakaia](/papers/rakaia-in-kernel-scheduling-for-tcp-rpcs) ataca o mesmo bloqueio de cabeça de fila dentro do kernel.

Convém saber antes: RSS, a diferença entre d-FCFS, c-FCFS e PS, e o que é um processo Dune (um processo Linux rodando em modo VMX não-root, com acesso direto a recursos privilegiados da CPU).

## Contribuição

- **Preempção barata.** O despachante envia uma interrupção entre processadores (IPI) sem VM exit, mapeando o APIC real e os descritores de interrupção postada dos workers no espaço físico do convidado via EPT. O worker recebe a interrupção como postada, também sem exit. A Tabela 1 dá 298 ciclos no emissor e 1.212 no receptor (1.993 no total), contra 2.084 e 2.523 (4.950) de um sinal do Linux. Os autores dizem que isso mantém a preempção de 5 µs abaixo de 10% da vazão dos workers.
- **Troca de contexto barata.** Um ucontext modificado dispensa a máscara de sinais (uma chamada de sistema que custa um VM exit no Dune) e o salvamento ou restauração de ponto flutuante desnecessário, levando a troca a 36 a 109 ciclos (o swapcontext custa 2.290 no Dune).
- **Um despachante centralizado.** A rede (uma hyperthread, baseada no IX) entrega as requisições a um despachante que as enfileira e escalona nos workers. Uma requisição preemptada volta ao despachante com o seu contexto. As threads conversam por pares de linhas de cache (211 ciclos de ida e volta), e um despachante pode, em teoria, tratar 28 MRPS. Vários despachantes escalam mais, com o RSS direcionando requisições entre eles.
- **Duas políticas.** Fila única (SQ): uma fila FCFS, preempta o que passar de um quantum de 5 a 15 µs e põe no fim (aproxima PS) ou no início (aproxima c-FCFS). Múltiplas filas (MQ): uma fila por tipo de requisição, cada uma com seu SLO, escolhida pela maior razão entre tempo de fila e SLO (inspirada no BVT), o que exige que o estágio de rede identifique os tipos.

## Metodologia

A Seção 2 usa um simulador de eventos discretos de 16 cores, sem custos, para comparar d-FCFS, c-FCFS, PS e as políticas preemptivas. A avaliação usa um servidor (dois E5-2658 a 2,3 GHz, 128 GB, uma Intel 82599ES de 10 GbE, Linux 4.4) e seis clientes ligados por um switch Arista, com gerador de carga de malha aberta e 1.920 conexões. IX e ZygOS aceitam no máximo 16 filas RSS, então a maioria das execuções usa 16 hyperthreads: o Shinjuku(16) gasta duas com rede e despachante e 14 com workers. O IX roda sobre UDP com lote de 64 e o ZygOS sobre TCP, com um segmento por requisição. As cargas são um servidor sintético com tempos de serviço controláveis e o RocksDB 5.13 em memória (GET em cerca de 6 µs, SCAN de 1.000 ou 5.000 chaves em 240 ou 1.200 µs), com fatia de 15 µs. O Shinjuku tem cerca de 1.365 SLOC de mudanças no Dune e 2.535 de despachante e workers.

## Resultados

Todos os números são dos autores, como estão no texto; onde só o gráfico traz o valor, marca-se "leitura de gráfico".

- **Caudas leves.** Em Fixed(1) e Exp(1), o Shinjuku(SQ) fica perto do IX e supera o ZygOS, que rouba trabalho em 60% dos casos mesmo em cargas homogêneas. Leitura de gráfico: o Shinjuku satura perto de 4,3 MRPS e o IX perto de 5.
- **Bimodal(99,5% a 0,5 µs, 0,5% a 500 µs).** Até 50% menos latência de cauda com carga baixa e 5x a vazão para uma meta de 300 µs. Leitura de gráfico: IX e ZygOS saturam abaixo de 1 MRPS e o Shinjuku perto de 4,3.
- **Vários tipos (MQ).** Em Bimodal(50-1, 50-100) e Trimodal, 94% menos slowdown no percentil 99 com carga baixa e mais de 2x a vazão. Leitura de gráfico: cerca de 260 kRPS contra cerca de 80 do IX no caso bimodal.
- **Intervalo de preempção.** Em Bimodal(50-1, 50-100), fatias menores são melhores, e 5 µs funciona bem (leitura de gráfico: cerca de 230 kRPS antes de o slowdown subir, contra cerca de 120 com 100 µs).
- **Escala.** Um despachante escala quase linearmente até 11 workers e escalona 5M RPS, dois escalonam 9,5M RPS em 22 workers, e uma NIC de 40 GbE satura com respostas de 258 bytes.
- **RocksDB.** Com 99,5% GET e 0,5% SCAN(1000), o Shinjuku melhora 88% a latência de cauda e 6,6x a vazão em relação ao ZygOS, e o IX é pior. O texto não dá o ponto de carga do 88%. Leitura de gráfico: o GET fica perto de 40 µs até cerca de 550 kRPS.
- **A preempção importa.** Com 50% GET e 50% SCAN(5000), a SQ sem preempção favorece os SCANs sobre os GETs, a SQ corrige isso, a MQ ainda ajuda os SCANs, e o ZygOS vai pior que o Shinjuku sem preempção. O IX foi omitido por sair do gráfico.
- **Conexões.** O RSS precisa de cerca de 16.000 conexões para menos de 10% de desbalanceamento em 24 hyperthreads (Monte Carlo), enquanto 300 bastam para dois despachantes.

## Análise crítica

O que o artigo não afirma nem mede:

- **Sem o preço do Dune.** Exige VT-x, mudanças no Dune e, na avaliação, Linux 4.4. As aplicações rodaram em VMX não-root anel 0, então runtime e aplicação precisam confiar um no outro, e mapear o APIC deixa um processo inundar o core de outro com interrupções. A ida e volta anel 3 a anel 0 foi medida em 84 ciclos, mas rodar aplicações no anel 3 é trabalho futuro.
- **Cores dedicados e em polling.** Duas de 16 hyperthreads vão para rede e despachante, e os workers são fixados. Não há medida de eficiência de CPU, energia ou cores perdidos em cargas leves. Ajustar o número de workers ao longo do tempo fica para uma integração futura com o Shenango.
- **Uma aplicação por instância.** O texto diz que cada aplicação sensível a latência ganha sua própria instância do Shinjuku, mas nunca avalia várias instâncias, convivência com trabalho em lote nem compartilhamento de cores.
- **Avaliação estreita.** Um servidor, enlace de 10 GbE, RocksDB em memória (tmpfs, tabelas mapeadas em memória), sem flash, só o percentil 99. O Shinjuku tem 14 workers contra 16 dos rivais, e os transportes diferem (UDP contra TCP). Quanta e SLOs são ajustados à mão, e inferir a distribuição de tempos de serviço online é trabalho futuro.
- **Cooperação da aplicação.** Código não thread-safe roda com interrupções desligadas (`call safe(fn)`), e as funções de alocação também, então alocações longas pioram a cauda. Grandes pegadas de memória tornam a preempção cara, o que fica para políticas futuras sensíveis à localidade.
- **Pequenas inconsistências.** A introdução diz que o Shinjuku iguala IX e ZygOS em caudas leves, enquanto a Seção 4.2 diz perto do IX e melhor que o ZygOS. A alegação de 10% de custo usa 2 GHz no texto, mas o testbed roda a 2,3 GHz. Dividir 1.212 ciclos por uma fatia de 5 µs a 2 GHz (conta minha) dá cerca de 12% antes da troca de contexto.

Literatura posterior, lida nas análises deste catálogo e não nos artigos originais: o Concord relata que a preempção do Shinjuku custa cerca de 20% da vazão com quantum de 5 µs e 50% com 2 µs, e que seus truques de virtualização excluem VMs de nuvem pública. O Skyloft diz que o Shinjuku não consegue dar nenhuma fatia de CPU a uma aplicação em lote. Shenango e Caladan estão na fila, mas não no catálogo, e não os li.

## Pesquisas futuras

- Preempção sem hardware de virtualização: pontos de yield inseridos pelo compilador ([Concord](/papers/concord-microsecond-scale-tail-latency-with-approximate-optimal-scheduling)) ou interrupções de usuário ([Skyloft](/papers/skyloft-general-scheduling-framework-in-user-space)).
- Realocação de cores entre aplicações sensíveis a latência e aplicações em lote, que os autores adiam.
- Escolha dinâmica de política e quantum a partir de perfis de tempo de serviço ao vivo, e políticas sensíveis à localidade.
- Troca de mensagens em hardware entre cores para escalar o despachante, e interrupções leves em nível de usuário.
