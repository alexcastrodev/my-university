---
version: 1.0
updatedAt: 2026-09-13
title: Programação Linear Inteira e Branch and Bound
summary: A relaxação linear de um PL inteiro sempre dá um limite otimista; arredondamento ingênuo pode ser estritamente subótimo (demonstrado concretamente); branch and bound resolve exatamente ramificando em uma variável fracionária e podando subproblemas cujo limite de relaxação não consegue superar a melhor solução inteira já encontrada.
---
## Objetivos de Aprendizagem

- Definir programação linear inteira (PLI): um programa linear com a exigência adicional de que algumas ou todas as variáveis assumam valores inteiros.
- Definir a relaxação linear de um PLI, e explicar por que seu valor ótimo é sempre pelo menos tão bom quanto o próprio valor ótimo do PLI para um problema de maximização.
- Explicar, com um contraexemplo concreto, por que arredondar ingenuamente a solução ótima de uma relaxação linear pode dar uma resposta subótima, ou até infactível.
- Executar o algoritmo branch and bound por completo: resolva a relaxação, ramifique em uma variável fracionária em dois subproblemas, e pode qualquer subproblema cujo limite de relaxação não consiga superar a melhor solução inteira já encontrada.
- Conectar branch and bound à solução de programação dinâmica do Knapsack 0/1 já coberta em outro lugar neste currículo, como duas abordagens exatas diferentes para uma família semelhante de problemas de otimização inteira.

## Contexto e Motivação

Todo programa linear resolvido até agora nesta trilha permitiu que suas variáveis assumissem qualquer valor real e fracionário: `2,7857` mesas, `0,357` cadeiras, valores que eram inteiramente sensatos para os exemplos resolvidos específicos escolhidos, mas que são simplesmente sem sentido para uma classe genuinamente grande de problemas reais, decidir se construir uma fábrica (sim ou não, não `0,6` de uma fábrica), quantos caminhões despachar (um número inteiro), ou quais de um conjunto de projetos financiar (cada um totalmente dentro ou totalmente fora). **Programação linear inteira** adiciona exatamente uma exigência a tudo construído até agora: algumas ou todas as variáveis de decisão precisam assumir valores inteiros. Essa única adição, enganosamente pequena no papel, muda tudo sobre como o problema precisa ser resolvido: a garantia elegante de vários conceitos atrás, de que um ótimo sempre fica em um vértice de uma região convexa, não entrega mais diretamente uma resposta de valor inteiro, porque os vértices de um politopo geralmente não são pontos inteiros de forma alguma. Este conceito constrói o método padrão de propósito geral para resolver programas lineares inteiros exatamente apesar disso: **branch and bound**.

## Teoria Central

### A relaxação linear, e por que ela sempre dá um limite otimista

Dado um programa linear inteiro, sua **relaxação linear** é o problema idêntico com a exigência de integralidade simplesmente removida, resolvido como um programa linear comum por tudo já construído nesta trilha. Para um problema de maximização, o valor ótimo da relaxação é sempre **pelo menos tão bom quanto** o próprio valor ótimo do PLI, já que toda solução inteira-factível também é automaticamente relaxação-factível (inteiros são um subconjunto dos reais), então a relaxação busca sobre um conjunto estritamente maior de candidatos e só pode se sair tão bem ou melhor. Essa garantia unidirecional, valor da relaxação ≥ valor inteiro real, é a fundação sobre a qual branch and bound é construído: ela transforma o valor ótimo da relaxação em um **limite superior** computável sobre a resposta sendo buscada.

### Por que arredondamento ingênuo não funciona

Um atalho tentador, resolver a relaxação, depois arredondar sua solução ótima fracionária para os inteiros mais próximos, falha por uma razão estrutural que vale a pena enunciar precisamente: arredondamento não leva em conta como as restrições interagem, um ponto arredondado pode violar uma restrição que o ponto fracionário satisfazia exatamente (um arredondamento infactível), ou, mesmo quando acontece de permanecer factível, não há garantia de que esteja nem perto do *melhor* ponto inteiro disponível, já que o verdadeiro ótimo inteiro pode ficar em um ponto inteiro completamente diferente e não adjacente que o procedimento de arredondamento nunca considera de forma alguma.

### Branch and bound, enunciado como um algoritmo

**Branch and bound** busca sistematicamente o espaço de soluções inteiras sem nunca precisar enumerar todas elas individualmente, usando o limite da relaxação linear para podar regiões inteiras desse espaço de uma vez:

