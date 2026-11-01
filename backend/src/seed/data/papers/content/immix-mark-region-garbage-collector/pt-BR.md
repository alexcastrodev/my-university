---
title: "Immix: um coletor de lixo mark-region com eficiência de espaço, coleta rápida e bom desempenho do mutador"
summary: O Immix é um coletor de lixo que marca objetos vivos, recupera memória em blocos e linhas contíguos e copia de forma oportunista para combater a fragmentação, tentando evitar o compromisso usual entre espaço, velocidade de coleta e velocidade do programa.
researchArea: Linguagens de programação
keywords: coleta de lixo, mark-region, immix, gerenciamento de memória, jvm, fragmentação
version: 1.0
updatedAt: 2026-11-01
---

## Visão geral

Programas em linguagens gerenciadas como Java alocam muitos objetos pequenos e de vida curta, e o coletor de lixo decide a velocidade deles e a memória de que precisam. O artigo parte de um compromisso clássico entre os três coletores de rastreamento canônicos. O semi-space copia os objetos vivos para um novo espaço, o que dá alocação rápida e boa localidade de cache, mas exige o dobro de memória. O mark-sweep nunca move objetos, o que é eficiente em espaço e rápido de coletar, mas espalha objetos que foram alocados juntos. O mark-compact desliza os objetos para ficarem juntos, o que é compacto, mas exige várias passagens pelo heap e é lento de coletar.

Este artigo do PLDI 2008, de Blackburn e McKinley, pergunta se um único projeto pode ter as três qualidades: eficiência de espaço, coleta rápida e bom desempenho do mutador (a velocidade da própria aplicação). A resposta deles é o Immix, construído sobre uma nova família de coletores que eles chamam de mark-region.

Vale conhecer antes: a ideia de coleta de lixo por rastreamento (marcar objetos vivos e recuperar o resto), por que a localidade importa para o desempenho de cache e o que é fragmentação.

## Contribuição

- **A família mark-region.** Um coletor de rastreamento que não move objetos e recupera memória como regiões contíguas ("sweep-to-region"), de modo que novos objetos possam ser alocados lado a lado, como faz um coletor com cópia, sem reserva de cópia.
- **Duas granularidades.** O Immix gerencia blocos de 32 KB e, dentro de blocos parcialmente usados, linhas de 128 bytes. Ele prefere blocos inteiros livres e recorre a sequências de linhas livres.
- **Desfragmentação oportunista.** Quando a fragmentação é ruim, o coletor copia os objetos dos blocos mais fragmentados enquanto marca, em uma única passagem, e só quando há espaço para isso.
- **Uma avaliação detalhada** do projeto contra os coletores canônicos e um coletor geracional de produção.

## Metodologia

O Immix é implementado no MMTk dentro do Jikes RVM, uma máquina virtual Java de pesquisa, e comparado com implementações de semi-space, mark-sweep e mark-compact no mesmo framework. Os benchmarks são 20 programas do SPECjvm98, do DaCapo (versão 2006-10-MR2) e um pseudojbb2000 de carga fixa. Os resultados são médias geométricas para heaps de 1 a 6 vezes o heap mínimo de que o mark-sweep precisa, em três máquinas (Intel Core 2 Duo, AMD Athlon e IBM PowerPC G5), com contadores de desempenho de hardware no Core 2 para explicar a localidade.

Os autores também usam o Immix como espaço maduro de um coletor geracional e o comparam com o coletor geracional mark-sweep de produção do Jikes RVM, e fazem testes de sensibilidade ao tamanho de bloco e de linha e ablações dos principais recursos.

## Resultados

Estes são os resultados relatados pelos autores.

- Um Immix de heap completo supera os três coletores canônicos em todos os tamanhos de heap nas três arquiteturas, tipicamente em torno de 5 a 10%. O resumo declara ganhos de desempenho total de 7 a 25% em média nos 20 benchmarks.
- O tempo do mutador e as falhas de cache ficam próximos dos do semi-space, e o tempo de coleta fica próximo do do mark-sweep, que é a forma como ele quebra a dicotomia usual.
- Como espaço maduro de um coletor geracional, ele iguala ou supera um coletor geracional muito bem ajustado, por exemplo cerca de 5% melhor no jbb2000.
- Os resultados são consistentes: em 11 tamanhos de heap e 20 benchmarks, o pior caso foi uma lentidão de 4,9% (hsqldb com 1,1 vez o heap mínimo) e o melhor foi uma melhoria de 74% (jython contra o mark-sweep no heap mínimo).
- No heap mínimo necessário para rodar um benchmark, o Immix fica em média em 86% do mark-sweep, ou seja, 14% mais eficiente em espaço e próximo do mark-compact (83%).
- As ablações mostram que cada peça importa: só com marcação de blocos, a fragmentação inflaria a quantidade de memória marcada em 93% em média, e alguns benchmarks nem rodam em um heap de 2 vezes sem o projeto completo. A alocação de overflow ajuda três benchmarks e deixa um mais lento (xalan).

## Análise crítica

É um artigo empírico cuidadoso em uma área em que os detalhes importam. Alguns limites merecem nota.

- **Uma plataforma, uma época de benchmarks.** Todos os resultados vêm do Jikes RVM, em modo 32 bits e com benchmarks Java de 2006 a 2007, em poucos núcleos. O comportamento com heaps grandes, muitos núcleos, compiladores JIT modernos e tempos de vida de objetos diferentes está fora dos dados.
- **A métrica é vazão.** O artigo trata de tempo total, tempo de coleta e tempo do mutador. Faz pouca afirmação sobre tempos de pausa ou latência de cauda, que importam para servidores e para tempo real.
- **As médias escondem uma dispersão.** As médias geométricas são favoráveis, mas os casos individuais vão de um ganho de 74% a uma pequena lentidão, e programas com muita fragmentação dependem de a desfragmentação entrar em ação.
- **Heurísticas simples.** Os tamanhos de bloco e de linha e as condições que disparam a cópia foram ajustados pelos autores, então o projeto carrega parâmetros que outra carga de trabalho pode querer mudar.
- **A comparação com produção** é contra um coletor em uma VM, e é a combinação de VM e toolkit dos próprios autores.

## Pesquisas futuras

- Versões concorrentes e incrementais do Immix que limitem os tempos de pausa.
- Comportamento paralelo, em múltiplos núcleos e com heaps grandes, e posicionamento NUMA.
- Escolhas adaptativas de tamanho de bloco, tamanho de linha e gatilhos de desfragmentação a partir de feedback em tempo de execução.
- Aplicar as ideias de mark-region a runtimes que não são Java e a linguagens com outros layouts de objeto.
