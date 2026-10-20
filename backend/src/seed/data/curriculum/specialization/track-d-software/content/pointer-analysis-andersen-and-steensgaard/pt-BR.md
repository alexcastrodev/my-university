---
version: 1.0
updatedAt: 2026-10-20
title: "Análise de Ponteiros: Andersen e Steensgaard"
summary: "Quase toda outra análise e otimização precisa saber a quais posições de memória um ponteiro ou referência pode se referir. A análise de Andersen, baseada em inclusão, resolve restrições de subconjunto com precisão e custo cúbico no pior caso, a de Steensgaard, baseada em unificação, funde classes de equivalência em tempo quase linear, e as sensibilidades a contexto, campo e heap decidem onde uma ferramenta real fica na curva de precisão e custo."
---
## Objetivos de Aprendizagem

- Definir um conjunto de points-to e may-alias, e explicar por que quase toda outra análise e otimização precisa deles.
- Extrair os quatro tipos de restrições de points-to de um programa e resolvê-las com o algoritmo de Andersen, baseado em inclusão.
- Resolver o mesmo programa com o algoritmo de Steensgaard, baseado em unificação, e explicar exatamente onde a precisão se perde e por que ele é mais rápido.
- Descrever as sensibilidades a fluxo, contexto, campo e heap, e aplicar informação de points-to à construção de grafos de chamadas e à análise de escape.

## Contexto e Motivação

`computer/c-and-assembly` mostrou que `*p = 1` pode mudar qualquer variável para a qual `p` aponta, e `software-distributed/compilers` mostrou que otimizações como eliminação de subexpressões comuns, eliminação de stores mortos e propagação de constantes só são válidas quando nenhuma escrita escondida muda um valor no meio do caminho. Sem saber a quais posições um ponteiro pode se referir, o compilador precisa assumir que um store através de `p` pode modificar qualquer coisa, e isso mata a maioria das otimizações. A mesma pergunta decide se uma análise de taint enxerga um vazamento, se um detector de data races reporta dois acessos como conflitantes e quais métodos uma chamada virtual pode alcançar. O Java não tem aritmética de ponteiros, mas toda referência a objeto é um ponteiro e a pergunta sobre aliasing é idêntica.

A **análise de ponteiros** (ou análise de alias) calcula, para cada variável ponteiro, um **conjunto de points-to**: as posições abstratas de memória que ela pode conter. Dois ponteiros **podem ser aliases** se os seus conjuntos se sobrepõem. Respostas exatas são indecidíveis, então toda análise superaproxima, como na interpretação abstrata. O espaço de projeto é uma troca entre precisão e custo que vai de quase linear a exponencial, e os dois extremos baratos mais conhecidos são os algoritmos de Andersen (1994) e de Steensgaard (1996). O livro *Static Program Analysis*, de Møller e Schwartzbach, e a revisão de Smaragdakis e Balatsouras desenvolvem o espaço todo.

## Teoria Central

### Posições abstratas e restrições

A análise nomeia a memória com **posições abstratas**: cada variável do programa cujo endereço é tomado e cada **ponto de alocação** (cada `malloc` ou `new` no código-fonte, representando todos os objetos que ele cria). Uma análise insensível a fluxo ignora a ordem dos comandos e calcula uma relação de points-to válida para o programa todo. Cada comando gera uma restrição, em que $\text{pts}(p)$ é o conjunto de points-to de $p$:

| Comando | Restrição |
|---|---|
| `p = &x` ou `p = new T` (ponto $o$) | $\{x\} \subseteq \text{pts}(p)$ (ou $\{o\}$) |
| `p = q` | $\text{pts}(q) \subseteq \text{pts}(p)$ |
| `p = *q` | para cada $a \in \text{pts}(q)$: $\text{pts}(a) \subseteq \text{pts}(p)$ |
| `*p = q` | para cada $a \in \text{pts}(p)$: $\text{pts}(q) \subseteq \text{pts}(a)$ |

As duas últimas dependem dos conjuntos de points-to correntes, então resolvê-las é uma iteração. Para linguagens orientadas a objetos, `p = q.f` e `p.f = q` leem e escrevem o campo $f$ de cada objeto para o qual $q$ ou $p$ aponta, com um conjunto $\text{pts}(o.f)$ separado por objeto e campo.

### Algoritmo de Andersen: baseado em inclusão

