---
title: "seL4: verificação formal de um kernel de sistema operacional"
summary: Klein e colegas relatam a primeira prova verificada por máquina, em Isabelle/HOL, de que a implementação em C de um kernel completo de uso geral (o seL4, com 8.700 linhas de C) refina uma especificação abstrata, passando por uma especificação executável derivada de Haskell, ao custo de cerca de 20 anos-pessoa de prova, e dizem com precisão o que assumem em vez de provar (compilador, assembly, código de boot, caches e TLB, hardware).
researchArea: Sistemas operacionais
keywords: seL4, verificação formal, correção funcional, refinamento, Isabelle/HOL, microkernel, capabilities
version: 1.0
updatedAt: 2026-11-19
---

## Abstract

A verificação formal completa é a única forma conhecida de garantir que um sistema esteja livre de erros de programação. Apresentamos nossa experiência na verificação formal, verificada por máquina, do microkernel seL4, de uma especificação abstrata até a sua implementação em C. Assumimos a correção do compilador, do código assembly e do hardware, e usamos uma abordagem de projeto singular que funde técnicas formais e de sistemas operacionais. Até onde sabemos, esta é a primeira prova formal de correção funcional de um kernel de sistema operacional completo e de uso geral. Correção funcional significa aqui que a implementação sempre segue estritamente a nossa especificação abstrata de alto nível do comportamento do kernel. Isso abrange propriedades tradicionais de segurança de projeto e de implementação, como o kernel nunca travar e nunca executar uma operação insegura. Prova também muito mais: podemos prever com precisão como o kernel se comportará em toda situação possível. O seL4, um microkernel de terceira geração com origem no L4, tem 8.700 linhas de código C e 600 linhas de assembler. Seu desempenho é comparável ao de outros kernels L4 de alto desempenho.

## Visão geral

O kernel roda no modo mais privilegiado do processador, então um bug nele pode minar tudo o que está acima. A resposta usual é reduzir o código privilegiado: microkernels, kernels de separação e hypervisors pequenos fazem isso, e o [exokernel](/papers/exokernel-os-architecture-application-level-resource-management) leva a mesma ideia para outro lado, exportando o hardware com segurança e deixando a gerência para bibliotecas. Os autores argumentam que, com um kernel realmente pequeno, dá para ir além e provar a ausência de bugs de implementação. O seL4 sofre influência do EROS e usa capabilities para autorização, inclusive na alocação de memória; capabilities são um dos mecanismos de proteção estudados em [The Protection of Information in Computer Systems](/papers/protection-of-information-in-computer-systems).

Este artigo do SOSP 2009, do NICTA, da UNSW, da Open Kernel Labs e da ANU, relata uma verificação concluída do seL4 para ARMv6 (Freescale i.MX31). Outros trabalhos de verificação do catálogo, como o [Verus](/papers/verus-practical-foundation-for-systems-verification) e o [Atmosphere](/papers/atmosphere-practical-verified-kernels-with-rust-and-verus), seguem outro caminho: provas checadas por um verificador baseado em SMT sobre Rust, não provas interativas sobre C. O [TreeSLS](/papers/treesls-whole-system-persistent-microkernel-with-tree-structured-checkpoint) é um microkernel que cita o seL4 apenas como kernel de capabilities.

Vale conhecer antes: lógica de Hoare (pré e pós-condições), a ideia de refinamento entre uma máquina de estados abstrata e uma concreta, e microkernels no estilo L4, em que os drivers rodam em modo usuário e tudo se comunica por IPC.

## Contribuição

- **Uma prova de refinamento da especificação até o C.** O Isabelle/HOL prova que a implementação em C (MC) refina uma especificação executável (ME), que refina uma especificação abstrata (MA); por transitividade, MC refina MA.
- **Um processo de projeto que funde SO e métodos formais.** Um protótipo em Haskell, ligado a um simulador de hardware derivado do QEMU, é o artefato compartilhado: os desenvolvedores de SO o executam, e ele é traduzido automaticamente para o provador. O kernel de produção é então escrito à mão em C, por desempenho.
- **Uma semântica formal de um grande subconjunto do C99,** com obrigações de prova explícitas para segurança de ponteiros e um subconjunto restrito (sem endereço de variáveis locais, sem ponteiros de função, sem goto, sem unions).
- **Projeto do kernel para ser verificável.** Kernel orientado a eventos, com uma única pilha e API quase toda atômica, interrupções tratadas por polling em poucos pontos de preempção, drivers em espaço de usuário, política de alocação fora do kernel com uma árvore de derivação de capabilities, e capabilities zumbi que tornam a destruição de objetos preemptável.
- **Dados de custo e de experiência** para um projeto desse tipo, incluindo o custo de mudar um kernel verificado.

## Metodologia

Os autores fixam primeiro a propriedade: correção funcional, mostrada como refinamento por simulação progressiva entre máquinas de estados. As transições do kernel são especificadas em cada camada; o comportamento do usuário é totalmente não determinístico, então a prova cobre programas de usuário benignos, com defeito e maliciosos. A especificação abstrata diz o que o kernel faz (por exemplo, o escalonador escolhe qualquer thread executável ou a thread ociosa); a executável diz como (um escalonador round-robin por prioridade, com a árvore de derivação de capabilities como lista duplamente encadeada). O código C é lido no provador por meio da semântica de C, e a máquina é modelada por uma pequena interface de funções (Figura 6 do artigo) deixadas o mais não determinísticas possível.

