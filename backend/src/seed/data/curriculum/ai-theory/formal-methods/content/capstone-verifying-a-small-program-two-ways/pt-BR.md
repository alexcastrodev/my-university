---
version: 1.0
updatedAt: 2026-09-07
title: "Capstone: Verificando um Programa Pequeno de Duas Formas"
summary: O capstone verifica um mesmo programa pequeno de forma dedutiva e por exploração de estados finitos. Ver o mesmo requisito como uma prova de Hoare e como uma propriedade de model checking torna concreto o trade-off entre raciocínio simbólico e busca exaustiva.
---
## Objetivos de Aprendizagem

- Verificar um programa pequeno de forma dedutiva, usando lógica de Hoare e um invariante de laço, para toda entrada matematicamente válida de uma vez.
- Verificar o requisito do mesmo programa por exploração de estados finitos, formulando-o como um sistema de transição e uma propriedade de lógica temporal.
- Explicar com precisão o que cada método de fato estabelece e de qual premissa limitadora de escopo cada um depende que o outro não depende.
- Identificar, a partir do limite do Problema da Parada e do Teorema de Rice desta disciplina, por que nenhum dos métodos é um substituto gratuito do outro.
- Escolher, para um novo problema de verificação, qual dos dois estilos se encaixa melhor no formato dele, e justificar a escolha explicitamente.

## Contexto e Motivação

Cada conceito desta disciplina construiu em direção a uma de duas famílias de técnicas: o estilo simbólico e composicional da lógica de Hoare (triplas, regras de inferência, invariantes de laço, precondições mais fracas, correção total) e o estilo exaustivo de estados finitos do model checking (sistemas de transição, estruturas de Kripke, LTL e CTL, exploração explícita e simbólica). Este capstone coloca as duas famílias para trabalhar exatamente no mesmo programa pequeno e exatamente no mesmo requisito, para que a diferença entre elas deixe de ser um ponto metodológico abstrato e vire algo concreto: duas provas diferentes do mesmo fato, construídas por meios genuinamente diferentes, cada uma com seu escopo e seu preço.

O objetivo de fazer isso não é, de jeito nenhum, coroar um método como vencedor. É tornar o trade-off entre eles totalmente visível, mantendo fixos o programa e o requisito enquanto o *método* varia: uma prova em lógica de Hoare compra uma garantia que vale para literalmente toda entrada matematicamente válida, ao custo de exigir que um humano encontre o invariante certo; uma prova por model checking compra automação total depois que o modelo e a propriedade estão montados, ao custo de cobrir só a faixa específica e finita de entradas que o modelo foi construído para representar. Cada hábito de escrita de especificações de `specifications-preconditions-postconditions-invariants` e `logic-for-specification-propositional-and-first-order`, e cada disciplina honesta de declaração de escopo de `the-limits-of-verification`, é o que torna possível dizer, com precisão, qual dessas duas garantias foi de fato conquistada por qual prova; e essa precisão é o objetivo inteiro deste capstone.

## Teoria Central

### O programa e o requisito

O programa sob verificação calcula a soma dos inteiros de `0` até `n - 1`; o mesmo laço pequeno já apresentado em `loop-invariants-and-the-while-rule`, reaproveitado aqui de propósito para que sua prova em lógica de Hoare possa ser usada em vez de derivada do zero:

```text
i := 0;
s := 0;
while i < n do
    s := s + i;
    i := i + 1
```

A precondição é `n ≥ 0`; o requisito sendo verificado, nos dois métodos abaixo, é a identidade em forma fechada `2*s = n*(n - 1)` quando o laço termina. No método da lógica de Hoare, `n` é tratado como um inteiro matemático arbitrário que satisfaz só a precondição; a prova, depois de completa, cobre todo `n` assim ao mesmo tempo, sem nenhum limite superior. No método do model checking, `n` é deliberadamente limitado a uma pequena faixa finita, já que uma exploração de estados finitos só consegue explorar um espaço de estados finito; esse limite não é uma simplificação escolhida por conveniência só neste capstone; é exatamente o mesmo movimento limitador de escopo que `state-space-explosion-and-symbolic-model-checking` e `the-limits-of-verification` já apontaram como um custo inevitável e honesto da busca exaustiva em estados finitos.

### Plano da prova dedutiva

