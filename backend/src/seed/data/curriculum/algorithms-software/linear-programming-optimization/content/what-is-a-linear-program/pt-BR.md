---
version: 1.0
updatedAt: 2026-09-13
title: O Que É um Programa Linear
summary: Um programa linear tem uma função objetivo linear a maximizar ou minimizar, restrições lineares, e tipicamente não-negatividade das variáveis; três regras mecânicas (negar, inverter ≥, dividir =) colocam qualquer PL na forma padrão.
---
## Objetivos de Aprendizagem

- Definir precisamente um programa linear: uma função objetivo linear a otimizar, sujeita a um sistema de restrições lineares (igualdades e/ou desigualdades) e, tipicamente, restrições de não-negatividade sobre as variáveis.
- Traduzir um problema de alocação de recursos em linguagem natural para a forma algébrica de um programa linear.
- Converter um programa linear para a forma padrão (maximizar, todas as restrições como ≤, todas as variáveis não negativas) usando as transformações mecânicas que sempre funcionam.
- Distinguir as variáveis de decisão, a função objetivo, e as restrições de um programa linear entre si, e explicar por que cada uma precisa ser *linear* especificamente.
- Reconhecer por que esta disciplina dedica uma trilha inteira a programas lineares, dado quantos problemas reais de alocação e agendamento se reduzem exatamente a essa forma.

## Contexto e Motivação

Todo paradigma algorítmico coberto em outro lugar neste currículo, dividir para conquistar, guloso, programação dinâmica, fluxo em redes, é uma *técnica* voltada para um *formato* específico de problema. Programação linear é diferente em natureza: é uma linguagem de modelagem, geral o suficiente para expressar uma gama enorme de problemas reais de alocação, agendamento e planejamento de recursos, emparelhada com um método de solução de propósito geral (o algoritmo simplex, os próximos vários conceitos desta trilha) que não precisa ser reinventado para cada novo formato de problema da forma como um algoritmo guloso ou de programação dinâmica sob medida precisa. Uma fábrica decidindo quantas unidades de cada produto fabricar dados matéria-prima e horas de trabalho limitadas, uma companhia aérea decidindo como alocar assentos entre classes tarifárias, um planejador de dieta decidindo quanto de cada alimento comprar para atingir metas nutricionais ao menor custo, todos esses são, por trás de seu vocabulário específico, exatamente o mesmo objeto matemático: otimizar uma função linear de algumas variáveis de decisão, sujeita a restrições lineares sobre essas variáveis. Este conceito estabelece esse objeto precisamente, e mostra como traduzir um problema em linguagem natural para ele.

## Teoria Central

### Os três ingredientes de um programa linear

Um **programa linear (PL)** consiste em exatamente três peças, todas construídas a partir de um conjunto de **variáveis de decisão** `x₁, x₂, ..., xₙ`, as quantidades que o problema pede para determinar:

1. **Uma função objetivo linear** a maximizar ou minimizar: `c₁x₁ + c₂x₂ + ... + cₙxₙ`, para alguns coeficientes fixos `c₁, ..., cₙ`.
2. **Um conjunto de restrições lineares**: cada uma uma expressão linear nos `xᵢ` comparada a uma constante via `≤`, `≥`, ou `=`.
3. **Restrições de não-negatividade**, tipicamente `xᵢ ≥ 0` para toda variável, refletindo que a maioria das variáveis de decisão reais (unidades produzidas, horas trabalhadas, recursos alocados) não pode significativamente ser negativa.

A palavra **linear** está fazendo trabalho real e restritivo aqui, não só descrevendo "uma fórmula": todo termo no objetivo e em toda restrição precisa ser uma constante vezes uma variável, somados, nada mais. `3x₁ + 2x₂` é linear; `x₁ · x₂` (um produto de duas variáveis), `x₁²`, e `max(x₁, x₂)` são todos proibidos, isso é exatamente o que separa programação linear do mundo muito mais difícil da otimização não linear geral, e exatamente o que o método simplex (construído ao longo dos próximos conceitos) consegue explorar para um método de solução genuinamente eficiente na prática.

