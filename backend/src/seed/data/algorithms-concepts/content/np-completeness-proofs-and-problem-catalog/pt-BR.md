---
version: 1.0
updatedAt: 2026-08-17
title: "Provando NP-Completude: Reduções e o Catálogo de Problemas"
description: "Como novos problemas são de fato provados NP-completos: a receita de quatro passos do Lema 34.8 para reduzir a partir de uma única linguagem NP-completa conhecida em vez de todo NP, depois o catálogo resolvido de reduções construindo de CIRCUIT-SAT até SAT, 3-CNF-SAT, CLIQUE, VERTEX-COVER, HAM-CYCLE, TSP e SUBSET-SUM — mais a técnica de gadget e as estratégias e armadilhas de redução que se generalizam."
---
## Objetivo

O conceito irmão "P vs. NP: Reconhecendo Quando um Problema É Provavelmente Difícil" para nas definições — o que P e NP significam, o que é uma redução em tempo polinomial, o que torna um problema NP-completo, e o que fazer na prática quando você suspeita que um problema é. Este conceito retoma exatamente daí e responde a próxima pergunta: **como alguém de fato prova que um novo problema é NP-completo?** Cormen et al. respondem em duas partes. A Seção 34.4 estabelece o Lema 34.8 e a receita de quatro passos que transforma "reduza toda linguagem em NP para L" no muito mais tratável "reduza *uma* linguagem NP-completa conhecida para L", depois aplica essa receita duas vezes para ir de `CIRCUIT-SAT` até `SAT` e depois `3-CNF-SAT`. A Seção 34.5 roda a receita mais cinco vezes para construir um catálogo — `CLIQUE`, `VERTEX-COVER`, `HAM-CYCLE`, `TSP` e `SUBSET-SUM` — e fecha com um conjunto de estratégias de redução e armadilhas que se generalizam. Tudo abaixo vem dessas duas seções.

## Casos de Uso

- Provar que um problema no seu próprio domínio é NP-hard para que você possa parar de buscar um algoritmo exato em tempo polinomial com justificativa, em vez de um palpite — a receita de quatro passos do Lema 34.8 é toda a obrigação de prova, e ela é curta.
- Escolher a partir de qual problema NP-completo conhecido fazer a redução: a Seção 34.5.6 da fonte dá orientação concreta (satisfabilidade 3-CNF ao cruzar domínios, vertex-cover quando você precisa selecionar um subconjunto sem considerar ordem, ciclo hamiltoniano ou caminho hamiltoniano quando a ordem importa).
- Ler uma prova de NP-completude num artigo e conseguir verificá-la: a redução está na direção certa, o "se e somente se" é argumentado nas duas direções, e a própria transformação é em tempo polinomial?
- Reconhecer a técnica de gadget — um subgrafo fixo ou conjunto fixo de números conectado de forma que só algumas configurações sejam possíveis — que é a ideia de engenharia reutilizável por trás das reduções mais difíceis do catálogo.

## Aprofundamento

### Lema 34.8: reduza de um problema conhecido, não de todo NP

A prova de que `CIRCUIT-SAT` é NP-completo (Teorema 34.7, na seção anterior) fez a coisa difícil diretamente: mostrou `L ≤p CIRCUIT-SAT` para *toda* linguagem `L ∈ NP`. Ninguém quer fazer isso de novo. O Lema 34.8 garante que ninguém precisa:

> **Lema 34.8** — Se `L` é uma linguagem tal que `L' ≤p L` para algum `L' ∈ NPC`, então `L` é NP-hard. Se, além disso, `L ∈ NP`, então `L ∈ NPC`.

A prova são três linhas de transitividade: como `L'` é NP-completa, toda `L'' ∈ NP` satisfaz `L'' ≤p L'`; por suposição `L' ≤p L`; então por transitividade `L'' ≤p L` para toda `L'' ∈ NP`, que é a definição de NP-hard. Em outras palavras, **ao reduzir uma linguagem NP-completa conhecida para `L`, você implicitamente reduz toda linguagem em NP para `L`.**

Isso dá a receita que o resto do capítulo roda repetidamente:

1. Prove `L ∈ NP`.
2. Prove que `L` é NP-hard:
   - a. Selecione uma linguagem NP-completa conhecida `L'`.
   - b. Descreva um algoritmo que calcula uma função `f` que mapeia toda instância `x` de `L'` para uma instância `f(x)` de `L`.
   - c. Prove que `x ∈ L'` se e somente se `f(x) ∈ L`, para todo `x`.
   - d. Prove que o algoritmo que calcula `f` roda em tempo polinomial.

O passo 1 costuma ser um parágrafo (exiba um certificado e verifique-o). Os passos 2b-2d são o trabalho real. E a receita se acumula: conforme o catálogo de problemas NP-completos conhecidos cresce, também cresce o conjunto de linguagens a partir das quais você tem permissão para reduzir, motivo pelo qual provas posteriores no capítulo costumam ser mais fáceis que as anteriores.

