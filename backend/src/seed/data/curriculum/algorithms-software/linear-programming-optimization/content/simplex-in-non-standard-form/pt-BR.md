---
version: 1.0
updatedAt: 2026-09-13
title: Simplex em Forma Não Padrão
summary: Restrições ≥ ou = quebram o início fácil do simplex; variáveis artificiais constroem um ponto de partida factível fictício para uma Fase 1 que zera os artificiais, seguida por uma Fase 2 que otimiza o objetivo real a partir do vértice encontrado.
---
## Objetivos de Aprendizagem

- Explicar por que uma restrição `≥` ou `=` quebra o truque usual de "começar na origem" do método simplex, mesmo depois de converter `≥` para `≤` algebricamente.
- Introduzir variáveis artificiais para construir uma solução básica factível de partida fácil, embora fictícia, para qualquer programa linear, independente da direção das restrições.
- Executar o método de duas fases por completo: um subproblema de Fase 1 que leva toda variável artificial a zero, seguido por uma Fase 2 que otimiza o objetivo real a partir do vértice factível que a Fase 1 encontrou.
- Enunciar, em nível conceitual, o método alternativo Big-M, e explicar a troca prática entre as duas abordagens.
- Reconhecer quando a Fase 1 sozinha já pousa no vértice ótimo do problema real, e verificar esse resultado diretamente em vez de assumir que resta mais trabalho.

## Contexto e Motivação

O método simplex, como construído dois conceitos atrás, se apoiou em um fato conveniente: definir toda variável original como `0` e ler as variáveis de folga diretamente dos lados direitos dá um vértice de partida imediato e sempre factível, desde que toda restrição seja um `≤` com lado direito não negativo. Problemas reais nem sempre são tão acomodados. O problema de planejamento de dieta introduzido no primeiro conceito desta trilha tem exigências nutricionais *mínimas*, restrições `≥`, e converter `≥` para `≤` por negação (a regra mecânica desse mesmo conceito) transforma um lado direito positivo em negativo, o que torna o ponto de partida de "definir folgas iguais ao lado direito" infactível na hora (uma folga negativa viola a não-negatividade que toda variável do simplex precisa obedecer). Este conceito constrói a correção: uma forma de fabricar um vértice de partida válido para *qualquer* programa linear, seja qual for a direção de suas restrições, introduzindo temporariamente variáveis que existem puramente para tornar esse primeiro passo possível.

## Teoria Central

### Por que restrições `≥` e `=` quebram o início fácil

Considere `x₁ + 3x₂ ≥ 15`. Subtrair uma **variável de excesso** não negativa `e` (a contraparte natural de uma folga, agora medindo o quanto o lado esquerdo *excede* a exigência em vez de quanto espaço resta) transforma isso em uma equação: `x₁ + 3x₂ - e = 15`. Definir `x₁ = x₂ = 0` força `e = -15`, violando `e ≥ 0` imediatamente. O ponto de partida óbvio simplesmente não é factível, e nenhuma quantidade de rearranjo algébrico dessa única restrição sozinha corrige isso; um vértice de partida genuinamente diferente é necessário, e encontrar um não é sempre óbvio por inspeção uma vez que várias restrições desse tipo interagem.

### Variáveis artificiais: um ponto de partida fictício mas fácil

A correção é adicionar uma **variável artificial** não negativa `a` em cima da variável de excesso: `x₁ + 3x₂ - e + a = 15`. Agora definir `x₁ = x₂ = e = 0` e `a = 15` satisfaz a equação com toda variável não negativa, um ponto de partida imediatamente factível (embora fictício). Toda restrição `≥` ganha sua própria variável artificial dessa forma (e toda restrição `=` ganha uma também, diretamente, já que não tem nenhuma folga ou excesso próprio para começar). A palavra "fictício" importa: uma solução com `a > 0` não é de forma alguma uma solução para o problema *original*, ela satisfaz a equação modificada só porque `a` está silenciosamente absorvendo a lacuna; o ponto inteiro do que segue é levar toda variável artificial de volta a exatamente `0` antes de confiar em qualquer resposta.

### Fase 1: minimizando as artificiais para encontrar um vértice factível real

O **método de duas fases** trata disso diretamente, como um programa linear próprio: a **Fase 1** resolve um subproblema, minimizar a soma de toda variável artificial, sujeita às mesmas restrições (cada uma aumentada com sua variável de excesso e artificial) e não-negatividade. Esse subproblema sempre tem um vértice de partida fácil (toda variável artificial no lado direito de sua própria equação, exatamente como construído acima), então o simplex comum, exatamente como construído no conceito anterior, consegue resolvê-lo diretamente. Dois resultados são possíveis:

- **O valor ótimo da Fase 1 é `0`.** Toda variável artificial foi levada a exatamente `0`, significando que a solução básica factível que o simplex alcançou (com as colunas artificiais agora descartadas ou ignoradas) é um vértice factível genuíno do problema *original*, pronto para servir como ponto de partida para a **Fase 2**: resolva novamente usando o objetivo real, começando exatamente desse vértice, continuando com pivôs de simplex comuns até que a otimalidade real seja alcançada.
- **O valor ótimo da Fase 1 é estritamente positivo.** Nenhuma atribuição das variáveis originais consegue satisfazer toda restrição simultaneamente sem alguma variável artificial sustentando as coisas; o problema original é genuinamente **infactível**, e a Fase 2 nunca roda de forma alguma, é exatamente assim que o simplex detecta e relata infactibilidade em vez de buscar para sempre por um vértice que não existe.

### A alternativa Big-M, brevemente

Uma segunda técnica, mais antiga, o **método Big-M**, dobra ambas as fases em uma única execução: em vez de um objetivo de Fase 1 separado, as variáveis artificiais são adicionadas diretamente ao objetivo *real* com um coeficiente de penalidade enorme `M` (conceitualmente, um número grande o suficiente para garantir que o simplex sempre prefira levar qualquer variável artificial a `0` em vez de mantê-la positiva, seja lá como isso se compare aos termos do próprio objetivo real). Isso evita nunca precisar de uma segunda fase literal, ao custo de introduzir uma constante simbólica (ou incomodamente grande numericamente) `M` em todo cálculo, e algum risco de instabilidade numérica em uma implementação de computador real se `M` for escolhido grande ou pequeno demais em relação aos próprios coeficientes do problema. O método de duas fases, usado ao longo do exemplo resolvido deste conceito, evita esse incômodo inteiramente mantendo os dois objetivos totalmente separados, e é geralmente o mais comumente ensinado e mais numericamente confiável dos dois na prática.

## Exemplos Resolvidos

### Exemplo 1: resolvendo o problema de planejamento de dieta pelo método de duas fases, por completo

**Problema:** Resolva `minimizar 2x₁ + 3x₂` sujeito a `4x₁ + 2x₂ ≥ 20`, `x₁ + 3x₂ ≥ 15`, `x₁, x₂ ≥ 0` (o problema de dieta do primeiro conceito desta trilha) usando o método de duas fases.

**Montagem.** Subtraindo excesso e adicionando variáveis artificiais: `4x₁ + 2x₂ - e₁ + a₁ = 20`, `x₁ + 3x₂ - e₂ + a₂ = 15`. Ponto de partida: `a₁ = 20`, `a₂ = 15`, tudo mais `0`.

**Objetivo da Fase 1.** Minimizar `a₁ + a₂` é equivalente a maximizar `z' = -a₁ - a₂`. Substituindo `a₁ = 20 - 4x₁ - 2x₂ + e₁` e `a₂ = 15 - x₁ - 3x₂ + e₂` dá `z' = -35 + 5x₁ + 5x₂ - e₁ - e₂`, então a linha objetivo do tableau da Fase 1 lê `z' - 5x₁ - 5x₂ + e₁ + e₂ = -35`.

**Fase 1, iteração 1:** Tanto `x₁` quanto `x₂` têm coeficiente `-5`; escolha `x₁` para entrar. Teste da razão: linha 1, `20/4 = 5`; linha 2, `15/1 = 15`. Linha 1 vence, `a₁` sai. Pivoteando no coeficiente de `x₁` da linha 1 (4) e eliminando `x₁` da linha 2 e da linha objetivo dá, depois da aritmética: linha 1 se torna `x₁ + 0,5x₂ - 0,25e₁ + 0,25a₁ = 5`; linha 2 se torna `2,5x₂ + 0,25e₁ - e₂ - 0,25a₁ + a₂ = 10`; a linha objetivo se torna `z' - 2,5x₂ - 0,25e₁ + e₂ + 1,25a₁ = -10`.

**Fase 1, iteração 2:** `-2,5` (para `x₂`) é o único coeficiente negativo restante, então `x₂` entra. Teste da razão: linha 1, `5 / 0,5 = 10`; linha 2, `10 / 2,5 = 4`. Linha 2 vence, `a₂` sai. Pivoteando no coeficiente de `x₂` da linha 2 (2,5): linha 2 se torna `x₂ + 0,1e₁ - 0,4e₂ - 0,1a₁ + 0,4a₂ = 4`. Eliminando `x₂` da linha 1 dá `x₁ - 0,3e₁ + 0,2e₂ + 0,3a₁ - 0,2a₂ = 3`. Eliminando `x₂` da linha objetivo dá `z' + a₁ + a₂ = 0`.

**Resultado da Fase 1:** A linha objetivo `z' + a₁ + a₂ = 0` não tem coeficientes negativos, então a Fase 1 termina com `z' = 0`, significando `a₁ = a₂ = 0` (o valor mínimo da Fase 1 de `0`, confirmando factibilidade). A solução básica factível alcançada é `x₁ = 3`, `x₂ = 4`, `e₁ = e₂ = 0` (ambas as restrições originais justas, correspondendo ao vértice de interseção que o método gráfico desta trilha também encontraria).

