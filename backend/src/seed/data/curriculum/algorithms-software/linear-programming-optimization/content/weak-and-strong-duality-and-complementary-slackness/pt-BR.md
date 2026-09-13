---
version: 1.0
updatedAt: 2026-09-13
title: Dualidade Fraca e Forte, e Folga Complementar
summary: Dualidade fraca prova cᵀx ≤ bᵀy para qualquer par factível; dualidade forte mostra que isso vira igualdade exata no ótimo, lido diretamente dos coeficientes de folga na linha objetivo final do simplex; folga complementar liga precisamente quais variáveis primais positivas forçam quais restrições duais justas.
---
## Objetivos de Aprendizagem

- Provar dualidade fraca: todo valor objetivo dual-factível é um limite superior sobre todo valor objetivo primal-factível, para qualquer par de soluções factíveis.
- Enunciar dualidade forte: na otimalidade, os valores objetivo primal e dual são exatamente iguais, não apenas limitados.
- Ler uma solução dual-ótima diretamente da linha objetivo final de um tableau simplex primal, usando os coeficientes das variáveis de folga, e verificá-la contra o dual resolvido diretamente.
- Enunciar e verificar folga complementar: uma variável primal é positiva só se sua restrição dual correspondente está justa, e uma restrição primal está justa só se sua variável dual correspondente é positiva.
- Usar folga complementar como uma forma rápida de verificar se um par primal-dual proposto poderia possivelmente ser ambos ótimos, sem resolver nenhum dos dois problemas do zero.

## Contexto e Motivação

O conceito anterior construiu o dual de um programa linear e observou, em um exemplo resolvido, que seu valor ótimo correspondia exatamente ao do primal, `840` em ambos os lados, alcançado através de variáveis inteiramente diferentes e uma região factível inteiramente diferente. Este conceito prova que essa correspondência nunca é coincidência, em dois estágios: primeiro a metade fácil (**dualidade fraca**, verdadeira para *qualquer* par factível, provada diretamente das restrições sozinhas), depois a metade profunda (**dualidade forte**, verdadeira especificamente *na* otimalidade, tornada concreta aqui lendo a solução dual ótima diretamente do tableau simplex primal que esta trilha já calculou). Um terceiro resultado, **folga complementar**, então fixa a relação precisa entre quais variáveis primais são positivas e quais restrições duais estão justas.

## Teoria Central

### Dualidade fraca: uma prova curta e geral

**Afirmação.** Para qualquer `x` primal-factível (satisfazendo `Ax ≤ b`, `x ≥ 0`) e qualquer `y` dual-factível (satisfazendo `Aᵀy ≥ c`, `y ≥ 0`): `cᵀx ≤ bᵀy`.

**Prova.** Já que `x ≥ 0` e `Aᵀy ≥ c` (componente a componente), multiplicar ambos os lados da restrição dual pelo `x` não negativo preserva a desigualdade: `xᵀ(Aᵀy) ≥ xᵀc`, ou seja, `(Ax)ᵀy ≥ cᵀx`. Já que `y ≥ 0` e `Ax ≤ b` (a restrição primal), multiplicar ambos os lados pelo `y` não negativo preserva *essa* desigualdade: `(Ax)ᵀy ≤ bᵀy`. Encadeando as duas: `cᵀx ≤ (Ax)ᵀy ≤ bᵀy`. `∎`

Isso vale para *todo* par factível, não só ótimos, o que já tem um uso prático imediato: qualquer `y` dual-factível, seja lá como foi encontrado, certifica um limite superior sobre o valor ótimo do primal (já que o ótimo primal é ele mesmo primal-factível, dualidade fraca se aplica a ele diretamente), e simetricamente qualquer `x` primal-factível certifica um limite inferior sobre o valor ótimo do dual.

### Dualidade forte: lendo a solução dual do tableau primal

