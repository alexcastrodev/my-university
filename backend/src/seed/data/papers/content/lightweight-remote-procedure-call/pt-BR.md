---
title: "Chamada de procedimento remoto leve"
summary: Bershad, Anderson, Lazowska e Levy medem que a maior parte do tráfego de RPC em sistemas operacionais fica na mesma máquina e carrega argumentos pequenos, e constroem o LRPC para o Firefly, que transfere o controle direto pelo kernel na própria thread do cliente e passa argumentos numa pilha compartilhada, reduzindo uma chamada nula entre domínios de 464 para 157 microssegundos.
researchArea: Sistemas operacionais
keywords: chamada de procedimento remoto leve, comunicação entre domínios, sistemas operacionais de kernel pequeno, A-stack, linkage record, cache de domínios, Firefly
version: 1.0
updatedAt: 2026-11-20
---

## Resumo

A Lightweight Remote Procedure Call (LRPC) é um mecanismo de comunicação projetado e otimizado para a comunicação entre domínios de proteção na mesma máquina. Nos sistemas operacionais contemporâneos de kernel pequeno, os sistemas de RPC existentes têm um custo desnecessariamente alto quando usados para o tipo de comunicação que predomina (entre domínios de proteção na mesma máquina). Esse custo leva os projetistas a juntar subsistemas pouco relacionados no mesmo domínio de proteção, trocando segurança por desempenho. Ao reduzir o custo da comunicação local, a LRPC estimula segurança e desempenho ao mesmo tempo. Ela combina o modelo de transferência de controle e de comunicação dos sistemas de capacidades com a semântica de programação e o modelo de proteção de granularidade grossa da RPC. A LRPC alcança uma melhora de desempenho por um fator de três sobre as abordagens tradicionais baseadas em threads independentes que trocam mensagens, reduzindo o custo da comunicação local a quase o limite inferior imposto pelo hardware convencional. A LRPC foi integrada ao sistema operacional Taos da estação de trabalho multiprocessada Firefly, do DEC SRC.

## Visão geral

O texto analisado aqui é a versão da ACM Transactions on Computer Systems (volume 8, número 1, fevereiro de 1990, pp. 37-55), da Universidade de Washington. O artigo diz que foi indicado ao TOCS pelo comitê de programa do ACM Symposium on Operating Systems Principles de dezembro de 1989. O Crossref lista a versão de conferência nos anais do 12º SOSP (pp. 102-113, DOI 10.1145/74850.74861), que eu não li.

O cenário é o do sistema operacional de kernel pequeno (Accent, Mach, V, Amoeba, Taos), que divide o sistema em domínios que se comunicam por mensagens, em oposição a um kernel monolítico grande como o do UNIX (veja [O sistema de tempo compartilhado UNIX](/papers/unix-time-sharing-system)). O modelo de RPC veio da computação distribuída, onde [Implementando chamadas de procedimento remoto](/papers/implementing-remote-procedure-calls) (referência 1 do artigo) fez a chamada remota parecer uma chamada de procedimento. Os autores argumentam que esse modelo é usado sobretudo entre domínios de uma mesma máquina, que as implementações tratam esse caso como se fosse remoto e que o custo resultante empurra os projetistas a fundir subsistemas num único domínio, o que anula o objetivo de um kernel pequeno. Dizem que a abordagem convencional "viola um princípio básico de projeto de sistemas ao deixar de isolar o caso comum", citando o artigo de dicas de Lampson (a versão de 1984 da IEEE Software; o [Hints for Computer System Design](/papers/hints-for-computer-system-design) do catálogo é a versão do SOSP de 1983, e não conferi nela essa frase).

Vale saber antes: o que são um domínio de proteção e uma trap do kernel, e o que é um TLB. O artigo foi escrito no DEC SRC Firefly, a mesma plataforma de [Scheduler Activations](/papers/scheduler-activations-user-level-management-of-parallelism), com os mesmos quatro autores (ligo os dois por esse cenário comum, não porque um cite o outro).

## Contribuição

