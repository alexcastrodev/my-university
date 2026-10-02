---
version: 1.0
updatedAt: 2026-09-06
title: Políticas de Substituição de Cache
summary: Quando um conjunto está cheio e um bloco novo precisa entrar, algo tem de ser despejado. O menos recentemente usado (LRU, e suas aproximações mais baratas em hardware), o FIFO e o aleatório são as políticas reais em uso, cada uma uma aposta diferente sobre qual linha residente tem menos chance de ser reutilizada em breve.
---
## Objetivos de Aprendizagem

- Explicar por que uma política de substituição só é uma pergunta com sentido quando a cache tem mais de uma via por conjunto.
- Descrever a política Least Recently Used (LRU, menos recentemente usado) e o raciocínio baseado em localidade por trás dela.
- Explicar por que o LRU exato é caro de implementar com associatividade maior e descrever uma aproximação real e mais barata.
- Comparar o LRU com a substituição FIFO e aleatória e dar um padrão de acesso concreto em que o LRU supera o FIFO.
- Rastrear qual bloco é despejado sob LRU para uma dada sequência de acessos dentro de um conjunto.

## Contexto e Motivação

O conceito anterior deu a uma cache associativa por conjunto mais de um lugar onde um bloco *pode* ficar dentro de um conjunto, mas deixou deliberadamente em aberto exatamente qual das N vias é escolhida quando um bloco novo precisa entrar e toda via do conjunto alvo já está ocupada. Essa escolha importa: escolha bem, e o bloco despejado é um que dificilmente será necessário de novo em breve; escolha mal, e a cache despeja um bloco logo antes de ele ser reutilizado, transformando o que poderia ser um acerto numa falha evitável.

Este conceito se liga naturalmente à primeira ideia da discussão de hierarquia de memória deste bloco: a localidade temporal, a observação empírica de que um local usado recentemente provavelmente vai ser usado de novo em breve. Toda política de substituição séria é, no fundo, uma tentativa de transformar esse mesmo princípio numa regra de despejo concreta e implementável.

## Teoria Central

### Por que a substituição é trivial no mapeamento direto

O mapeamento direto (uma via por conjunto) nunca precisa de fato de uma política de substituição: quando um conjunto (de um) já guarda um bloco e um bloco novo mapeia para ele, há exatamente um ocupante a despejar; não existe escolha. A pergunta que este conceito desenvolve só ganha sentido, e interesse, quando um conjunto tem duas ou mais vias entre as quais escolher, e é exatamente por isso que ela vem depois da associatividade por conjunto na sequência deste bloco.

### Least Recently Used (LRU): transformando a localidade temporal diretamente em regra

A política **LRU** despeja, entre as vias do conjunto alvo, a que foi acessada há mais tempo. O raciocínio é uma aplicação direta e literal da localidade temporal: se um bloco não é tocado há algum tempo, em relação aos seus companheiros de conjunto, é uma aposta razoável que ele tenha menos chance de ser tocado de novo em breve do que os blocos que *foram* acessados mais recentemente. O LRU exato exige acompanhar uma ordenação de recência completa e válida entre todas as vias de um conjunto, atualizada a cada acesso a esse conjunto. Para um conjunto de 2 vias, isso é barato (um bit basta, invertido para indicar qual via foi acessada mais recentemente); para associatividades maiores (digamos, 8 ou 16 vias), acompanhar uma ordenação exata de 8 ou 16 itens exige significativamente mais estado e uma lógica de atualização mais complexa a cada acesso.

### Por que o hardware real muitas vezes aproxima o LRU