O plano da prova em lógica de Hoare segue exatamente a estrutura estabelecida em `loop-invariants-and-the-while-rule`: inicializar o contador e o acumulador com zero, adotar o invariante `0 ≤ i ≤ n ∧ 2*s = i*(i - 1)` e cumprir as três obrigações da regra do while (inicialização, preservação, saída) para estabelecer a correção parcial. Como o capstone pretende fechar por completo o bloco de lógica de Hoare, em vez de parar na correção parcial, esta prova acrescenta também a metade de terminação de `total-correctness-and-termination`: uma variante `n - i`, não negativa e estritamente decrescente a cada iteração, que eleva o resultado de "se o laço terminar, a pós-condição vale" para o incondicional "o laço termina, e a pós-condição vale"; correção total, para todo `n ≥ 0` matematicamente válido de uma vez.

### Plano da prova por model checking

O plano do model checking segue o caminho oposto: em vez de raciocinar simbolicamente sobre um domínio ilimitado, ele fixa um pequeno limite concreto (`0 ≤ n ≤ 3`) e constrói um sistema de transição explícito cujos estados registram os valores atuais de `n`, `i`, `s` e uma posição de contador de programa que marca qual linha do laço está para executar, seguindo exatamente o estilo de representação de estados que `transition-systems-and-kripke-structures` introduziu para modelar trechos de programas. O requisito é então reformulado como uma propriedade de lógica temporal sobre esse sistema de transição: não apenas "o estado terminal satisfaz a pós-condição", mas uma afirmação genuína em CTL usando os operadores de `ctl-and-branching-time-logic`: `AG (at_exit → 2*s = n*(n-1))`, lida como "em todo caminho, sempre que o contador de programa chega ao ponto de saída do laço, a identidade em forma fechada vale". Como este programa é inteiramente sequencial, sem nenhum não determinismo genuíno, cada estado tem na verdade exatamente um sucessor, então o quantificador "em todo caminho" aqui percorre um único caminho determinístico por valor de `n`; mas enunciar a propriedade com todo o mecanismo de CTL, em vez de como um informal "cheque o estado final", é proposital: é exatamente a mesma disciplina de escrita de propriedades que `logic-for-specification-propositional-and-first-order` e `ctl-and-branching-time-logic` estabeleceram, e ela se generaliza imediatamente, sem mudar de formato, para uma versão deste mesmo programa com escalonamento não determinístico genuíno.

### Comparação

As duas provas conquistam coisas genuinamente diferentes, e enunciar a diferença com precisão é o ganho inteiro de fazer as duas. A prova de Hoare cobre todo `n ≥ 0` (um domínio infinito) em um único argumento finito, mas exigiu que um humano encontrasse o invariante certo, exatamente o passo criativo que `loop-invariants-and-the-while-rule` identificou como a verdadeira dificuldade das provas de laços, e sua correção depende de confiar nas manipulações aritméticas simbólicas como derivações corretas. A prova por model checking é, depois que o modelo e a propriedade CTL estão montados, totalmente automática (nenhum invariante a descobrir, nenhuma aritmética a simplificar à mão), mas cobre só o limite finito `0 ≤ n ≤ 3` escolhido de antemão, e estender sua garantia para todo `n` exigiria um argumento indutivo explícito ligando o limite ao caso geral, ou aceitar o resultado limitado como evidência limitada em vez de uma prova ilimitada, exatamente a distinção em que a discussão sobre verificadores limitados de `the-limits-of-verification` insistiu. As duas provas, apesar desses custos muito diferentes, dependem exatamente da mesma especificação subjacente (a mesma precondição e a mesma pós-condição), e é isso que as torna comparáveis, em vez de dois exercícios sem relação que por acaso compartilham um programa.

## Exemplos Resolvidos

### O programa, reapresentado

```text
i := 0;
s := 0;
while i < n do
    s := s + i;
    i := i + 1
```

Relação final desejada, nos dois métodos: `2*s = n*(n - 1)`.

### Método um: a prova completa em lógica de Hoare