- **Um argumento medido para o caso comum.** A seção 2 conta as chamadas em três sistemas e os tamanhos de argumento no Taos (veja Resultados).
- **Quatro técnicas.** Transferência de controle simples (a thread do cliente executa o procedimento no domínio do servidor), transferência de dados simples (uma pilha de argumentos compartilhada), stubs simples e projeto para concorrência.
- **Binding.** O clerk do servidor entrega ao kernel uma lista de descritores de procedimento. Para cada procedimento, o kernel aloca, em par no cliente e no servidor, tantas A-stacks (pilhas de argumentos, mapeadas em leitura e escrita nos dois lados) quantas forem as chamadas simultâneas permitidas, mais um linkage record por A-stack, acessível só ao kernel, que guarda o endereço de retorno do chamador. O cliente recebe um Binding Object que precisa apresentar a cada chamada.
- **O caminho da chamada.** O stub empilha os argumentos numa A-stack e faz a trap. O kernel valida o binding e a A-stack, grava o endereço de retorno no linkage record, acha uma E-stack (pilha de execução) no domínio do servidor, troca o espaço de endereçamento e faz um upcall no stub do servidor. O retorno não exige nova validação, pois o direito foi concedido na chamada.
- **Menos cópias.** Um argumento de chamada é copiado uma vez, da pilha do stub do cliente para a A-stack, contra quatro cópias na RPC baseada em mensagens. Para chamada e retorno com parâmetros imutáveis, a Tabela III conta três cópias na LRPC, sete na troca de mensagens e cinco na troca de mensagens restrita.
- **Stubs em assembly e projeto para multiprocessador.** Stubs gerados em assembly a partir de arquivos de definição Modula2+, um lock por fila de A-stacks e cache de domínios em processadores ociosos.

## Metodologia

Para a frequência, os autores instrumentaram ou contaram três sistemas: o sistema V (número de C. Williamson, comunicação pessoal), o Taos num Firefly durante cinco horas de trabalho e um Sun-3 sem disco com UNIX e NFS durante quatro dias. Para os parâmetros, examinaram a SRC RPC como usada pelo Taos: 28 serviços, 366 procedimentos, mais de 1.000 parâmetros e 1.487.105 chamadas em quatro dias.

A LRPC foi implementada no Taos, no Firefly, e comparada com a SRC RPC, o sistema nativo do Taos. A Tabela II mistura medições dos autores com números publicados de seis sistemas. A Tabela IV roda quatro testes num Firefly com C-VAX, cada um como 100.000 chamadas entre domínios num laço fechado, dividindo o tempo total por 100.000. A Tabela V vem de medições de tempo e de cálculo manual dos TLB misses. A vazão foi medida com vários processadores chamando ao mesmo tempo e o cache de domínios desligado.

## Resultados

**Frequência (Tabela I).** A fração de operações que cruzam fronteiras de máquina é 3,0% no V, 5,3% no Taos (344.888 RPCs locais contra 18.366 RPCs de rede) e 0,6% no UNIX+NFS (mais de 100 milhões de chamadas de sistema contra menos de um milhão de RPCs). O artigo conclui que a atividade entre domínios vai dominar, ressalvando que outras cargas dão outras porcentagens.

**Parâmetros.** No Taos, 112 procedimentos diferentes foram chamados, 95% das chamadas foram para 10 deles e 75% para 3, e a cópia de bytes bastava para esses 3. As chamadas mais frequentes moveram menos de 50 bytes e a maioria menos de 200. Estaticamente, quatro de cada cinco parâmetros tinham tamanho conhecido em tempo de compilação e 65% tinham 4 bytes ou menos.

**Custo existente (Tabela II).** A chamada Null leva, real contra mínimo teórico em microssegundos, 464 e 109 no Taos, 754 e 90 no Mach, 2.300 e 444 no Accent, 730 e 170 no V, 800 e 170 no Amoeba e 1.590 e 170 no DASH. Só os stubs da Null levam cerca de 70 microssegundos na SRC RPC.

**LRPC (Tabela IV, microssegundos, LRPC/MP, LRPC, Taos).** Null 125, 157, 464. Add (dois argumentos de 4 bytes, um resultado de 4 bytes) 130, 164, 480. BigIn (um argumento de 200 bytes) 173, 192, 539. BigInOut (200 bytes na ida e na volta) 219, 227, 636. A LRPC/MP usa cache de domínios. Pela minha divisão, a LRPC em um processador é 2,96, 2,93, 2,81 e 2,80 vezes mais rápida que a RPC do Taos, e a LRPC/MP é 3,7 vezes mais rápida na Null.