A Figura 34.13 da fonte estabelece a estrutura de dependência de toda prova nas Seções 34.4 e 34.5. Cada seta é um teorema — uma redução do problema na cauda para o problema na cabeça — e tudo enraíza, em última instância, em `CIRCUIT-SAT`:

```viz
type: graph
node circuit CIRCUIT-SAT 1 0
node sat SAT 1 1
node cnf 3-CNF-SAT 1 2
node clique CLIQUE 0 3
node subset SUBSET-SUM 2 3
node vc VERTEX-COVER 0 4
node ham HAM-CYCLE 0 5
node tsp TSP 0 6
edge circuit sat directed
edge sat cnf directed
edge cnf clique directed
edge cnf subset directed
edge clique vc directed
edge vc ham directed
edge ham tsp directed
---
visit circuit | Teorema 34.7 (seção anterior): CIRCUIT-SAT é provado NP-completo diretamente, reduzindo toda linguagem em NP para ele. É a raiz -- toda outra prova abaixo o reutiliza através do Lema 34.8.
traverse circuit sat | Teorema 34.9: CIRCUIT-SAT <=p SAT. Uma variável por fio, uma cláusula por porta lógica.
visit sat | SAT é NP-completo -- o primeiro problema já provado ser, historicamente.
traverse sat cnf | Teorema 34.10: SAT <=p 3-CNF-SAT, em três passos (árvore de análise sintática, tabelas-verdade, preenchimento até exatamente três literais).
visit cnf | 3-CNF-SAT é NP-completo. Sua estrutura rígida o torna o problema preferido para reduzir A PARTIR DE.
traverse cnf clique | Teorema 34.11: 3-CNF-SAT <=p CLIQUE. Um trio de vértices por cláusula; arestas só entre literais consistentes em trios diferentes.
visit clique | CLIQUE é NP-completo -- um problema de lógica cruzou para a teoria dos grafos.
traverse clique vc | Teorema 34.12: CLIQUE <=p VERTEX-COVER, via o grafo complementar, com o alvo do cover ajustado para (número de vértices) menos k.
visit vc | VERTEX-COVER é NP-completo.
traverse vc ham | Teorema 34.13: VERTEX-COVER <=p HAM-CYCLE, usando um gadget de 12 vértices e 14 arestas por aresta mais k vértices seletores.
visit ham | HAM-CYCLE é NP-completo.
traverse ham tsp | Teorema 34.14: HAM-CYCLE <=p TSP. Completa o grafo, custo 0 para arestas reais e 1 para o resto, custo alvo 0.
visit tsp | TSP é NP-completo -- a redução mais fácil do capítulo.
traverse cnf subset | Teorema 34.15: 3-CNF-SAT <=p SUBSET-SUM, cruzando da lógica para a aritmética via colunas de dígitos base 10.
visit subset | SUBSET-SUM é NP-completo. Note que isso ramifica de 3-CNF-SAT, não da cadeia de grafos.
```

### Satisfabilidade de fórmulas: CIRCUIT-SAT ≤p SAT

`SAT` recebe uma fórmula booleana `φ` construída a partir de `n` variáveis booleanas, `m` conectivos booleanos (qualquer função booleana de uma ou duas entradas: `∧`, `∨`, `¬`, `→`, `↔`) e parênteses, e pergunta se alguma atribuição de valores-verdade faz ela avaliar para 1. O exemplo da fonte é `φ = ((x1 → x2) ∨ ¬((¬x1 ↔ x3) ∨ x4)) ∧ ¬x2`, satisfeita por `⟨x1 = 0, x2 = 0, x3 = 1, x4 = 1⟩`. O algoritmo ingênuo checa todas as `2^n` atribuições — superpolinomial no comprimento de `⟨φ⟩` quando esse comprimento é polinomial em `n`.

**Teorema 34.9: `SAT` é NP-completo.** A pertença em NP é imediata: o certificado é uma atribuição satisfatória, e o verificador substitui os valores e avalia a expressão em tempo polinomial. A NP-dificuldade vem de `CIRCUIT-SAT ≤p SAT`.

A redução óbvia — percorrer o circuito a partir de sua porta de saída e escrever indutivamente uma fórmula para as entradas de cada porta — **não é polinomial**. Portas cujo fio de saída tem fan-out de 2 ou mais produzem subfórmulas compartilhadas que são duplicadas, e a fórmula pode crescer exponencialmente (o Exercício 34.4-1 pede que você construa um circuito assim). O conserto é o truque que se repete ao longo do capítulo: **nomeie os valores intermediários em vez de fazer inline deles.**

- Dê à fórmula `φ` uma variável `xi` para cada *fio* do circuito `C`.
- Para cada porta, emita uma pequena cláusula `↔` com a variável de saída da porta à esquerda e a função da porta aplicada às suas variáveis de entrada à direita. Para a porta AND de saída do circuito na Figura 34.10 da fonte, essa cláusula é `x10 ↔ (x7 ∧ x8 ∧ x9)`.
- Seja `φ` o AND da variável de saída do circuito com a conjunção de todas as cláusulas de porta. Para o circuito da figura: `φ = x10 ∧ (x4 ↔ ¬x3) ∧ (x5 ↔ (x1 ∨ x2)) ∧ (x6 ↔ ¬x4) ∧ (x7 ↔ (x1 ∧ x2 ∧ x4)) ∧ (x8 ↔ (x5 ∨ x6)) ∧ (x9 ↔ (x6 ∨ x7)) ∧ (x10 ↔ (x7 ∧ x8 ∧ x9))`.

