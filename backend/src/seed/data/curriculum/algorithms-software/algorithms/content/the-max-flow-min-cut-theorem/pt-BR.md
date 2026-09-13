---
version: 1.0
updatedAt: 2026-09-13
title: O Teorema do Fluxo Máximo e Corte Mínimo
summary: O valor de qualquer fluxo válido nunca excede a capacidade de nenhum corte s-t (dualidade fraca), e o valor do fluxo máximo é sempre exatamente igual à capacidade do corte mínimo, provado construtivamente a partir do ponto de término de Ford-Fulkerson.
---
## Objetivos de Aprendizagem

- Definir precisamente um corte s-t: uma partição dos vértices em dois conjuntos, um contendo a fonte e o outro o sumidouro, e definir sua capacidade como a capacidade total das arestas cruzando do lado da fonte para o lado do sumidouro.
- Provar a dualidade fraca: o valor de qualquer fluxo válido é no máximo a capacidade de qualquer corte s-t, sem exceções.
- Enunciar o teorema do fluxo máximo/corte mínimo: o valor do fluxo máximo é igual à capacidade do corte mínimo, e explicar por que essa é uma igualdade genuína, não apenas a desigualdade da dualidade fraca.
- Provar que a condição de término de Ford-Fulkerson (nenhum caminho de aumento) é exatamente equivalente a ter encontrado tanto um fluxo máximo quanto um corte mínimo simultaneamente.
- Usar o teorema para certificar que um fluxo dado é máximo sem precisar buscar um melhor.

## Contexto e Motivação

O conceito anterior terminou com uma observação que parecia suspeitosamente uma coincidência: um fluxo de valor 26 foi encontrado, e um corte com capacidade exatamente 26 também foi encontrado, no exato momento em que o algoritmo ficou sem caminhos de aumento. Este conceito prova que isso nunca foi coincidência alguma. A relação entre o valor do fluxo e a capacidade do corte é um dos resultados de dualidade mais limpos e mais úteis em toda a otimização combinatória: o maior fluxo possível através de uma rede é sempre *exatamente* igual à menor capacidade possível de qualquer corte separando fonte de sumidouro, não meramente limitado por ela. Este é o teorema do fluxo máximo/corte mínimo, e ele cumpre um papel duplo: explica precisamente por que a regra simples de término de Ford-Fulkerson (parar quando nenhum caminho de aumento existir) de fato funciona, e entrega um certificado prático, um corte correspondente, que permite a qualquer um verificar que um fluxo máximo alegado é genuinamente máximo sem precisar confiar no algoritmo que o produziu ou buscar mais por conta própria.

## Teoria Central

### Definindo um corte s-t e sua capacidade

Um **corte s-t** é uma partição do conjunto de vértices `V` em dois conjuntos disjuntos `S` e `T`, com `s ∈ S` e `t ∈ T`. A **capacidade** de um corte é a soma das capacidades de toda aresta que cruza *de* `S` *para* `T` (arestas de `T` de volta para `S` não são contadas, só a direção do lado da fonte em direção ao lado do sumidouro):

```
capacidade(S, T) = soma de c(u, v), sobre toda aresta (u, v) com u ∈ S e v ∈ T
```

Intuitivamente, um corte representa uma forma de dividir a rede em "o lado da fonte" e "o lado do sumidouro", e sua capacidade é a capacidade total de transporte de todo link que vai na direção "correta" através dessa divisão, do lado da fonte em direção ao do sumidouro.

### Dualidade fraca: o valor do fluxo nunca excede a capacidade de nenhum corte

**Afirmação:** Para qualquer fluxo válido `f` e qualquer corte s-t `(S, T)`, `|f| ≤ capacidade(S, T)`.

**Por quê.** Toda unidade de fluxo saindo de `s` precisa, por conservação de fluxo em todo vértice intermediário, eventualmente cruzar de `S` para `T` em algum lugar (não pode ficar presa dentro de `S` para sempre sem violar a conservação em algum vértice, e não pode alcançar `t`, que vive em `T`, sem cruzar pelo menos uma vez). Mais precisamente, o valor do fluxo é igual ao fluxo líquido cruzando o corte: (fluxo em arestas de `S` para `T`) menos (fluxo em arestas de `T` de volta para `S`). A primeira quantidade é no máximo `capacidade(S, T)` (um fluxo nunca pode exceder a capacidade de uma aresta), e a segunda quantidade é no mínimo 0 (valores de fluxo nunca são negativos), então:

```
|f| = (fluxo S→T) - (fluxo T→S) ≤ (fluxo S→T) ≤ capacidade(S, T)
```

Essa única desigualdade já tem uma consequência imediata e útil, enunciada como o próximo fato.

### O teorema do fluxo máximo/corte mínimo

**Teorema.** Em qualquer rede de fluxo, o valor de um fluxo máximo é igual à capacidade de um corte s-t mínimo.

