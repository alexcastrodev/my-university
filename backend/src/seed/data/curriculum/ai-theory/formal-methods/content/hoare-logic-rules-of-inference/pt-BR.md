---
version: 1.0
updatedAt: 2026-09-07
title: "Lógica de Hoare: Regras de Inferência"
summary: A lógica de Hoare se torna útil porque as triplas podem ser derivadas de forma composicional. Atribuição, sequência, condicionais, laços e consequência têm, cada um, regras locais, e essas regras permitem que uma prova siga a estrutura do programa em vez de enumerar execuções.
---
## Objetivos de Aprendizagem

- Enunciar com precisão as regras de atribuição, sequência, condicional e consequência da lógica de Hoare.
- Explicar por que essas regras são dirigidas pela sintaxe: cada construção da linguagem de programação tem exatamente uma regra de prova correspondente.
- Escolher uma asserção intermediária para a regra de sequência que torne as duas metades de uma prova demonstráveis.
- Reconhecer a regra de consequência como o ponto em que a consequência lógica comum, e não a sintaxe do programa, entra em toda prova em lógica de Hoare.
- Derivar a tripla de correção de um programa pequeno compondo essas regras, em vez de raciocinar diretamente sobre cada rastro de execução possível.

## Contexto e Motivação

`the-hoare-triple` estabeleceu o que `{P} C {Q}` significa, mas o significado sozinho não fornece um método para provar que uma tripla é verdadeira. A verdadeira percepção de Hoare, a que transforma a tripla de uma definição em uma técnica prática de prova, é que cada construção de uma linguagem imperativa simples pode receber sua própria regra de prova local, de modo que provar uma tripla sobre um programa inteiro se reduz a combinar as provas das suas partes, em um formato que espelha a própria sintaxe do programa, em vez de exigir um argumento novo, inventado do zero, para cada programa.

Isso importa porque a estrutura de um programa é finita e conhecida de antemão, enquanto o número de formas como ele pode executar não é: um laço com um número desconhecido de iterações, ou uma sequência de muitos comandos, poderia em princípio exigir raciocinar sobre arbitrariamente muitos caminhos de execução distintos se a alternativa fosse enumerá-los diretamente. Regras de prova dirigidas pela sintaxe evitam completamente essa explosão: uma atribuição é tratada exatamente pela regra de atribuição, uma sequência de dois comandos dividindo a prova em uma asserção intermediária cuidadosamente escolhida, e um condicional checando cada um dos seus dois ramos uma vez; nunca rastreando os estados concretos pelos quais um programa passa em alguma execução específica.

Este é o ponto da disciplina em que o material começa a parecer um cálculo genuíno (um conjunto fixo, finito e mecanicamente aplicável de regras), e não uma coleção solta de exemplos resolvidos avulsos, e essa mudança importa porque tudo, de `loop-invariants-and-the-while-rule` até os geradores automatizados de condições de verificação vistos bem mais adiante nesta disciplina, é construído diretamente sobre essas mesmas quatro regras, estendidas e automatizadas, mas nunca substituídas na essência.

## Teoria Central

### Regra de atribuição

A regra de atribuição olha deliberadamente para trás, e entender por que ela anda para trás é a chave para usá-la corretamente. Para provar que uma pós-condição `Q` vale depois que a atribuição `x := E` executa, a regra faz uma pergunta diferente de "em que x se transforma": ela pergunta o que precisava ser verdade sobre o estado *antes* de a atribuição rodar para que, quando `x` for substituído em todo lugar de `Q` pela expressão `E`, a condição resultante já valesse antes. Concretamente, a precondição exigida é `Q` com cada ocorrência de `x` substituída textualmente por `E`, escrita `Q[E/x]`. Essa formulação baseada em substituição é o que permite à regra nunca precisar simular a atribuição em cada estado possível a partir do qual ela pode rodar: a precondição é calculada uma vez, sintaticamente, e vale para todo o espaço (potencialmente infinito) de estados iniciais possíveis da atribuição ao mesmo tempo, em vez de ser checada estado por estado.

### Regra de sequência

Para provar uma tripla sobre dois comandos executados um depois do outro, `{P} C1; C2 {R}`, a regra de sequência exige encontrar uma única asserção intermediária `Q` que sirva como pós-condição de `C1` e, ao mesmo tempo, como precondição de `C2`. Encontrado esse `Q`, o problema original se decompõe de forma limpa em dois problemas menores e independentes: provar `{P} C1 {Q}` e, separadamente, provar `{Q} C2 {R}`. Se as duas triplas menores puderem ser provadas, a regra de sequência autoriza combiná-las na tripla original sobre `C1; C2` juntos. Toda a arte de aplicar bem essa regra está em escolher `Q`: fraco demais, e ele não leva adiante informação suficiente para a prova de `C2` chegar a `R`; forte demais, e a prova de `C1` pode nem conseguir estabelecê-lo. Uma heurística útil, desenvolvida nos exemplos abaixo, é calcular para frente a partir de `P` por meio de `C1` (o que `C1` garante, dado `P`) e checar se isso corresponde ao que `C2` precisa como precondição para chegar a `R`.

