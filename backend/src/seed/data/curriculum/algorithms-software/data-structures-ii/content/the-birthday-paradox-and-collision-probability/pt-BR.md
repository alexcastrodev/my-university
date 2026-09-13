---
version: 1.0
updatedAt: 2026-09-13
title: O Paradoxo do Aniversário e a Probabilidade de Colisão
summary: A probabilidade de colisão entre n chaves em m slots depende de n² relativo a m, não de n relativo a m, então colisões se tornam prováveis com aproximadamente n ≈ √m chaves, muito antes da tabela estar perto de cheia.
---
## Objetivos de Aprendizagem

- Enunciar precisamente o paradoxo do aniversário: com apenas 23 pessoas, há mais de 50% de chance de que duas compartilhem um aniversário, apesar de existirem 365 aniversários possíveis.
- Derivar a fórmula geral para a probabilidade de pelo menos uma colisão entre `n` itens espalhados em `m` slots, e explicar por que ela cresce muito mais rápido do que a intuição sugere.
- Conectar o paradoxo do aniversário diretamente a colisões em tabelas hash: uma tabela hash começa a acumular colisões muito antes de estar perto de cheia.
- Explicar por que isso importa especificamente para uma função hash *fixa* sob entrada adversarial ou meramente azarada, motivando os próximos dois conceitos.
- Calcular, para um tamanho de tabela concreto, o número de entradas no qual colisões se tornam prováveis, não apenas possíveis.

## Contexto e Motivação

Estruturas de Dados I estabeleceu o que é uma colisão e como resolvê-la, por meio de encadeamento ou endereçamento aberto, e o conceito anterior na sequência de tópicos desta disciplina sobre fator de carga mostrou como o desempenho degrada conforme uma tabela enche. O que nenhum desse material abordou diretamente é uma pergunta genuinamente contraintuitiva: em que ponto uma colisão de fato deveria ser *esperada*? Uma intuição natural, mas errada, diz "não até a tabela estar perto de cheia", raciocinando por analogia com um estacionamento quase cheio, onde a maioria das vagas já está ocupada. Colisões em tabelas hash não se comportam assim, e a razão é uma peça famosa de probabilidade, geralmente introduzida através de aniversários em vez de tabelas hash, que generaliza diretamente para explicar por quê: com surpreendentemente poucos itens e uma tabela surpreendentemente vazia, uma colisão já é mais provável do que não. Este conceito trabalha essa matemática surpreendente em si; os próximos dois conceitos a usam para explicar duas respostas muito diferentes que o design de tabelas hash deu a ela.

## Teoria Central

### O paradoxo do aniversário, enunciado e resolvido

A forma clássica da pergunta: quantas pessoas precisam estar em uma sala antes de haver mais de 50% de chance de que duas delas compartilhem um aniversário (ignorando anos bissextos, então 365 aniversários igualmente prováveis)? A intuição, ancorada em "365 é um número grande", tipicamente chuta algo na casa das centenas. A resposta real é 23.

O cálculo é mais fácil feito computando a probabilidade de *nenhum* aniversário compartilhado e subtraindo de 1. Com `k` pessoas, o aniversário da primeira pessoa pode ser qualquer um (probabilidade 1); o aniversário da segunda pessoa precisa evitar o da primeira (probabilidade 364/365); o da terceira precisa evitar os dois anteriores (probabilidade 363/365); e assim por diante, até a k-ésima pessoa evitar todos os `k-1` aniversários anteriores (probabilidade (365-k+1)/365). Multiplicar tudo isso dá a probabilidade de *nenhuma* colisão entre todas as `k` pessoas:

```
P(nenhum aniversário compartilhado) = (365/365) · (364/365) · (363/365) · ... · ((365-k+1)/365)
```