A dualidade fraca sozinha só prova `fluxo máximo ≤ corte mínimo` (todo fluxo é limitado por todo corte, então em particular o melhor fluxo é limitado pelo melhor corte). A parte genuinamente profunda deste teorema é a direção reversa, que esse limite é sempre *alcançado exatamente*, sem nenhuma folga, e a prova passa diretamente pela própria condição de término de Ford-Fulkerson.

**Esboço de prova, via o ponto de parada de Ford-Fulkerson.** Rode Ford-Fulkerson até terminar (nenhum caminho de aumento de `s` a `t` resta no grafo residual `G_f`). Seja `S` o conjunto de vértices alcançáveis a partir de `s` em `G_f` naquele ponto, e seja `T = V - S` tudo mais. Já que nenhum caminho de aumento existe, `t` não é alcançável a partir de `s`, então `t ∈ T`, confirmando que `(S, T)` de fato é um corte s-t válido. Agora examine toda aresta original `(u, v)` com `u ∈ S` e `v ∈ T`: ela precisa estar totalmente saturada, `f(u, v) = c(u, v)`, porque se não estivesse, sua aresta residual direta teria capacidade positiva, tornando `v` alcançável a partir de `s` (via `u`), contradizendo `v ∈ T`. Simetricamente, toda aresta original `(v, u)` com `v ∈ T` e `u ∈ S` precisa carregar exatamente zero de fluxo, `f(v, u) = 0`, porque se carregasse algum fluxo positivo, sua aresta residual reversa `(u, v)` teria capacidade positiva, novamente tornando `v` alcançável a partir de `s`, a mesma contradição. Combinando ambos os fatos: o fluxo cruzando de `S` para `T` é igual a `capacidade(S, T)` exatamente (toda aresta de cruzamento está totalmente saturada), e o fluxo cruzando de volta de `T` para `S` é exatamente 0 (toda aresta assim está vazia), então `|f| = capacidade(S, T) - 0 = capacidade(S, T)`. O fluxo com o qual Ford-Fulkerson termina tem um valor que é igual exatamente à capacidade deste corte específico. Já que a dualidade fraca já mostrou que nenhum fluxo pode exceder a capacidade de nenhum corte, esse fluxo, correspondendo exatamente a um corte, precisa ser máximo, e esse corte, correspondido exatamente por um fluxo, precisa ser mínimo.

### A equivalência tripla

A prova acima estabelece algo mais forte que só a igualdade principal do teorema; mostra que três afirmações sobre um fluxo `f` são todas exatamente equivalentes entre si:

1. `f` é um fluxo máximo.
2. O grafo residual `G_f` de `f` não tem nenhum caminho de aumento de `s` a `t`.
3. `|f| = capacidade(S, T)` para algum corte s-t `(S, T)` (a saber, o formado por `S = ` vértices alcançáveis a partir de `s` em `G_f`).

Essa equivalência é o que torna a regra simples de parada de Ford-Fulkerson ("pare quando nenhum caminho de aumento existir") correta, não apenas uma heurística que soa plausível: a afirmação 2, a condição de término real do algoritmo, é comprovadamente idêntica à afirmação 1, o objetivo real.

## Exemplos Resolvidos

### Exemplo 1: usando o corte do conceito anterior para certificar um fluxo como máximo, sem busca adicional

**Problema:** A execução de Ford-Fulkerson do conceito anterior terminou com um fluxo de valor 26 e identificou o corte `S = {s, A, B}`, `T = {C, D, t}`. Use só a dualidade fraca (não o argumento completo de término) para certificar, independentemente, que 26 é verdadeiramente o fluxo máximo possível.

**Certificação.** `capacidade(S, T)` = capacidade de toda aresta de `S` para `T` = `c(A, C) + c(B, D) = 12 + 14 = 26` (nenhuma outra aresta cruza de `S` para `T`: `A→B` e `B→A` ficam dentro de `S`, `C→D` fica dentro de `T`, `C→t` e `D→t` ficam dentro de `T`). Pela dualidade fraca, *qualquer* fluxo válido nessa rede, encontrado por qualquer método, precisa satisfazer `|f| ≤ 26`. Já que um fluxo de valor 26 foi de fato exibido, ele precisa ser máximo, ponto final, sem nenhuma necessidade de tentar caminhos de aumento adicionais, algoritmos adicionais, ou raciocínio adicional de nenhum tipo. Este é o retorno prático do teorema: um corte de capacidade correspondente é um certificado de otimalidade verificável e independente.

### Exemplo 2: encontrando um corte mínimo diretamente, sem rodar Ford-Fulkerson de forma alguma

**Problema:** Em uma rede pequena com `s→a: 5`, `s→b: 3`, `a→t: 2`, `a→b: 4`, `b→t: 6`, identifique um corte com capacidade pequena e use a dualidade fraca para limitar o fluxo máximo antes de calculá-lo.

**Corte candidato 1:** `S = {s}`, `T = {a, b, t}`. Arestas de cruzamento: `s→a` (5), `s→b` (3). Capacidade `= 5 + 3 = 8`.