O tamanho agora é linear no circuito, então a construção é polinomial. A equivalência é o lado fácil nos dois sentidos: uma atribuição que satisfaz `C` dá a todo fio um valor bem definido com saída 1, então toda cláusula e portanto `φ` avalia para 1; e uma atribuição que satisfaz `φ` força os valores dos fios a serem consistentes com as portas e a saída a ser 1, então `C` é satisfatível.

### 3-CNF-SAT: fabricando um problema restrito que vale a pena reduzir a partir dele

Reduzir *a partir de* `SAT` é doloroso, porque um algoritmo de redução precisa lidar com fórmulas de entrada de formato arbitrário. É muito mais fácil reduzir a partir de uma linguagem **restrita** — desde que a restrição não torne a linguagem acidentalmente resolvível em tempo polinomial. `3-CNF-SAT` é essa linguagem. Um *literal* é uma variável ou sua negação; uma *cláusula* é um OR de literais; uma fórmula está em *forma normal conjuntiva* (CNF) se é um AND de cláusulas, e em *3-CNF* se toda cláusula tem **exatamente três literais distintos**.

**Teorema 34.10: `3-CNF-SAT` é NP-completo.** A pertença em NP reutiliza o argumento de `SAT` palavra por palavra. A NP-dificuldade é `SAT ≤p 3-CNF-SAT`, em três passos, cada um aproximando mais a fórmula de 3-CNF:

1. **Árvore de análise sintática, depois nomeie os nós.** Construa uma árvore binária de análise sintática para `φ` com literais como folhas e conectivos como nós internos (use associatividade para parenteizar completamente de forma que todo nó interno tenha um ou dois filhos). A árvore é essencialmente um circuito, então aplique o truque do Teorema 34.9 de novo: introduza uma variável `yi` por nó interno e reescreva `φ` como o AND da variável da raiz com uma conjunção de cláusulas `↔` descrevendo cada nó. Para `φ = ((x1 → x2) ∨ ¬((¬x1 ↔ x3) ∨ x4)) ∧ ¬x2`, isso produz `φ' = y1 ∧ (y1 ↔ (y2 ∧ ¬x2)) ∧ (y2 ↔ (y3 ∨ y4)) ∧ (y3 ↔ (x1 → x2)) ∧ (y4 ↔ ¬y5) ∧ (y5 ↔ (y6 ∨ x4)) ∧ (y6 ↔ (¬x1 ↔ x3))`. Toda cláusula agora tem no máximo três literais, mas ainda não é um OR deles.
2. **Transforme cada cláusula em CNF via tabela-verdade.** Toda cláusula `φ'i` tem no máximo três variáveis, então sua tabela-verdade tem no máximo `2³ = 8` linhas. Pegue as linhas que avaliam para 0, construa uma DNF (um OR de ANDs) equivalente a `¬φ'i`, depois negue-a e aplique as leis de DeMorgan (`¬(a ∧ b) = ¬a ∨ ¬b`, `¬(a ∨ b) = ¬a ∧ ¬b`) para obter uma CNF `φ''i`. A fonte trabalha isso para `φ'1 = (y1 ↔ (y2 ∧ ¬x2))`, cujas quatro linhas com valor 0 dão uma DNF para a negação, que converte para `φ''1 = (¬y1 ∨ ¬y2 ∨ ¬x2) ∧ (¬y1 ∨ y2 ∨ ¬x2) ∧ (¬y1 ∨ y2 ∨ x2) ∧ (y1 ∨ ¬y2 ∨ x2)`. A conjunção de todos os `φ''i` é uma fórmula CNF `φ''` equivalente a `φ'`, ainda com no máximo três literais por cláusula.
3. **Preencha toda cláusula até exatamente três literais distintos.** Usando duas variáveis auxiliares `p` e `q`, para cada cláusula `Ci` de `φ''`: se já tem três literais distintos, mantenha-a; se tem exatamente dois, `Ci = (l1 ∨ l2)`, emita `(l1 ∨ l2 ∨ p) ∧ (l1 ∨ l2 ∨ ¬p)`; se tem um literal `l`, emita `(l ∨ p ∨ q) ∧ (l ∨ p ∨ ¬q) ∧ (l ∨ ¬p ∨ q) ∧ (l ∨ ¬p ∨ ¬q)`. Seja lá o que `p` e `q` forem definidos, exatamente uma das cláusulas emitidas reduz para a original e o resto avalia para 1, que é o elemento identidade para AND.

