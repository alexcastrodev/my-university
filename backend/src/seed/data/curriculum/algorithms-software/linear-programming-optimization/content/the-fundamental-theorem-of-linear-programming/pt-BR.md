---
version: 1.0
updatedAt: 2026-09-13
title: O Teorema Fundamental da Programação Linear
summary: Sempre que um programa linear com região factível limitada tem uma solução ótima, pelo menos uma solução ótima ocorre em um vértice, provado por convexidade e linearidade, reduzindo a busca de um contínuo infinito para uma lista finita de vértices.
---
## Objetivos de Aprendizagem

- Enunciar precisamente o Teorema Fundamental da Programação Linear: se um programa linear tem uma solução ótima, pelo menos uma solução ótima ocorre em um vértice da região factível.
- Provar o teorema para o caso de uma região factível limitada, usando convexidade e a linearidade da função objetivo.
- Definir um vértice algebricamente, não só visualmente: um ponto factível onde restrições suficientes estão simultaneamente justas (satisfeitas com igualdade) para fixar um único ponto.
- Explicar por que esse teorema é o que transforma resolver um programa linear de uma busca infinita em uma finita, em princípio, mesmo antes de qualquer algoritmo específico ser introduzido.
- Conectar a caracterização algébrica de vértice do teorema ao vocabulário de "solução básica factível" que o método simplex usa.

## Contexto e Motivação

O conceito anterior mostrou, por exemplo direto, que o ótimo de um programa linear sempre parecia pousar em um vértice da região factível, nunca estritamente dentro dela. Essa observação, demonstrada em dois exemplos específicos, é promovida aqui a um teorema totalmente geral e provado, um que vale para todo programa linear com qualquer número de variáveis e restrições, não só os quadros de duas variáveis que um gráfico consegue mostrar. Esse teorema é o único fato de sustentação por trás de tudo que o resto desta trilha constrói: sem ele, "busque a região factível pelo melhor ponto" significaria buscar um contínuo infinito de possibilidades; com ele, a busca comprovadamente colapsa para uma lista finita (embora potencialmente grande) de vértices candidatos, que é exatamente o que torna um algoritmo sistemático como o simplex, o próximo conceito, possível de forma alguma.

## Teoria Central

### O teorema, enunciado precisamente

**Teorema Fundamental da Programação Linear.** Considere um programa linear cuja região factível é não vazia e limitada. Então uma solução ótima existe, e pelo menos uma solução ótima ocorre em um vértice da região factível.

O qualificador "pelo menos uma" importa: quando o objetivo acontece de ser paralelo a uma das bordas da região (ou, em dimensões maiores, uma face inteira), todo ponto ao longo dessa borda ou face alcança o mesmo valor ótimo, incluindo seus vértices de extremidade, então o ótimo não é necessariamente único, mas um ótimo localizado em vértice está sempre entre os ótimos que existem.

### Prova, para uma região factível limitada

Seja `P` a região factível (um politopo convexo limitado, estabelecido no conceito anterior), e seja `x*` um ponto em `P` alcançando o valor objetivo máximo `z* = cᵀx*`. Suponha, por contradição, que `x*` *não* seja um vértice de `P`. Então, pela definição de vértice (um ponto que não pode ser escrito como uma média genuína de dois *outros* pontos distintos de `P`), `x*` pode ser expresso como `x* = λx₁ + (1-λ)x₂` para dois pontos distintos `x₁, x₂ ∈ P` e algum `0 < λ < 1`.

Pela linearidade do objetivo: `cᵀx* = λ(cᵀx₁) + (1-λ)(cᵀx₂)`. Já que `cᵀx*` é o valor *máximo* sobre todo `P`, tanto `cᵀx₁ ≤ cᵀx*` quanto `cᵀx₂ ≤ cᵀx*` precisam valer (eles mesmos são pontos factíveis, então nenhum pode exceder o máximo). Mas uma média ponderada de duas quantidades, cada uma no máximo `cᵀx*`, só pode ser igual a `cᵀx*` exatamente se *ambas* as quantidades forem iguais a `cᵀx*` exatamente (se qualquer uma fosse estritamente menor, a média ponderada também seria estritamente menor, uma consequência direta de `λ` e `1-λ` serem ambos estritamente positivos). Então `cᵀx₁ = cᵀx₂ = cᵀx* = z*`: tanto `x₁` quanto `x₂` são eles mesmos ótimos.