O invariante é `I: 0 ≤ i ≤ n ∧ 2*s = i*(i - 1)`, exatamente como `loop-invariants-and-the-while-rule` estabeleceu. **Inicialização**: depois que `i := 0; s := 0` executa, `0 ≤ 0 ≤ n` vale porque a precondição garante `n ≥ 0`, e `2*0 = 0*(0-1)` se simplifica em `0 = 0`, que vale incondicionalmente; o invariante vale antes de o corpo do laço rodar uma única vez. **Preservação**: suponha que `I` e a guarda `i < n` valham; o corpo define `i' = i + 1` e `s' = s + i`. O limite sobrevive porque `i < n` junto com `i ≤ n` dá `i' = i + 1 ≤ n`. A parte aritmética sobrevive por cálculo direto: `2*s' = 2*(s+i) = 2*s + 2*i = i*(i-1) + 2*i` (usando o invariante suposto) `= i² + i = i*(i+1) = i'*(i'-1)`, exatamente o que a preservação exige. **Saída**: quando a guarda falha, `i ≥ n`, e combinado com `i ≤ n` de `I`, isso força `i = n` exatamente; substituindo na parte aritmética, obtém-se `2*s = n*(n-1)`, precisamente a pós-condição desejada. **Terminação**: tome a variante `n - i`. Ela é não negativa o tempo todo, já que `I` mantém `i ≤ n`, e diminui estritamente em exatamente um a cada iteração, já que o corpo incrementa `i` em um enquanto `n` nunca muda; um inteiro não negativo, estritamente decrescente a cada passo, não pode diminuir para sempre, então o laço termina depois de exatamente `n` iterações. Combinar a correção parcial (do invariante) com a terminação (da variante) dá a correção total: para todo `n ≥ 0`, o laço termina e `2*s = n*(n-1)` vale; uma prova finita, cobrindo infinitos valores de `n` de uma vez, sem nenhum limite superior em parte alguma do argumento.

### Método dois: a visão do model checking

Restrinja a atenção a `0 ≤ n ≤ 3` e construa o sistema de transição cujos estados são tuplas `(pc, n, i, s)`, em que `pc` marca a posição do contador de programa (`loop-head`, `body` ou `exit`). Para um `n = 3` fixo, a sequência alcançável de pares `(i, s)` na cabeça do laço, acompanhada passo a passo, é: `(i=0, s=0)`, depois `(i=1, s=0)` (após a primeira execução do corpo: `s := s+0=0`, `i := 0+1=1`), depois `(i=2, s=1)` (após a segunda: `s := 0+1=1`, `i := 1+1=2`), depois `(i=3, s=3)` (após a terceira: `s := 1+2=3`, `i := 2+1=3`); nesse ponto a guarda `i < n` falha (`3 < 3` é falso) e o programa chega a `pc = exit`. Checando a propriedade CTL `AG (at_exit → 2*s = n*(n-1))` nesse caminho: o único estado em que `at_exit` vale é `(i=3, s=3)`, e ali `2*s = 6` e `n*(n-1) = 3*2 = 6`; a propriedade vale no único estado em que seu antecedente é satisfeito, e como o caminho é determinístico e finito, checar esse único estado basta para confirmar que `AG` vale ao longo de todo o caminho para `n = 3`. O model checker repete essa mesma checagem exaustiva (construir a sequência de estados alcançáveis, verificar a propriedade em cada estado em que o antecedente se aplica) de forma independente para `n = 0`, `n = 1` e `n = 2`, e confirma que a propriedade vale para cada um dos quatro valores dentro do limite escolhido, sem nunca invocar um invariante ou um argumento aritmético simbólico; cada uma das quatro checagens é uma computação concreta e finita sobre números concretos.

### Comparando o que de fato foi provado

Colocar os dois resultados lado a lado torna o trade-off exato, em vez de aproximado. A prova de Hoare estabelece `2*s = n*(n-1)` para todo inteiro `n ≥ 0` (infinitos valores, incluindo `n = 1000000`, que nenhuma execução de model checking deste capstone jamais tocou diretamente) usando um único argumento simbólico finito que exigiu descobrir à mão o invariante `0 ≤ i ≤ n ∧ 2*s = i*(i-1)` e a variante `n - i`. A prova por model checking estabelece exatamente a mesma relação para exatamente os quatro valores `n ∈ {0, 1, 2, 3}`, de forma totalmente automática depois que o modelo e a propriedade CTL foram montados, sem nenhuma percepção criativa necessária na hora da checagem; mas, sozinha, ela não diz absolutamente nada sobre `n = 4`, quanto mais sobre `n = 1000000`, e estender seu resultado de quatro valores ao caso geral exigiria exatamente o tipo de argumento indutivo separado que a discussão sobre verificadores limitados de `the-limits-of-verification` alertou que não é fornecido automaticamente só porque uma busca limitada voltou limpa. Nenhum resultado engloba o outro: a força da prova de Hoare é seu alcance ilimitado, comprado com esforço humano; a força da prova por model checking é sua automação sem esforço, comprada com um limite rígido de escopo.