Andersen trata as restrições como relações de **subconjunto** e calcula a menor solução com uma worklist: propaga conjuntos de points-to ao longo das arestas `p = q` e, cada vez que um conjunto cresce, adiciona as novas arestas implicadas pelas restrições de load e store. É a mais precisa das análises insensíveis a fluxo e a contexto, com custo no pior caso de $O(n^3)$ no número de variáveis ponteiro. Na prática, a **eliminação de ciclos** (variáveis num ciclo de arestas de subconjunto precisam ter conjuntos iguais e podem ser fundidas) e a **propagação de diferenças** (encaminhar só os fatos recém-adicionados) fazem a análise escalar para milhões de linhas de C.

### Algoritmo de Steensgaard: baseado em unificação

Steensgaard trata `p = q` como **igualdade**: funde os *alvos* de $p$ e $q$ em uma única classe de equivalência, mantida com uma estrutura union-find, e cada classe aponta para no máximo uma classe. Uma passada pelo programa dá tempo quase linear, $O(n\,\alpha(n))$. O preço é a precisão: os ponteiros dos dois lados de uma atribuição são fundidos mesmo que aquela atribuição seja toda a evidência, então dados não relacionados podem se conectar transitivamente.

### Dimensões de precisão

- **Sensibilidade a fluxo**: respeitar a ordem dos comandos, de modo que `p = &x; ...; p = &y;` deixe $\{y\}$ depois da segunda atribuição (uma *atualização forte*). Muito mais cara; a maioria das análises de programa inteiro é insensível a fluxo.
- **Sensibilidade a contexto**: analisar uma função separadamente para chamadores diferentes. As variantes são sensibilidade a cadeia de chamadas (os últimos $k$ pontos de chamada) e **sensibilidade a objeto** (o objeto receptor da chamada), que costuma ser o melhor ajuste para Java. O custo cresce rápido com $k$.
- **Sensibilidade a campo**: distinguir `s.a` de `s.b`. Uma análise insensível a campo funde todos os campos de uma struct ou objeto.
- **Abstração do heap**: um ponto de alocação dentro de um laço representa muitos objetos, então fatos sobre "o" objeto naquele ponto são fracos; nomeação mais fina (por contexto de chamada) ajuda.

### Aplicações

Conjuntos de points-to servem de entrada para muitas outras análises. **Construção de grafo de chamadas** para chamadas virtuais: a análise de hierarquia de classes (CHA) considera toda subclasse do tipo estático, enquanto a análise de points-to considera só as classes dos objetos que realmente podem alcançar o receptor. Uma chamada com um único alvo pode ser inlinada. A **análise de escape** decide se um objeto pode sair do método que o criou; se não pode, o JIT pode substituí-lo por escalares na pilha, otimização que o C2 do HotSpot e o Graal fazem. A **otimização baseada em alias** no LLVM usa as respostas dos seus passes de análise de alias, e as referências `&mut` do Rust dão ao LLVM `noalias` de graça, porque as regras de propriedade já afirmam que a referência não tem alias. Frameworks como Soot, WALA e Doop (que expressa as análises como regras Datalog) constroem análises de Java sobre isso.

## Exemplos Resolvidos

### Exemplo 1: resolvendo com o algoritmo de Andersen

**Problema:** Calcular os conjuntos de points-to de
```text
a = &x;   b = &y;   p = &a;   q = p;   *q = b;   r = *p;
```

**Solução:** Restrições base: $\text{pts}(a) \ni x$, $\text{pts}(b) \ni y$, $\text{pts}(p) \ni a$. A cópia `q = p` dá $\text{pts}(q) \supseteq \text{pts}(p) = \{a\}$. O store `*q = b` se aplica a cada $t \in \text{pts}(q) = \{a\}$: $\text{pts}(a) \supseteq \text{pts}(b) = \{y\}$, então $\text{pts}(a) = \{x, y\}$. O load `r = *p` se aplica a cada $t \in \text{pts}(p) = \{a\}$: $\text{pts}(r) \supseteq \text{pts}(a) = \{x, y\}$. Resultado: $\text{pts}(a) = \{x,y\}$, $\text{pts}(b) = \{y\}$, $\text{pts}(p) = \text{pts}(q) = \{a\}$, $\text{pts}(r) = \{x,y\}$. O store através de `q` mudou o que `a` guarda, e o load através de `p` o observou, porque `p` e `q` têm o mesmo alvo `a`; a resolução insensível a fluxo descobre isso sem olhar a ordem dos comandos.

### Exemplo 2: onde Steensgaard perde precisão