Isso mostra que sempre que um máximo é alcançado em um ponto que não é vértice, ele também é alcançado em outros pontos, e esse argumento pode ser aplicado novamente a `x₁` (ou `x₂`) se qualquer um deles não for ele mesmo um vértice, repetindo a mesma decomposição. Como `P` tem apenas finitos vértices (uma consequência de ser um politopo, uma interseção de finitos semiespaços), esse processo não pode continuar para sempre sem eventualmente alcançar um ponto que genuinamente não pode ser decomposto mais, que é precisamente a definição de um vértice. Esse vértice é ótimo, provando o teorema.

### Um vértice, caracterizado algebricamente

O quadro geométrico (um "canto" onde bordas se encontram) tem uma contraparte algébrica exata que generaliza limpamente além de duas dimensões, e sobre a qual o método simplex do próximo conceito opera diretamente: para um programa linear em `n` variáveis com `m` restrições (depois de adicionar variáveis de folga para transformar toda desigualdade em uma igualdade, um passo mecânico que este conceito antecipa e o próximo conceito realiza explicitamente), um **vértice** corresponde a uma solução onde pelo menos `n` das `m + n` variáveis totais (originais mais folga) são definidas como exatamente `0`, com os valores das variáveis restantes fixados unicamente pelas `m` restrições de igualdade. Isso é exatamente o que "restrições suficientes simultaneamente justas" significa algebricamente: definir `n` variáveis como `0` é equivalente a fazer `n` das restrições de desigualdade originais (ou restrições de não-negatividade) se vincularem com igualdade, e um sistema de `m` equações em `m` incógnitas restantes tem, genericamente, exatamente uma solução, precisamente um único ponto, um vértice.

### Por que isso torna a busca finita

Um politopo definido por `m` restrições em `n` dimensões tem no máximo `C(m+n, n)` vértices (escolhendo quais `n` variáveis definir como zero, de `m+n` no total, um limite superior já que nem toda escolha assim produz um ponto factível), um número finito, por maior que seja, para qualquer tamanho de problema *fixo*. A garantia do Teorema Fundamental, um ótimo existe em um vértice, portanto reduz resolver um programa linear, em princípio, a calcular o objetivo em cada um desses finitos pontos candidatos e pegar o melhor. Isso ainda não é um algoritmo eficiente (verificar todo vértice diretamente é em si exponencialmente lento para problemas grandes, já que a própria contagem de vértices pode crescer combinatorialmente), mas é a redução crucial de um espaço de busca incontavelmente infinito para um combinatório, bem definido e finito, exatamente a redução que o método simplex do próximo conceito explora com uma estratégia de busca muito mais inteligente do que verificar todo vértice exaustivamente.

## Exemplos Resolvidos

### Exemplo 1: verificando o teorema diretamente no exemplo do conceito anterior

**Problema:** Para o PL modificado da marcenaria do conceito anterior (`maximizar 70x₁ + 90x₂`, `x₁+x₂≤10`, `x₁+3x₂≤24`, `x₁,x₂≥0`, vértice ótimo `(3,7)` no valor `840`), confirme que `(3,7)` genuinamente não pode ser escrito como uma média não trivial de dois outros pontos factíveis distintos, verificando que é um vértice verdadeiro, não um ponto interior se disfarçando de um.

**Verificando:** `(3,7)` fica exatamente em ambas as fronteiras de restrição simultaneamente: `x₁+x₂=3+7=10` (justa) e `x₁+3x₂=3+21=24` (justa). Com duas equações lineares independentes fixando ambas as coordenadas exatamente, não há direção para perturbar `(3,7)` que mantenha ambas as equações satisfeitas, qualquer ponto factível próximo em qualquer direção viola pelo menos uma das duas restrições justas. Essa é exatamente a assinatura algébrica de um vértice: duas restrições justas (correspondendo à contagem necessária para fixar um ponto em duas dimensões), sem deixar liberdade para expressá-lo como uma média de dois pontos factíveis distintos.

### Exemplo 2: aplicando o argumento de decomposição da prova a um ponto que não é vértice

**Problema:** Na mesma região factível, considere o ponto `(5, 5)`. Verifique que é factível, mostre que não é um vértice, e use a técnica de decomposição do teorema para encontrar dois pontos factíveis cuja média dá esse ponto com valor objetivo igual ou maior.

**Verificação de factibilidade:** `x₁+x₂=10≤10` ✓ (justa). `x₁+3x₂=5+15=20≤24` ✓ (não justa). Então `(5,5)` é factível, mas só *uma* restrição está justa (mais nenhuma restrição de não-negatividade), uma a menos que as duas necessárias para fixar um vértice em duas dimensões, confirmando que `(5,5)` não é um vértice.