Para `k = 23`, esse produto resulta em aproximadamente 0,493, o que significa `P(pelo menos um aniversário compartilhado) = 1 - 0,493 ≈ 0,507`, pouco mais de 50%. A razão pela qual isso desafia a intuição é que a quantidade relevante não é "quantas pessoas comparadas a 365 aniversários possíveis" (23 de 365 de fato parece pequeno), mas sim "quantos *pares* de pessoas", já que qualquer par poderia colidir: com 23 pessoas há `C(23, 2) = 253` pares distintos, e 253 chances quase independentes de correspondência, de 365 aniversários possíveis, é uma fonte muito mais plausível de colisão do que 23 pessoas sozinhas sugerem.

### Generalizando para n itens e m slots

O mesmo cálculo exato, com 365 substituído por `m` (o número de slots da tabela hash, fazendo o papel de "aniversários possíveis") e 23 substituído por `n` (o número de chaves espalhadas, fazendo o papel de "pessoas"), dá a probabilidade de pelo menos uma colisão quando `n` chaves são espalhadas uniformemente ao acaso em `m` slots:

```
P(nenhuma colisão) = (m/m) · ((m-1)/m) · ((m-2)/m) · ... · ((m-n+1)/m)
P(pelo menos uma colisão) = 1 - P(nenhuma colisão)
```

Uma aproximação comumente usada (válida quando `n` é pequeno em relação a `m`, usando `1 - x ≈ e^(-x)` para `x` pequeno) simplifica isso para:

```
P(nenhuma colisão) ≈ e^(-n²/2m)
```

Essa aproximação torna a relação chave explícita: a probabilidade de colisão depende de `n²` em relação a `m`, não de `n` em relação a `m` da forma como o fator de carga depende. Essa relação de `n²` versus `m` é exatamente por que colisões se tornam prováveis com aproximadamente `n ≈ √m`, muito antes de `n` se aproximar de `m` (que é o que uma intuição de "quão cheio está o estacionamento", ou até o fator de carga sozinho, sugeriria).

### Por que isso importa especificamente para tabelas hash

A consequência direta para uma tabela hash com `m` slots é que colisões não são um caso extremo raro reservado para quando a tabela está quase cheia: com apenas cerca de `√m` chaves inseridas (um fator de carga de apenas cerca de `1/√m`, que pode ser um número muito pequeno para uma tabela grande), a probabilidade de já ter encontrado pelo menos uma colisão ultrapassa 50%. É precisamente por isso que toda implementação prática de tabela hash precisa ter uma estratégia de resolução de colisão desde as primeiras inserções, não como um recurso raro: encadeamento e endereçamento aberto, cobertos em Estruturas de Dados I, não são defesas contra um evento improvável, eles lidam com algo que o paradoxo do aniversário mostra que acontece cedo e frequentemente, mesmo sob uma função hash "justa", uniformemente aleatória, sem nenhum adversário envolvido.

## Exemplos Resolvidos

### Exemplo 1: verificando o cálculo de 23 pessoas e 365 dias

**Problema:** Confirme que com 23 pessoas, a probabilidade de um aniversário compartilhado ultrapassa 50%.

**Cálculo:** Multiplicar `(365/365) · (364/365) · (363/365) · ... · (343/365)` (23 termos, até `365 - 23 + 1 = 343`) dá aproximadamente 0,4927. Então `P(pelo menos uma correspondência) = 1 - 0,4927 ≈ 0,5073`, confirmando o resultado clássico: pouco mais de 50%, com apenas 23 pessoas entre 365 aniversários possíveis.

### Exemplo 2: encontrando o ponto de "50% de colisão" para uma tabela hash com m = 1.000.000 slots

**Problema:** Usando a aproximação `P(nenhuma colisão) ≈ e^(-n²/2m)`, estime quantas chaves `n` precisam ser espalhadas em uma tabela de `m = 1.000.000` slots antes de a probabilidade de pelo menos uma colisão ultrapassar 50%.

**Configuração:** Resolva `e^(-n²/2m) = 0,5` para `n`. Tomando o logaritmo natural de ambos os lados: `-n²/2m = ln(0,5) ≈ -0,693`, então `n² = 2m · 0,693 = 1,386m`.