### Traduzindo um problema em palavras para um programa linear

**Problema:** Uma marcenaria fabrica mesas e cadeiras. Cada mesa exige 4 horas de carpintaria e 2 horas de acabamento, e vende com lucro de $70. Cada cadeira exige 2 horas de carpintaria e 1 hora de acabamento, e vende com lucro de $30. A marcenaria tem 40 horas de carpintaria e 20 horas de acabamento disponíveis esta semana. Quantas mesas e cadeiras deveria fabricar para maximizar o lucro?

**Tradução.** Seja `x₁` = número de mesas, `x₂` = número de cadeiras (as variáveis de decisão). O objetivo é maximizar lucro: `maximizar 70x₁ + 30x₂`. O tempo de carpintaria é limitado: `4x₁ + 2x₂ ≤ 40`. O tempo de acabamento é limitado: `2x₁ + x₂ ≤ 20`. Nenhuma quantidade pode ser negativa: `x₁ ≥ 0, x₂ ≥ 0`. Reunindo:

```
maximizar   70x₁ + 30x₂
sujeito a    4x₁ + 2x₂ ≤ 40
             2x₁ +  x₂ ≤ 20
             x₁, x₂ ≥ 0
```

Este é um programa linear completo: um objetivo linear, duas restrições lineares de desigualdade, e não-negatividade.

### Forma padrão

Fontes diferentes enunciam restrições em direções diferentes (`≤`, `≥`, `=`) e pedem tanto maximização quanto minimização; para ter um formato canônico único contra o qual o método simplex (o próximo conceito) possa ser construído uniformemente, um programa linear é colocado na **forma padrão**: maximizar um objetivo, sujeito a toda restrição expressa como `≤`, com toda variável não negativa. Três regras mecânicas colocam qualquer PL nesse formato:

- **Minimizar → maximizar.** `minimizar z` é equivalente a `maximizar -z` (resolva o objetivo negado, depois negue o valor ótimo de volta no final).
- **`≥` → `≤`.** Multiplique ambos os lados de uma restrição `≥` por `-1`, invertendo a desigualdade: `2x₁ + x₂ ≥ 8` se torna `-2x₁ - x₂ ≤ -8`.
- **`=` → duas restrições `≤`.** Uma igualdade `aᵀx = b` é equivalente ao par `aᵀx ≤ b` e `aᵀx ≥ b` (a segunda então convertida para forma `≤` pela regra anterior), já que um valor satisfaz a igualdade exatamente quando satisfaz ambas as desigualdades simultaneamente.

Essas três regras são puramente mecânicas e sempre aplicáveis, então *qualquer* programa linear, independente de como suas restrições acontecem de estar escritas, pode ser reescrito na forma padrão sem mudar sua região factível real ou seu valor ótimo em nada, só a apresentação superficial.

## Exemplos Resolvidos

### Exemplo 1: traduzindo um problema de planejamento de dieta

**Problema:** Um plano de refeição precisa de pelo menos 20 unidades de proteína e pelo menos 15 unidades de vitamina C por dia, usando dois alimentos. O Alimento A fornece 4 unidades de proteína e 1 unidade de vitamina C por porção, a um custo de $2 por porção. O Alimento B fornece 2 unidades de proteína e 3 unidades de vitamina C por porção, a um custo de $3 por porção. Minimize o custo enquanto atende ambos os mínimos nutricionais.

**Tradução.** Seja `x₁` = porções do Alimento A, `x₂` = porções do Alimento B.

```
minimizar   2x₁ + 3x₂
sujeito a   4x₁ + 2x₂ ≥ 20   (proteína)
             x₁ + 3x₂ ≥ 15   (vitamina C)
            x₁, x₂ ≥ 0
```

### Exemplo 2: convertendo o Exemplo 1 para a forma padrão

**Problema:** Converta o programa linear do Exemplo 1 para a forma padrão (maximizar, todas as restrições como `≤`).

**Passo 1, minimizar → maximizar:** `minimizar 2x₁ + 3x₂` se torna `maximizar -2x₁ - 3x₂` (o custo ótimo, uma vez encontrado, é recuperado negando o valor maximizado de volta).

