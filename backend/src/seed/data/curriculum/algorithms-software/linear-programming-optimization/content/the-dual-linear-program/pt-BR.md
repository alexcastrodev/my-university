---
version: 1.0
updatedAt: 2026-09-13
title: O Programa Linear Dual
summary: Todo PL em forma padrão tem um dual construído mecanicamente (trocar max por min, transpor a matriz, trocar lado direito por coeficientes objetivo, inverter desigualdades); cada variável dual é um preço-sombra, e o valor ótimo do dual bate exatamente com o do primal.
---
## Objetivos de Aprendizagem

- Construir o dual de um programa linear em forma padrão (maximizar, todos os `≤`, variáveis não negativas) mecanicamente: trocar a direção do objetivo, transpor a matriz de restrições, trocar os papéis do lado direito e dos coeficientes objetivo, e inverter as direções das restrições.
- Enunciar a receita geral como uma correspondência: toda restrição primal se torna uma variável dual, e toda variável primal se torna uma restrição dual.
- Interpretar uma variável dual economicamente como um "preço-sombra", o valor marginal de uma unidade adicional do recurso que sua restrição primal correspondente limita.
- Calcular o valor ótimo de um programa linear dual diretamente e observar, em um exemplo concreto, que ele corresponde exatamente ao valor ótimo do primal.
- Explicar, em nível conceitual, por que essa correspondência exata não é coincidência, preparando o terreno para a prova formal do próximo conceito.

## Contexto e Motivação

Todo programa linear estudado até agora nesta trilha foi abordado de uma direção: dado um objetivo e algumas restrições, encontre a melhor atribuição das variáveis de decisão. Este conceito introduz um segundo programa linear, inteiramente diferente, derivado mecanicamente do primeiro, chamado de seu **dual**, que acaba respondendo uma pergunta relacionada mas genuinamente distinta: não "como os recursos deveriam ser alocados", mas "quanto cada recurso limitado realmente vale". A relação entre um programa linear (daqui em diante, o **primal**) e seu dual é uma das ideias mais produtivas em toda a otimização, útil para interpretação econômica, para construir algoritmos mais rápidos (o simplex dual do próximo conceito, e mais tarde a conexão desta trilha de volta a fluxo em redes), e para certificar uma solução ótima alegada sem resolver o problema novamente do zero.

## Teoria Central

### A construção mecânica

Dado um programa linear primal em forma padrão,

```
maximizar   c₁x₁ + c₂x₂ + ... + cₙxₙ
sujeito a  a₁₁x₁ + a₁₂x₂ + ... + a₁ₙxₙ ≤ b₁
           a₂₁x₁ + a₂₂x₂ + ... + a₂ₙxₙ ≤ b₂
           ...
           x₁, ..., xₙ ≥ 0
```

seu **dual** é construído por uma receita fixa e mecânica:

1. **Troque maximizar por minimizar.**
2. **Uma variável dual por restrição primal.** Com `m` restrições primais, o dual tem `m` variáveis, `y₁, ..., yₘ`, uma por restrição.
3. **Os coeficientes objetivo do dual são os lados direitos do primal.** O objetivo dual é `minimizar b₁y₁ + b₂y₂ + ... + bₘyₘ`.
4. **Uma restrição dual por variável primal.** Com `n` variáveis primais, o dual tem `n` restrições, cada uma construída a partir da *coluna* de coeficientes daquela variável através de toda restrição primal: `a₁ⱼy₁ + a₂ⱼy₂ + ... + aₘⱼyₘ ≥ cⱼ` para cada variável primal `xⱼ`, usando o coeficiente objetivo primal original `cⱼ` como o lado direito dessa restrição dual.
5. **Inverta a direção da desigualdade, e mantenha não-negatividade.** Restrições primais `≤` correspondem a restrições duais escritas como `≥`, e toda variável dual é ela mesma não negativa: `y₁, ..., yₘ ≥ 0`.

O padrão para reter: **linhas se tornam colunas**. Toda *restrição* primal (uma linha da matriz de coeficientes) se torna uma *variável* dual; toda *variável* primal (uma coluna da matriz de coeficientes) se torna uma *restrição* dual. A própria matriz de coeficientes é literalmente transposta entre os dois problemas.

### A interpretação econômica: preços-sombra