**Cálculo:** Com `m = 1.000.000`: `n² ≈ 1.386.000`, então `n ≈ 1177`.

**Interpretação:** Com uma tabela de um milhão de slots, apenas cerca de 1.177 chaves (um fator de carga de aproximadamente 0,00118, mal acima de um décimo de um por cento de cheia) já são suficientes para tornar uma colisão mais provável do que não. Essa é a versão concreta e numérica de "muito antes da tabela estar perto de cheia" que a Teoria Central descreve, e é exatamente a relação `n ≈ √m` prevista ali (√1.000.000 = 1.000, próximo dos 1.177 calculados precisamente).

## Equívocos Comuns e Armadilhas

- **"Uma colisão só se torna provável quando a tabela está quase cheia."** O Exemplo 2 mostra o oposto para uma tabela grande: uma colisão se torna mais provável do que não com um fator de carga de cerca de 0,1%, longe de a tabela ficar cheia, porque a comparação relevante é `n²` contra `m`, não `n` contra `m`.
- **"O paradoxo do aniversário é uma curiosidade divertida sem aplicação real em computação."** É exatamente o mesmo cálculo, com rótulos diferentes sobre as mesmas duas quantidades (23 pessoas, 365 aniversários vira n chaves, m slots), e é a razão pela qual toda tabela hash precisa de uma estratégia real de resolução de colisão desde suas primeiras inserções, não como uma contingência rara.
- **"Se colisões são assim tão prováveis, tabelas hash não devem ser uma boa ideia de fato."** O desempenho médio O(1) de uma tabela hash já leva colisões regulares em conta, é exatamente para isso que o O(1 + alpha) do encadeamento e as fórmulas de contagem de sondagem do endereçamento aberto de Estruturas de Dados I foram construídos; o paradoxo do aniversário explica *por que* esses mecanismos são essenciais desde cedo, ele não enfraquece o valor prático da estrutura.
- **"Esse cálculo assume algo especial sobre tabelas hash que não se aplica a um processo 'real' aleatório como aniversários."** O cálculo é idêntico nos dois casos; a única suposição necessária é que o mapeamento (aniversário, ou valor de hash) seja próximo de uniformemente aleatório sobre seu intervalo, que é exatamente a suposição que uma "boa" função hash é projetada para aproximar, e exatamente a suposição que o próximo conceito, hashing universal, formaliza e fortalece.

## Resumo

O clássico paradoxo do aniversário (23 pessoas bastam para uma chance melhor que par de um aniversário compartilhado entre 365 possibilidades) não é realmente sobre aniversários, é sobre o número de *pares* entre `n` itens crescendo muito mais rápido que `n` em si, e o mesmo cálculo, com `m` slots substituindo 365 aniversários, se aplica diretamente a tabelas hash: a probabilidade de pelo menos uma colisão entre `n` chaves espalhadas em `m` slots é aproximadamente `1 - e^(-n²/2m)`, se tornando mais provável do que não assim que `n` alcança aproximadamente `√m`, um fator de carga que pode ser uma fração minúscula de 1 para uma tabela grande. É precisamente por isso que resolução de colisão é uma parte de primeira classe, sempre necessária, de qualquer design de tabela hash, não um recurso de caso raro, e isso prepara uma pergunta genuína que os próximos dois conceitos desta disciplina respondem de duas formas muito diferentes: hashing universal trata colisões causadas por um adversário que consegue prever uma função hash fixa, e hashing perfeito elimina colisões completamente para um conjunto de chaves conhecido e estático.

## Documentation Links

- [MIT 6.042 - Mathematics for Computer Science (OCW)](https://ocw.mit.edu/courses/6-042j-mathematics-for-computer-science-fall-2010/): doc
- [Sedgewick & Wayne - Algorithms Lectures (Princeton)](https://algs4.cs.princeton.edu/lectures/): doc
