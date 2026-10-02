---
version: 1.0
updatedAt: 2026-09-07
title: A Tripla de Hoare
summary: A tripla de Hoare `{P} C {Q}` é o julgamento central da verificação axiomática de programas. Se o comando C começa em um estado que satisfaz P e termina, ele termina em um estado que satisfaz Q. Ela separa a especificação da implementação sem perder o vínculo com a semântica operacional.
---
## Objetivos de Aprendizagem

- Ler `{P} C {Q}` como uma afirmação de correção parcial sobre toda execução do comando `C` que termina, e não como um caso de teste ou uma anotação de tipo.
- Separar a asserção do estado inicial `P` da asserção do estado final `Q` e explicar com precisão que ponto da execução cada uma descreve.
- Explicar por que um comando que não termina pode tornar uma tripla de correção parcial trivialmente verdadeira, e por que isso é uma característica da definição, e não uma brecha.
- Ligar as triplas de Hoare à semântica operacional sem precisar enumerar à mão cada passo individual de execução.
- Refutar uma tripla inválida com um único estado inicial concreto e o estado final resultante, em vez de um argumento geral.

## Contexto e Motivação

`logic-for-specification-propositional-and-first-order` forneceu a linguagem (conectivos, predicados, quantificadores) em que asserções como `P` e `Q` são escritas. A semântica operacional, de Linguagens de Programação, explica separadamente *como* um comando avança de um estado para o seguinte, um pequeno passo de cada vez. A tripla de Hoare é o conceito que liga as duas coisas: ela abstrai os passos individuais da semântica operacional e faz uma única pergunta, de nível mais alto: dado tudo o que pode acontecer enquanto `C` roda, que relação é garantida entre o estado em que ele começou e o estado em que ele termina?

Vale ser explícito sobre o que a tripla *não* é, porque a tentação de lê-la errado aparece em várias direções ao mesmo tempo. Ela não é um caso de teste, porque faz uma afirmação sobre todo estado que satisfaz `P`, e não sobre um estado específico. Não é uma anotação de tipo, porque não diz nada sobre o formato ou o tipo dos valores, só sobre propriedades lógicas que eles satisfazem. E não é uma descrição operacional de como `C` executa, porque deliberadamente não diz nada sobre os estados intermediários por que `C` passa; só sobre a relação entre o primeiríssimo estado e o último, para as execuções que de fato chegam a um último estado.

É exatamente aqui que Matemática Discreta e Lógica vira raciocínio sobre software de forma totalmente concreta: uma tripla de Hoare é provada por argumento lógico, o mesmo estilo de argumento com conectivos e quantificadores já desenvolvido lá, só que agora apontado para estados de programa em vez de proposições abstratas. E o alerta de Computabilidade e Complexidade de antes nesta disciplina não é uma digressão histórica aqui; é uma restrição viva: como não pode existir um provador automático completo para todo comando possível e toda asserção possível, as regras de prova apresentadas no próximo conceito, `hoare-logic-rules-of-inference`, são deliberadamente dirigidas pela sintaxe, em vez de uma busca sobre todas as provas possíveis, trocando a completude no caso mais geral por uma estratégia de prova que de fato funciona na prática nos programas que as pessoas escrevem.

## Teoria Central

### A sintaxe da tripla

A tripla tem o formato fixo `{P} C {Q}`, e cada um dos seus três componentes cumpre um papel distinto e não intercambiável. `P` é a precondição, uma asserção sobre o estado em que a execução de `C` está para começar. `C` é o comando cujo comportamento está sendo caracterizado; pode ser tão pequeno quanto uma única atribuição ou tão grande quanto um programa inteiro. `Q` é a pós-condição, uma asserção sobre o estado que resulta se e quando `C` terminar de rodar. As chaves em volta de `P` e `Q` são pura notação emprestada para esse fim (marcam "isto é uma asserção, não código executável") e não têm nenhum significado em tempo de execução; uma tripla nunca é executada, só provada ou refutada como uma afirmação matemática sobre o comportamento de `C`. É um hábito mental importante a estabelecer cedo: ver `{P} C {Q}` deveria disparar de imediato a pergunta "esta afirmação é verdadeira para todo estado que satisfaz P?", e não "o que acontece se eu rodar isto?".

