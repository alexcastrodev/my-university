---
version: 1.0
updatedAt: 2026-09-13
title: O Método Simplex: Tableau e Pivoteamento
summary: Variáveis de folga transformam desigualdades em equações; cada iteração escolhe uma variável de entrada (coeficiente mais negativo na linha objetivo), roda o teste da razão para achar a variável de saída, e pivoteia até que nenhum coeficiente negativo reste.
---
## Objetivos de Aprendizagem

- Converter um programa linear em forma padrão em um sistema de equações introduzindo uma variável de folga para toda restrição de desigualdade.
- Montar um tableau simplex, identificar sua solução básica factível inicial, e ler os valores de toda variável diretamente dele.
- Aplicar a regra da variável de entrada (coeficiente mais negativo na linha objetivo) e o teste da razão da variável de saída para selecionar um pivô.
- Executar uma operação de pivô completa (eliminação de Gauss-Jordan em torno da entrada de pivô) e atualizar o tableau de acordo.
- Reconhecer a condição de otimalidade (nenhum coeficiente negativo resta na linha objetivo) e ler a solução ótima do tableau final.

## Contexto e Motivação

O conceito anterior provou que o ótimo de um programa linear, quando existe, sempre fica em um vértice, reduzindo a busca a uma lista finita de pontos candidatos. Mas "finito" não é o mesmo que "rápido": o número de vértices pode crescer combinatorialmente com o tamanho do problema, e verificar cada um diretamente, exatamente a abordagem de força bruta que a prova do conceito anterior tornou possível em princípio, é lento demais para ser prático em qualquer problema de tamanho real. O **método simplex** de George Dantzig (1947) é a resposta: em vez de verificar todo vértice, ele começa em um vértice e repetidamente se move para um vértice *adjacente* com um valor objetivo estritamente melhor (ou igual), parando no momento em que nenhum vértice adjacente melhora o atual. Este conceito constrói o motor mecânico do método, o **tableau simplex**, e trabalha um exemplo completo até sua resposta já conhecida como correta, verificada contra o vértice que o conceito anterior desta trilha já encontrou por inspeção direta.

## Teoria Central

### Introduzindo variáveis de folga: transformando desigualdades em equações

Um programa linear em forma padrão tem restrições como `4x₁ + 2x₂ ≤ 40`. Para trabalhar com equações (que a álgebra linear do tableau precisa) em vez de desigualdades, uma **variável de folga** não negativa `s` é adicionada a cada restrição, absorvendo exatamente a capacidade não usada: `4x₁ + 2x₂ + s = 40`, com `s ≥ 0`. Quando `s > 0`, a restrição original tem espaço sobrando; quando `s = 0`, a restrição está justa (vinculante), exatamente a noção algébrica de "restrição justa" que a caracterização de vértice do conceito anterior usou. Um programa linear com `m` restrições de desigualdade ganha `m` variáveis de folga dessa forma, uma por restrição, cada uma aparecendo só em sua própria linha.

### O tableau inicial e seu vértice de partida

Com variáveis de folga adicionadas, um programa linear em `n` variáveis originais e `m` restrições se torna um sistema de `m` equações em `n + m` incógnitas, organizado em um **tableau**: uma linha por restrição, uma linha para o objetivo, uma coluna por variável (original e folga), mais uma coluna de lado direito. Definir toda variável *original* como `0` e ler as variáveis de folga diretamente (`s = 40`, no exemplo acima) dá um vértice de partida imediato e fácil de encontrar, a origem, que é sempre factível sempre que todo lado direito original é não negativo (verdadeiro sempre que os limites de recurso do problema são eles mesmos quantidades não negativas, o caso típico).

### A variável de entrada: qual direção melhora mais rápido

A linha objetivo do tableau, escrita como `z - c₁x₁ - c₂x₂ - ... = 0`, tem um coeficiente negativo para toda variável atualmente *não* na solução (atualmente `0`) que *aumentaria* o objetivo se fosse aumentada de `0`. A **variável de entrada** do método simplex é escolhida como aquela com o coeficiente mais negativo nessa linha, a variável cujo aumento melhora o objetivo mais rápido, por unidade, entre todas as candidatas. (Essa é uma regra de escolha comum e simples, às vezes chamada de regra de Dantzig; outras regras de variável de entrada existem e são usadas na prática, um ponto ao qual o conceito posterior desta trilha sobre complexidade e degenerescência retorna.)

### A variável de saída: o teste da razão

