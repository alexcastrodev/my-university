---
title: "Por que os sistemas operacionais não aceleram tão rápido quanto o hardware?"
summary: Ousterhout roda oito benchmarks em dez máquinas e seis sistemas operacionais de 1989 e conclui que chamadas ao kernel, trocas de contexto, cópias de memória e operações de arquivo melhoram menos que a velocidade bruta de inteiros, apontando a largura de banda da memória e os sistemas de arquivos presos ao disco como causas principais.
researchArea: Sistemas operacionais
keywords: sistemas operacionais, benchmarks, largura de banda de memória, sistemas de arquivos, E/S de disco, RISC
version: 1.0
updatedAt: 2026-11-20
---

## Resumo

Este artigo avalia várias plataformas de hardware e sistemas operacionais com um conjunto de benchmarks que exercitam entrada e saída do kernel, sistemas de arquivos e outras funções ligadas ao sistema operacional. A conclusão geral é que o desempenho do sistema operacional não está melhorando na mesma taxa que a velocidade básica do hardware subjacente. As formas mais óbvias de corrigir isso são aumentar a largura de banda da memória e reduzir a tendência dos sistemas operacionais de esperar a conclusão de operações de disco.

## Visão geral

John Ousterhout apresentou este artigo na conferência USENIX Summer 1990 (Anaheim, junho de 1990, pp. 247-256). Uma versão anterior é a nota técnica TN-11 do DEC Western Research Laboratory, de outubro de 1989. É um artigo de medição com opiniões, não o projeto de um sistema. Ousterhout construía o Sprite, um sistema operacional de pesquisa compatível com UNIX em Berkeley, e queria compará-lo ao UNIX dos fabricantes em hardware parecido. As máquinas "rápidas" não executavam os benchmarks tão depressa quanto a velocidade de seus processadores sugeria, então ele rodou o conjunto em muitas configurações na DEC, em Berkeley e na Carnegie Mellon.

Vale saber antes: o que é uma classificação em MIPS (milhões de instruções por segundo, com o VAX-11/780 em cerca de 1,0), a diferença entre processadores RISC e CISC, o cache de buffers de arquivos e o fato de que os sistemas de arquivos UNIX da época gravavam metadados em disco de forma síncrona. O próprio UNIX está descrito em [O sistema de tempo compartilhado UNIX](/papers/unix-time-sharing-system); Ultrix e SunOS são descendentes do BSD. O artigo aponta para uma versão anterior, do USENIX 1990, do trabalho sobre o sistema de arquivos estruturado em log, cuja versão de periódico é [O projeto e a implementação de um sistema de arquivos estruturado em log](/papers/log-structured-file-system).

## Contribuição

- **Um conjunto de benchmarks entre máquinas.** Oito benchmarks, sete deles microbenchmarks (getpid, cswitch, select, bcopy, leitura do cache de arquivos, open-close, create-delete) mais o benchmark Andrew modificado como único teste de grande escala. O código-fonte foi disponibilizado por FTP.
- **Uma normalização.** A "velocidade relativa ao MIPS" divide a razão de velocidade da máquina em relação ao Microvax II (MVAX2) pela razão de seus MIPS. O valor 1,0 significa que o benchmark rodou tão rápido quanto a classificação em MIPS prevê; abaixo de 1,0, a função do sistema operacional ficou atrás da velocidade bruta de inteiros.
- **Dois diagnósticos.** A largura de banda da memória, que não acompanha as CPUs RISC, e os sistemas de arquivos que esperam gravações em disco.
- **Quatro áreas-problema** para projetistas, duas de hardware (largura de banda de memória e troca de contexto) e duas de software (separar a velocidade do sistema de arquivos da velocidade do disco e os protocolos de arquivos em rede, como o NFS).

## Metodologia

A Tabela 1 lista dez configurações de hardware: MIPS M2000 e DECstation 5000 (20 e 18 MIPS), HP 9000-835CHX, DECstation 3100, SPARCstation-1, Sun-4/280, VAX 8800, IBM RT-APC, Sun-3/75 e Microvax II (0,9). As classificações em MIPS são estimativas do próprio autor. Os seis sistemas operacionais são Ultrix, SunOS, RISC/os, HP-UX, Mach e Sprite. Ultrix e SunOS descendem do 4.3 BSD, o RISC/os do System V, e Mach e Sprite são sistemas de pesquisa. O SunOS 4.0.3 (Sun-4, SPARCstation-1) e o SunOS 3.5 (Sun-3) são bem diferentes entre si.

As máquinas tinham memória de sobra e não houve paginação relevante, e os arquivos dos benchmarks cabiam no cache de buffers. O benchmark Andrew foi modificado para usar um único compilador (GNU C, gerando código para o SPUR), de modo que os tempos sejam comparáveis entre arquiteturas. Ele rodou localmente e sobre Sprite, NFS e AFS. As configurações de disco variaram, e as execuções do Mach no DS3100 usaram discos um pouco mais rápidos. O próprio artigo diz que seu conjunto de benchmarks pode estar incompleto e que outros benchmarks poderiam dar resultados diferentes.

## Resultados

Todos os números abaixo vêm das tabelas e do texto do artigo.

