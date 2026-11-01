---
title: "Roofline: um modelo visual e esclarecedor de desempenho para arquiteturas multicore"
summary: Um modelo de desempenho em um único gráfico, que limita o que um programa pode alcançar pelo menor valor entre o pico de ponto flutuante e a largura de banda de memória vezes a intensidade operacional do programa, e que usa tetos empilhados para dizer quais otimizações tentar primeiro.
researchArea: Computação de alto desempenho
keywords: roofline, modelagem de desempenho, intensidade operacional, largura de banda de memória, multicore, otimização
version: 1.0
updatedAt: 2026-11-01
---

## Visão geral

Por volta de 2009, a mudança para processadores multicore encerrou um longo período em que a maioria dos chips seguia o mesmo projeto. Alguns ofereciam muitos núcleos simples, outros menos núcleos complexos, outros dependiam de multithreading e alguns trocavam os caches por memória local gerenciada de forma explícita. Essa diversidade complica o trabalho de programadores, de quem escreve compiladores e de arquitetos, porque não é óbvio por que um programa está lento em um chip e o que mudar.

Este artigo, de Samuel Williams, Andrew Waterman e David Patterson (Communications of the ACM, abril de 2009), propõe um modelo deliberadamente simples. Eles dizem que o modelo não precisa ser perfeito, apenas esclarecedor, e o comparam ao modelo dos "3Cs" para faltas de cache, que também ignora detalhes mas ajuda as pessoas há décadas.

Vale conhecer antes: operações de ponto flutuante por segundo (Flops/s), largura de banda da DRAM, o que é uma falta de cache e que um programa pode ser limitado pelo cálculo ou pela movimentação de dados.

## Contribuição

- **O Roofline.** Um gráfico log-log por máquina, cuja linha horizontal é o pico de desempenho de ponto flutuante e cuja linha diagonal é o pico de largura de banda de memória. Um kernel nunca fica acima do teto que está sobre a sua intensidade operacional.
- **Intensidade operacional,** definida como operações por byte de tráfego entre os caches e a DRAM. Como conta o tráfego da DRAM depois que o cache o filtrou, as otimizações de cache aparecem como um deslocamento no eixo x.
- **Tetos.** Linhas abaixo do teto marcam o que se obtém sem uma dada otimização (por exemplo SIMD, paralelismo no nível de instrução, prefetching por software, afinidade de memória). A ordem delas sugere a ordem para tentar otimizações, e a distância até o próximo teto é a recompensa possível.
- **Uma demonstração** em quatro computadores multicore e quatro kernels numéricos, e uma lista de equívocos que os autores ouviram ao apresentar o trabalho.

## Metodologia

O limite é `GFlops/s atingíveis = mínimo(pico de ponto flutuante, pico de largura de banda de memória x intensidade operacional)`. O teto e os tetos intermediários são medidos uma vez por computador, e não por kernel, com a folha de especificações para o lado do cálculo e uma série de microbenchmarks progressivamente otimizados para a largura de banda sustentável da DRAM.

Os quatro computadores são todos de dois soquetes: um Intel Xeon (Clovertown), um AMD Opteron X4 (Barcelona), um Sun UltraSPARC T2+ (Niagara 2) e um IBM Cell (QS20), escolhidos porque seus projetos diferem muito. Os quatro kernels vêm dos "Sete Anões" dos métodos numéricos: multiplicação matriz esparsa por vetor (SpMV), magneto-hidrodinâmica de Lattice-Boltzmann (LBMHD), um stencil 3D e uma FFT 3D. Os kernels foram otimizados com autotuners de três publicações anteriores, e com a FFTW para a FFT em três das máquinas.

## Resultados

Estes são os resultados relatados pelos autores.

- No Opteron X2 usado como exemplo, o teto é de 17,6 GFlops/s e 15 GB/s. Seus tetos intermediários são 8,8 e 2,2 GFlops/s no lado do cálculo, e 11, 4,8 e 2,7 GB/s no lado da memória. O ponto de crista (a intensidade necessária para atingir o pico) passa de 1,0 Flops/byte no X2 para 4,4 no X4, que tem cerca de quatro vezes o pico com a mesma largura de banda de memória.
- Os pontos de crista são 6,7 Flops/byte para o Xeon e 4,4 para o X4, 0,33 para o T2+ e 0,65 para o Cell. Nas máquinas x86 isso significa de 35 a 55 operações de ponto flutuante para cada operando de 8 bytes vindo da DRAM.
- As intensidades operacionais das 16 combinações de kernel e computador vão de 0,25 a 1,64 Flops/byte, com mediana de 0,60, bem à esquerda dos pontos de crista dos x86.
- Em todas as 16 combinações o desempenho obtido fica entre os tetos superior e inferior do modelo. No Xeon e no X4, 15 dos 16 tetos limitantes são tetos de memória, enquanto no T2+ e no Cell o limite se divide de forma quase igual.
- O ponto de crista previu o desempenho melhor que a frequência de clock ou a taxa de pico. O Cell alcançou o maior desempenho, mas o T2+, com o menor ponto de crista, foi a máquina em que foi mais fácil obter o melhor resultado.

## Análise crítica

O modelo entrega o que promete: é fácil de desenhar, fácil de ler e explica muito com dois números por máquina. O artigo também é franco, com uma seção que responde a equívocos.

- **É um limite, não uma previsão.** O teto diz o que é impossível, não o que é provável. Um kernel bem abaixo do teto pode estar limitado por algo que o gráfico não mostra.
- **A evidência vem de quem otimizou os kernels.** As implementações otimizadas vêm de trabalhos anteriores do próprio grupo, e o artigo nos diz que os limites se sustentaram, não que poderiam falhar. Um teste em que o modelo erra seria mais informativo.
- **Os kernels são regulares.** Têm paralelismo suficiente e carga balanceada, o que os autores afirmam. Programas irregulares, limitados por latência ou por comunicação são os casos em que mais se quer um modelo.
- **O hardware mudou.** As máquinas são de 2008 e 2009. Em nossa leitura, a ideia sobreviveu a elas, já que versões do modelo hoje são muito usadas para GPUs e níveis de cache, mas o artigo só cita processadores vetoriais e GPUs como trabalho futuro.
- **A intensidade operacional precisa ser conhecida.** O artigo conta o tráfego da DRAM com análise ou contadores (veja o apêndice), e a qualidade do gráfico depende de essa contagem estar correta.

## Pesquisas futuras

- Usar contadores de desempenho para definir a altura e a ordem dos tetos de cada kernel, o que os autores apontam como direção.
- Estender o modelo a outros kernels e métricas, como ordenação ou ray tracing, a processadores vetoriais e a GPUs.
- Acrescentar mais recursos ao gráfico (níveis de cache, rede, energia) sem perder a simplicidade de uma única figura.
- Estudos sobre se o modelo muda o que os programadores fazem, por exemplo com estudos controlados com usuários em vez do uso pelos próprios autores.
