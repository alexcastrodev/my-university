---
title: "Hyperkernel: verificação push-button de um kernel de sistema operacional"
summary: Nelson e colegas redesenham a interface do kernel do xv6 para que toda chamada de sistema seja finita e verificam 50 trap handlers com o solucionador SMT Z3, sem scripts de prova escritos à mão, contra uma especificação de máquina de estados e outra declarativa. A verificação leva cerca de 15 minutos em 8 núcleos, e o artigo lista o que fica de fora (inicialização, código de cola, o backend do compilador, multicore).
researchArea: Sistemas operacionais
keywords: Hyperkernel, verificação push-button, solucionador SMT, Z3, interfaces finitas, LLVM IR, xv6, refinamento, virtualização de hardware
version: 1.0
updatedAt: 2026-11-19
---

## Resumo

Este artigo descreve uma abordagem para projetar, implementar e verificar formalmente a correção funcional de um kernel de sistema operacional, chamado Hyperkernel, com alto grau de automação de provas e baixo custo de prova. O projeto da interface do Hyperkernel parte do xv6, um sistema operacional didático semelhante ao Unix. O Hyperkernel introduz três ideias para alcançar a automação: finitiza a interface do kernel para evitar laços e recursão sem limite; separa os espaços de endereçamento do kernel e do usuário para simplificar o raciocínio sobre memória virtual; e faz a verificação no nível da representação intermediária do LLVM para evitar a modelagem da semântica complicada de C. Verificamos a implementação do Hyperkernel com o solucionador SMT Z3, checando ao todo 50 chamadas de sistema e outros trap handlers. A experiência mostra que o Hyperkernel evita bugs parecidos com os encontrados no xv6 e que sua verificação pode ser feita com baixo custo de prova.

## Visão geral

Verificar um kernel elimina classes inteiras de bugs, mas o artigo começa pelo preço: a prova de correção funcional do [seL4](/papers/sel4-formal-verification-of-an-os-kernel) levou cerca de 11 anos-pessoa para 10.000 linhas de C, escrita à mão num provador interativo. Este artigo do SOSP 2017, da Universidade de Washington, pergunta o que acontece se o kernel for projetado para que um solucionador SMT faça a prova sozinho.

A resposta se apoia em ideias antigas de sistemas operacionais. A interface lembra um [exokernel](/papers/exokernel-os-architecture-application-level-resource-management): o espaço de usuário escolhe qual página ou descritor de arquivo usar, e o kernel só confere se está livre. Os processos rodam como convidados sob virtualização de hardware, como no Dune, base do [IX](/papers/ix-protected-dataplane-operating-system). Kernels posteriores do catálogo que provam código em escala, o [Atmosphere](/papers/atmosphere-practical-verified-kernels-with-rust-and-verus) e o gerenciador de memória do [CortenMM](/papers/cortenmm-efficient-memory-management-with-strong-correctness), usam Verus e Rust.

Vale conhecer antes: solucionadores SMT (vetores de bits e funções não interpretadas), refinamento entre uma máquina de estados de especificação e a implementação, e o LLVM IR como forma intermediária de compilador.

## Contribuição

- **Uma abordagem push-button.** Duas especificações em Python e uma implementação em C são tudo o que o programador escreve por chamada de sistema; o verificador as converte em consultas SMT e o Z3 as prova ou devolve um contraexemplo que vira caso de teste.
- **Interfaces finitas.** Todo trap handler precisa ser expressável como traços de tamanho limitado, independente de parâmetros como o número de descritores de arquivo. O dup do POSIX vira dup(oldfd, newfd): o kernel confere um slot em vez de procurar o menor livre. Segundo o artigo, aplicar a abordagem a um kernel existente "dificilmente escala".
- **Espaços de endereçamento separados.** Com Intel VT-x e AMD-V, o kernel roda como host com mapeamento identidade e os processos como convidados com tabelas de páginas próprias, então o código do kernel não precisa raciocinar sobre endereços virtuais e físicos.
- **Verificação sobre LLVM IR,** que tem semântica mais simples que C e menos comportamentos indefinidos, e é de nível mais alto que o assembly x86.
- **Duas especificações.** Uma de máquina de estados para cada trap handler e outra declarativa, com propriedades transversais que a primeira precisa satisfazer.

## Metodologia

O kernel é modelado como máquina de estados; cada trap handler roda de forma atômica, com interrupções desligadas, num uniprocessador. O Teorema 1 (refinamento) diz que a implementação refina a especificação de máquina de estados: dados estados equivalentes (por uma função de equivalência escrita pelo programador) e um invariante de representação, ambos vão para estados equivalentes e o invariante volta a valer. O verificador obtém o lado da implementação por execução simbólica exaustiva do LLVM IR, que desenrola os laços (autofinitização) e emite checagens contra comportamento indefinido. O Teorema 2 (transversal) diz que a especificação de máquina de estados preserva o predicado declarativo P.

Quantificadores ficam fora da codificação SMT, exceto na especificação declarativa. Posse exclusiva é escrita com uma função inversa, e contagem de referências com uma permutação, porque codificações ingênuas podem fazer o solucionador não terminar. Leituras voláteis (DMA e páginas de dispositivos) devolvem valores simbólicos novos. As especificações são Python sobre a API do Z3; o verificador em si é C++ e Python.

