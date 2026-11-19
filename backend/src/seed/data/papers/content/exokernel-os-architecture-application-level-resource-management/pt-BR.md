---
title: "Exokernel: uma arquitetura de sistema operacional para a gerência de recursos no nível da aplicação"
summary: Engler, Kaashoek e O'Toole defendem que o kernel deve apenas proteger os recursos de hardware, não gerenciá-los, e constroem o exokernel Aegis e o sistema operacional de biblioteca ExOS em DECstations MIPS para mostrar que memória virtual, IPC e escalonamento podem viver em bibliotecas de aplicação sem confiança, com custo muito menor que no Ultrix.
researchArea: Sistemas operacionais
keywords: exokernel, sistema operacional de biblioteca, secure binding, revogação visível, proteção versus gerência, gerência de recursos no nível da aplicação, Aegis, ExOS
version: 1.0
updatedAt: 2026-11-19
---

## Resumo

Os sistemas operacionais tradicionais limitam o desempenho, a flexibilidade e a funcionalidade das aplicações ao fixar a interface e a implementação de abstrações como comunicação entre processos e memória virtual. A arquitetura de sistema operacional exokernel enfrenta esse problema oferecendo gerência de recursos físicos no nível da aplicação. Nela, um kernel pequeno exporta com segurança todos os recursos de hardware, por uma interface de baixo nível, a sistemas operacionais de biblioteca sem confiança. Esses sistemas operacionais de biblioteca usam a interface para implementar objetos e políticas do sistema. Essa separação entre proteção e gerência de recursos permite personalizar abstrações tradicionais por aplicação, estendendo, especializando ou até substituindo bibliotecas.

Os autores implementaram um protótipo de sistema operacional exokernel. As medições mostram que a maioria das operações primitivas do kernel (como tratamento de exceções e transferência de controle protegida) é de dez a 100 vezes mais rápida que no Ultrix, um sistema UNIX monolítico maduro. Além disso, demonstram que um exokernel permite às aplicações controlar recursos da máquina de formas impossíveis nos sistemas tradicionais. Por exemplo, as abstrações de memória virtual e de comunicação entre processos são implementadas inteiramente numa biblioteca no nível da aplicação. As medições mostram que as primitivas de memória virtual e de comunicação entre processos no nível da aplicação são de cinco a 40 vezes mais rápidas que as primitivas de kernel do Ultrix. Em comparação com implementações de ponta da literatura, o protótipo é pelo menos cinco vezes mais rápido em operações como despacho de exceções e comunicação entre processos.

## Visão geral

Este é o artigo do MIT Laboratory for Computer Science que deu nome ao exokernel, apresentado no SOSP '95 (Copper Mountain, Colorado, dezembro de 1995). Ele faz parte de uma longa linha de trabalhos sobre onde traçar a fronteira entre sistema operacional e aplicação: [O sistema de tempo compartilhado UNIX](/papers/unix-time-sharing-system) fixou um pequeno conjunto de abstrações de alto nível (arquivos, processos, pipes) que todo programa usa, e [A proteção da informação em sistemas de computação](/papers/protection-of-information-in-computer-systems) forneceu o vocabulário de proteção (capabilities, descritores, privilégio mínimo) em que os secure bindings se apoiam, embora este artigo não o cite como fonte. Os autores também invocam o argumento fim a fim, uma linha de raciocínio que aparece em [Dicas para o projeto de sistemas computacionais](/papers/hints-for-computer-system-design): a aplicação sabe melhor que o SO qual é o objetivo da sua gerência de recursos.

A tese é que as abstrações do sistema operacional (memória virtual, IPC, arquivos, processos) são gerais demais, prejudicam aplicações que precisam de outra coisa e não podem ser alteradas por código sem confiança, estejam elas no kernel ou em servidores de usuário confiáveis, como nos microkernels. O remédio é movê-las para bibliotecas ligadas a cada aplicação.

Vale conhecer antes: o que é uma TLB e como funciona o reabastecimento de uma TLB gerenciada por software no MIPS, o que são chamada de sistema e domínio de proteção, e o que são kernel monolítico e microkernel.