### Regra do condicional

Um comando condicional executa exatamente um de dois ramos, escolhido por uma guarda em tempo de execução, e a regra do condicional espelha essa estrutura diretamente na prova. O ramo `then` é provado sob a precondição `P ∧ guard` (a precondição original fortalecida com o fato extra de que a guarda era verdadeira, já que é exatamente nessa situação que o ramo roda). O ramo `else`, simetricamente, é provado sob `P ∧ ¬guard`. As duas provas de ramo precisam chegar à *mesma* pós-condição `Q`, e, uma vez provadas as duas, a regra do condicional autoriza concluir `{P} if guard then C1 else C2 {Q}` para o comando inteiro. Isso funciona porque a guarda e sua negação são exaustivas e mutuamente exclusivas: todo estado que satisfaz `P` satisfaz `guard` ou `¬guard` e nunca os dois; então, entre as duas provas de ramo, todo estado inicial possível que satisfaz `P` foi de fato levado em conta exatamente uma vez, sem nenhum caso deixado de lado e nenhum caso contado duas vezes.

### Regra de consequência

As três primeiras regras são dirigidas pela sintaxe: cada uma se aplica a uma forma específica de comando e produz ou consome asserções de um formato específico ditado por esse comando. A regra de consequência é de outra natureza: ela não corresponde a nenhum comando, e é o único lugar em que a consequência lógica comum, em vez da estrutura do programa, faz o trabalho. Ela diz que, se uma precondição mais forte `P` implica alguma precondição já provada `P1` (ou seja, `P ⊨ P1`), e uma pós-condição mais fraca `Q1` (já provada) implica a pós-condição desejada `Q` (ou seja, `Q1 ⊨ Q`), então uma prova de `{P1} C {Q1}` pode ser adaptada em uma prova de `{P} C {Q}` sem tocar em `C` nem reexaminar sua execução; a adaptação é puramente uma questão de consequência lógica dos dois lados de uma tripla já estabelecida. Na prática, essa regra não é um caso especial raro reservado para condições de borda; é, em volume, onde mora a maior parte do trabalho lógico real de uma prova realista em lógica de Hoare, porque asserções calculadas mecanicamente pelas outras três regras muitas vezes precisam ser ajustadas (fortalecidas, enfraquecidas ou simplificadas algebricamente) até o formato exato que um passo seguinte ou o objetivo final exige, e a regra de consequência é o que autoriza fazer esse ajuste.

## Exemplos Resolvidos

### Regra de inferência da atribuição

Escrita como regra de inferência, a regra de atribuição tem o formato:

```text
Q[E/x]
----------------
{Q[E/x]} x := E {Q}
```

o que significa: se a precondição for exatamente `Q` com `E` substituído por `x`, a tripla `{Q[E/x]} x := E {Q}` está provada automaticamente, sem mais nenhum argumento. Como instância concreta, tome a pós-condição desejada `Q: x > 5` e o comando `x := y + 1`. Aplicar a substituição mecanicamente (trocar cada ocorrência de `x` em `Q` pela expressão `y + 1`) produz a precondição exigida `y + 1 > 5`. Isso diz exatamente o que a intuição pede: para a pós-condição `x > 5` valer quando `x` recebe `y + 1`, precisava ser verdade antes que o próprio `y + 1` passasse de 5, o que se simplifica (pela regra de consequência, invocando aritmética comum) em `y > 4`.

### Esboço de prova de sequência

Considere o programa de dois comandos `x := x + 1; y := x`, com o objetivo de provar `{x = 0} program {y = 1}`. Aplicar a regra de sequência exige escolher uma asserção intermediária que sirva ao mesmo tempo como pós-condição do primeiro comando e precondição do segundo. Trabalhando para frente a partir da precondição pelo primeiro comando: partindo de `x = 0`, depois que `x := x + 1` roda, `x` vale `0 + 1 = 1`; então a asserção intermediária natural é `x = 1`. Essa escolha é então checada nos dois lados de forma independente. Primeira tripla: `{x = 0} x := x + 1 {x = 1}`; isso decorre diretamente da regra de atribuição, já que substituir `x + 1` por `x` na pós-condição `x = 1` dá a precondição `x + 1 = 1`, que a regra de consequência simplifica em `x = 0`, coincidindo exatamente. Segunda tripla: `{x = 1} y := x {y = 1}`; de novo pela regra de atribuição, substituir `x` por `y` na pós-condição `y = 1` dá a precondição `x = 1`, coincidindo exatamente com a asserção intermediária escolhida. As duas metades conferem de forma independente, então a regra de sequência autoriza combiná-las na tripla completa `{x = 0} program {y = 1}`; e repare que em nenhum momento foi preciso rastrear o comportamento real do programa em tempo de execução; a prova inteira foi montada a partir de duas aplicações da regra de atribuição mais a contabilidade da regra de sequência.