- **Visão geral.** A Figura 1 mostra a média geométrica das velocidades relativas ao MIPS por máquina. Só o VAX 8800 chegou perto de 1,0, e mesmo ele não foi consistente. As outras máquinas ficaram de 10% a 10 vezes mais lentas do que a potência da CPU sugeriria.
- **Entrada e saída do kernel e troca de contexto.** As máquinas RISC tiveram velocidade relativa ao MIPS de 0,5 a 0,8 no getpid (Ultrix no DS5000: 11 microssegundos, 0,94) e de 0,3 a 0,5 no cswitch, com exceções para o Ultrix no DS3100 (0,81) e no DS5000 (1,02). Ousterhout escreve que a troca de contexto parece cerca de 2 vezes mais cara em RISC e que não tem uma boa explicação. No select, o RISC/os do M2000 levou 10 ms com pipes vazios, o que ele suspeita ser uma emulação defeituosa do select.
- **Memória.** Normalizada por MIPS, a cópia de blocos grandes fora do cache deu de 2,7 a 3,7 nas máquinas CISC (8800, Sun3, MVAX2) e 1,0 ou menos em todas as RISC, exceto o RT-APC. O desempenho relativo da cópia caiu quase monotonicamente com processadores mais rápidos. A leitura do cache de arquivos (Tabela 6) acompanhou as mesmas larguras de banda. Exceções: o Sun-4 se saiu melhor por causa do cache write-back, e o DS5000 ficou mais lento que o esperado, o que o artigo não explica.
- **Benchmark Andrew.** As máquinas mais rápidas tiveram menor velocidade relativa ao MIPS no caso local: Sprite 1,7, 0,93 e 0,89 em Sun3, Sun4 e DS3100; SunOS 1,4, 0,85 e 0,66 em Sun3, Sun4 e SS1; Ultrix 1,0, 0,93 e 0,50 em MVAX2, 8800 e DS3100. A penalidade remota do NFS subiu de 21% (MVAX2) para 34% (Sun3) e 63% (Sun4). O Sprite foi tipicamente de 30% a 70% mais rápido que os demais no caso remoto e rodou quase tão rápido remotamente quanto localmente.
- **Causas no sistema de arquivos.** No open-close os derivados de UNIX superaram o Sprite, então esse benchmark não explicou o Andrew. O create-delete explicou: os derivados de UNIX levaram de 35 a 100 ms para criar e apagar um arquivo vazio, porque metadados são forçados ao disco, enquanto o Sprite fez uma única E/S de disco (cerca de uma rotação, 16 ms no DS3100), e uma versão mais nova levaria 4 ms. O autor conclui que o desempenho de arquivos temporários em UNIX depende mais da velocidade do disco que da CPU. O DS3100 com Ultrix e NFS levou 45 vezes mais que o DS3100 com Sprite sem disco para um arquivo de 100 kbytes. O SunOS 4.0.3 saltou de 67 ms (sem dados) para 842 ms (10 kbytes), o que ele supõe estar ligado a arquivos mapeados em memória.

## Análise crítica

O que o artigo não afirma: não traz solução, não prova que a tendência continua e não detalha onde o tempo do kernel é gasto dentro de nenhum sistema. Ele também deixa duas anomalias sem explicação: a leitura de arquivos no DS5000 e o resultado lento do Andrew para o Ultrix no DS3100 (explicado só em parte por discos mais lentos e por palpites sobre ajuste).

- **Um retrato de máquinas de 1989.** As conclusões sobre o futuro são previsões do autor (será mais difícil melhorar a memória que as CPUs, em parte porque o limite de custo das estações de trabalho incentiva economizar no sistema de memória). Ele também observa que parte da diferença de memória das RISC é um efeito único da mudança de arquitetura.
- **As implementações são diferentes.** Os sistemas têm kernels, sistemas de arquivos e discos distintos, e as classificações em MIPS são estimativas, então um valor relativo ao MIPS mistura efeitos de hardware e de software. Várias observações são palpites explícitos, por exemplo sobre o ajuste do Ultrix.
- **Interesse do autor.** Ousterhout lidera o Sprite, que sai à frente nos benchmarks de arquivos; os conselhos sobre sistemas de arquivos (adiar gravações, usar memória não volátil, sistemas de arquivos estruturados em log, trocar o NFS, "minha primeira escolha") também são trabalho e opinião dele.
- **Trabalho posterior (só de artigos do catálogo; não faz parte deste PDF).** O [Exokernel](/papers/exokernel-os-architecture-application-level-resource-management) mede primitivas do kernel contra o Ultrix em DECstations, o [Multikernel](/papers/multikernel-new-os-architecture-scalable-multicore-systems) e a [Análise da escalabilidade do Linux em muitos núcleos](/papers/analysis-of-linux-scalability-to-many-cores) tratam de escalar em multicore, e [All File Systems Are Not Created Equal](/papers/all-file-systems-are-not-created-equal-crash-consistent-applications) estuda em quais garantias de queda as aplicações confiam nos sistemas de arquivos. Li os resumos do catálogo, não há aqui uma ligação causal com este artigo.

## Pesquisas futuras

- Repetir o conjunto de benchmarks em hardware e kernels atuais, separando efeitos de hardware, de kernel e de bibliotecas.
- Reduzir o custo de entrar no kernel e de trocar de contexto, e descobrir por que era maior em RISC.
- Adiar ou armazenar gravações sem perder confiabilidade, por exemplo com memória não volátil ou logs.
- Protocolos de arquivos em rede que dependam menos de gravações síncronas em disco.