**Montagem da Fase 2.** Descarte as variáveis artificiais inteiramente e substitua o objetivo *real*, `minimizar 2x₁ + 3x₂`, ou seja, `maximizar z = -2x₁ - 3x₂`, usando as linhas finais da Fase 1 (`x₁ = 3 + 0,3e₁ - 0,2e₂`, `x₂ = 4 - 0,1e₁ + 0,4e₂`): `z = -2(3 + 0,3e₁ - 0,2e₂) - 3(4 - 0,1e₁ + 0,4e₂) = -18 - 0,3e₁ - 0,8e₂`, dando a linha objetivo `z + 0,3e₁ + 0,8e₂ = -18`.

**Resultado da Fase 2:** Ambos os coeficientes literais nessa linha, `+0,3` e `+0,8`, já são não negativos, nenhum coeficiente negativo resta, então a Fase 2 exige zero pivôs adicionais: o vértice que a Fase 1 encontrou já é ótimo para o objetivo real. A resposta final: `x₁ = 3`, `x₂ = 4`, custo mínimo `2(3) + 3(4) = 18`, correspondendo exatamente ao vértice `(3,4)` que a verificação vértice-por-vértice desta trilha encontraria (avaliando `2x₁+3x₂` nos três vértices finitos da região `(0,10)`, `(3,4)`, `(15,0)` dá `30`, `18`, `30` respectivamente, confirmando que `(3,4)` é de fato o mínimo).

## Equívocos Comuns e Armadilhas

- **"A Fase 2 sempre precisa de pelo menos um pivô, já que a Fase 1 só resolveu um objetivo diferente (artificial)."** O Exemplo 1 mostra que o vértice final da Fase 1 pode coincidir exatamente com o ótimo do problema real, verificado diretamente checando que a linha do objetivo real recalculada já não tem coeficientes negativos; quando isso acontece, a Fase 2 corretamente termina imediatamente, isso é um resultado válido a reconhecer e confirmar, não um sinal de que um passo foi pulado por engano.
- **"Variáveis artificiais são uma parte legítima da resposta final, e seu valor deveria ser relatado."** Variáveis artificiais existem só para construir um ponto de partida para a Fase 1 e são descartadas inteiramente uma vez que a Fase 1 confirma factibilidade (`z' = 0`); uma variável artificial não nula no tableau *final* da Fase 2 indicaria que a infactibilidade não foi de fato resolvida, não uma parte válida da solução.
- **"Se o valor ótimo da Fase 1 é muito pequeno mas não exatamente zero, o problema é 'quase' factível e pode ser tratado como resolvido."** O mínimo da Fase 1 precisa ser exatamente `0` para que as restrições originais sejam genuinamente satisfazíveis; qualquer mínimo estritamente positivo, por menor que seja, significa que nenhuma combinação das variáveis originais satisfaz toda restrição simultaneamente, uma infactibilidade dura, não uma aproximação tolerante a arredondamento.
- **"O método Big-M e o método de duas fases podem dar respostas finais diferentes para o mesmo problema."** Ambas são técnicas exatas e equivalentes para lidar com variáveis artificiais, corretamente implementadas, chegam à solução e ao valor ótimo idênticos; diferem só em mecanismo (uma execução única baseada em penalidade, uma execução em dois estágios) e em praticidade numérica, nunca na resposta subjacente.

## Resumo

Uma restrição `≥` ou `=` nega ao simplex seu vértice de partida gratuito usual, já que converter `≥` para `≤` por negação transforma um lado direito positivo em negativo, tornando a origem infactível na hora. Variáveis artificiais corrigem isso por construção, uma adicionada por restrição `≥` ou `=`, dando um ponto de partida imediatamente factível (embora fictício) para um subproblema de Fase 1 que minimiza sua soma; alcançar o mínimo da Fase 1 de exatamente `0` certifica um vértice factível genuíno do problema real, a partir do qual a Fase 2 otimiza o objetivo real usando pivôs de simplex comuns, enquanto um mínimo de Fase 1 estritamente positivo certifica que o problema original é infactível de vez. O traço completo de duas fases do Exemplo 1 no problema de planejamento de dieta alcança `x₁ = 3, x₂ = 4` no custo `18`, com a Fase 1 sozinha pousando exatamente no ótimo real, confirmado diretamente em vez de assumido, então a Fase 2 precisou de zero pivôs adicionais. O método Big-M alcança o resultado idêntico dobrando ambos os objetivos em uma execução ponderada por penalidade em vez disso, uma alternativa mecânica, não uma resposta diferente. O próximo conceito se volta para o que acontece quando o quadro limpo e sempre terminante do método simplex se quebra, ou parece se quebrar, e o que isso revela sobre o comportamento real de pior caso do algoritmo.

## Documentation Links

- [MIT 6.251 - Introduction to Mathematical Programming (OCW)](https://ocw.mit.edu/courses/6-251j-introduction-to-mathematical-programming-fall-2009/): doc
- [Dantzig, G. B. (1963). Linear Programming and Extensions. Princeton University Press.](https://press.princeton.edu/books/paperback/9780691059136/linear-programming-and-extensions): book