**Corte candidato 2:** `S = {s, a}`, `T = {b, t}`. Arestas de cruzamento: `a→t` (2), `a→b` (4); `s→b` também cruza (3). Capacidade `= 2 + 4 + 3 = 9`.

**Corte candidato 3:** `S = {s, a, b}`, `T = {t}`. Arestas de cruzamento: `a→t` (2), `b→t` (6). Capacidade `= 2 + 6 = 8`.

**Limitando o fluxo:** Pela dualidade fraca, o fluxo máximo é no máximo o *menor* desses (e de qualquer outro) corte, então `|f| ≤ min(8, 9, 8) = 8`, sem ter calculado uma única unidade de fluxo real ainda. Se 8 é de fato alcançável (tornando um dos cortes de capacidade 8 o verdadeiro mínimo) ainda precisaria ser confirmado exibindo um fluxo de valor 8, mas o limite superior em si exigiu apenas enumerar alguns cortes, uma checagem de sanidade útil para qualquer cálculo de fluxo antes ou depois de rodar um algoritmo de fato.

## Equívocos Comuns e Armadilhas

- **"Dualidade fraca e o teorema do fluxo máximo/corte mínimo são a mesma afirmação."** A dualidade fraca é só a desigualdade `|f| ≤ capacidade(S,T)` para *todo* fluxo e *todo* corte, e vale trivial e facilmente, como a prova curta da Teoria Central mostra. O teorema completo é a afirmação muito mais forte de que o *melhor* fluxo e o *melhor* corte são exatamente iguais, o que exige o argumento construtivo adicional (via o ponto de término de Ford-Fulkerson) que a Teoria Central trabalha por completo.
- **"Qualquer corte pode ser usado para certificar a otimalidade de um fluxo, não só um mínimo."** A dualidade fraca só certifica otimalidade quando a capacidade do corte *é igual* ao valor do fluxo exatamente, como o Exemplo 1 mostra; um corte com capacidade estritamente maior que o valor do fluxo não prova nada sobre otimalidade por si só (só confirma que o fluxo não excede aquele corte específico, o que é bem mais fraco).
- **"Encontrar o corte mínimo exige primeiro encontrar o fluxo máximo, então o corte é só um efeito colateral sem valor independente."** O Exemplo 2 mostra que cortes podem ser avaliados e comparados diretamente, independentemente de rodar qualquer algoritmo de fluxo, fornecendo um limite superior sobre o fluxo alcançável antes ou sem nunca calcular um; a conexão apertada que a Teoria Central prova é o que torna esse limite superior significativo, não incidental.
- **"O corte do conjunto alcançável do término de Ford-Fulkerson é só um exemplo de corte mínimo; pode haver outros, menores, que o algoritmo não encontrou."** A prova na Teoria Central mostra que a capacidade desse corte específico do conjunto alcançável é igual exatamente ao valor do fluxo terminante, e a dualidade fraca já mostra que nenhum corte pode ter capacidade menor que o valor de nenhum fluxo, então esse corte é comprovadamente um corte mínimo, não apenas um candidato entre possivelmente melhores.

## Resumo

Um corte s-t particiona os vértices da rede em um lado da fonte `S` e um lado do sumidouro `T`, com capacidade igual à capacidade total das arestas cruzando de `S` para `T`. A dualidade fraca mostra que o valor de qualquer fluxo válido é limitado superiormente pela capacidade de qualquer corte, um argumento curto que decorre diretamente de restrições de capacidade e conservação de fluxo. O teorema do fluxo máximo/corte mínimo fortalece isso para uma igualdade genuína: o valor do fluxo máximo é exatamente igual à capacidade do corte mínimo, provado construtivamente examinando o próprio ponto de término de Ford-Fulkerson, onde o conjunto de vértices ainda alcançáveis a partir da fonte no grafo residual define um corte cuja capacidade corresponde exatamente ao valor do fluxo terminante. Isso produz uma equivalência tripla, fluxo máximo, nenhum caminho de aumento restante, e um corte correspondente, que tanto justifica a regra simples de parada de Ford-Fulkerson quanto entrega um certificado prático e independentemente verificável de otimalidade, como ambos os exemplos resolvidos demonstram. O próximo conceito se volta para uma pergunta genuinamente prática que o método em si deixa em aberto: qual caminho de aumento escolher em cada passo, e o que essa escolha faz ao tempo de execução real do algoritmo.

## Documentation Links

- [Ford, L. R., & Fulkerson, D. R. (1956). "Maximal Flow Through a Network." Canadian Journal of Mathematics.](https://www.cambridge.org/core/journals/canadian-journal-of-mathematics/article/maximal-flow-through-a-network/): paper
- [MIT 6.006 - Lecture Notes (OCW)](https://ocw.mit.edu/courses/6-006-introduction-to-algorithms-spring-2020/pages/lecture-notes/): doc