**Dualidade forte** enuncia que quando tanto o primal quanto o dual têm soluções ótimas, seus valores objetivo ótimos são *exatamente* iguais, `cᵀx* = bᵀy*`, não apenas relacionados pela desigualdade que a dualidade fraca já estabeleceu. A prova completa desse fato é um argumento substancial (pode ser derivada da geometria da própria condição de término do método simplex, rastreando por que a estrutura do tableau final força igualdade), além do que este conceito reproduz do zero; em vez disso, este conceito torna o resultado concreto e diretamente verificável através de um fato que o simplex entrega de graça: **no tableau ótimo, o coeficiente de cada variável de folga na linha objetivo final é exatamente o valor da variável dual ótima daquela restrição**.

### Folga complementar, enunciada precisamente

**Folga complementar** liga as duas metades de um par primal-dual precisamente, em ambas as direções ao mesmo tempo:

- Para toda variável primal `xⱼ`: se `xⱼ > 0`, então sua restrição dual correspondente vale com **igualdade** (está justa). Equivalentemente, se a restrição dual **não** está justa (tem folga), então `xⱼ` precisa ser exatamente `0`.
- Para toda restrição primal `i`: se essa restrição tem folga (`sᵢ > 0`, não justa), então sua variável dual correspondente `yᵢ` precisa ser exatamente `0`. Equivalentemente, se `yᵢ > 0`, então a restrição primal `i` precisa estar justa.

Ambas as direções decorrem diretamente da prova da dualidade fraca: os dois passos de desigualdade encadeados (`cᵀx ≤ (Ax)ᵀy ≤ bᵀy`) se tornam *igualdades* precisamente na otimalidade (já que a dualidade forte força os dois extremos a corresponder exatamente), o que força cada passo individual de multiplicação nessa cadeia a também ser uma igualdade, exatamente as condições componente a componente que a folga complementar enuncia.

## Exemplos Resolvidos

### Exemplo 1: lendo a solução dual diretamente do tableau final do primal

**Problema:** O conceito do método simplex desta trilha resolveu `maximizar 70x₁ + 90x₂` sujeito a `x₁+x₂≤10`, `x₁+3x₂≤24` e alcançou a linha final do tableau `z + 60s₁ + 10s₂ = 840`. Leia a solução dual-ótima diretamente dessa linha, e verifique que ela corresponde ao dual resolvido independentemente no conceito anterior.

**Lendo o tableau:** As variáveis de folga `s₁` e `s₂` correspondem, em ordem, às duas restrições primais, e portanto às duas variáveis duais `y₁` e `y₂`. Seus coeficientes na linha objetivo final são `60` e `10` respectivamente.

**Verificação:** O conceito anterior resolveu o dual (`minimizar 10y₁+24y₂` sujeito a `y₁+y₂≥70`, `y₁+3y₂≥90`) diretamente pelo método gráfico e encontrou `(y₁,y₂)=(60,10)` no valor `840`. Isso corresponde exatamente à leitura do tableau: `y₁=60`, `y₂=10`, com ambos os valores objetivo iguais a `840`, confirmando a dualidade forte concretamente neste exemplo, e demonstrando que a solução ótima do dual estava, em um sentido real, já dentro do próprio tableau final do primal o tempo todo, sem precisar resolver o dual como um problema separado de forma alguma.

### Exemplo 2: verificando folga complementar no mesmo exemplo resolvido

**Problema:** Usando o primal-ótimo `(x₁,x₂)=(3,7)` e o dual-ótimo `(y₁,y₂)=(60,10)`, verifique ambas as condições de folga complementar: (a) toda variável primal positiva tem uma restrição dual correspondente justa, e (b) toda restrição primal justa tem (ou pode ter) uma variável dual correspondente positiva, enquanto toda restrição primal com folga tem uma variável dual correspondente zero.

**Condição (a), variáveis primais para restrições duais:** `x₁=3>0`, então sua restrição dual (`y₁+y₂≥70`) deveria estar justa: `60+10=70` ✓, exatamente justa. `x₂=7>0`, então sua restrição dual (`y₁+3y₂≥90`) deveria estar justa: `60+30=90` ✓, exatamente justa. Ambas valem.