Os autores também comparam com o histórico de commits do xv6 (janeiro de 2016 a julho de 2017), medem o tempo de verificação em commits mensais do Z3, aumentam o limite de páginas em 2x, 4x e 100x e rodam benchmarks adaptados do Dune contra o Linux 4.8.0.

## Resultados

- **Tamanho (Figura 8).** Implementação do kernel com 7.419 linhas (C e assembly), invariante de representação com 197, especificação de máquina de estados com 804, especificação declarativa com 263, código de espaço de usuário com 10.025 e verificador com 2.878. O kernel tem 50 trap handlers.
- **Tempo de verificação.** Cerca de 15 minutos num Core i7-7700K de oito núcleos com Z3 4.5.0; em um núcleo, cerca de 45 minutos (12 para o Teorema 1 e 33 para o Teorema 2). Todo commit mensal do Z3 desde janeiro de 2016 provou o resultado, e subir o número máximo de páginas em 2x, 4x e 100x não aumentou o tempo de forma perceptível.
- **Esforço.** Vários pesquisadores, cerca de um ano, gasto sobretudo em testar projetos: um kernel em Rust (abandonado por causa do modelo de propriedade e do custo de formalizar Rust), depois um kernel em C com o layout clássico de endereços, e então o Hyperkernel. Com as bibliotecas prontas, um autor verificava uma nova chamada de sistema em uma hora.
- **Propriedades provadas.** Entre elas: a raiz da tabela de páginas de um processo pertence só a ele (Propriedade 3); uma entrada gravável de tabela de páginas aponta para página do mesmo processo (Propriedade 4); e toda página gravável alcançada por uma caminhada de quatro níveis pertence ao processo e é um quadro de página (Propriedade 5). As contagens de referência batem com os objetos que as referenciam, e nenhum processo designa um processo livre como pai (Propriedade 2).
- **Bugs.** Dos dez bugs do xv6 corrigidos no período, dois (de travas) não se aplicam; dos outros oito, cinco não podem ocorrer no Hyperkernel e três (no carregamento de ELF) podem ocorrer, mas só em espaço de usuário. A especificação declarativa expôs três bugs na especificação de máquina de estados: uma checagem de slot da tabela de arquivos feita de duas formas inconsistentes e dois bugs de tempo de vida no IOMMU.
- **Tempo de execução (ciclos: Linux, Hyperkernel, Hyp-Linux).** syscall 125, 490, 136; fault 2.917, 615, 722; appel1 637.562, 459.522, 519.235; appel2 623.062, 452.611, 482.596. Uma ida e volta de hypercall custa 497 ciclos contra 69 de um syscall no i7-7700K.

## Análise crítica

O artigo é franco sobre o que fica fora dos teoremas. Não são cobertos: a inicialização do kernel e o código de cola (por exemplo, o assembly que salva e restaura registradores) e o binário final. O verificador trabalha sobre LLVM IR, então comportamento indefinido no C que não aparece no IR passa despercebido, e o backend do LLVM é confiado. O frontend de C e o otimizador de IR não são. A base confiável inclui ainda as especificações, a função de equivalência, o verificador, o Z3, o Python, o modelo do assembly inline para flush de TLB e o hardware (CPU, memória, IOMMU). O DMA é tratado confinando dispositivos a páginas dedicadas (VT-d e DEV configurados no boot) e tratando essas leituras como arbitrárias, não modelando os dispositivos. Três checkers cobrem parte da lacuna: boot (o invariante vale no início), pilha (todos os handlers cabem na pilha de 4 KiB) e link (símbolos não se sobrepõem).

O artigo não prova que a lista de páginas livres é completa nem que o escalonador evita inanição, e não tem multicore, threads, fork com copy-on-write nem permissões. O sistema de arquivos e a pilha de rede rodam sem verificação no espaço de usuário. Fork, exec e mmap são não finitos, então ficam em bibliotecas de usuário. O pedido que originou esta nota falava de um subconjunto de C "sem ponteiros"; o artigo não diz isso. Ele diz que os dados do kernel são sobretudo arrays e que goto e switch com fall-through são permitidos. "Baixo custo de prova" não vem como razão: os números acima mostram 1.264 linhas de especificação e invariante (soma minha) contra 7.419 de kernel, e nenhum custo em anos-pessoa para a prova em si.

Literatura posterior, que conheço só por metadados do Crossref e não li: o Serval (Nelson, Bornholt, Gu, Baumann, Torlak e Wang, SOSP 2019, "Scaling symbolic evaluation for automated verification of systems code with Serval"), cujo título sugere um framework reutilizável para o verificador usado aqui. Para concorrência, o outro lado da escolha uniprocessador deste artigo, veja o [OZZ](/papers/ozz-kernel-out-of-order-concurrency-bugs), que encontra bugs de ordenação de memória no Linux e não é um resultado de verificação.

## Pesquisas futuras

- Suporte a multicore: os autores dizem que verificá-lo está além deste artigo e que raciocínio automatizado para kernels concorrentes é uma direção promissora.
- Projetos de interface finita para threads, fork com copy-on-write, páginas compartilhadas e permissões.
- Sistemas de arquivos verificados e pilhas de rede de alto desempenho para os servidores de espaço de usuário.
- Estruturas encadeadas, usando trabalhos recentes de verificação automática, para provar a lista de livres e o escalonador.
- Port para ARM, onde o custo de syscall e de hypercall é parecido, e codificações que funcionem para interfaces não finitas, como a revogação de capabilities do seL4.