O tamanho polinomial cai da contagem: o passo 1 adiciona no máximo uma variável e uma cláusula por conectivo em `φ`; o passo 2 transforma cada cláusula em no máximo 8 cláusulas (a tabela-verdade tem no máximo 8 linhas); o passo 3 transforma cada cláusula em no máximo 4. Note também o aviso do Exercício 34.4-3 — você não pode pular direto para o passo de tabela-verdade na fórmula `φ` inteira, porque essa tabela tem `2^n` linhas e a redução deixa de ser polinomial. Por perto, o Exercício 34.4-7 aponta a fronteira: `2-CNF-SAT`, com exatamente dois literais por cláusula, está em **P**.

### CLIQUE: cruzando da lógica para grafos

Um *clique* num grafo não direcionado `G = (V, E)` é um subconjunto `V' ⊆ V` no qual todo par de vértices é ligado por uma aresta — um subgrafo completo. O problema de decisão é `CLIQUE = {⟨G, k⟩ : G contém um clique de tamanho k}`. O algoritmo ingênuo enumera todos os `k`-subconjuntos de `V` e checa cada um, rodando em `Θ(k² · C(|V|, k))` — polinomial quando `k` é constante, superpolinomial quando `k` está perto de `|V|/2`.

**Teorema 34.11: `CLIQUE` é NP-completo.** Para NP, o certificado é o próprio conjunto de vértices `V'`, verificado checando que `(u, v) ∈ E` para todo par `u, v ∈ V'`. A NP-dificuldade é `3-CNF-SAT ≤p CLIQUE`, o que é surpreendente à primeira vista — fórmulas lógicas parecem ter pouco a ver com grafos — e é o arquétipo de uma redução entre domínios.

Dado `φ = C1 ∧ C2 ∧ ... ∧ Ck` em 3-CNF, onde a cláusula `Cr = (l1r ∨ l2r ∨ l3r)`:

```java
// Tradução fiel da construção na prova do Teorema 34.11.
// Um vértice por ocorrência de literal; k trios ao todo, um por cláusula.
// A aresta (v_i^r, v_j^s) existe se e somente se as ocorrências estão em
// cláusulas DIFERENTES E os literais são consistentes (nenhum é a negação do outro).
Graph buildCliqueInstance(List<Clause> clauses) {
    Graph g = new Graph();
    for (int r = 0; r < clauses.size(); r++) {
        for (int i = 0; i < 3; i++) {
            g.addVertex(vertexId(r, i));          // v_i^r, rotulado pelo literal l_i^r
        }
    }
    for (int r = 0; r < clauses.size(); r++) {
        for (int s = r + 1; s < clauses.size(); s++) {   // r != s: só trios diferentes
            for (int i = 0; i < 3; i++) {
                for (int j = 0; j < 3; j++) {
                    Literal a = clauses.get(r).literal(i);
                    Literal b = clauses.get(s).literal(j);
                    if (!a.isNegationOf(b)) {              // literais consistentes
                        g.addEdge(vertexId(r, i), vertexId(s, j));
                    }
                }
            }
        }
    }
    return g;   // a instância de CLIQUE é <g, k>, onde k = número de cláusulas
}
```

A construção é claramente polinomial. A equivalência, `φ` satisfatível se e somente se `G` tem um clique de tamanho `k`:

- **Direção direta.** Uma atribuição satisfatória torna pelo menos um literal verdadeiro em toda cláusula `Cr`; escolha um desses literais verdadeiros por cláusula, dando `k` vértices. Quaisquer dois deles estão em trios diferentes e ambos recebem valor 1, então nenhum pode ser o complemento do outro — por construção a aresta entre eles existe. Esses `k` vértices formam um clique.
- **Direção reversa.** Um clique `V'` de tamanho `k` contém exatamente um vértice por trio, já que nenhuma aresta liga vértices dentro de um trio. Atribua 1 a cada literal correspondente. Como `G` não tem arestas entre literais inconsistentes, nenhuma variável e sua negação recebem 1 ao mesmo tempo, então a atribuição é consistente, e toda cláusula tem um literal verdadeiro. Variáveis não representadas no clique podem ser definidas arbitrariamente.

A fonte para aqui numa sutileza que vale internalizar. A redução só produz grafos de um formato especial (vértices em trios, sem arestas intra-trio), então parece provar NP-dificuldade só para essa família restrita. Isso é normal, e *de fato* estabelece NP-dificuldade para grafos gerais: um algoritmo em tempo polinomial para `CLIQUE` em grafos gerais também resolveria esses restritos. O movimento **oposto** — reduzir só instâncias especialmente estruturadas de `3-CNF-SAT` para instâncias gerais de `CLIQUE` — não bastaria, porque essas instâncias especiais de `3-CNF-SAT` poderiam ser fáceis. Uma segunda sutileza: a redução consome a *instância* `φ`, nunca uma *solução* dela. Uma redução que precisasse saber se `φ` é satisfatível não valeria nada, já que decidir isso em tempo polinomial é exatamente o que ninguém sabe fazer.

### VERTEX-COVER: a redução por grafo complementar

Um *vertex cover* de `G = (V, E)` é um subconjunto `V' ⊆ V` tal que toda aresta `(u, v) ∈ E` tem `u ∈ V'` ou `v ∈ V'` (ou ambos). A linguagem é `VERTEX-COVER = {⟨G, k⟩ : G tem um vertex cover de tamanho k}`.

