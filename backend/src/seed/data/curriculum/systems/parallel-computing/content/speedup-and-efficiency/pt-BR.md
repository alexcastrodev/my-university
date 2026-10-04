---
version: 1.0
updatedAt: 2026-09-06
title: "Speedup e Eficiência"
summary: "Speedup = T(1) / T(p), a razão entre o tempo de execução sequencial e o paralelo em p processadores; eficiência = Speedup / p, a fração do tempo de cada processador de fato gasta em trabalho útil. São os dois números contra os quais toda afirmação de desempenho paralelo, no fim das contas, tem que ser medida."
---
## Objetivos de Aprendizagem

- Definir speedup como T(1)/T(p) e eficiência como Speedup/p, e calcular ambos a partir de tempos medidos.
- Explicar o que "speedup linear" e "speedup superlinear" significam, e por que o speedup superlinear, embora real, exige uma explicação honesta em vez de ser aceito pelo valor de face.
- Distinguir speedup (uma razão entre tempos) do tempo de relógio bruto, e explicar por que um programa paralelo "rápido" ainda pode ter um speedup ruim.
- Reconhecer que speedup e eficiência são os dois números contra os quais toda afirmação do restante do bloco "Desempenho e Escalabilidade" desta disciplina é medida.

## Contexto e Motivação

Os conceitos de decomposição, comunicação, sincronização, granularidade e balanceamento de carga recém-cobertos estão todos, no fim das contas, a serviço de um objetivo prático: fazer um programa rodar mais rápido usando mais processadores. Mas "mais rápido" precisa de uma definição precisa antes de poder ser raciocinado matematicamente. Um programa paralelo que termina em 10 segundos soa rápido, mas se esse é um resultado *bom* para o número de processadores que ele usou é uma pergunta completamente separada. Speedup e eficiência são as duas métricas padrão que tanto o tutorial do LLNL quanto o CS267 da UC Berkeley usam para responder exatamente essa pergunta, e elas estabelecem o vocabulário sobre o qual os próximos três conceitos (Lei de Amdahl, Lei de Gustafson e escalabilidade forte/fraca) constroem diretamente.

## Teoria Central

### Speedup: quão mais rápido, em relação ao sequencial

O **speedup** em p processadores é definido como:

```text
Speedup(p) = T(1) / T(p)
```

onde T(1) é o tempo que a melhor versão sequencial (de um processador) disponível do programa leva, e T(p) é o tempo que a versão paralela leva rodando em p processadores. Um speedup de 4 em 8 processadores significa que a versão paralela rodou 4 vezes mais rápido do que a sequencial, usando 8 processadores para conseguir isso.

Dois casos especiais merecem ser nomeados com precisão:

- **Speedup linear**: Speedup(p) = p exatamente. Dobrar os processadores corta o tempo exatamente pela metade. Este é o ideal teórico, raramente alcançado na prática por causa dos overheads de comunicação, sincronização e desequilíbrio de carga já cobertos.
- **Speedup superlinear**: Speedup(p) > p. A versão paralela é *mais* do que p vezes mais rápida. Isto soa impossível à primeira vista (como dividir o trabalho entre p processadores pode ser melhor do que um speedup perfeito de p vezes?), mas é real e acontece, mais comumente porque a fatia menor dos dados de cada processador cabe melhor no seu cache local, reduzindo os custos da hierarquia de memória (já quantificados no material de AMAT de Arquitetura de Computadores) de uma forma da qual a versão sequencial, trabalhando sobre o conjunto de dados inteiro de uma vez, não conseguia se beneficiar. O speedup superlinear é um efeito genuíno e explicável, não um erro de medição, mas qualquer afirmação dele merece exatamente esse tipo de explicação, e não apenas um número reportado sem contexto.

### Eficiência: speedup por processador

A **eficiência** normaliza o speedup pelo número de processadores usados:

```text
Efficiency(p) = Speedup(p) / p
```

Um speedup linear perfeito corresponde a uma eficiência de 1,0 (100%): todo processador está contribuindo exatamente com a sua parte justa. Uma eficiência de 0,5 significa que, em média, cada processador está entregando apenas metade do benefício que teoricamente poderia, devido a overhead de comunicação, sincronização ou desequilíbrio de carga. A eficiência é frequentemente o número mais honesto a reportar do que o speedup sozinho, porque um número de speedup grande alcançado com uma quantidade enorme de processadores ainda pode representar um retorno ruim sobre o hardware de fato usado. Reconhecer isso é exatamente a mesma disciplina contábil de eficiência versus produção bruta em qualquer sistema com recursos limitados.

### Por que o tempo bruto sozinho não basta

Um programa paralelo que termina em 2 segundos não é automaticamente "bom": se a versão sequencial também terminava em 2,1 segundos, o speedup mal passa de 1, o que significa que o esforço de paralelização comprou quase nada apesar de (presumivelmente) usar muitos processadores. Speedup e eficiência forçam a comparação a ser sempre relativa à melhor linha de base sequencial, que é a única forma de avaliar honestamente se o esforço de paralelização (e a complexidade extra de comunicação, sincronização e decomposição que ele exigiu) de fato valeu a pena.