Como o custo de hardware do LRU exato cresce mais que linearmente com a associatividade, muitos projetos reais de cache usam uma aproximação mais barata em vez da política exata. Por exemplo, um esquema "pseudo-LRU", que usa uma pequena árvore binária de bits únicos para acompanhar aproximadamente a recência com muito menos estado do que uma ordenação exata exigiria, ou um esquema no estilo "clock" / "não usado recentemente" (familiar da literatura de substituição de páginas de sistemas operacionais que o `operating-systems-i` desta disciplina vai desenvolver mais), que limpa periodicamente bits de "usado" e despeja entre os que não foram marcados recentemente. Essas aproximações sacrificam um pouco de precisão em troca de um hardware bem mais barato e, na prática, têm desempenho perto o bastante do LRU exato para que a diferença raramente importe para o desempenho geral do sistema.

### FIFO e aleatório: alternativas mais simples, com trocas reais

O **FIFO** (primeiro a entrar, primeiro a sair) despeja a via cujo bloco foi trazido para a cache há mais tempo, não importa quão recentemente ele tenha sido de fato *usado*. É barato de implementar (um único contador por conjunto, rodando entre as vias), mas pode despejar um bloco que acabou de ser acessado um instante antes só porque ele por acaso chegou cedo, ignorando o padrão real de acesso que o LRU é projetado para acompanhar. A substituição **aleatória** escolhe uma via para despejar de forma uniformemente aleatória: é trivialmente barata em hardware (nenhum estado a manter entre acessos) e, surpreendentemente, tem desempenho razoável na prática com associatividades maiores, porque com vias suficientes a chance de despejar ao acaso justamente o bloco prestes a ser reutilizado é simplesmente baixa.

## Exemplos Resolvidos

### Exemplo 1: o LRU evitando corretamente um despejo ruim que o FIFO faz

Considere um conjunto de 2 vias que guarda inicialmente os blocos A (trazido primeiro) e B (trazido em segundo, e também o *acessado* mais recentemente, já que acabou de ser buscado). Uma sequência de acessos seguinte para este conjunto: acessa A (tornando A o mais recentemente usado), depois um bloco novo C precisa entrar.

```text
Ordem de acessos até agora: A trazido, B trazido, A acessado de novo.
Recência (LRU):  B agora é o menos recentemente usado (A acabou de ser acessado de novo;
                 B não é tocado desde que foi trazido originalmente).
Ordem FIFO:      A foi trazido primeiro, então o FIFO despejaria A, apesar de
                 A ter ACABADO de ser acessado.

O LRU despeja:  B   (correto: B é de fato o tocado há mais tempo)
O FIFO despeja: A   (escolha ruim: A acabou de ser acessado e agora se foi)
```

É precisamente o cenário em que a contabilidade extra do LRU se paga: o FIFO, ignorando o uso real, despeja o bloco que acabou de provar ainda ser relevante, enquanto o LRU o protege corretamente.

### Exemplo 2: rastreando o LRU exato numa sequência de acessos mais longa num conjunto de 4 vias

Começando com um conjunto de 4 vias vazio e a sequência de acessos P, Q, R, S, P, T (acessar o bloco T exige um despejo, já que o conjunto agora está cheio com P, Q, R, S):

```text
Depois de P: [P]                    (P o mais recente)
Depois de Q: [P, Q]                 (Q o mais recente)
Depois de R: [P, Q, R]              (R o mais recente)
Depois de S: [P, Q, R, S]            (S o mais recente; conjunto agora cheio)
Depois de P (de novo): a ordem de recência vira Q, R, S, P
                 (Q agora é o MENOS recentemente usado, sem ser tocado
                  desde que foi trazido originalmente)
Trazer T: despeja Q (o menos recentemente usado) → o conjunto vira [R, S, P, T]
```

Q é despejado especificamente porque todo outro bloco do conjunto (R, S e o P recém-acessado de novo) foi tocado mais recentemente que Q: exatamente a contabilidade de que o LRU exato precisa para fazer essa determinação corretamente.

### Exemplo 3: um padrão de acesso patológico em que até o LRU vai mal

Considere um laço que percorre ciclicamente exatamente 5 blocos distintos, repetidas vezes, dentro de um conjunto de 4 vias (um bloco a mais do que as vias disponíveis): ordem de acesso A, B, C, D, E, A, B, C, D, E, ... repetindo.

