---
version: 1.0
updatedAt: 2026-10-20
title: "Interpretação Abstrata e Conexões de Galois"
summary: "A interpretação abstrata executa um programa sobre um domínio simplificado (sinais, intervalos) em vez de valores concretos, e uma conexão de Galois entre os dois garante que todo comportamento concreto é coberto. O alargamento (widening) força os laços a convergir, trocando precisão por terminação, e o resultado é uma análise correta que pode provar a ausência de classes inteiras de erros de execução."
---
## Objetivos de Aprendizagem

- Explicar por que a análise exata de programas é impossível e como abstrair a semântica dá uma aproximação computável e correta.
- Definir um domínio abstrato (sinais, intervalos) com seu join e seus operadores abstratos, e enunciar a correção por meio de uma conexão de Galois $(\alpha, \gamma)$.
- Executar uma análise de intervalos de um laço com widening e narrowing, e ler o resultado.
- Distinguir análises corretas (sound) de caçadores de bugs, explicar alarmes falsos e dizer o que os domínios relacionais acrescentam aos não relacionais.

## Contexto e Motivação

`software-distributed/compilers` apresentou a análise de fluxo de dados como iteração sobre um reticulado até um ponto fixo, e `ai-theory/formal-methods` terminou com os limites da verificação: pelo teorema de Rice, nenhum algoritmo decide exatamente qualquer propriedade semântica não trivial de programas. Analisadores estáticos contornam isso abrindo mão da exatidão em uma direção. Respondem "esta propriedade **com certeza vale**" ou "**não sei dizer**", nunca errando da primeira forma. A **interpretação abstrata**, introduzida por Patrick e Radhia Cousot em 1977, é a teoria que diz como construir esses analisadores e provar que são corretos.

Ela é a base dos analisadores estáticos industriais mais fortes. O Astrée, construído sobre essa teoria, provou a ausência de erros de execução (overflow, divisão por zero, acesso fora dos limites) no software primário de controle de voo do Airbus A340, um programa com mais de 100 mil linhas de C, sem alarmes falsos depois de especializado para esse domínio (Blanchet et al., PLDI 2003). O plugin Eva do Frama-C, o IKOS da NASA e as análises de faixa de valores dentro de compiladores otimizadores como o LLVM seguem a mesma receita. As análises de fluxo de dados que você já conhece são casos especiais: a interpretação abstrata acrescenta domínios de altura infinita e uma forma fundamentada de fazer a iteração terminar.

## Teoria Central

### Semântica concreta e abstrata

Tome uma linguagem imperativa minúscula com variáveis inteiras. A sua **semântica concreta** associa a cada ponto do programa o conjunto de todos os valores (ou, em geral, todos os estados de memória) que o alcançam em alguma execução. É um objeto matemático, um elemento do reticulado das partes $\mathcal{P}(\mathbb{Z})$ por variável, e não é computável em geral.

Um **domínio abstrato** troca conjuntos de valores por uma descrição pequena que um programa consegue manipular. Dois domínios não relacionais clássicos:

- **Sinais**: $\{\bot, -, 0, +, \top\}$, descrevendo o sinal de uma variável. $\bot$ significa "nenhum valor", $\top$ significa "qualquer inteiro".
- **Intervalos**: $[l, u]$ com $l \in \mathbb{Z} \cup \{-\infty\}$ e $u \in \mathbb{Z} \cup \{+\infty\}$. O join é o menor intervalo que envolve os dois: $[a,b] \sqcup [c,d] = [\min(a,c), \max(b,d)]$.

Toda operação da linguagem ganha uma **função de transferência abstrata** que a superaproxima. Para intervalos, $[a,b] + [c,d] = [a+c,\ b+d]$, e a multiplicação toma o mínimo e o máximo dos quatro produtos. Um condicional `if (x < 100)` refina o intervalo intersectando-o com $(-\infty, 99]$ num ramo e $[100, +\infty)$ no outro.

### Conexões de Galois e correção

A relação entre concreto e abstrato é uma **conexão de Galois**: dois mapas monótonos, a abstração $\alpha : \mathcal{P}(\mathbb{Z}) \to A$ e a concretização $\gamma : A \to \mathcal{P}(\mathbb{Z})$, tais que

$$\alpha(C) \sqsubseteq a \iff C \subseteq \gamma(a)$$