**Decomposição (Tabela V).** A LRPC Null executa 120 instruções em 157 microssegundos. O mínimo é 109 (chamada de procedimento 7, duas traps 36, duas trocas de contexto 66) e a LRPC acrescenta 48 (stubs 21, transferência no kernel 27). Cerca de 25% do tempo vem de uns 43 TLB misses estimados, a cerca de 0,9 microssegundo cada. Os autores dizem que os stubs em assembly são quatro vezes mais rápidos que os stubs Modula2+ do gerador da SRC RPC.

**Vazão.** Um processador faz cerca de 6.300 LRPCs por segundo e quatro fazem mais de 23.000, um ganho de 3,7. Um Firefly de cinco processadores MicroVax II mostrou 4,3. A SRC RPC estabiliza em cerca de 4.000 chamadas por segundo com dois processadores, por causa de um lock global. As operações de fila levam menos de 2% do tempo da chamada.

## Análise crítica

O artigo declara alguns limites. As A-stacks ficam em memória virtual globalmente compartilhada porque o Firefly não tinha memória compartilhada em par, e ele diz que o mapeamento em par teria o mesmo desempenho com mais segurança (não medido). Um cliente ou servidor pode alterar argumentos na A-stack durante a chamada, então as cópias só ocorrem onde isso importa. O truque de passagem de argumentos exige um ponteiro de argumentos separado e não funcionaria se os argumentos tivessem de ficar na E-stack. O término de um domínio pode deixar uma thread capturada num servidor, o que o artigo trata com uma exceção de chamada falha e a criação de uma thread substituta. Ele trata o término como um caso especial infrequente.

Os pontos a seguir são a minha leitura, não afirmações do artigo.

- **Um sistema só.** Tudo o que se mede da LRPC é o Taos num Firefly com C-VAX. A comparação com Mach, V, Amoeba e DASH vem de números publicados em outros processadores, embora a coluna do mínimo teórico ajude.
- **Uma base rápida e insegura.** A SRC RPC, pelo próprio artigo, compartilha buffers globalmente, usa um lock só e dispensa validação de acesso, então o fator 3 é contra um projeto que já trocara segurança por velocidade.
- **Aritmética.** Os 5,3% do Taos são 18.366 divididos por 344.888, e não pelo total de 363.254, que dá cerca de 5,1%. A diferença não muda o argumento.
- **A evidência da premissa são três cargas.** Os autores dizem "acreditamos" que o padrão se generaliza. Nenhum benchmark de aplicação mostra ganho de ponta a ponta, e a ideia de que chamadas baratas estimulam sistemas mais modulares é argumentada, não medida.
- **Cache de domínios.** O ganho aparece só na Tabela IV, sem a taxa de achar um processador ocioso. A escala para em quatro ou cinco processadores, e o texto mesmo diz que algumas dezenas pressionariam mais o caminho de transferência.
- **Segurança.** Além do Binding Object, da validação do kernel na chamada e no retorno, da revogação no término e dos canais em par, o texto não analisa isolamento nem abuso.

Literatura posterior (não faz parte deste artigo; não li os originais e me apoio nas análises do catálogo): [On µ-Kernel Construction](/papers/on-micro-kernel-construction) relata um round trip de RPC de um byte do L3 de 10 microssegundos contra 230 do Mach na mesma CPU, e o [seL4](/papers/sel4-formal-verification-of-an-os-kernel) relata um IPC de ida de 224 ciclos. São outras máquinas e outras métricas, então não se comparam com a Tabela IV.

## Pesquisas futuras

- Tirar o IPC do kernel: a análise do [Exokernel](/papers/exokernel-os-architecture-application-level-resource-management) relata uma RPC local (lrpc) de 6,3 microssegundos num sistema operacional de biblioteca; não conferi se ela deriva deste projeto.
- Isolar componentes do kernel pela linguagem em vez de domínios de hardware, como o [Tock](/papers/multiprogramming-a-64kb-computer-safely-and-efficiently) faz com capsules, outra resposta para quanto a proteção deve custar.
- Troca de mensagens entre núcleos, como no [Multikernel](/papers/multikernel-new-os-architecture-scalable-multicore-systems), cujos canais URPC carregam mensagens entre núcleos por memória compartilhada (o texto do catálogo não o liga a este artigo).
- Medir as taxas de acerto do cache de domínios e a versão com memória em par que os autores descrevem.
- Custos de cópia e de checagem de argumentos quando eles não são pequenos.