Cada variável dual `yᵢ` tem um significado econômico preciso: é o **preço-sombra** do `i`-ésimo recurso primal, o aumento marginal no valor objetivo ótimo do primal por uma unidade adicional do limite `bᵢ` daquele recurso, mantendo todo outro limite fixo. Se o lucro ótimo de uma fábrica é `Z` dadas `10` horas de algum recurso, e aumentar esse recurso para `11` horas elevaria o lucro ótimo para `Z + 60`, o preço-sombra daquele recurso é exatamente `60`, informação que um gestor poderia usar diretamente, vale a pena pagar até `$60` para adquirir mais uma hora daquele recurso, uma pergunta que as próprias variáveis de decisão do primal (unidades a produzir) não respondem de forma alguma, mas as variáveis do dual respondem diretamente.

### Por que a receita produz um problema novo genuinamente útil, não só uma curiosidade algébrica

A receita é mecânica, mas o que ela produz não é arbitrário: as restrições do dual existem precisamente para garantir que qualquer `y` dual-factível dê um limite superior sobre o valor objetivo de todo `x` primal-factível (um fato que o próximo conceito prova formalmente, como *dualidade fraca*), que é exatamente o que torna o valor de uma variável dual interpretável como um valor genuíno por unidade em vez de um artefato de contabilidade. Cada um dos conceitos posteriores desta trilha, o algoritmo simplex dual, os limites de relaxação da programação inteira, e a conexão de encerramento de volta ao teorema do fluxo máximo/corte mínimo de fluxo em redes, depende dessa mesma relação primal-dual, construída mecanicamente aqui pela primeira vez.

## Exemplos Resolvidos

### Exemplo 1: construindo o dual do programa linear da marcenaria

**Problema:** Construa o dual de `maximizar 70x₁ + 90x₂` sujeito a `x₁ + x₂ ≤ 10`, `x₁ + 3x₂ ≤ 24`, `x₁, x₂ ≥ 0` (o exemplo recorrente desta trilha, com solução primal ótima `(3,7)` no valor `840`).

**Aplicando a receita.** Duas restrições primais dão duas variáveis duais, `y₁` (para a primeira restrição) e `y₂` (para a segunda). O objetivo dual usa os lados direitos do primal `10` e `24`: `minimizar 10y₁ + 24y₂`. Duas variáveis primais dão duas restrições duais, construídas a partir da coluna de coeficientes de cada variável: a coluna de `x₁` é `(1, 1)` (seu coeficiente em cada restrição), dando `y₁ + y₂ ≥ 70` (`70` sendo o coeficiente objetivo de `x₁`); a coluna de `x₂` é `(1, 3)`, dando `y₁ + 3y₂ ≥ 90`. O dual completo:

```
minimizar   10y₁ + 24y₂
sujeito a    y₁ +  y₂ ≥ 70
             y₁ + 3y₂ ≥ 90
             y₁, y₂ ≥ 0
```

### Exemplo 2: resolvendo o dual diretamente e comparando com o ótimo primal conhecido

**Problema:** Resolva o dual construído no Exemplo 1 pelo método gráfico (avaliando seus vértices diretamente, exatamente como o segundo conceito desta trilha fez para o primal), e compare seu valor ótimo com o valor ótimo primal conhecido de `840`.

**Vértices da região factível do dual:** Definindo `y₂ = 0`: `y₁ ≥ 70` e `y₁ ≥ 90`, então a exigência vinculante é `y₁ = 90`, dando o vértice `(90, 0)`. Definindo `y₁ = 0`: `y₂ ≥ 70` e `y₂ ≥ 30`, então `y₂ = 70`, dando o vértice `(0, 70)`. A interseção das duas retas de restrição: `y₁+y₂=70` e `y₁+3y₂=90`; subtraindo dá `2y₂=20`, então `y₂=10`, `y₁=60`, dando o vértice `(60, 10)`.

**Avaliando o objetivo dual:** Em `(90,0)`: `10(90)+24(0)=900`. Em `(0,70)`: `10(0)+24(70)=1680`. Em `(60,10)`: `10(60)+24(10)=600+240=840`.