### O significado de correção parcial

A tripla `{P} C {Q}` é definida para significar exatamente isto: se `C` começa a executar em um estado que satisfaz `P`, *e* `C` termina, então o estado em que ele termina satisfaz `Q`. A cláusula "e C termina" não é uma nota de rodapé nem um aparte; ela carrega peso, faz parte da própria definição do que a tripla afirma, e tirá-la muda silenciosamente a afirmação para algo mais forte e diferente (a correção total, que `total-correctness-and-termination` trata como conceito próprio, exigindo uma prova própria). Uma consequência direta e um tanto contraintuitiva de embutir a terminação na definição dessa forma: uma tripla pode ser verdadeira, e até fácil de provar verdadeira, só porque `C` nunca termina a partir de estados que satisfazem `P`; não havendo execução que termina para checar contra `Q`, a afirmação universalmente quantificada "toda execução que termina satisfaz Q" vale trivialmente, do mesmo jeito que "todo unicórnio nesta sala é roxo" é verdade justamente porque não há unicórnios na sala para serem de outra cor. Isso também significa que uma precondição que por acaso é insatisfatível, ou que descreve uma situação falsa ou impossível, pode tornar uma tripla tecnicamente verdadeira e ao mesmo tempo praticamente inútil; uma prova de `{false} C {qualquer coisa}` é válida, mas não diz nada interessante sobre nenhuma execução real, porque nenhum estado satisfaz `false`, para começo de conversa.

### Conexão com a semântica operacional

A semântica operacional de passos pequenos, de Linguagens de Programação, dá uma regra precisa para cada transição individual que um comando pode fazer: um estado avançando para o seguinte, uma construção sintática de cada vez. A lógica de Hoare fica um nível de abstração acima disso: em vez de raciocinar sobre passos individuais, ela fornece regras de prova composicionais para comandos inteiros, construídas diretamente a partir da estrutura sintática deles (uma atribuição recebe uma regra, uma sequência de dois comandos recebe outra, e assim por diante, como `hoare-logic-rules-of-inference` desenvolve por completo). A ponte entre esses dois níveis é um teorema de correção (soundness): toda tripla que pode ser derivada usando as regras de prova de Hoare tem garantia de ser verdadeira segundo a semântica operacional de passos pequenos subjacente. Essa garantia de correção é o que autoriza trabalhar inteiramente no nível das triplas e das regras de prova, seguindo a sintaxe do programa, em vez de precisar desdobrar e checar à mão cada sequência possível de passos individuais de execução; uma necessidade prática real, já que até um laço curto pode ter um rastro de execução de comprimento ilimitado se puder rodar por iterações suficientes.

### Contraexemplos

Uma tripla `{P} C {Q}` é falsa exatamente quando existe pelo menos uma execução de `C` que termina, que começa em um estado que satisfaz `P` e termina em um estado que não satisfaz `Q`. A palavra-chave é "uma": refutar uma afirmação universalmente quantificada nunca exige examinar todo estado inicial possível, porque um único contraexemplo basta logicamente para falsear uma afirmação da forma "para todo estado que satisfaz P, ...". Isso espelha exatamente a assimetria entre testes e prova de `testing-shows-presence-proof-shows-absence`: um teste que falha refuta uma afirmação universal de correção, e um estado de contraexemplo refuta uma tripla inválida, pelo mesmo motivo lógico. Na prática, um contraexemplo concreto (um estado inicial específico e o estado final específico a que ele leva) muitas vezes é mais fácil para um humano entender e usar do que o registro de uma tentativa fracassada de prova simbólica, porque um contraexemplo é algo que se pode aplicar e ver falhar, em vez de uma lacuna abstrata em um argumento. É precisamente por isso que ferramentas de verificação bem projetadas fazem questão de relatar contraexemplos concretos sempre que uma tentativa de prova falha, em vez de só relatar "indemonstrável" e deixar o usuário adivinhar o porquê.

## Exemplos Resolvidos

### Tripla de atribuição

Considere a tripla:

```text
{x ≥ 0} y := x + 1 {y > 0}
```

Para verificá-la, rastreie o que a atribuição faz com o estado e depois cheque a pós-condição contra o estado resultante. Depois que `y := x + 1` executa, a variável `y` guarda exatamente o valor que `x` tinha logo antes da atribuição, mais um; chame esse valor antigo de `x₀`, de modo que o estado logo depois da atribuição tem `y = x₀ + 1`. A precondição garante `x₀ ≥ 0`. A partir daí, o argumento é pura aritmética: somar um a qualquer inteiro não negativo produz um inteiro estritamente positivo, então `x₀ + 1 > 0`, que é exatamente `y > 0`. Como uma atribuição sempre termina de imediato (não há como uma única instrução de atribuição rodar para sempre), esta tripla é na verdade total, e não só parcial, para este único comando; a distinção entre correção parcial e total só se torna substantiva quando laços ou recursão entram em cena, como `total-correctness-and-termination` vai desenvolver.

### Tripla inválida

Agora considere a tripla afirmada:

```text
{x ≥ 0} y := x - 1 {y ≥ 0}
```

Ela parece superficialmente plausível (subtrair um de um número não negativo "deveria" muitas vezes continuar não negativo), e é exatamente por isso que vale percorrê-la com cuidado em vez de aceitar a semelhança de padrão. Para refutá-la, a estratégia da seção de Teoria Central se aplica diretamente: encontrar um estado concreto que satisfaz a precondição e para o qual a pós-condição falha depois da execução. Escolha o estado inicial `x = 0`. Esse estado satisfaz a precondição `x ≥ 0` (zero é não negativo). Executar `y := x - 1` a partir desse estado define `y = 0 - 1 = -1`. Agora cheque a pós-condição contra o estado resultante: `-1 ≥ 0`? Não. A pós-condição falha, então esta única execução (começando em um estado que satisfaz `P`, terminando, já que atribuições sempre terminam, e acabando em um estado que viola `Q`) é exatamente o tipo de contraexemplo que a seção de Teoria Central descreveu como logicamente suficiente. Nenhum outro caso precisa ser checado, e nenhum argumento sobre "a maioria" dos valores de `x` é relevante aqui: esta única testemunha em `x = 0` basta para tornar falsa a tripla universalmente quantificada, exatamente do mesmo jeito que um teste que falha refuta uma afirmação universal de correção. O que isso revela sobre a falha da afirmação original: a pós-condição `y ≥ 0` precisava implicitamente de `x ≥ 1`, e não só de `x ≥ 0`, para sobreviver à subtração; a precondição, como enunciada, era uma unidade fraca demais para a pós-condição com que foi combinada, e o caso de borda `x = 0` é exatamente onde essa lacuna fica visível.

### Valor absoluto com condicional

Considere o comando:

```text
if x ≥ 0 then y := x else y := -x
```

com o objetivo de provar `{true} comando {y ≥ 0}`, uma tripla com a precondição trivial `true`, o que significa que a afirmação deve valer a partir de *todo* estado inicial possível, sem nenhuma restrição. Como o comando se ramifica, a prova naturalmente se divide em dois casos, um para cada ramo, e os dois precisam estabelecer de forma independente a mesma pós-condição. No ramo `then`, sabe-se que a guarda `x ≥ 0` vale (é por isso que esse ramo foi tomado), e a atribuição `y := x` define `y` igual a `x`; como `x ≥ 0` neste ramo, o `y ≥ 0` resultante decorre de imediato. No ramo `else`, a guarda é falsa, então sabe-se que vale `x < 0`, e a atribuição `y := -x` define `y` igual à negação de `x`; negar um número estritamente negativo produz um estritamente positivo, então `y > 0`, o que certamente também satisfaz `y ≥ 0`. Os dois ramos, sob suas próprias premissas sobre `x` (e mutuamente exclusivas), chegam de forma independente à mesma pós-condição; e como as guardas dos dois ramos são exaustivas e mutuamente exclusivas, todo estado inicial possível cai em exatamente um dos dois casos recém-checados, e é precisamente por isso que provar os dois ramos separadamente basta para provar a tripla para todo estado inicial, sem lacuna entre eles. Essa estrutura de divisão em casos (dividir pela guarda, provar cada ramo sob sua própria premissa, confirmar que a divisão foi exaustiva) é exatamente o formato que a regra do condicional em `hoare-logic-rules-of-inference` vai formalizar como uma regra de prova reutilizável e dirigida pela sintaxe.