**Passo 2, `≥` → `≤`:** `4x₁ + 2x₂ ≥ 20` se torna `-4x₁ - 2x₂ ≤ -20`. `x₁ + 3x₂ ≥ 15` se torna `-x₁ - 3x₂ ≤ -15`.

**Forma padrão:**

```
maximizar   -2x₁ - 3x₂
sujeito a   -4x₁ - 2x₂ ≤ -20
             -x₁ - 3x₂ ≤ -15
              x₁, x₂ ≥ 0
```

Isso representa exatamente o mesmo problema subjacente do Exemplo 1, só reescrito de forma que toda restrição é um `≤` e o objetivo é uma maximização, exatamente o formato uniforme que o método simplex do próximo conceito é construído para consumir diretamente.

## Equívocos Comuns e Armadilhas

- **"Qualquer problema de otimização com um objetivo e algumas restrições é um programa linear."** Linearidade é um requisito estrito e verificável sobre todo termo único: `x₁ · x₂`, `1/x₁`, `x₁²`, e `|x₁|` são todas expressões comuns que imediatamente desqualificam uma formulação de ser um PL; um problema com qualquer termo desses precisa de uma classe de técnica de otimização inteiramente diferente (geralmente muito mais difícil).
- **"Converter `≥` para `≤` muda a resposta real do problema."** A conversão `aᵀx ≥ b ⟺ -aᵀx ≤ -b` é uma equivalência algébrica exata, não uma aproximação, ambas expressam identicamente o mesmo conjunto de valores `x` factíveis; a forma padrão é uma mudança de apresentação, nunca uma mudança do problema subjacente ou de sua solução ótima.
- **"Não-negatividade (`xᵢ ≥ 0`) é só mais uma restrição entre várias, sem status especial."** Ela é tratada separadamente da lista geral de restrições especificamente porque o método simplex (o próximo conceito) é construído para explorá-la diretamente como uma suposição estrutural, não como só mais uma linha no sistema de restrições; uma variável que genuinamente precisa ser negativa exige uma substituição explícita (dividindo-a em uma diferença de duas variáveis não negativas) antes que a forma padrão se aplique.
- **"A resposta do exemplo da marcenaria é obviamente 10 mesas e 0 cadeiras, já que mesas são mais lucrativas por unidade."** Lucro por unidade sozinho ignora o custo de recurso *relativo* de cada produto contra as restrições específicas vinculantes; a mistura ótima real (encontrada pelos métodos dos próximos conceitos, não por inspeção) depende de como as duas restrições interagem, e maximizar gulosamente o item de maior lucro primeiro, um atalho tentador mas injustificado, é exatamente o tipo de raciocínio que programação linear substitui por um método que de fato é garantido correto.

## Resumo

Um programa linear é construído a partir de variáveis de decisão, uma função objetivo linear a maximizar ou minimizar, um conjunto de restrições lineares, e (tipicamente) restrições de não-negatividade, com "linear" excluindo estritamente produtos de variáveis, potências, e termos não lineares semelhantes. Qualquer problema real de alocação ou agendamento cujos custos e limites se combinem aditivamente se traduz diretamente para essa forma, como os exemplos da marcenaria e do planejamento de dieta mostram. Três regras mecânicas, negar para converter minimizar em maximizar, inverter `≥` em `≤` por negação, dividir `=` em um par de restrições `≤`, colocam qualquer programa linear na forma padrão sem alterar sua região factível real ou valor ótimo, dando o formato uniforme que todo método no resto desta trilha é construído para consumir. O próximo conceito se volta para como a região factível de um programa linear realmente se parece geometricamente, e por que essa geometria é a chave para resolver um.

## Documentation Links

- [MIT 6.251 - Introduction to Mathematical Programming (OCW)](https://ocw.mit.edu/courses/6-251j-introduction-to-mathematical-programming-fall-2009/): doc
- [Stanford CS261 - Optimization and Algorithmic Paradigms](https://web.stanford.edu/class/cs261/): doc