Em palavras, $\alpha(C)$ é o valor abstrato mais preciso que cobre $C$, e $\gamma(a)$ é o conjunto de valores concretos que $a$ representa. Uma função de transferência abstrata $f^\#$ é **correta** (sound) para uma função concreta $f$ quando

$$f(\gamma(a)) \subseteq \gamma(f^\#(a))$$

para todo $a$: quaisquer que sejam os valores concretos que a entrada abstrata representa, os resultados concretos são cobertos pela saída abstrata. Se toda operação é correta e o join é um limite superior, a análise inteira é correta, porque calcula um superconjunto dos comportamentos reais. A melhor $f^\#$ possível é $\alpha \circ f \circ \gamma$, que costuma ser cara demais para calcular exatamente e é trocada por uma correta mais barata.

### Laços: pontos fixos, widening, narrowing

No cabeçalho de um laço, o estado abstrato precisa cobrir o estado de entrada e o estado depois de qualquer número de iterações. Isso é um ponto fixo de $X = \text{entrada} \sqcup F(X)$, que a iteração de Kleene calcula repetindo a partir de $\bot$. Num reticulado de altura finita (sinais) isso termina. No domínio de intervalos pode não terminar: um laço que incrementa um contador produz $[0,0], [0,1], [0,2], \dots$ para sempre.

Um operador de **widening** $\nabla$ força a terminação extrapolando: mantém um limite estável e descarta um que continua crescendo, mandando-o para o infinito:

$$[a,b] \mathbin{\nabla} [c,d] = [\,l,\ u\,] \quad \text{onde } l = \begin{cases} a & c \geq a \\ -\infty & c < a \end{cases}, \quad u = \begin{cases} b & d \leq b \\ +\infty & d > b \end{cases}$$

A iteração com widening chega a um ponto pós-fixo em um número limitado de passos, sempre correto mas muitas vezes grosseiro demais. Uma passada de **narrowing** em seguida reaplica $F$ algumas vezes, recuperando a precisão perdida pelo salto. As ferramentas também usam *widening com limiares* (pular para a próxima constante do programa em vez de infinito) e widening adiado (iterar algumas vezes antes).

### Precisão e domínios relacionais

Domínios não relacionais guardam uma descrição por variável, e por isso esquecem correlações: se `y = x` e `z = x - y`, intervalos dão a `z` a faixa $[-m, m]$ em vez de $0$. **Domínios relacionais** guardam restrições entre variáveis: octógonos ($\pm x \pm y \leq c$), poliedros (desigualdades lineares arbitrárias) e congruências. São mais precisos e mais caros, a troca central da área. Um analisador correto reporta um possível erro sempre que a sua superaproximação inclui um; se nenhuma execução real o tem, esse relato é um **alarme falso**. Reduzir alarmes falsos para uma família de programas escolhendo ou projetando os domínios certos foi o que o Astrée fez.

### Relação com outras análises

Um sistema de tipos pode ser lido como uma interpretação abstrata em que o domínio é o conjunto de tipos. Uma análise de fluxo de dados é uma interpretação abstrata com um domínio de altura finita. Um **caçador de bugs** que pode deixar erros passar (não correto) é uma ferramenta diferente: pode não ter alarmes falsos, mas pode ter falsos negativos. A correção é o que permite a um analisador dizer "nenhum erro de execução destes tipos é possível", sob premissas declaradas sobre entradas, comportamento de ponto flutuante e ambiente.

## Exemplos Resolvidos

### Exemplo 1: análise de sinais e um alarme falso

**Problema:** Analisar `x = 5; y = -3; z = x * y; w = z + x; r = 1 / w;` com o domínio de sinais e depois com o de intervalos.

**Sinais:** $x = +$, $y = -$, $z = +\cdot- = -$, $w = - + + = \top$ (um negativo mais um positivo pode ter qualquer sinal). Divisão por $w$: $\top$ inclui $0$, então o analisador precisa reportar **possível divisão por zero**. A execução real dá $z=-15$, $w=-10$, então é um alarme falso.

**Intervalos:** $x=[5,5]$, $y=[-3,-3]$, $z=[-15,-15]$, $w=[-10,-10]$ e $0 \notin [-10,-10]$: nenhum alarme, e o resultado é exato. Escolher um domínio mais rico remove o alarme falso a um custo maior por operação.

### Exemplo 2: um laço de intervalos com widening e narrowing

**Problema:** Calcular o intervalo de `i` na saída de `i = 0; while (i < 100) { i = i + 1; }`.

**Solução:** Seja $X$ o intervalo de `i` no cabeçalho do laço. $X_0 = [0,0]$ vindo da entrada. Uma iteração: a guarda `i < 100` mantém $[0,0]$, o corpo dá $[1,1]$ e o join com a entrada dá $X_1 = [0,1]$. Sem widening, isso continuaria até $[0,100]$ em 100 passos (e para sempre se o limite fosse desconhecido). Aplique widening no cabeçalho: $[0,0] \mathbin{\nabla} [0,1] = [0,+\infty]$. Confira que é estável: a guarda dá $[0,99]$, o corpo $[1,100]$, o join com a entrada $[0,100] \sqsubseteq [0,+\infty]$, então $[0,+\infty]$ é um ponto pós-fixo. A condição de saída `i >= 100` dá então $[100,+\infty]$, impreciso. O **narrowing** reaplica $F$ a $[0,+\infty]$ e obtém $[0,100]$, de modo que a saída passa a $[100,100]$: o analisador prova `i == 100` depois do laço.

### Exemplo 3: limites de array e o custo de ignorar correlações

**Problema:** Que acessos o analisador consegue provar seguros em `int a[100]; for (i = 0; i < 100; i++) a[i] = 0;`, e o que dá errado em `x = input in [0,10]; y = x; z = x - y; a[z] = 1`?

**Solução:** No primeiro programa, dentro do corpo do laço a guarda refina `i` para $[0,99]$, que cabe na faixa de índices do array $[0,99]$: todo acesso é provado dentro dos limites. Trocar a guarda por `i <= 100` dá $[0,100]$ e o analisador reporta corretamente um possível acesso fora dos limites em `a[100]`, um bug real. No segundo programa, intervalos calculam $x=[0,10]$, $y=[0,10]$, $z=[0,10]-[0,10]=[-10,10]$, então `a[z]` gera um alarme para índices negativos, embora $z$ seja sempre $0$. Um domínio de **octógonos** registra a restrição $x - y = 0$ e calcula $z=[0,0]$: o alarme falso some.

## Equívocos Comuns e Armadilhas

- **"Correto (sound) significa sem alarmes falsos."** Significa sem erros perdidos (falsos negativos) dentro da classe de propriedades. A correção é comprada com alarmes falsos, e o esforço de engenharia vai para reduzi-los.
- **"Interpretação abstrata é uma ferramenta."** É um arcabouço. Análise de fluxo de dados, muitos sistemas de tipos e algumas técnicas de verificação de modelos são instâncias, e ferramentas como Astrée, Eva e IKOS são implementações com domínios específicos.
- **"Widening destrói o resultado."** Perde precisão para garantir terminação, mas narrowing, limiares e widening adiado recuperam boa parte dela, como mostra o exemplo do laço.
- **"Um relatório limpo prova que o programa está correto."** Prova a ausência das classes de erro que o analisador modela, sob premissas (faixas de entrada, um modelo de ponto flutuante, ausência de outras threads), e nada diz sobre correção funcional.

## Resumo

A interpretação abstrata calcula uma superaproximação correta do comportamento de um programa executando-o sobre um domínio abstrato. Uma conexão de Galois $(\alpha, \gamma)$ liga valores abstratos e concretos, e correção significa que cada operação abstrata cobre a concreta. Laços são tratados por iteração de ponto fixo, e o widening garante terminação em domínios de altura infinita com alguma perda de precisão que o narrowing recupera em parte. Domínios não relacionais como sinais e intervalos são baratos, mas esquecem correlações; domínios relacionais como octógonos e poliedros custam mais e aumentam a precisão. O resultado é um analisador que pode provar a ausência de classes inteiras de erros de execução. O próximo conceito aplica as mesmas ideias à análise de que a maioria das outras análises depende: a quais posições de memória um ponteiro pode se referir.

## Documentation Links

- [Cousot, Cousot: Abstract Interpretation: A Unified Lattice Model for Static Analysis of Programs (POPL 1977)](https://www.di.ens.fr/~cousot/COUSOTpapers/POPL77.shtml): doc
- [Moller, Schwartzbach: Static Program Analysis (lecture notes, Aarhus University)](https://cs.au.dk/~amoeller/spa/): doc
- [Blanchet et al.: A Static Analyzer for Large Safety-Critical Software (PLDI 2003)](https://www.di.ens.fr/~cousot/COUSOTpapers/PLDI03.shtml): doc