## Exemplos Resolvidos

### Exemplo 1: Calculando speedup e eficiência a partir de tempos medidos

Um programa sequencial de ordenação leva T(1) = 80 segundos. O mesmo algoritmo, paralelizado, é medido em diferentes quantidades de processadores:

```text
Processadores (p) T(p)      Speedup = T(1)/T(p)   Eficiência = Speedup/p
---------------  --------  ---------------------  -----------------------
1                 80s       1,0                     1,00 (100%)
2                 42s       1,90                    0,95 (95%)
4                 24s       3,33                    0,83 (83%)
8                 16s       5,00                    0,63 (63%)
16                12s       6,67                    0,42 (42%)
```

O padrão a notar: a eficiência declina de forma constante conforme processadores são adicionados, mesmo com o speedup continuando a aumentar, uma assinatura clássica do mundo real dos overheads de comunicação e sincronização discutidos nos conceitos anteriores, que crescem em relação à fatia (agora menor) do trabalho real por processador. Este padrão de eficiência declinante é precisamente o que a Lei de Amdahl, coberta a seguir, explica matematicamente.

### Exemplo 2: Um speedup superlinear, explicado honestamente

Uma computação matricial tem T(1) = 100 segundos em um processador, onde a matriz completa não cabe no cache desse processador, forçando muitos acessos lentos à memória principal. Em 4 processadores, cada um trabalhando num quarto da matriz que *cabe* inteiramente no seu cache local, T(4) = 20 segundos.

```text
Speedup(4) = 100s / 20s = 5,0     (maior que 4 processadores: superlinear)
Efficiency(4) = 5,0 / 4 = 1,25    (125%: maior que 100%)
```

Este resultado é real e reproduzível, não um artefato de medição. A explicação é que a própria linha de base sequencial estava prejudicada por cache misses que o conjunto de trabalho menor por processador da versão paralela evitava inteiramente (uma aplicação direta dos conceitos de hierarquia de memória e localidade de Arquitetura de Computadores). Reportar um speedup superlinear sem esse tipo de explicação seria enganoso; reportá-lo *com* a explicação é legítimo e instrutivo.

## Equívocos Comuns e Armadilhas

- **"Speedup superlinear é impossível e deve ser um erro de medição."** É real e bem documentado, quase sempre atribuível a efeitos de cache ou da hierarquia de memória que penalizam a linha de base sequencial mais do que a versão paralela, mas sempre merece uma explicação, não só um número reportado.
- **"Um tempo de relógio mais rápido sempre significa um bom speedup."** Speedup e eficiência são sempre relativos à *melhor linha de base sequencial disponível*. Um tempo paralelo rápido ao lado de uma linha de base sequencial mal otimizada pode produzir um número de speedup enganosamente grande, que diz mais sobre a linha de base fraca do que sobre a paralelização.
- **"Eficiência acima de 1,0 (100%) é sinal de erro de cálculo."** É incomum, mas legítimo (speedup superlinear, Exemplo 2); deveria motivar uma investigação sobre o *porquê*, não uma suposição de que o próprio número está errado.
- **"Speedup e eficiência só são úteis para medir programas prontos."** São igualmente úteis como ferramentas *preditivas* antes de escrever código: a Lei de Amdahl e a Lei de Gustafson, cobertas a seguir, usam exatamente este framework de speedup para prever o desempenho alcançável a partir apenas da estrutura de uma decomposição, antes que qualquer código seja rodado.

## Resumo

Speedup(p) = T(1)/T(p) mede quantas vezes uma versão paralela é mais rápida do que a melhor linha de base sequencial em p processadores; Efficiency(p) = Speedup(p)/p normaliza isso pela quantidade de processadores para medir quão bem a fatia de trabalho de cada processador está de fato sendo aproveitada. O speedup linear (Speedup = p, Eficiência = 100%) é o ideal, raramente alcançado por causa do overhead de comunicação, sincronização e desequilíbrio de carga; o speedup superlinear (Speedup > p) é real, mas sempre remete a um efeito específico e explicável, mais comumente a localidade de cache. Estas duas métricas são o vocabulário preciso que os próximos três conceitos (Lei de Amdahl, Lei de Gustafson e escalabilidade forte/fraca) usam para explicar e prever exatamente como o speedup se comporta conforme a quantidade de processadores cresce.

## Documentation Links

- [LLNL: Introduction to Parallel Computing Tutorial](https://hpc.llnl.gov/documentation/tutorials/introduction-parallel-computing-tutorial): fonte para os conceitos de desempenho de speedup e eficiência.
- [UC Berkeley CS267: Applications of Parallel Computers](https://sites.google.com/lbl.gov/cs267-spr2024): curso real que confirma speedup/eficiência como métricas de desempenho fundamentais antes de introduzir as leis de Amdahl e Gustafson.