1. **Resolva a relaxação linear** do subproblema atual (inicialmente, o problema original inteiro). Se sua solução acontecer de já ser de valor inteiro, ela é uma candidata válida para o verdadeiro ótimo, registre-a se for a melhor solução inteira encontrada até agora (o **incumbente** atual), e esse subproblema não precisa de mais exploração.
2. **Se a solução da relaxação é fracionária** em alguma variável `xⱼ`, **ramifique**: crie dois novos subproblemas, idênticos ao atual exceto que um adiciona a restrição `xⱼ ≤ ⌊valor⌋` (arredondando o valor fracionário dessa variável para baixo) e o outro adiciona `xⱼ ≥ ⌈valor⌉` (arredondando para cima), cobrindo toda possibilidade inteira para `xⱼ` entre eles enquanto exclui o próprio valor fracionário.
3. **Limite e pode.** Antes de explorar completamente um subproblema, compare o valor ótimo da própria relaxação dele contra o valor do incumbente atual. Se o limite da relaxação do subproblema não puder possivelmente superar o incumbente (para um problema de maximização, se o valor da relaxação não é melhor que o do incumbente), aquele subproblema inteiro, e tudo em que ele poderia ramificar, é descartado sem mais exploração, já que nenhuma solução inteira dentro dele poderia possivelmente melhorar o que já foi encontrado.
4. **Repita** até que todo subproblema tenha ou produzido uma solução inteira ou sido podado; a melhor solução inteira encontrada em toda a busca é o verdadeiro ótimo.

### Conexão com programação dinâmica

A disciplina de algoritmos deste currículo já resolveu um problema de otimização inteira específico e famoso, o Knapsack 0/1, usando programação dinâmica: preenchendo uma tabela de respostas de subproblema indexada por contagem de itens e capacidade restante. Branch and bound é uma abordagem genuinamente diferente e mais geral para a mesma família ampla de problemas de otimização inteira: em vez de uma tabela fixa indexada por uma estrutura específica do problema, ela busca uma árvore de relaxações lineares, podada por limites, aplicável a essencialmente qualquer programa linear inteiro independente de seu formato combinatório específico, ao custo de não ter mais o tamanho de tabela de tempo polinomial garantido da programação dinâmica para problemas (como Knapsack 0/1) onde essa estrutura específica acontece de se aplicar.

## Exemplos Resolvidos

### Exemplo 1: branch and bound completo, incluindo uma armadilha de arredondamento ingênuo

**Problema:** Resolva `maximizar x₁ + x₂` sujeito a `2x₁ + 4x₂ ≤ 7`, `5x₁ + 3x₂ ≤ 15`, `x₁, x₂ ≥ 0` e inteiros, usando branch and bound.

**Relaxação da raiz.** Resolvendo a relaxação linear (removendo integralidade) encontrando todos os vértices: `(0,0)` valor `0`; `(3,0)` (de `5x₁≤15`, verificando `2(3)=6≤7` ✓) valor `3`; `(0,1,75)` (de `4x₂≤7`, verificando `3(1,75)=5,25≤15` ✓) valor `1,75`; e a interseção das duas retas de restrição, resolvendo `2x₁+4x₂=7` e `5x₁+3x₂=15` simultaneamente dá `x₁≈2,786, x₂≈0,357`, valor `≈3,143`, o maior dos quatro, então esse é o ótimo da relaxação.

**A armadilha do arredondamento.** Arredondar ingenuamente `(2,786, 0,357)` para baixo para `(2, 0)` dá um ponto factível (`2(2)+4(0)=4≤7` ✓, `5(2)+3(0)=10≤15` ✓) com valor `2`, estritamente pior que o verdadeiro ótimo inteiro que este exemplo encontra abaixo (`3`), uma demonstração concreta de que arredondar uma solução ótima fracionária de PL não é um substituto confiável para resolver o programa inteiro de fato.

**Ramificando em `x₁` (fracionário em `≈2,786`).** **Ramo B (`x₁ ≥ 3`):** combinado com `5x₁+3x₂≤15` e `x₂≥0`, `x₁` não pode exceder `3` de forma alguma (qualquer `x₁>3` forçaria `x₂<0`), então a região factível deste ramo colapsa para o único ponto `(3,0)`, já inteiro, valor `3`. Este se torna o novo incumbente.

**Ramo A (`x₁ ≤ 2`):** resolvendo a relaxação deste subproblema, o melhor ponto é `(2, 0,75)` (`x₁` em seu novo limite `2`, e `4x₂≤7-4=3` dando `x₂≤0,75`, verificado contra `5(2)+3(0,75)=12,25≤15` ✓), valor `2,75`.