## Contribuição

- **Separar proteção de gerência.** O exokernel apenas controla a propriedade dos recursos, vigia cada uso ou ponto de ligação e revoga o acesso. A política, como qual página despejar, fica com o sistema operacional de biblioteca. Os recursos são exportados como o hardware os apresenta (páginas físicas, entradas da TLB, fatias de tempo, filtros de pacotes), não emulados.
- **Secure bindings.** A autorização é feita uma vez, na hora da ligação, e os acessos seguintes são verificados por operações simples. O artigo os implementa de três formas: mecanismos de hardware (uma entrada da TLB, capabilities de memória), cache em software (uma TLB em software) e código carregado no kernel (filtros de pacotes e tratadores seguros específicos da aplicação).
- **Revogação visível de recursos.** O kernel avisa o SO de biblioteca quando retoma um recurso, de modo que a biblioteca escolhe qual instância devolver e atualiza seus próprios nomes físicos.
- **Um protocolo de aborto.** Se o SO de biblioteca não responde rápido à revogação, o kernel rompe as ligações à força e registra isso num vetor de reapropriação, em vez de matar a aplicação.
- **Princípios de projeto.** Expor hardware, alocação, nomes e revogação; evitar gerenciar recursos além do que a proteção exige.
- **Dois sistemas.** O Aegis é o exokernel e o ExOS é um SO de biblioteca. Ambos rodam em DECstations com processadores MIPS (R2000 e R3000).

## Metodologia

O artigo é um projeto mais um protótipo, avaliado contra quatro hipóteses: exokernels podem ser muito eficientes, a multiplexação segura de baixo nível pode ser eficiente, abstrações tradicionais podem ser implementadas com eficiência no nível da aplicação e as aplicações podem construir versões especializadas delas. As medições rodam em três DECstations (DEC2100, DEC3100 e DEC5000/125) contra o Ultrix 4.2 no mesmo hardware. Cada operação é repetida muitas vezes e tirada a média, então os números não incluem faltas frias de cache ou de TLB; os autores dizem que isso favorece o Ultrix, que tem uma pegada maior. Para o Ultrix usaram o melhor tempo entre as instâncias de máquina, e para o exokernel a mediana de três execuções.

As comparações com a literatura (L3, o trabalho de exceções de Thekkath e Levy, FRPC, os filtros de pacotes PATHFINDER e MPF) usam números publicados em outras máquinas, escalados por notas SPECint ou por contagem de instruções, o que os autores chamam de grosseiro. O texto também admite que Aegis e ExOS não oferecem a mesma funcionalidade do Ultrix.

## Resultados

Todos os números abaixo vêm do artigo, na DEC5000/125, salvo indicação.

- **Primitivas.** Uma chamada de sistema leva de 1,6 a 2,3 microssegundos no Aegis, contra 21,3 do getpid no Ultrix. O despacho de exceção leva 1,5 microssegundo (18 instruções), contra 130 a 154 no Ultrix, e o artigo diz que é mais de cinco vezes mais rápido que o melhor número publicado (8 microssegundos numa DECstation 5000/200). Uma transferência de controle protegida em um sentido leva 1,4 microssegundo (30 instruções), que os autores comparam com 9,3 escalado para o L3, ou seja, 6,6 vezes mais rápido.
- **IPC numa biblioteca.** Os pipes do ExOS levam 14,2 microssegundos (10,7 com inlining), contra 199 no Ultrix; o ping-pong em memória compartilhada, 5,7 contra 118; e uma RPC local (lrpc), 6,3. Uma variante confiável (tlrpc), que não salva registradores, reduz isso para 2,9.
- **Memória virtual numa biblioteca.** O ExOS trata uma armadilha de proteção de página em 4,8 microssegundos contra 161, e os benchmarks de Appel e Li appel1 e appel2 dão 34 e 22 contra 262 e 232 (por página). O Ultrix é mais rápido para proteger 100 páginas contíguas (até cerca de 1,6 vez nas tabelas do artigo). Uma multiplicação de matrizes 150 por 150 leva praticamente o mesmo tempo nos dois.
- **Rede.** O filtro de pacotes compilado (DPF) classifica um cabeçalho TCP/IP em 1,5 microssegundo, contra 35,0 do MPF e 19,0 do PATHFINDER. A latência de ida e volta de um pacote de 60 bytes é de 259 microssegundos com ASHs, 320 sem, 3400 no Ultrix e 340 para o FRPC numa máquina um pouco mais rápida.
- **Personalização.** Um ExOS com tabelas de páginas invertidas é mais de duas vezes mais rápido em dirty, 37% em appel1 e 17% em appel2. Um escalonador de passos (stride) com menos de 100 linhas manteve uma divisão 3:2:1 próxima da ideal.

