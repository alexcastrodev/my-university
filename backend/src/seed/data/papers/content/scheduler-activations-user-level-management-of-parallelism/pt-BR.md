---
title: "Ativações de escalonador: suporte efetivo do kernel ao gerenciamento do paralelismo no nível do usuário"
summary: O artigo argumenta que threads de nível de usuário são rápidas, mas falham diante de E/S, page faults e multiprogramação, e que threads de kernel são a abstração errada para resolver isso. Propõe uma interface de kernel, as ativações de escalonador, que dá a cada espaço de endereçamento um multiprocessador virtual e avisa o escalonador de nível de usuário de cada evento do kernel por meio de upcalls.
researchArea: Sistemas operacionais
keywords: ativações de escalonador, threads de nível de usuário, upcalls, threads de kernel, multiprocessador virtual, alocação de processadores, seções críticas
version: 1.0
updatedAt: 2026-11-19
---

## Resumo

Threads são o veículo da concorrência em muitas abordagens de programação paralela. Elas podem ser suportadas pelo kernel do sistema operacional ou por código de biblioteca em nível de usuário, no espaço de endereçamento da aplicação, mas nenhuma das abordagens se mostrou plenamente satisfatória. Este artigo trata desse dilema. Primeiro, argumentamos que o desempenho das threads de kernel é inerentemente pior que o das threads de nível de usuário, e não um artefato das implementações existentes; gerenciar o paralelismo no nível do usuário é essencial para a computação paralela de alto desempenho. Depois, argumentamos que os problemas de integrar threads de nível de usuário aos demais serviços do sistema são consequência da falta de suporte do kernel a elas nos sistemas operacionais multiprocessados da época; threads de kernel são a abstração errada para sustentar o gerenciamento do paralelismo no nível do usuário. Por fim, descrevemos o projeto, a implementação e o desempenho de uma nova interface de kernel e de um pacote de threads de nível de usuário que juntos oferecem a mesma funcionalidade das threads de kernel sem abrir mão das vantagens de desempenho e flexibilidade do gerenciamento do paralelismo no nível do usuário.

## Visão geral

No começo dos anos 1990, multiprocessadores de memória compartilhada se tornavam comuns, e programadores expressavam o paralelismo com threads em vez de processos pesados no estilo UNIX. As threads podiam viver no kernel (Mach, Topaz, V) ou em uma biblioteca dentro da aplicação (PCR, FastThreads). O artigo parte da observação de que cada escolha falha de um jeito diferente e busca a velocidade da biblioteca com o comportamento do kernel. Ele apareceu no SOSP 1991 (pp. 95-109) e, em forma ampliada, na ACM Transactions on Computer Systems de fevereiro de 1992 (vol. 10, n. 1, pp. 53-79). Esta análise segue o texto da TOCS, que é o que tem cópia aberta.

A ideia, de que o kernel aloca processadores e cada aplicação decide o que rodar neles, reaparece várias vezes neste catálogo. O [Exokernel](/papers/exokernel-os-architecture-application-level-resource-management) leva o gerenciamento de recursos para as aplicações no sistema operacional inteiro, e trabalhos posteriores de escalonamento em espaço de usuário, como [ghOSt](/papers/ghost-user-space-delegation-of-linux-scheduling) e [Skyloft](/papers/skyloft-general-scheduling-framework-in-user-space), revisitam a divisão entre o kernel e o escalonador de usuário em hardware moderno. Os dois vieram décadas depois deste artigo.

Vale conhecer antes: a diferença entre thread e processo, o que um page fault e uma chamada de sistema bloqueante fazem com a thread em execução, e o que é um spin-lock.

## Contribuição