```text
Quando A é acessado de novo (o 6º acesso do ciclo), ele já foi
despejado há muito tempo (o LRU o despejou depois do 4º acesso seguinte, já que
ele virou o menos recentemente usado no momento em que B, C, D, E foram cada um
tocados depois dele): cada acesso deste padrão é uma FALHA,
sob LRU, FIFO ou aleatório igualmente, porque o conjunto de trabalho (5 blocos)
simplesmente ultrapassa a associatividade (4 vias) disponível neste conjunto.
```

É uma limitação genuína compartilhada por *toda* política de substituição, e não uma falha específica do LRU: nenhuma regra de despejo consegue impedir uma falha quando o conjunto de blocos genuinamente em uso ativo ultrapassa o número de vias disponíveis para guardá-los. Isso é uma limitação de capacidade, e não uma falha da política de substituição, e é exatamente a motivação para escolher, para começo de conversa, uma associatividade e um tamanho total de cache grandes o bastante para o conjunto de trabalho real de um programa.

## Equívocos Comuns e Armadilhas

- **"O LRU é sempre a melhor política possível."** O LRU é uma boa heurística baseada na localidade temporal, mas o Exemplo 3 mostra que ele não oferece proteção alguma quando o número de blocos percorridos ativamente ultrapassa as vias disponíveis. Nenhuma política de substituição corrige uma falta genuína de capacidade; só uma cache maior ou uma associatividade maior conseguem.
- **"O hardware real sempre implementa o LRU exato."** O custo de hardware do LRU exato cresce rápido com a associatividade; muitos projetos reais usam aproximações mais baratas (pseudo-LRU, esquemas no estilo clock) que, na prática, têm desempenho perto o bastante do LRU exato para justificar o hardware mais simples e mais barato.
- **"A substituição aleatória é uma escolha ingênua e ruim comparada ao LRU."** Especificamente com associatividades maiores, a substituição aleatória tem, na prática, desempenho surpreendentemente competitivo com o LRU, e seu custo de hardware trivial (nenhuma atualização de estado por acesso) é uma vantagem de engenharia real e legítima em alguns projetos.
- **"FIFO e LRU sempre produzem a mesma decisão de despejo."** O Exemplo 1 mostra um caso concreto em que eles divergem: o FIFO acompanha só a ordem de chegada, ignorando se um bloco foi reacessado depois, enquanto o LRU reordena explicitamente a cada acesso para refletir o uso recente real.

## Resumo

Uma política de substituição só importa quando um conjunto tem mais de uma via, e seu trabalho é escolher, entre os ocupantes de um conjunto cheio, qual despejar para um bloco que está chegando. O Least Recently Used (LRU) transforma a localidade temporal diretamente em regra, despejando a via tocada há mais tempo, embora o custo de hardware do LRU exato cresça com a associatividade, o que motiva aproximações mais baratas no mundo real; o FIFO (ordem de chegada, ignorando reuso) e a substituição aleatória são alternativas mais simples, com suas próprias trocas reais, e nenhuma política consegue impedir uma falha quando um conjunto de trabalho genuinamente ultrapassa as vias disponíveis, uma limitação de capacidade que nenhuma regra de despejo consegue disfarçar. Tendo coberto como os blocos são encontrados (mapeamento e associatividade) e qual é despejado (substituição), o próximo conceito se volta para o outro lado do trabalho da cache: o que acontece numa *escrita*, e não numa leitura.

## Documentation Links

- [Bryant & O'Hallaron: Computer Systems: A Programmer's Perspective (CS:APP)](https://csapp.cs.cmu.edu/): o Capítulo 6 discute políticas de substituição de cache junto com associatividade e localidade.
- [CMU 15-213: Cache Memories Lecture](http://www.cs.cmu.edu/afs/cs/academic/class/15213-s14/www/lectures/11-cache-memories.pdf): cobre o LRU e seu papel no projeto de caches associativas por conjunto.