O que o artigo não afirma: que exokernels são seguros contra bibliotecas maliciosas em geral, que um sistema POSIX completo ou um sistema de arquivos foi medido (o ExOS não faz swapping e o sistema de arquivos ainda está em desenvolvimento) ou que o protocolo de aborto foi medido. Ele diz que o protótipo não tinha usuários reais.

## Análise crítica

A ideia central (proteção e gerência são trabalhos diferentes) é enunciada com clareza e as medições sustentam a afirmação de que abstrações fixas têm custo. Alguns limites merecem atenção.

- **Benchmarks pequenos e favoráveis.** Microbenchmarks repetidos em laço mostram o custo no melhor caso, e as abstrações comparadas são mais estreitas que as do Ultrix. Os autores avisam das duas coisas, mas os fatores de 10 a 100 vezes valem para primitivas, não para aplicações.
- **Comparações escaladas.** Os ganhos sobre o L3 e outros dependem de escalar números publicados entre processadores diferentes, e o próprio artigo os chama de grosseiros.
- **Projeto para o hardware de 1995.** TLBs carregadas por software, frame buffers com etiquetas e filtros de pacotes facilitaram o secure binding no MIPS. O artigo diz que os detalhes dependem do hardware de tradução de endereços e trata o hardware de tabelas de páginas só em linhas gerais.
- **Quem escreve a biblioteca?** A arquitetura espera que a maioria dos programas use poucos SOs de biblioteca padrão. A compatibilidade e o compartilhamento entre bibliotecas que desconfiam umas das outras (um sistema de arquivos compartilhado, um cache de buffers) recebem pouco tratamento medido.

Literatura posterior, que não faz parte deste artigo e não foi lida para esta análise (dados bibliográficos do Crossref): "On micro-kernel construction", de Liedtke, e o artigo do SPIN (Bershad e outros) saíram nos mesmos anais do SOSP '95, e o seguimento dos próprios autores, "Application performance and flexibility on exokernel systems" (SOSP 1997), amplia a avaliação. "The multikernel: a new OS architecture for scalable multicore systems" (SOSP 2009) e "Unikernels: library operating systems for the cloud" (ASPLOS 2013) são trabalhos posteriores sobre a estrutura de SOs que o leitor pode querer comparar. No catálogo, a mesma questão de separar a política de um kernel fino aparece em [ghOSt](/papers/ghost-user-space-delegation-of-linux-scheduling), [Skyloft](/papers/skyloft-general-scheduling-framework-in-user-space), [Snap](/papers/snap-microkernel-approach-to-host-networking), [Demikernel](/papers/demikernel-datapath-os-for-microsecond-datacenter-systems) e [KFlex](/papers/fast-flexible-practical-kernel-extensions). Esses pareamentos são meus; o artigo de 1995 não pode citá-los.

## Pesquisas futuras

- Como aplicar secure bindings a hardware que não oferece TLBs em software nem etiquetas de propriedade por recurso.
- Sistemas operacionais de biblioteca que continuem portáteis entre hardwares e convivam com serviços compartilhados, como um sistema de arquivos.
- O custo e o comportamento do protocolo de aborto sob contenção real.
- Tornar o código carregado no kernel (filtros, tratadores) seguro e barato sem servidores confiáveis.
- Se a gerência no nível da aplicação supera kernels de propósito geral bem ajustados em aplicações inteiras, não só em primitivas.