**Condição (b), restrições primais para variáveis duais:** A primeira restrição primal (`x₁+x₂≤10`) está justa (`3+7=10`), consistente com sua variável dual `y₁=60` sendo positiva. A segunda restrição primal (`x₁+3x₂≤24`) está justa (`3+21=24`), consistente com sua variável dual `y₂=10` sendo positiva. (Nenhuma restrição primal tem folga aqui, então a direção "restrição com folga força sua variável dual a zero" não é exercitada por este exemplo específico, mas é enunciada precisamente na regra geral da Teoria Central acima.)

## Equívocos Comuns e Armadilhas

- **"Dualidade fraca só se aplica a soluções ótimas, o mesmo que dualidade forte."** A prova da dualidade fraca usa só factibilidade (`Ax≤b`, `Aᵀy≥c`, ambos não negativos), nunca otimalidade de forma alguma; vale para qualquer `y` dual-factível emparelhado com qualquer `x` primal-factível, por mais longe que qualquer um esteja do ótimo, que é exatamente o que a torna útil para limitar um ótimo desconhecido a partir de um único palpite factível.
- **"Ler a solução dual dos coeficientes de folga do primal é um atalho que só funciona por coincidência neste exemplo específico."** Este é um fato geral e confiável sobre o tableau final do método simplex, não um artefato dos números deste problema específico; vale porque os custos reduzidos das variáveis de folga na otimalidade são matematicamente idênticos às variáveis duais correspondentes, uma consequência estrutural de como a própria aritmética do método simplex espelha a construção do dual, verificada aqui em vez de apenas afirmada.
- **"Folga complementar diz que uma variável primal positiva e sua restrição dual nunca podem estar ambas justa-e-positiva ao mesmo tempo."** As condições não são mutuamente exclusivas da forma que essa frase implica: o Exemplo 2 mostra `x₁>0` *e* sua restrição dual sendo exatamente justa simultaneamente, isso é precisamente o que a condição exige, não uma contradição; o que folga complementar de fato proíbe é uma variável primal positiva emparelhada com uma restrição dual *com folga* (não justa).
- **"Se uma solução primal e dual propostas ambas parecem plausíveis e folga complementar vale, elas precisam ser ótimas."** Folga complementar valer é uma condição *necessária* para otimalidade (pares verdadeiramente ótimos sempre a satisfazem), verificada no Exemplo 2 para um par já independentemente confirmado ótimo pelo simplex, mas verificá-la sozinha, sem também confirmar que ambas as soluções são de fato factíveis para seus respectivos problemas, não é suficiente por si só para certificar otimalidade; é melhor usada como uma checagem rápida de consistência ou uma ajuda para construir uma solução, não um substituto para verificação de factibilidade.

## Resumo

Dualidade fraca é a metade fácil e geral: para qualquer `x` primal-factível e `y` dual-factível, `cᵀx ≤ bᵀy`, provada diretamente encadeando as restrições primal e dual através de multiplicações não negativas, valendo independente de otimalidade. Dualidade forte é a metade profunda: na otimalidade, essa desigualdade se torna uma igualdade exata, tornada concreta no Exemplo 1 lendo a solução dual-ótima `(60,10)` diretamente do tableau simplex final do primal, correspondendo exatamente ao valor calculado independentemente resolvendo o dual do zero no conceito anterior, ambos alcançando o valor ótimo compartilhado `840`. Folga complementar então fixa precisamente quais pares primal-dual podem coexistir: uma variável primal positiva força sua restrição dual justa, e uma restrição primal com folga força sua variável dual a zero, ambas as direções verificadas concretamente contra os próprios números correntes desta trilha no Exemplo 2. Juntos, esses três resultados são a fundação formal por trás de tudo que o resto desta trilha constrói sobre a relação primal-dual, do algoritmo simplex dual do próximo conceito até a conexão de encerramento desta trilha de volta ao teorema do fluxo máximo/corte mínimo de fluxo em redes.

## Documentation Links

- [MIT 6.251 - Introduction to Mathematical Programming (OCW)](https://ocw.mit.edu/courses/6-251j-introduction-to-mathematical-programming-fall-2009/): doc
- [Stanford CS261 - Optimization and Algorithmic Paradigms](https://web.stanford.edu/class/cs261/): doc