**Teorema 34.12: `VERTEX-COVER` é NP-completo.** Para NP, o certificado é o cover `V'`; o verificador checa `|V'| = k` e então, para cada aresta `(u, v) ∈ E`, que `u ∈ V'` ou `v ∈ V'`. A NP-dificuldade é `CLIQUE ≤p VERTEX-COVER`, e é lindamente curta. Defina o **complemento** de `G = (V, E)` como `Ḡ = (V, Ē)` onde `Ē = {(u, v) : u, v ∈ V, u ≠ v, e (u, v) ∉ E}` — exatamente as arestas que faltam em `G`. A redução mapeia a instância de `CLIQUE` `⟨G, k⟩` para a instância de `VERTEX-COVER` `⟨Ḡ, |V| − k⟩`, computável em tempo polinomial. Então:

- **Direção direta.** Se `G` tem um clique `V'` com `|V'| = k`, pegue qualquer aresta `(u, v) ∈ Ē`. Então `(u, v) ∉ E`, então `u` e `v` não podem estar ambos em `V'` (todo par num clique é ligado em `E`), então pelo menos um deles está em `V − V'`. Toda aresta de `Ē` é portanto coberta por `V − V'`, um conjunto de tamanho `|V| − k`.
- **Direção reversa.** Se `Ḡ` tem um vertex cover `V'` de tamanho `|V| − k`, então para todo `u, v ∈ V`, `(u, v) ∈ Ē` implica `u ∈ V'` ou `v ∈ V'`. A contrapositiva diz: se `u ∉ V'` e `v ∉ V'`, então `(u, v) ∈ E`. Então `V − V'` é um clique, de tamanho `|V| − |V'| = k`.

A fonte imediatamente adiciona a nota prática que motiva o conceito irmão "Algoritmos de Aproximação: Vertex Cover e TSP": como `VERTEX-COVER` é NP-completo, não esperamos um algoritmo exato em tempo polinomial, mas a Seção 35.1 dá um algoritmo de aproximação em tempo polinomial cujo cover é no máximo o dobro do tamanho mínimo. NP-completude é um motivo para mudar de tática, não para desistir.

### HAM-CYCLE: a redução por gadget

**Teorema 34.13: `HAM-CYCLE` é NP-completo.** Pertença em NP: o certificado é a sequência de `|V|` vértices formando o ciclo, e o verificador checa que ela contém cada vértice exatamente uma vez e que vértices consecutivos (incluindo do último para o primeiro) são ligados por arestas. A NP-dificuldade é `VERTEX-COVER ≤p HAM-CYCLE`, de longe a prova mais intrincada do capítulo, e a vitrine da fonte para **gadgets** — um pedaço de grafo que impõe certas propriedades restringindo como um ciclo pode passar por ele.

Dado `G = (V, E)` e o inteiro `k` (assumindo sem perda de generalidade que `G` não tem vértices isolados e `k ≤ |V|`), construa `G' = (V', E')`:

- **Um gadget por aresta.** Para cada `(u, v) ∈ E`, `G'` contém uma cópia do gadget, denotado `W_uv`, cujos 12 vértices são escritos `[u, v, i]` e `[v, u, i]` para `1 ≤ i ≤ 6`, e que contém 14 arestas. Crucialmente, **só** `[u, v, 1]`, `[u, v, 6]`, `[v, u, 1]` e `[v, u, 6]` têm arestas saindo do gadget. Essa restrição é o que faz o gadget funcionar: qualquer ciclo hamiltoniano de `G'` precisa atravessar `W_uv` de exatamente uma de três formas — entrando em `[u, v, 1]` e saindo em `[u, v, 6]` cobrindo todos os 12 vértices ou só `[u, v, 1..6]` (caso em que o ciclo precisa reentrar depois para cobrir `[v, u, 1..6]`), ou simetricamente entrando em `[v, u, 1]`. Nenhuma outra travessia dos 12 vértices é possível; em particular você não consegue formar dois caminhos vértice-disjuntos, um de `[u, v, 1]` a `[v, u, 6]` e o outro de `[v, u, 1]` a `[u, v, 6]`, cuja união cubra o gadget.
- **Arestas de caminho por vértice.** Ordene os vizinhos de cada `u ∈ V` arbitrariamente como `u⁽¹⁾, ..., u⁽ᵈᵉᵍʳᵉᵉ⁽ᵘ⁾⁾`, e adicione as arestas `{([u, u⁽ⁱ⁾, 6], [u, u⁽ⁱ⁺¹⁾, 1]) : 1 ≤ i ≤ degree(u) − 1}`. Isso encadeia todos os gadgets para arestas incidentes em `u` num único caminho. A intuição: se `u` está no vertex cover, esse caminho "cobre" todos os gadgets de `u` — pegando os 12 vértices de um gadget quando só `u` está no cover, ou só 6 quando ambos os extremos estão.
- **Vértices seletores.** Adicione `s1, ..., sk` e ligue todo seletor ao primeiro e ao último vértice de cada um desses caminhos por vértice: `{(sj, [u, u⁽¹⁾, 1])}` e `{(sj, [u, u⁽ᵈᵉᵍʳᵉᵉ⁽ᵘ⁾⁾, 6])}` para todo `u ∈ V`, `1 ≤ j ≤ k`. Os `k` seletores são o que escolhe os `k` vértices do cover.