**Problema:** Comparar os dois algoritmos em `p = &x; q = &y; r = p; r = q;` e depois perguntar se `p` e `q` podem ser aliases.

**Solução:** Andersen: $\text{pts}(p) = \{x\}$, $\text{pts}(q) = \{y\}$, $\text{pts}(r) = \{x, y\}$. Os conjuntos de `p` e `q` são disjuntos, então não são aliases. Steensgaard: `r = p` funde a classe-alvo de `r` com a de `p`, e `r = q` então a funde com a de `q`; como a fusão é simétrica, `p` e `q` agora apontam para a mesma classe $\{x, y\}$. A análise responde "podem ser aliases", o que é espúrio: nem `p` nem `q` jamais guardaram o alvo do outro. Duas atribuições para um mesmo ponteiro bastaram para conectá-los. Esse é o custo de tornar o algoritmo quase linear.

### Exemplo 3: sensibilidade a contexto e desvirtualização

**Problema:** No trecho Java abaixo, para o que `x` e `y` apontam sob uma análise insensível a contexto e uma sensível a 1 ponto de chamada, e o que isso significa para `x.run()`?

```java
static Object id(Object o) { return o; }
Object x = id(new A());   // ponto de chamada 1, ponto de alocação a1
Object y = id(new B());   // ponto de chamada 2, ponto de alocação b1
```

**Solução:** Insensível a contexto: as duas chamadas compartilham o único resumo de `id`, então $\text{pts}(o) = \{a_1, b_1\}$ e portanto $\text{pts}(x) = \text{pts}(y) = \{a_1, b_1\}$. Então `x.run()` tem dois alvos possíveis, `A.run` e `B.run`, e não pode ser desvirtualizada. Com sensibilidade a 1 ponto de chamada, `id` é analisada uma vez por ponto de chamada: $\text{pts}(x) = \{a_1\}$ e $\text{pts}(y) = \{b_1\}$, então `x.run()` se resolve só em `A.run` e pode ser inlinada. Um método utilitário usado em muitos lugares é exatamente onde a sensibilidade a contexto compensa, e onde mais custa.

## Equívocos Comuns e Armadilhas

- **"Java não tem ponteiros, então aliasing não é problema."** Toda referência a objeto é um ponteiro. Duas variáveis podem se referir ao mesmo objeto, e `a.f = 1` pode mudar o que `b.f` lê.
- **"Mais sensibilidade é sempre melhor."** Precisão custa tempo e memória, às vezes exponencialmente, e pode fazer uma análise falhar em um programa grande. Ferramentas práticas escolhem a configuração mais barata que responde à pergunta do seu cliente, e algumas misturam: uma análise precisa para métodos selecionados, uma barata no resto.
- **"Análises insensíveis a fluxo são grosseiras demais para serem úteis."** São o cavalo de batalha: um único grafo de points-to para o programa inteiro é o que deixa grafos de chamadas e análise de escape escalarem para milhões de linhas.
- **"Andersen e Steensgaard acham os conjuntos de points-to exatos."** Acham superaproximações corretas. O aliasing exato é indecidível, e até os algoritmos mais precisos da literatura têm falsos positivos.

## Resumo

A análise de ponteiros calcula, para cada ponteiro, uma superaproximação correta das posições abstratas que ele pode conter, o que muitas outras análises e otimizações precisam. Os comandos viram quatro tipos de restrições sobre conjuntos de points-to. Andersen as resolve como restrições de subconjunto, mais precisas e cúbicas no pior caso, e Steensgaard como igualdades com union-find, quase lineares mas fundindo dados não relacionados. As sensibilidades a fluxo, contexto, campo e heap trocam custo por precisão, e os resultados alimentam construção de grafos de chamadas, análise de escape, rastreamento de taint e otimização baseada em alias. O próximo conceito adota a abordagem oposta: em vez de superaproximar todas as execuções de uma vez, a execução simbólica explora caminhos individuais exatamente.

## Documentation Links

- [Smaragdakis, Balatsouras: Pointer Analysis (Foundations and Trends in Programming Languages, 2015)](https://yanniss.github.io/points-to-tutorial15.pdf): doc
- [Steensgaard: Points-to Analysis in Almost Linear Time (POPL 1996)](https://dl.acm.org/doi/10.1145/237721.237727): doc
- [Moller, Schwartzbach: Static Program Analysis, chapter on pointer analysis](https://cs.au.dk/~amoeller/spa/): doc