O artigo descreve então o que está e o que não está coberto, classifica os invariantes (de memória, de tipos, de estruturas de dados e algorítmicos) e relata o esforço por fase. O desempenho é medido em ciclos de IPC unidirecional num i.MX31 (ARM1136JF-S a 532 MHz) com caches quentes e o contador de ciclos do processador, contra o OKL4 2.1 na mesma placa e um resultado publicado para o XScale.

## Resultados

- **Tamanho.** Tabela 1: 8.700 linhas de C, mais 600 de assembler; 5.700 linhas de Haskell na camada executável; especificação abstrata com 4.900 linhas de Isabelle e especificação executável com 13.000; o código C lido no Isabelle tem 15.000. As provas têm cerca de 110.000 linhas no primeiro passo de refinamento e 55.000 no segundo; com frameworks, bibliotecas e provas geradas, o total é de 200.000 linhas de script Isabelle. A prova cobre mais de 150 invariantes.
- **Esforço.** Cerca de 20 anos-pessoa de prova no total, dos quais 9 foram para frameworks de linguagem, ferramentas e bibliotecas e 11 foram específicos do seL4. O primeiro refinamento levou 8 anos-pessoa, o segundo menos de 3 anos-pessoa. O lado do projeto custou cerca de 2,2 anos-pessoa, incluindo o protótipo em Haskell, contra cerca de 6 anos-pessoa do Pistachio e 4 anos-pessoa estimados pelo SLOCCount; os autores concluem que o desvio por Haskell não aumentou o custo. Estimam que repetir a verificação levaria 6 anos-pessoa de prova, 8 anos-pessoa no total.
- **O que é garantido.** O kernel nunca falha e sempre tem comportamento definido (as asserções valem, sem acesso a ponteiro nulo ou desalinhado), todas as chamadas do kernel terminam e retornam, e a checagem de argumentos não pode ser subvertida do nível de usuário, desde que as suposições valham. Cerca de 80% do esforço de prova foi em invariantes.
- **Bugs.** 16 defeitos foram achados antes de a verificação começar, depois mais 144 pela verificação, e 54 outras mudanças de código foram feitas para facilitar a prova. O primeiro refinamento gerou cerca de 300 mudanças na especificação abstrata e 200 na executável, cerca de metade correções de bugs.
- **Desempenho.** O IPC unidirecional otimizado leva 224 ciclos no seL4, contra 206 do caminho em assembly feito à mão do OKL4 2.1 na mesma placa e 151 ciclos publicados para o XScale. O caminho em C não otimizado do OKL4 levou 756. O caminho otimizado do seL4 ainda não estava na base de código verificada.
- **Custo da mudança.** Uma nova chamada de sistema em lote levou um dia para implementar e menos de uma pessoa-semana de prova; adicionar interrupções, tabelas de páginas ARM e espaços de endereçamento levou de 1,5 a 2 anos-pessoa para reverificar; as reply capabilities, menos de 5% do código, levaram cerca de 1 ano-pessoa (17% do esforço de prova original).

## Análise crítica

O artigo é incomumente explícito sobre seus limites, e esse é seu maior mérito. Os teoremas afirmam correspondência entre os pontos de entrada e saída do kernel. Os autores assumem o compilador GCC, o código assembly, o hardware, o código de boot e de inicialização (cerca de 1,2 kLOC) e o gerenciamento de caches e TLB feito pela interface da máquina; a consistência da janela de memória virtual do kernel é argumentada apenas de modo informal. A prova vale para um kernel uniprocessador em ARMv6; o port para x86 foi feito sem prova, e a prova do controle de acesso ainda não está ligada a esta. A prova também mostra que a implementação corresponde à especificação, não que a especificação é o que os usuários precisam, como os próprios autores observam.

O que o artigo não afirma: não discute DMA, temporização ou latência de pior caso, nem canais ocultos, e não diz nada sobre propriedades de segurança além da correção funcional. Os 224 ciclos de IPC são um único microbenchmark numa só placa, não um benchmark de sistema.

Literatura posterior ao artigo, que conheço apenas por título e veículo conferidos no Crossref (não li esses textos para esta nota): "Translation validation for a verified OS kernel" (PLDI 2013), cujo título sugere trabalho sobre a suposição do compilador; "seL4: From General Purpose to a Proof of Information Flow Enforcement" (IEEE S&P 2013); "Timing Analysis of a Protected Operating System Kernel" (RTSS 2011); e o artigo de periódico "Comprehensive formal verification of an OS microkernel" (ACM TOCS 2014). A suposição do compilador é também o que [Finding and Understanding Bugs in C Compilers](/papers/csmith-finding-bugs-in-c-compilers) testa empiricamente em busca de bugs de código errado. Para comparar custos, o artigo do Atmosphere no catálogo relata uma razão prova-código de 20:1 para o seL4 e de 3,32:1 para si mesmo; é um cálculo dele, não um número deste artigo.

## Pesquisas futuras

- Verificar o assembly, o código de boot e a saída do compilador, para remover a base confiável abaixo do C.
- Uma versão multicore do kernel, que os autores deixam para trabalho futuro.
- Ligar o modelo de controle de acesso à prova de refinamento e provar outras propriedades de segurança sobre a especificação abstrata.
- Verificação no nível de aplicação que se apoie na especificação abstrata do kernel.
- Reduzir o custo de prova para novos kernels, por exemplo com mais automação ou outras linguagens e verificadores, como na linha do Verus.