**Comparação:** O mínimo do dual, `840` em `(y₁,y₂)=(60,10)`, corresponde ao máximo do primal, `840` em `(x₁,x₂)=(3,7)`, exatamente. Isso não é uma coincidência específica deste exemplo, o próximo conceito prova que essa igualdade (chamada *dualidade forte*) vale para todo programa linear com uma solução ótima, e é exatamente por que o valor de uma variável dual pode ser confiado como um preço-sombra genuíno: `y₁=60` diz que uma unidade adicional do primeiro recurso (a restrição `x₁+x₂≤10`) vale exatamente `$60` em lucro ótimo adicional, e `y₂=10` diz que uma unidade adicional do segundo recurso vale exatamente `$10`.

## Equívocos Comuns e Armadilhas

- **"O dual é só uma cópia renomeada do primal, resolvendo o mesmo problema."** O dual do Exemplo 1 tem variáveis diferentes (`y₁, y₂`, não `x₁, x₂`), um objetivo diferente (minimizar custo de recurso, não maximizar lucro de produção), e uma região factível inteiramente diferente (os vértices duais `(90,0)`, `(0,70)`, `(60,10)` do Exemplo 2 não guardam semelhança com os vértices `(0,0)`, `(10,0)`, `(0,8)`, `(3,7)` do primal de conceitos anteriores); só o *valor* ótimo, não o *ponto* ótimo, é compartilhado entre eles.
- **"Construir o dual exige rederivar a partir de raciocínio econômico sobre preços-sombra toda vez."** A construção na Teoria Central é uma receita fixa e puramente mecânica, trocar max/min, transpor a matriz de coeficientes, trocar coeficientes objetivo por lados direitos, inverter direções de desigualdade, que pode ser aplicada diretamente a qualquer programa linear em forma padrão sem precisar raciocinar sobre recursos ou preços de forma alguma; a interpretação econômica é uma forma de *entender* o resultado, não um passo exigido para *construí-lo*.
- **"Uma restrição primal com um lado direito grande (um limite de recurso generoso) sempre tem um preço-sombra grande."** O preço-sombra reflete o quanto o *valor ótimo* melhoraria com mais uma unidade daquele recurso específico, que depende de quão apertadamente a restrição daquele recurso de fato vincula o ótimo, não do tamanho do limite em si; um limite muito generosamente grande que não é de fato um gargalo tipicamente tem um preço-sombra de exatamente `0` (sua restrição não está justa no ótimo de forma alguma), uma conexão que o resultado de folga complementar do próximo conceito torna precisa.
- **"Toda variável primal corresponde a exatamente uma variável dual, espelhando o primal um a um."** A correspondência vai na direção oposta: *restrições* primais mapeiam para *variáveis* duais (duas restrições primais deram exatamente duas variáveis duais `y₁,y₂` no Exemplo 1), enquanto *variáveis* primais mapeiam para *restrições* duais (as duas variáveis do primal `x₁,x₂` produziram as duas restrições do dual, não mais duas variáveis duais).

## Resumo

Todo programa linear em forma padrão tem um dual construído mecanicamente: maximizar se torna minimizar, os lados direitos do primal se tornam os coeficientes objetivo do dual, os coeficientes objetivo do primal se tornam os lados direitos do dual, a matriz de coeficientes é transposta, e as direções de desigualdade se invertem, com uma variável dual por restrição primal e uma restrição dual por variável primal. Cada variável dual tem uma leitura econômica direta como um preço-sombra, o valor marginal de mais uma unidade de seu recurso primal correspondente. A construção e solução completamente resolvidas dos Exemplos 1 e 2 mostram o valor ótimo do dual, `840`, correspondendo exatamente ao próprio valor ótimo do primal, o mesmo número alcançado a partir de uma região factível completamente diferente e um conjunto de variáveis completamente diferente, uma coincidência impressionante na superfície que o próximo conceito prova nunca ser de fato coincidência: os teoremas de dualidade fraca e forte, e a relação de folga complementar que liga a justeza de uma restrição primal diretamente ao valor de sua variável dual.

## Documentation Links

- [MIT 6.251 - Introduction to Mathematical Programming (OCW)](https://ocw.mit.edu/courses/6-251j-introduction-to-mathematical-programming-fall-2009/): doc
- [Stanford CS261 - Optimization and Algorithmic Paradigms](https://web.stanford.edu/class/cs261/): doc