**Podando o ramo A.** O limite de relaxação do ramo A, `2,75`, é pior que o valor do incumbente, `3` (encontrado do ramo B), então nenhuma solução inteira dentro do ramo A poderia possivelmente superar `3`; o ramo A é podado sem mais nenhuma ramificação.

**Resultado.** A busca termina com o incumbente do ramo B como o verdadeiro ótimo: `(x₁,x₂)=(3,0)`, valor `3`, encontrado explorando só dois subproblemas além da raiz, não enumerando cada ponto inteiro na região factível individualmente.

## Equívocos Comuns e Armadilhas

- **"Arredondar a solução ótima da relaxação linear para os inteiros mais próximos é uma aproximação razoável."** O ponto arredondado do Exemplo 1, `(2,0)`, alcança só `2`, enquanto o verdadeiro ótimo inteiro é `3`, uma lacuna significativa e não trivial em um exemplo genuinamente pequeno; arredondamento pode estar arbitrariamente longe do ótimo (ou ser completamente infactível) em outros problemas, que é exatamente por que branch and bound existe como um método exato em vez de uma heurística de arredondamento ser considerada suficiente.
- **"Ramificar sempre exige explorar ambos os novos subproblemas por completo."** O Exemplo 1 explorou a relaxação do ramo B e a encontrou já inteira, depois explorou a relaxação do ramo A e a podou imediatamente com base só em seu limite, sem nunca ramificar mais dentro do ramo A de forma alguma; podar por limite é o que impede branch and bound de degenerar em enumeração exaustiva de todo ponto inteiro.
- **"O valor ótimo da relaxação linear é só uma estimativa frouxa e não muito útil do ótimo inteiro."** O valor da relaxação, `≈3,143` na raiz, foi justo o suficiente para imediatamente podar uma subárvore inteira (ramo A, limitado a `2,75`) usando só uma comparação contra o incumbente; o limite da relaxação está fazendo trabalho real e de sustentação em cortar a busca, não apenas fornecendo uma noção vaga de escala.
- **"Branch and bound e a solução de programação dinâmica do Knapsack 0/1 são técnicas concorrentes, e uma é simplesmente melhor que a outra."** São ferramentas diferentes com trocas diferentes: programação dinâmica explora a estrutura de subproblema específica do Knapsack para um tempo de execução garantido, enquanto branch and bound se aplica a essencialmente qualquer programa linear inteiro, ao custo de nenhuma garantia geral de tempo de execução; a ferramenta certa depende de se um problema tem a estrutura específica que programação dinâmica consegue explorar.

## Resumo

Um programa linear inteiro adiciona a exigência de que algumas ou todas as variáveis assumam valores inteiros, e sua relaxação linear (o mesmo problema com essa exigência removida) sempre dá um limite otimista, pelo menos tão bom quanto o verdadeiro ótimo inteiro para um problema de maximização, porque soluções inteiras são um subconjunto do próprio conjunto factível da relaxação. Arredondamento ingênuo do ótimo fracionário da relaxação não é um substituto confiável, o Exemplo 1 mostra uma resposta arredondada de `2` onde o verdadeiro ótimo é `3`. Branch and bound resolve o programa inteiro exatamente em vez disso: resolva a relaxação, ramifique em uma variável fracionária em um subproblema de "arredondar para baixo" e "arredondar para cima", e pode qualquer subproblema cujo próprio limite de relaxação não consiga superar a melhor solução inteira já encontrada, exatamente o processo que o Exemplo 1 completa em dois ramos (um imediatamente inteiro, se tornando o incumbente; o outro podado por seu limite pior) em vez de uma busca exaustiva sobre todo ponto inteiro. Este método geral complementa, em vez de substituir, a solução exata de programação dinâmica para problemas específicos de otimização inteira como Knapsack 0/1, aplicável mesmo quando um problema não tem a estrutura específica de subproblemas sobrepostos que programação dinâmica exige. O conceito final desta trilha fecha o ciclo de volta a material anterior neste currículo, conectando dualidade de programação linear diretamente ao teorema do fluxo máximo/corte mínimo que a disciplina de algoritmos deste currículo já provou por uma rota inteiramente diferente.

## Documentation Links

- [MIT 6.251 - Introduction to Mathematical Programming (OCW)](https://ocw.mit.edu/courses/6-251j-introduction-to-mathematical-programming-fall-2009/): doc
- [ACM/IEEE CS2013 - Algorithms and Complexity Knowledge Area](https://csed.acm.org/cs2013-version/): doc