## Equívocos Comuns e Armadilhas

- **Ler uma tripla de Hoare como uma garantia de terminação.** `{P} C {Q}` não diz absolutamente nada sobre se `C` termina; diz só que, *se* `C` terminar a partir de um estado que satisfaz `P`, o resultado satisfaz `Q`. Um comando que nunca termina a partir de nenhum estado que satisfaz `P` torna a tripla trivialmente verdadeira, um fato legítimo e às vezes útil sobre a definição, e não um bug nela; a correção total é uma afirmação estritamente mais forte, provada separadamente.
- **Esquecer que `P` e `Q` se referem a estados diferentes.** `P` descreve o estado imediatamente antes de `C` rodar; `Q` descreve o estado imediatamente depois de `C` terminar. O valor de uma variável em `P` e o valor da *mesma* variável em `Q` podem ser completamente diferentes; como mostra o exemplo da atribuição, `x` na precondição e `y` na pós-condição se relacionam pelo valor antigo de `x`, e não por algum valor compartilhado e imutável ao longo de toda a tripla.
- **Tratar uma tripla verdadeira como prova de um requisito não enunciado.** Uma tripla só prova exatamente o que sua pós-condição diz; provar `{x ≥ 0} y := x + 1 {y > 0}` não diz nada sobre se o novo valor de `y` é útil, esperado por alguma outra parte do programa ou consistente com algum requisito que nunca foi escrito em `Q`.
- **Usar um estado de exemplo como se ele estabelecesse uma afirmação universal.** É a imagem espelhada da técnica de contraexemplo usada acima para *refutar* uma tripla: um estado que satisfaz nunca consegue *provar* uma tripla verdadeira, porque a afirmação é universalmente quantificada sobre todo estado que satisfaz `P`, e uma testemunha só demonstra que a afirmação não é violada naquele ponto específico.
- **Ignorar precondições falsas ou impossíveis.** Uma precondição que nunca pode ser de fato satisfeita por nenhum estado real (como `false`, ou uma conjunção contraditória como `x > 0 ∧ x < 0`) torna trivialmente verdadeira qualquer tripla construída sobre ela, exatamente como um comando que não termina; isso é tecnicamente correto, mas vazio na prática, e uma prova que se apoia em uma precondição insatisfatível para facilitar o próprio trabalho não estabeleceu de fato nada útil sobre execuções reais.

## Resumo

Uma tripla de Hoare `{P} C {Q}` é um teorema de correção parcial sobre um comando: supondo que a precondição `P` vale no estado inicial, toda execução de `C` que de fato termina acaba em um estado que satisfaz a pós-condição `Q`; sem nenhuma afirmação sobre execuções que não terminam, e sem nenhuma afirmação sobre nada além da única relação de antes e depois que a pós-condição enuncia. Ela fica um nível de abstração acima da semântica operacional, ligada a ela por uma garantia de correção que permite às provas seguirem a estrutura sintática de `C` em vez de cada transição individual de passo pequeno, e é refutada, exatamente como uma afirmação universal de correção em testes, por um único estado de contraexemplo concreto, e não por um argumento geral. Tudo o que o resto do bloco de lógica de Hoare desta disciplina constrói (regras de inferência composicionais, invariantes de laço, precondições mais fracas, correção total) é construído diretamente sobre esta única tripla como seu julgamento central e unificador.

## Documentation Links

- [Hoare: An Axiomatic Basis for Computer Programming (1969)](https://www.cs.cmu.edu/~crary/819-f09/Hoare69.pdf): o artigo original de programação axiomática por trás das triplas de Hoare e das regras de inferência.
- [Pierce et al.: Software Foundations](https://softwarefoundations.cis.upenn.edu/): desenvolvimento verificado por máquina de lógica, lógica de Hoare e estilo de assistentes de prova.