Aumentar o valor da variável de entrada precisa ser equilibrado diminuindo o valor de alguma variável atualmente básica (para manter toda equação satisfeita); o **teste da razão** determina até onde a variável de entrada pode aumentar antes que alguma variável atualmente positiva seja levada a exatamente `0` (e não além, já que toda variável precisa permanecer não negativa). Para cada linha com um coeficiente estritamente positivo na coluna da variável de entrada, calcule (o lado direito daquela linha) dividido por (o coeficiente daquela linha na coluna de entrada); a linha que alcança a *menor* dessas razões identifica a **variável de saída**, a variável básica naquela linha, que será levada a exatamente `0` e sairá da solução.

### Pivoteamento: eliminação de Gauss-Jordan em torno da entrada escolhida

A operação de **pivô** atualiza o tableau inteiro de forma que a coluna da variável de entrada se torne um vetor unitário (1 na antiga linha da variável de saída, 0 em todo o resto, incluindo a linha objetivo), exatamente a mesma técnica de eliminação de Gauss-Jordan usada para resolver sistemas lineares diretamente: divida a linha do pivô pela entrada do pivô (tornando-a exatamente 1 ali), depois, para toda *outra* linha (incluindo a linha objetivo), subtraia um múltiplo apropriado da linha do pivô agora normalizada para zerar a entrada daquela linha na coluna da variável de entrada.

### Término: nenhum coeficiente negativo a mais

O processo se repete, variável de entrada, teste da razão, variável de saída, pivô, até que a linha objetivo não contenha nenhum coeficiente negativo. Nesse ponto, nenhuma variável não básica restante poderia melhorar o objetivo aumentando a partir de `0`, exatamente a condição de otimalidade local em nível de vértice que (dada a convexidade da região factível, estabelecida dois conceitos atrás) também é otimalidade global. A coluna de lado direito do tableau atual então dá o valor ótimo de toda variável básica diretamente, com toda variável não básica em `0`.

## Exemplos Resolvidos

### Exemplo 1: resolvendo o PL modificado da marcenaria por simplex, verificado contra o vértice conhecido

**Problema:** Resolva `maximizar 70x₁ + 90x₂` sujeito a `x₁ + x₂ ≤ 10`, `x₁ + 3x₂ ≤ 24`, `x₁, x₂ ≥ 0` (o mesmo PL cujo vértice ótimo, `(3,7)` no valor `840`, foi encontrado pelo método gráfico dois conceitos atrás) usando o tableau simplex, rastreando todo pivô.

**Montagem com folgas:** `x₁ + x₂ + s₁ = 10`, `x₁ + 3x₂ + s₂ = 24`, linha objetivo `z - 70x₁ - 90x₂ = 0`. Tableau inicial: variáveis básicas `s₁ = 10`, `s₂ = 24`, não básicas `x₁ = x₂ = 0`, `z = 0`.

**Iteração 1, variável de entrada:** Os coeficientes da linha objetivo são `-70` (para `x₁`) e `-90` (para `x₂`); `-90` é mais negativo, então `x₂` entra.

**Iteração 1, teste da razão:** Linha 1 (`s₁`): `10 / 1 = 10`. Linha 2 (`s₂`): `24 / 3 = 8`. A menor razão é o `8` da linha 2, então `s₂` sai.

**Iteração 1, pivô no coeficiente de `x₂` da linha 2 (3):** Divida a linha 2 por 3: `(1/3)x₁ + x₂ + (1/3)s₂ = 8`. Elimine `x₂` da linha 1 (subtraia a nova linha 2 da linha 1): `(2/3)x₁ + s₁ - (1/3)s₂ = 2`. Elimine `x₂` da linha objetivo (some `90 ×` a nova linha 2 a ela): `z - 40x₁ + 30s₂ = 720`.

**Depois da iteração 1:** `x₂ = 8`, `s₁ = 2`, `x₁ = s₂ = 0`, `z = 720`, exatamente o vértice `(0, 8)` no valor `720` já calculado pelo método gráfico (o segundo conceito desta trilha), um ponto de checagem intermediário útil confirmando que a aritmética do tableau até aqui está correta.

**Iteração 2, variável de entrada:** A linha objetivo agora lê `z - 40x₁ + 30s₂ = 720`; `-40` (para `x₁`) é o único coeficiente negativo, então `x₁` entra.

**Iteração 2, teste da razão:** Linha 1 (`s₁`, coeficiente `2/3`): `2 / (2/3) = 3`. Linha 2 (`x₂`, coeficiente `1/3`): `8 / (1/3) = 24`. A menor razão é o `3` da linha 1, então `s₁` sai.