### Esboço de prova de condicional

Volte ao comando condicional `if x ≥ 0 then y := x else y := -x`, com a pós-condição-alvo `y ≥ 0`, agora organizado explicitamente como uma aplicação da regra do condicional, e não como uma análise informal por casos. O ramo `then` é provado sob `true ∧ x ≥ 0` (simplificando para `x ≥ 0`): a atribuição `y := x` sob essa premissa precisa da precondição `x ≥ 0` para a pós-condição `y ≥ 0` pela regra de atribuição, o que coincide exatamente com a premissa do ramo. O ramo `else` é provado sob `true ∧ ¬(x ≥ 0)` (simplificando, por consequência, para `x < 0`): a atribuição `y := -x` precisa da precondição `-x ≥ 0` para a pós-condição `y ≥ 0` pela regra de atribuição, e a regra de consequência cobre a diferença observando que `x < 0 ⊨ -x ≥ 0` (negar um número negativo produz um não negativo). Os dois ramos, provados de forma independente sob suas premissas mutuamente exclusivas, estabelecem a mesma pós-condição `y ≥ 0`, então a regra do condicional conclui a tripla completa para o comando `if` inteiro; uma repetição direta, regra por regra, do raciocínio feito informalmente, por casos, em `the-hoare-triple`.

## Equívocos Comuns e Armadilhas

- **Usar a regra de atribuição para frente em vez de para trás.** Um erro inicial comum é substituir na direção "calcule o novo valor de x e coloque-o na precondição", em vez da direção real da regra, que substitui a expressão atribuída na *pós-condição* para derivar a precondição. Fazer a substituição no sentido errado produz uma asserção que, sem querer, se refere ao novo valor de `x` em um contexto em que na verdade era necessário o valor antigo, invalidando a prova silenciosamente.
- **Escolher uma asserção intermediária para a sequência fraca demais para o segundo comando.** Se a asserção intermediária `Q` escolhida para a regra de sequência não levar adiante informação suficiente (por exemplo, deixando de fora um limite ou uma relação que `C1` de fato estabeleceu), então `{Q} C2 {R}` pode se revelar indemonstrável, embora um `Q` mais forte, escolhido corretamente, teria tornado as duas metades demonstráveis. Escolher bem o `Q` é um passo de projeto genuíno, e não uma formalidade.
- **Checar só o ramo que parece mais provável de executar.** A regra do condicional exige que *os dois* ramos sejam provados, de forma independente, qualquer que seja o que uma execução específica de fato tome; pular o ramo "improvável" deixa a prova incompleta exatamente para as execuções que o tomam, e derrota o objetivo inteiro de provar uma afirmação universal sobre toda execução possível.
- **Esquecer a regra de consequência e tentar forçar toda asserção a coincidir sintaticamente.** Asserções produzidas mecanicamente pelas regras de atribuição, sequência e condicional raramente chegam exatamente no formato sintático necessário para o passo seguinte ou para o objetivo final; a regra de consequência é o que autoriza a simplificação lógica comum (identidades aritméticas, enfraquecimento, fortalecimento) que cobre essa diferença, e recusar usá-la em favor de forçar correspondências sintáticas em todo lugar torna provas diretas desnecessariamente desajeitadas, ou até impossíveis de completar.

## Resumo

As quatro regras de Hoare (atribuição, sequência, condicional e consequência) tornam a verificação de programas composicional: cada construção sintática da linguagem contribui com sua própria obrigação de prova local, calculada mecanicamente a partir do formato da construção, e a consequência lógica comum (pela regra de consequência) é o que conecta essas obrigações locais em uma única prova do programa inteiro. Essa estrutura dirigida pela sintaxe é exatamente o que permite a uma prova de tripla de Hoare evitar totalmente rastrear a execução real de um programa, seguindo em vez disso a estrutura estática do programa; e é a base que `loop-invariants-and-the-while-rule` estende em seguida, acrescentando a única construção (o laço) que as quatro regras vistas aqui ainda não tratam.

## Documentation Links

- [Hoare: An Axiomatic Basis for Computer Programming (1969)](https://www.cs.cmu.edu/~crary/819-f09/Hoare69.pdf): o artigo original de programação axiomática por trás das triplas de Hoare e das regras de inferência.
- [Pierce et al.: Software Foundations](https://softwarefoundations.cis.upenn.edu/): desenvolvimento verificado por máquina de lógica, lógica de Hoare e estilo de assistentes de prova.