## Equívocos Comuns e Armadilhas

- **Afirmar que o resultado limitado do model checking prova a propriedade para todo n sem um argumento indutivo separado.** Como a comparação lado a lado deixa explícito, checar `n ∈ {0,1,2,3}` não estabelece nada, por si só, sobre `n = 4` ou qualquer valor maior; ligar um resultado limitado ao caso geral exige um argumento próprio, exatamente a lacuna que `the-limits-of-verification` e `state-space-explosion-and-symbolic-model-checking` já alertaram para não confundir.
- **Esquecer a terminação na prova de Hoare e parar na correção parcial.** Como `total-correctness-and-termination` enfatizou, uma prova de correção parcial sozinha deixaria aberta a possibilidade de o laço simplesmente nunca terminar para algum `n`; o argumento da variante no Método um não é um enfeite opcional; é o que eleva o resultado à garantia incondicional que o capstone de fato afirma.
- **Usar especificações diferentes e inconsistentes nos dois métodos.** As duas provas deste capstone dependem exatamente da mesma precondição `n ≥ 0` e da mesma pós-condição `2*s = n*(n-1)`; se os dois métodos checassem requisitos sutilmente diferentes, comparar seus resultados (como faz a comparação lado a lado) não teria sentido, já que deixariam de ser duas provas do mesmo fato.
- **Tratar o invariante como óbvio demais para precisar de uma prova real de preservação.** O invariante `0 ≤ i ≤ n ∧ 2*s = i*(i-1)` pode parecer evidentemente verdadeiro depois de escrito, mas, como o exemplo do limite faltante em `loop-invariants-and-the-while-rule` já demonstrou para um invariante muito parecido, uma afirmação não checada que apenas parece plausível não é o mesmo que uma afirmação provada, e pular o cálculo explícito de preservação é exatamente como um invariante sutilmente errado passa sem ser detectado.

## Resumo

Este capstone verificou um mesmo programa pequeno de somatório por dois métodos genuinamente diferentes e complementares: uma prova em lógica de Hoare, usando o invariante `0 ≤ i ≤ n ∧ 2*s = i*(i-1)` e a variante `n - i`, que estabelece correção total para todo `n ≥ 0` matematicamente válido de uma vez, por um único argumento simbólico finito que exige percepção descoberta por um humano; e uma prova por model checking, usando um sistema de transição explícito e a propriedade CTL `AG (at_exit → 2*s = n*(n-1))`, que estabelece exatamente a mesma relação de forma totalmente automática, mas só para o limite finito `0 ≤ n ≤ 3` escolhido de antemão. Nenhum método é estritamente superior ao outro: cada um compra um tipo diferente de garantia a um tipo diferente de custo, exatamente o trade-off que `testing-shows-presence-proof-shows-absence` antecipou logo no início desta disciplina entre diferentes famílias de evidência, agora totalmente concreto ao aplicar as duas famílias a um programa e uma especificação compartilhados. Escolher entre elas para um novo problema de verificação (domínio infinito que exige percepção, ou domínio finito que admite automação) é o julgamento prático em direção ao qual esta disciplina inteira, do lema de abertura a este capstone de encerramento, vinha construindo.

## Documentation Links

- [Hoare: An Axiomatic Basis for Computer Programming (1969)](https://www.cs.cmu.edu/~crary/819-f09/Hoare69.pdf): o artigo original de programação axiomática por trás das triplas de Hoare e das regras de inferência.
- [Pierce et al.: Software Foundations](https://softwarefoundations.cis.upenn.edu/): desenvolvimento verificado por máquina de lógica, lógica de Hoare e estilo de assistentes de prova.
- [SPIN: On-the-Fly LTL Model Checking](https://spinroot.com/spin/whatispin.html): visão geral do SPIN e do model checking LTL on-the-fly na prática.