O tamanho é polinomial: `|V'| = 12|E| + k ≤ 12|E| + |V|`, e `|E'| = 14|E| + (2|E| − |V|) + 2k|V| = 16|E| + (2k − 1)|V| ≤ 16|E| + (2|V| − 1)|V|`.

O argumento de equivalência funciona nas duas direções. Dado um cover `V* = {u1, ..., uk}`, construa o ciclo começando em `s1`, caminhando pelo caminho-gadget de `u1`, indo a `s2`, caminhando pelos gadgets de `u2`, e assim por diante de volta a `s1`; cada gadget é visitado uma ou duas vezes dependendo de se um ou ambos de seus extremos estão em `V*`, e como `V*` cobre toda aresta, todo vértice de gadget é visitado. Reciprocamente, dado um ciclo hamiltoniano `C`, defina `V* = {u ∈ V : (sj, [u, u⁽¹⁾, 1]) ∈ C para algum 1 ≤ j ≤ k}`. A prova primeiro mostra que `V*` está bem definido particionando `C` em "caminhos de cobertura" — caminhos maximais indo de um seletor a outro sem passar por um terceiro — e argumentando que todo seletor tem exatamente uma aresta de ciclo incidente desse tipo. Então todo caminho de cobertura `Pu` cobre todos os gadgets de arestas incidentes em `u`, e todo gadget é visitado por um ou dois caminhos de cobertura, então toda aresta de `E` é coberta por algum vértice de `V*`. (O Exercício 34.5-9 pergunta o que quebra se `G` tiver um vértice isolado.)

### TSP: a redução mais fácil do capítulo

No problema do caixeiro-viajante o vendedor precisa fazer um tour por `n` cidades — um ciclo hamiltoniano num grafo completo — pagando um custo inteiro não negativo `c(i, j)` por trecho, e a versão de decisão pergunta se existe um tour de custo no máximo `k`:

`TSP = {⟨G, c, k⟩ : G = (V, E) é um grafo completo, c é uma função de V × V → ℕ, k ∈ ℕ, e G tem um tour de caixeiro-viajante com custo no máximo k}`.

**Teorema 34.14: `TSP` é NP-completo.** O certificado é a sequência de `n` vértices do tour; o verificador checa que é uma permutação, soma os custos das arestas, e compara com `k`. A NP-dificuldade é `HAM-CYCLE ≤p TSP`, e são três linhas: dada uma instância de `HAM-CYCLE` `G = (V, E)`, forme o grafo completo `G' = (V, E')` com `E' = {(i, j) : i, j ∈ V e i ≠ j}` e

```
c(i, j) = 0   se (i, j) ∈ E
c(i, j) = 1   se (i, j) ∉ E
```

e produza `⟨G', c, 0⟩`. Se `G` tem um ciclo hamiltoniano `H`, toda aresta de `H` está em `E` e portanto custa 0, tornando `H` um tour de custo 0 em `G'`. Reciprocamente, um tour de custo no máximo 0 precisa ter custo exatamente 0 (os custos são 0 ou 1), então toda aresta nele custa 0, então toda aresta está em `E` — o tour é um ciclo hamiltoniano de `G`. Note que esse não é o TSP com sabor de aproximação do conceito irmão "Algoritmos de Aproximação: Vertex Cover e TSP"; aqui a função de custo é construída deliberadamente e nenhuma desigualdade triangular é assumida.

### SUBSET-SUM: cruzando para a aritmética com colunas de dígitos

O problema de subset-sum recebe um conjunto finito `S` de inteiros positivos e um alvo `t > 0`, e pergunta se algum `S' ⊆ S` soma exatamente `t`: `SUBSET-SUM = {⟨S, t⟩ : existe um subconjunto S' ⊆ S tal que t = Σ_{s ∈ S'} s}`. A codificação padrão importa aqui — os inteiros de entrada são codificados em **binário**, o que é o que impede o problema de ser trivialmente polinomial no valor numérico de `t` (veja o Exercício 34.5-4, que pede para você resolvê-lo em tempo polinomial quando `t` é dado em unário).

**Teorema 34.15: `SUBSET-SUM` é NP-completo.** Para NP, o certificado é `S'` e o verificador só soma tudo. A NP-dificuldade é `3-CNF-SAT ≤p SUBSET-SUM` — a segunda redução entre domínios a partir de 3-CNF, e a única em que o gadget é aritmético em vez de estrutural.

Dada uma fórmula 3-CNF `φ` sobre as variáveis `x1, ..., xn` com cláusulas `C1, ..., Ck`, e duas suposições simplificadoras inofensivas (nenhuma cláusula contém tanto uma variável quanto sua negação, já que tal cláusula é sempre satisfeita; toda variável aparece em pelo menos uma cláusula), construa números em base 10 com `n + k` dígitos. As posições de dígito mais significativas `n` são rotuladas por variáveis e as `k` menos significativas por cláusulas:

```java
// Tradução fiel da construção de números na prova do Teorema 34.15.
// Todo número tem n + k dígitos em base 10: n colunas de variável, depois k colunas de cláusula.
// Alvo: 1 em toda coluna de variável, 4 em toda coluna de cláusula.
List<BigInteger> buildSubsetSumInstance(int n, List<Clause> clauses) {
    int k = clauses.size();
    List<BigInteger> S = new ArrayList<>();

    for (int i = 0; i < n; i++) {
        int[] v  = new int[n + k];   // escolhido quando x_i = 1
        int[] vp = new int[n + k];   // v'_i, escolhido quando x_i = 0
        v[i] = 1;                    // o dígito rotulado por x_i
        vp[i] = 1;
        for (int j = 0; j < k; j++) {
            if (clauses.get(j).contains(positive(i))) v[n + j] = 1;
            if (clauses.get(j).contains(negated(i)))  vp[n + j] = 1;
        }
        S.add(toNumber(v));
        S.add(toNumber(vp));
    }
    for (int j = 0; j < k; j++) {    // "gadgets" de folga: um 1 e um 2 por coluna de cláusula
        int[] s  = new int[n + k];
        int[] sp = new int[n + k];
        s[n + j] = 1;
        sp[n + j] = 2;
        S.add(toNumber(s));
        S.add(toNumber(sp));
    }
    return S;   // o alvo t tem 1 em cada um dos n dígitos de variável, 4 em cada um dos k dígitos de cláusula
}
```

A base é todo o truque. A maior soma possível numa posição de dígito é **6** — no máximo três 1s dos valores `vi`/`v'i` (uma cláusula tem três literais) mais 1 e 2 dos dois valores de folga — então em base 10 **nenhum carry pode ocorrer** entre posições de dígito, e cada coluna pode ser raciocinada independentemente. A nota de rodapé da fonte observa que qualquer base `b ≥ 7` funciona igualmente bem.

A unicidade dos valores também vale: para `ℓ ≠ i`, nenhum `vℓ` ou `v'ℓ` pode igualar `vi` ou `v'i` nos `n` dígitos mais altos, e `vi` não pode igualar `v'i` nos `k` dígitos mais baixos — isso exigiria que `xi` e `¬xi` aparecessem exatamente nas mesmas cláusulas, o que as suposições simplificadoras descartam.

A redução é polinomial: `S` tem `2n + 2k` valores de `n + k` dígitos cada, e `t` tem `n + k` dígitos produzidos em tempo constante cada. A equivalência:

- **Direção direta.** A partir de uma atribuição satisfatória, inclua `vi` em `S'` quando `xi = 1` e `v'i` quando `xi = 0` — exatamente os números correspondentes a literais verdadeiros. Cada coluna de variável então soma 1, batendo com `t`. Cada coluna de cláusula recebe 1, 2 ou 3 dos valores `v` escolhidos (conforme quantos de seus literais são verdadeiros), então somar o subconjunto não vazio apropriado do par de folga `{sj, s'j}` — valendo 1, 2 ou 3 juntos — leva toda coluna de cláusula a exatamente 4. Sem carries, o total é `t`.
- **Direção reversa.** Um subconjunto somando `t` precisa conter exatamente um de `vi`, `v'i` para cada `i`, ou as colunas de variável não somariam 1; leia isso como a atribuição. Como os dois valores de folga contribuem no máximo 3 para uma coluna de cláusula mas o alvo é 4, pelo menos um valor `v` escolhido precisa ter um 1 naquela coluna — significando que o literal correspondente aparece naquela cláusula e recebe valor 1. Toda cláusula é, portanto, satisfeita.

A Figura 34.19 da fonte resolve um exemplo completo com `n = 3`, `k = 4`, produzindo `S = {1001001, 1000110, 100001, 101110, 10011, 11100, 1000, 2000, 100, 200, 10, 20, 1, 2}` e `t = 1114444`, onde o subconjunto `{v'1, v'2, v3}` mais as folgas `s1, s'1, s'2, s3, s4, s'4` atinge o alvo, correspondendo à atribuição satisfatória `⟨x1 = 0, x2 = 0, x3 = 1⟩`.

### Estratégias de redução e armadilhas (Seção 34.5.6)

Nenhuma estratégia única cobre todo problema — algumas reduções são de três linhas (`HAM-CYCLE` para `TSP`) e outras preenchem cinco páginas (`VERTEX-COVER` para `HAM-CYCLE`). A fonte fecha com um checklist:

- **Não erre a direção.** Para mostrar que `Y` é NP-completo, você precisa reduzir um `X` NP-completo conhecido **para** `Y`, de forma que um resolvedor de `Y` produza um resolvedor de `X`. Reduzir `Y` para `X` não prova nada sobre a dificuldade de `Y`.
- **NP-hard não é NP-completo.** Reduzir um `X` NP-completo conhecido para `Y` prova só que `Y` é NP-hard. Você ainda deve a prova de que `Y ∈ NP`, mostrando que um certificado para `Y` pode ser verificado em tempo polinomial.
- **Vá do geral para o específico.** Você precisa lidar com *qualquer* entrada para `X`, mas você é livre para produzir entradas para `Y` com qualquer estrutura especial que quiser — a redução de 3-CNF para subset-sum só emite `2n + 2k` inteiros de um formato particular, e isso é aceitável.
- **Reduza a partir do problema com mais estrutura.** É quase sempre mais fácil reduzir a partir de `3-CNF-SAT` do que a partir de `SAT`, porque fórmulas 3-CNF são rígidas enquanto fórmulas booleanas são arbitrárias; da mesma forma, mais fácil a partir de `HAM-CYCLE` do que a partir de `TSP`, já que ciclo hamiltoniano é efetivamente TSP restrito a pesos de aresta 0/1.
- **Procure casos especiais.** Se um `X` NP-hard é um caso especial de `Y`, então `Y` também é NP-hard, já que um resolvedor em tempo polinomial para o `Y` mais geral resolveria `X` de graça. O exemplo da fonte: set-partition (Exercício 34.5-5) é o problema de decisão da mochila 0-1 com o valor de cada item igual ao seu peso e tanto `W` quanto `V` definidos como metade do total.
- **Escolha um problema de um domínio relacionado** — vertex-cover veio de clique, ciclo hamiltoniano de vertex-cover, TSP de ciclo hamiltoniano, todos problemas de grafo não direcionado. Quando você precisa cruzar domínios, `3-CNF-SAT` geralmente é a fonte certa. Dentro de problemas de grafo: use vertex-cover quando você precisa selecionar parte do grafo sem considerar ordenação, e ciclo hamiltoniano ou caminho hamiltoniano quando a ordenação importa.
- **Faça grandes recompensas e grandes penalidades.** A redução de `HAM-CYCLE` para `TSP` recompensou o uso de arestas reais com custo 0. Equivalentemente poderia ter penalizado arestas falsas com custo infinito — com arestas reais no peso `W` o alvo do tour se torna `W · |V|`. Penalidades são um jeito de codificar requisitos rígidos.
- **Projete gadgets.** Um gadget é qualquer componente que impõe uma propriedade. Podem ser elaborados, como o subgrafo de 12 vértices na redução de ciclo hamiltoniano, ou triviais, como os valores de folga `sj` e `s'j` que permitem que cada coluna de cláusula chegue a exatamente 4 na redução de subset-sum.

## Trade-offs

- **A receita é barata, mas só porque alguém pagou por `CIRCUIT-SAT` uma vez.** Toda prova nesse catálogo é um argumento de duas páginas em vez de um argumento de codificação de máquina, e isso se apoia inteiramente no Teorema 34.7 ter feito a redução direta a partir de todo NP. O Lema 34.8 compra alavancagem, não um almoço grátis — escolha o problema base errado e o passo 2b ainda pode ser intratável de escrever.
- **Provar NP-dificuldade é uma afirmação de pior caso sobre uma *família*, não um veredito sobre suas instâncias.** A prova de `CLIQUE` só produz grafos cujos vértices vêm em trios disjuntos; isso basta para a afirmação geral, mas é um lembrete de que NP-completude diz que um algoritmo *geral* em tempo polinomial é improvável. Suas entradas de produção podem viver numa classe restrita fácil — o mesmo motivo pelo qual `2-CNF-SAT` está em P enquanto `3-CNF-SAT` é NP-completo.
- **Reduções por gadget são corretas mas não construtivas de um jeito útil.** A construção de `VERTEX-COVER` para `HAM-CYCLE` infla um grafo com `|E|` arestas para `12|E| + k` vértices e `16|E| + (2k − 1)|V|` arestas. Isso é polinomial e portanto correto para a teoria, mas ninguém de fato resolve vertex cover roteando através de um resolvedor de ciclo hamiltoniano — reduções são dispositivos de prova primeiro, algoritmos um distante segundo lugar.
- **A codificação é parte do enunciado do problema.** `SUBSET-SUM` é NP-completo sob a codificação binária padrão de seus inteiros; o Exercício 34.5-4 observa que ele se torna resolvível em tempo polinomial quando o alvo `t` é escrito em unário. Se você algum dia "provar" algo sobre a dificuldade de um problema numérico, verifique qual codificação você assumiu antes de acreditar no resultado.
- **NP-completude fecha uma porta e abre várias.** Imediatamente depois de provar `VERTEX-COVER` NP-completo, a fonte aponta para a 2-aproximação da Seção 35.1 — o assunto do conceito irmão "Algoritmos de Aproximação: Vertex Cover e TSP". Uma prova de dificuldade concluída é o *começo* da conversa de engenharia sobre aproximação, casos especiais e heurísticas, não o fim dela.

## Documentation Links

- [Cormen, Leiserson, Rivest, Stein — Introduction to Algorithms, 4th Edition, Chapter 34 "NP-Completeness", Sections 34.4-34.5, pp. 1072-1098](https://mitpress.mit.edu/9780262046305/introduction-to-algorithms/) — doc