- **Um diagnóstico, não só um projeto.** Threads de nível de usuário enxergam os processadores do kernel apenas como "processadores virtuais" que o kernel multiplexa sem saber o que roda neles. Quando uma thread bloqueia no kernel por E/S ou page fault, ou o kernel retira um processador, o nível de usuário não é avisado, e o processador físico se perde ou a thread errada roda.
- **Um multiprocessador virtual por espaço de endereçamento.** O kernel decide quantos processadores cada espaço recebe. O espaço decide quais de suas threads rodam neles e sabe exatamente quantos processadores tem.
- **Ativações de escalonador.** Uma ativação é um recipiente (contexto de execução) para rodar threads de usuário, um meio de avisar o nível de usuário de um evento do kernel e espaço no kernel para guardar o contexto de uma thread parada. O kernel nunca retoma diretamente uma thread parada: uma ativação nova a reporta, e o escalonador de usuário decide o que fazer. O kernel mantém exatamente tantas ativações em execução quanto processadores atribuídos.
- **Quatro upcalls e duas chamadas de volta.** O kernel chama "Add this processor", "Processor has been preempted", "Scheduler activation has blocked" e "Scheduler activation has unblocked". O espaço de endereçamento chama "Add more processors" e "This processor is idle", e só nas operações de thread que podem mudar a alocação de processadores.
- **Recuperação para seções críticas**, em vez de prevenir a preempção (veja Metodologia).

## Metodologia

Os autores implementaram o projeto no multiprocessador DEC SRC Firefly, modificando o Topaz, seu kernel nativo, e o FastThreads, um pacote de threads de nível de usuário. Acrescentaram cerca de 1200 linhas ao Topaz (o código original de threads de kernel do Topaz tinha mais de 4000 linhas) e algumas centenas de linhas ao FastThreads. Threads de kernel do Topaz e binários UNIX continuam funcionando, então espaços que usam threads de kernel e espaços que usam ativações disputam processadores sem partição estática.

O kernel faz upcall no espaço de endereçamento, em uma ativação nova, em cada ponto onde teria de tomar uma decisão de escalonamento, e entrega o estado de registradores de qualquer thread parada. A retirada de um processador também é reportada por outro processador do mesmo espaço. Se o espaço não tem processador quando uma E/S termina, o upcall espera até que um seja alocado. A alocação usa uma política de divisão de espaço no estilo de Zahorjan e McCann, que respeita prioridades e nunca deixa um processador ocioso havendo trabalho. O FastThreads usa listas de prontos por processador, percorridas em ordem último a entrar, primeiro a sair, por localidade de cache.

As seções críticas são o caso difícil. Uma thread preemptada ou bloqueada segurando um lock (inclusive o da lista de prontos, ou uma lista livre por ativação sem lock) poderia causar baixo desempenho ou deadlock. Os autores rejeitam a prevenção, porque ela obriga o kernel a abrir mão da alocação de processadores, conflita com a implementação rápida de locks e exige páginas fixadas na memória. Adotam a recuperação: o upcall verifica, antes de pegar qualquer lock, se a thread parada estava em seção crítica. Se estava, continua essa thread por uma troca de contexto em nível de usuário até ela sair da seção e devolver o controle. Para não marcar uma flag a cada aquisição de lock, o FastThreads faz uma cópia exata de cada seção crítica, com um yield apenas no fim da cópia, e o upcall retoma uma thread pega dentro de uma seção no ponto correspondente da cópia.

## Resultados

Todos os números abaixo vêm das medições do artigo no Firefly.