**Decomposição:** Já que só `x₁+x₂=10` está justa, `(5,5)` fica ao longo da borda inteira de pontos satisfazendo `x₁+x₂=10` com `x₁+3x₂≤24`, essa borda vai de `(10,0)` (`700`, calculado anteriormente) a `(3,7)` (`840`, calculado anteriormente). Escrevendo `(5,5)` como uma combinação desses dois extremos: `(5,5) = λ(10,0) + (1-λ)(3,7)` dá `5 = 10λ + 3(1-λ) = 3 + 7λ`, então `λ = 2/7`. O objetivo em `(5,5)` é `70(5)+90(5)=350+450=800`, que de fato fica entre `700` e `840` como a prova do teorema prevê (uma média ponderada dos dois valores extremos: `(2/7)(700) + (5/7)(840) = 200 + 600 = 800` ✓), e estritamente menor que o `840` do vértice `(3,7)`, confirmando que o ponto que não é vértice não é ele mesmo ótimo, exatamente como a prova do teorema argumenta que eventualmente deve ser o caso ao rastrear de volta a partir de qualquer ponto não ótimo e não vértice.

## Equívocos Comuns e Armadilhas

- **"O teorema diz que o ótimo é sempre único."** Ele diz que um ótimo sempre ocorre *em* um vértice, não que ocorre *apenas* ali; quando o objetivo é paralelo a uma borda, todo ponto naquela borda, não só seus vértices de extremidade, alcança o mesmo valor ótimo, então múltiplos ótimos (uma borda ou face inteira deles) podem existir simultaneamente.
- **"Um ponto onde uma restrição está justa é um vértice."** O ponto `(5,5)` do Exemplo 2 tem exatamente uma restrição justa e é explicitamente mostrado como não sendo um vértice; um vértice em `n` dimensões genericamente exige `n` restrições (ou variáveis limitadas) simultaneamente justas, não meramente uma.
- **"Este teorema só se aplica a problemas de duas variáveis que podem ser desenhados."** A prova dada aqui usa só convexidade e linearidade, argumentos que não fazem referência a nenhuma contagem específica de dimensão; o teorema vale com generalidade total para qualquer número de variáveis e restrições, que é precisamente por que ele sustenta a capacidade do método simplex de lidar com problemas com milhares de variáveis, muito além do que qualquer quadro poderia mostrar diretamente.
- **"Se um programa linear é ilimitado (no objetivo, não só na região), o teorema ainda garante um ótimo localizado em vértice."** O teorema como provado aqui assume explicitamente uma região factível limitada; quando o objetivo é ilimitado (uma possibilidade genuína, como notado no conceito anterior), nenhum ótimo existe de forma alguma, em um vértice ou em qualquer lugar, e a conclusão do teorema simplesmente não se aplica a esse caso, um resultado distinto que os algoritmos dos próximos conceitos precisam detectar e relatar em vez de buscar indefinidamente.

## Resumo

O Teorema Fundamental da Programação Linear enuncia que sempre que um programa linear (com região factível limitada) tem uma solução ótima, pelo menos uma solução ótima ocorre em um vértice, provado por convexidade: qualquer ponto ótimo que não seja vértice pode ser escrito como uma média de dois outros pontos factíveis, e a linearidade força ambos os pontos a serem igualmente ótimos, uma decomposição que pode ser repetida até que um vértice genuíno, que não pode ser decomposto mais, seja alcançado. Algebricamente, um vértice em `n` dimensões corresponde a um ponto onde `n` restrições (ou restrições de não-negatividade) estão simultaneamente justas, fixando-o unicamente, exatamente o vocabulário de "solução básica factível" em torno do qual o método simplex do próximo conceito é construído. Esse teorema é o que transforma "busque a região factível inteira" em "busque uma lista finita de vértices", uma redução de um espaço de busca incontável para um combinatório, mesmo que verificar todo vértice diretamente permaneça lento demais para ser um algoritmo prático por si só. O próximo conceito introduz o método simplex: uma forma de se mover de vértice para vértice adjacente, sempre melhorando o objetivo, sem nunca precisar enumerar todo vértice da forma como uma verificação de força bruta faria.

## Documentation Links

- [MIT 6.251 - Introduction to Mathematical Programming (OCW)](https://ocw.mit.edu/courses/6-251j-introduction-to-mathematical-programming-fall-2009/): doc
- [Stanford CS261 - Optimization and Algorithmic Paradigms](https://web.stanford.edu/class/cs261/): doc