**Iteração 2, pivô no coeficiente de `x₁` da linha 1 (2/3):** Divida a linha 1 por `2/3`: `x₁ + 1,5s₁ - 0,5s₂ = 3`. Elimine `x₁` da linha 2 (subtraia `1/3 ×` a nova linha 1): `x₂ - 0,5s₁ + 0,5s₂ = 7`. Elimine `x₁` da linha objetivo (some `40 ×` a nova linha 1): `z + 60s₁ + 10s₂ = 840`.

**Depois da iteração 2:** `x₁ = 3`, `x₂ = 7`, `s₁ = s₂ = 0`, `z = 840`. A linha objetivo (`z + 60s₁ + 10s₂ = 840`) não tem mais coeficientes negativos, então isso é ótimo: `(x₁, x₂) = (3, 7)`, valor objetivo `840`, correspondendo exatamente ao vértice que o método gráfico encontrou diretamente, agora alcançado mecanicamente, através de exatamente 2 pivôs, sem nunca precisar plotar ou inspecionar visualmente nada.

## Equívocos Comuns e Armadilhas

- **"O método simplex verifica todo vértice, só que de forma mais sistemática."** O Exemplo 1 visitou exatamente 2 dos 4 vértices da região factível (a origem implicitamente como partida, depois `(0,8)`, depois `(3,7)`), nunca tocando `(10,0)` de forma alguma; o simplex se move só ao longo de um caminho de vértices adjacentes que *melhoram*, e toda sua vantagem de eficiência sobre a enumeração de vértices por força bruta vem de pular todo vértice que esse caminho não precisa visitar.
- **"Qualquer coeficiente negativo na linha objetivo significa que aquela variável deveria sair da solução."** Um coeficiente negativo na linha objetivo pertence a uma variável atualmente *não básica* (já em `0`), e sinaliza que aquela variável é uma boa candidata de *entrada* (aumentá-la melhora o objetivo), não uma candidata para remoção; é o teste da razão, aplicado a uma coluna inteiramente diferente, que determina qual variável atualmente básica sai.
- **"O teste da razão deveria escolher a maior razão, para fazer o máximo de progresso em um passo."** O primeiro teste da razão do Exemplo 1 escolheu a razão *menor* (`8`, não `10`) deliberadamente: escolher a razão maior teria levado alguma outra variável básica a ficar negativa, violando factibilidade; a menor razão é exatamente a quantidade que a variável de entrada pode aumentar com segurança antes que alguma outra variável fosse forçada abaixo de zero.
- **"Uma vez que uma variável sai da base, ela nunca pode voltar a um valor positivo em uma iteração posterior."** Nada na mecânica do tableau impede que uma variável saia em uma iteração e reentre (se tornando positiva novamente) em uma posterior; isso acontece de não ocorrer na execução curta e particular do Exemplo 1, mas é uma possibilidade real e bem documentada (relacionada a degenerescência) que um conceito posterior nesta trilha aborda diretamente.

## Resumo

Adicionar uma variável de folga não negativa a toda desigualdade converte um programa linear em forma padrão em um sistema de equações, organizado em um tableau cuja solução básica factível inicial (toda variável original em `0`, toda variável de folga igual ao lado direito de sua restrição) é sempre um vértice de partida fácil e imediatamente disponível. Cada iteração escolhe uma variável de entrada (o coeficiente mais negativo na linha objetivo, a direção que melhora o objetivo mais rápido), roda um teste da razão para encontrar a variável de saída (a menor razão de lado direito por coeficiente da coluna de entrada, o maior passo seguro antes que alguma variável ficasse negativa), e pivoteia (eliminação de Gauss-Jordan em torno daquela entrada) para se mover ao vértice adjacente. O método termina no momento em que nenhum coeficiente negativo resta na linha objetivo, ponto no qual a coluna de lado direito do tableau dá a solução ótima diretamente, exatamente como os dois pivôs do Exemplo 1 alcançaram `(3,7)` no valor `840`, correspondendo ao vértice já encontrado graficamente, mecanicamente e sem nenhuma necessidade de plotar ou inspecionar visualmente a região factível. O próximo conceito estende essa mesma maquinaria de tableau para programas lineares que não chegam no formato limpo de maximizar-com-todas-restrições-≤ que este conceito assumiu.

## Documentation Links

- [MIT 6.251 - Introduction to Mathematical Programming (OCW)](https://ocw.mit.edu/courses/6-251j-introduction-to-mathematical-programming-fall-2009/): doc
- [Dantzig, G. B. (1963). Linear Programming and Extensions. Princeton University Press.](https://press.princeton.edu/books/paperback/9780691059136/linear-programming-and-extensions): book