- **Custo das threads.** A Tabela I compara Null Fork (criar, escalonar, executar e terminar uma thread que chama um procedimento nulo) e Signal-Wait: FastThreads 34 e 37 microssegundos, threads de kernel do Topaz 948 e 441, processos Ultrix 11300 e 1840. Uma chamada de procedimento leva cerca de 7 microssegundos e um trap de kernel cerca de 19.
- **Custo das ativações no caso comum.** O FastThreads sobre ativações de escalonador leva 37 microssegundos no Null Fork e 42 no Signal-Wait, uma degradação de 3 e 5 microssegundos. Remover do FastThreads a otimização das seções críticas copiadas resultou em 49 e 48.
- **Upcalls são lentos.** Duas threads sinalizando e esperando pelo kernel levam 2,4 milissegundos, cinco vezes pior que as threads do Topaz. Os autores esperavam paridade, atribuem a diferença a uma modificação rápida de código existente e a Modula-2+ em vez de assembler ajustado, e esperam fechar a diferença com ajuste.
- **N-body, sem E/S e sem concorrente.** O speedup do programa N-body O(N log N) em até seis processadores é parecido nas duas versões do FastThreads. As threads do Topaz estabilizam, o que os autores atribuem ao custo das threads e dos locks de kernel.
- **N-body com E/S.** Com menos memória, um cache miss bloqueia uma thread no kernel por 50 ms. O FastThreads original degrada mais rápido que os outros dois, porque a thread bloqueada leva seu processador junto. O FastThreads modificado e as threads do Topaz têm curvas paralelas, com o FastThreads modificado mais rápido.
- **Multiprogramação.** Duas cópias em seis processadores dão speedups de 1,29 (threads do Topaz), 1,26 (FastThreads original) e 2,45 (ativações de escalonador), sendo 3 o máximo. O último fica a 5% do programa rodando sozinho em três processadores.

## Análise crítica

O argumento é claro e o mecanismo é geral: o kernel não precisa conhecer o modelo de concorrência do nível de usuário. A evidência é mais fraca que o projeto.

- **Um protótipo, uma máquina, um programa.** O Firefly CVAX de seis processadores, uma única aplicação N-body e esperas de disco simuladas são reconhecidos pelos próprios autores como "ilustrativos". Os portes para C Threads e Mach estavam apenas em andamento.
- **O resultado dos upcalls não sustenta a tese principal.** O caminho lento dos upcalls é medido, mas a explicação e a afirmação de que o ajuste igualaria o Topaz são expectativas, não medições.
- **A honestidade na declaração é argumentada, não testada.** O kernel confia que os espaços informem processadores ociosos e necessários. O artigo sugere realimentação multinível, mas não a avalia.
- **O que o artigo não afirma.** Não mostra desempenho melhor em todos os casos, não relata um kernel de produção e diz que as ativações poderiam ser práticas até em um uniprocessador somente se o custo de bloqueio e preempção fosse igual ao das threads de kernel, o que não foi alcançado.
- **Literatura posterior, não deste artigo.** O NetBSD adotou ativações de escalonador e depois integrou, em 2007, um modelo de threads 1:1 que as [substituiu](https://www.netbsd.org/changes/changes-5.0.html) no NetBSD 5.0. Um resumo comum, por exemplo [na Wikipedia](https://en.wikipedia.org/wiki/Scheduler_activations), é que esquemas N:M exigem mudanças no kernel e no espaço de usuário e são mais difíceis de implementar que threads 1:1 ou só de usuário. O runtime do Go multiplexa goroutines sobre threads do sistema em espaço de usuário e, desde o [Go 1.14](https://go.dev/doc/go1.14), as preempta de forma assíncrona, sem uma interface de upcalls como esta.

## Pesquisas futuras

- Custo por ativação: uma implementação de kernel ajustada para testar a expectativa dos autores de que os upcalls podem igualar o bloqueio de threads de kernel.
- Cargas multiprogramadas com muitas aplicações e E/S real, para testar a política de alocação e o problema da honestidade.
- Comparar a recuperação de seções críticas com outras formas de lidar com um detentor de lock preemptado.
- Como uma interface moderna de kernel para usuário, como o [ghOSt](/papers/ghost-user-space-delegation-of-linux-scheduling), se compara no que reporta e no que deixa o nível de usuário decidir.
- Como os bugs de escalonador do kernel mostrados em [The Linux Scheduler: A Decade of Wasted Cores](/papers/linux-scheduler-decade-of-wasted-cores) interagem com escalonadores de usuário que dependem de informação correta sobre os processadores.
