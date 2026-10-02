---
version: 1.0
updatedAt: 2026-09-07
title: Precondições Mais Fracas
summary: As precondições mais fracas fazem uma especificação correr de trás para frente pelo código. Dada uma pós-condição desejada, calcula-se a condição menos restritiva que precisa valer antes do comando. Isso transforma a busca por provas em geração calculacional de condições de verificação.
---
## Objetivos de Aprendizagem

- Definir `wp(C, Q)` como a asserção mais fraca `P` para a qual `{P} C {Q}` é uma tripla válida de correção parcial.
- Explicar com precisão por que "mais fraca" significa menos restritiva, e não mais fácil de enunciar ou mais fácil de provar.
- Calcular precondições mais fracas para comandos de atribuição, sequência e condicional usando regras calculacionais dirigidas pela sintaxe.
- Explicar por que laços gerais resistem a uma precondição mais fraca sintática exata, e por que as ferramentas usam um invariante fornecido no lugar.
- Fazer um cálculo completo, de trás para frente, de uma precondição mais fraca por uma pequena sequência de instruções.

## Contexto e Motivação

`hoare-logic-rules-of-inference` provou triplas para frente, no sentido de que cada regra recebe uma precondição já conhecida e deriva uma pós-condição, ou checa uma pós-condição proposta contra uma precondição proposta. As precondições mais fracas rodam o mesmo mecanismo na direção oposta: partir de uma pós-condição *desejada* (a propriedade que o código deve estabelecer) e calcular exatamente o que precisava ser verdade antes para que essa pós-condição fosse garantida. Essa inversão acaba sendo enormemente útil na prática, porque é precisamente como os verificadores automatizados funcionam: dado um programa anotado com uma pós-condição-alvo (e, para laços, um invariante fornecido), um calculador de precondição mais fraca percorre o código de trás para frente, gerando uma única fórmula lógica (a condição de verificação) cuja validade é exatamente equivalente a o programa cumprir sua especificação.

A palavra "mais fraca" faz aqui um trabalho técnico real e preciso e merece ser lida ao pé da letra, e não como um sinônimo vago de "mínima" ou "mais simples". Entre todas as asserções `P` para as quais `{P} C {Q}` vale, a mais fraca é a *menos restritiva* (a satisfeita pelo maior conjunto possível de estados), porque exclui só os estados que genuinamente precisam ser excluídos para garantir a pós-condição, e nada mais. Isso importa na prática: uma precondição mais forte que o necessário rejeita em silêncio chamadores legítimos que na verdade estariam bem, enquanto a precondição mais fraca aceita todo chamador que poderia funcionar, e é exatamente essa propriedade que a torna o alvo certo para uma ferramenta automatizada que tenta não rejeitar programas válidos sem necessidade.

## Teoria Central

### Definição

`wp(C, Q)` denota a asserção mais fraca `P` tal que a tripla `{P} C {Q}` é válida, restrita às execuções de `C` que terminam; esse qualificador importa, e as precondições mais fracas de correção total, que exigem também a terminação, são tratadas como uma noção distinta e mais forte quando `total-correctness-and-termination` as apresenta. Qualquer asserção mais forte que `wp(C, Q)` (ou seja, qualquer asserção que a implique) também torna `{P} C {Q}` válida, simplesmente porque uma precondição mais forte só exclui estados que uma mais fraca já tratava corretamente; ela nunca invalida uma tripla que já era verdadeira. O ganho prático de calcular especificamente a *mais fraca*, em vez de alguma precondição suficiente, porém mais forte, é que, para o fragmento de código sem laços de uma linguagem de programação (atribuições, sequências e condicionais), `wp` pode ser calculada de forma exata e mecânica, construção por construção, sem exigir nenhuma percepção criativa; um contraste nítido com os invariantes de laço, que normalmente exigem percepção, como o caso dos laços abaixo deixa explícito.

### Atribuição

Para uma atribuição `x := E`, a precondição mais fraca para a pós-condição `Q` é obtida substituindo `E` em cada ocorrência de `x` em `Q`: `wp(x := E, Q) = Q[E/x]`. Não é uma ideia nova apresentada pela primeira vez aqui; é exatamente a mesma substituição que a regra de atribuição da lógica de Hoare já usava, só que renomeada como uma função que calcula uma precondição a partir de uma pós-condição, em vez de uma premissa de regra de inferência. A substituição é avaliada em relação ao estado *antigo*, o que existia logo antes de a atribuição rodar; um detalhe fácil de enunciar, mas fácil de inverter na prática, e apontado explicitamente entre os equívocos abaixo porque errar a direção da substituição é um dos erros iniciais mais comuns ao aplicar esta regra.

### Sequência e condicionais

Para dois comandos executados em sequência, a precondição mais fraca se compõe por aninhamento: `wp(C1; C2, Q) = wp(C1, wp(C2, Q))`. Ler isso de dentro para fora torna o cálculo concreto: primeiro calcule a precondição mais fraca de que `C2` precisa para chegar a `Q`, depois trate *esse* resultado como a pós-condição-alvo de `C1` e calcule a precondição mais fraca de `C1` para chegar a ela. Esse aninhamento é o que torna o cálculo da precondição mais fraca para uma sequência inteira de instruções uma única varredura mecânica, da direita para a esquerda, sem exigir nenhum palpite sobre uma asserção intermediária; ao contrário da regra de sequência da lógica de Hoare, que exigia *escolher* uma asserção intermediária, a `wp` calcula essa asserção intermediária automaticamente, como subproduto do cálculo, sem nenhuma escolha em aberto. Para um condicional, a precondição mais fraca combina os dois ramos em uma única fórmula: a precondição precisa garantir que, qualquer que seja o ramo que de fato execute, a precondição mais fraca do próprio ramo para `Q` seja satisfeita; concretamente, `(guard → wp(C1, Q)) ∧ (¬guard → wp(C2, Q))`, exigindo a precondição do ramo `then` sempre que a guarda vale e a do ramo `else` sempre que não vale.

### Laços

O código sem laços tem uma precondição mais fraca exata e puramente sintática porque um texto de programa fixo corresponde a um cálculo fixo e finito. Um laço `while` geral quebra isso de forma nítida: expressar sua precondição mais fraca exata em aritmética de primeira ordem comum exigiria, em geral, expressar "a pós-condição vale depois de quantas iterações esta execução específica calhar de fazer", e, para uma quantidade de iterações ilimitada e dependente da entrada, essa afirmação nem sempre é expressável como uma fórmula de primeira ordem finita. Não é uma lacuna que uma engenharia melhor feche; é uma manifestação direta da mesma fronteira de indecidibilidade que atravessa esta disciplina desde `testing-shows-presence-proof-shows-absence`. As ferramentas práticas respondem não tentando calcular automaticamente uma `wp` exata para um laço; em vez disso, pedem ao autor humano que forneça um invariante de laço (exatamente o invariante apresentado em `loop-invariants-and-the-while-rule`), e a ferramenta então gera as obrigações de inicialização, preservação e saída como condições de verificação construídas *em torno* desse invariante fornecido, cumprindo cada uma (muitas vezes de forma automática, pelos solvers SMT vistos mais adiante nesta disciplina), em vez de calcular a `wp` do laço diretamente.

## Exemplos Resolvidos

### Atribuição única

Comando: `x := x + 1`. Pós-condição desejada: `x > 10`. Aplicando diretamente a regra de atribuição: substitua `x + 1` por `x` na pós-condição, o que dá `wp(x := x+1, x > 10) = (x + 1) > 10`. Isso se simplifica, por aritmética comum, em `x > 9`. Então qualquer estado com `x > 9` antes (e, importante, *só* esses estados) é exatamente o bastante para garantir `x > 10` depois; um estado com `x = 9` daria `x = 10` depois da atribuição, o que falha na desigualdade estrita, confirmando que `x > 9` é de fato a fronteira, e não só uma superestimativa segura dela.

### Cálculo de sequência

Comando: `x := x + 1; y := 2*x`. Pós-condição desejada: `y > 20`. Seguindo a definição aninhada `wp(C1; C2, Q) = wp(C1, wp(C2, Q))`, o cálculo avança estritamente da direita para a esquerda, uma instrução por vez, exatamente como uma derivação algébrica:

```text
wp(y := 2*x, y > 20)          =  2*x > 20
wp(x := x + 1, 2*x > 20)      =  2*(x + 1) > 20
```

A primeira linha aplica a regra de atribuição à segunda instrução (a mais à direita), substituindo `2*x` por `y` na pós-condição. A segunda linha então trata `2*x > 20` como a nova pós-condição-alvo e aplica de novo a regra de atribuição, desta vez à primeira instrução, substituindo `x + 1` por `x`. Simplificar `2*(x + 1) > 20` por álgebra comum dá `2*x + 2 > 20`, logo `2*x > 18`, logo `x > 9`. Assim, `wp(x := x + 1; y := 2*x, y > 20) = x > 9`, calculada como uma única cadeia calculacional sem nenhuma asserção intermediária chutada em nenhum ponto; a asserção intermediária inteira `2*x > 20` saiu da substituição mecânica, em vez de exigir o tipo de escolha que a regra de sequência da lógica de Hoare exigia.

### Cálculo de condicional

Comando: `if x ≥ 0 then y := x else y := -x`. Pós-condição desejada: `y ≥ 0`. A precondição mais fraca de cada ramo é calculada primeiro, de forma independente, pela regra de atribuição: o ramo `then` precisa de `wp(y := x, y ≥ 0) = x ≥ 0`; o ramo `else` precisa de `wp(y := -x, y ≥ 0) = -x ≥ 0`, que se simplifica em `x ≤ 0`. Combinando os dois ramos pela fórmula do condicional: `(x ≥ 0 → x ≥ 0) ∧ (x < 0 → x ≤ 0)`. As duas implicações são logicamente triviais quando enunciadas assim (a primeira tem antecedente e consequente idênticos, e o antecedente da segunda já implica diretamente o consequente), então a conjunção inteira se simplifica, pelo raciocínio lógico comum da regra de consequência, em `true`: o comando estabelece `y ≥ 0` qualquer que seja o valor inicial de `x`, sem exigir nenhuma precondição sobre `x`. Isso coincide, pela direção calculacional oposta, exatamente com o que a prova por divisão em casos de `the-hoare-triple` e `hoare-logic-rules-of-inference` já estabeleceu para este mesmo comando por análise direta de casos; uma checagem cruzada útil de que os dois estilos de prova concordam.

## Equívocos Comuns e Armadilhas

- **Chamar uma precondição suficiente de "a mais fraca" sem checar se ela exclui estados desnecessários.** Uma precondição que torna uma tripla válida não é automaticamente a precondição mais fraca possível; como mostra o exemplo da atribuição única, `x > 100` também tornaria `{x > 100} x := x+1 {x > 10}` válida, mas excluiria sem necessidade estados como `x = 20`, que a verdadeira precondição mais fraca `x > 9` admite corretamente; "suficiente" e "mais fraca" são afirmações diferentes, e só o procedimento calculacional acima, e não um palpite de aparência plausível, de fato calcula a segunda.
- **Substituir depois de uma atribuição na direção errada.** Como na regra de atribuição comum da lógica de Hoare, a substituição em `wp(x := E, Q) = Q[E/x]` troca `x` na *pós-condição* para produzir a *precondição*; inverter isso e substituir na precondição para "prever" a pós-condição calcula outra coisa completamente diferente, e é um dos jeitos mais comuns de este cálculo dar errado para quem o aplica pela primeira vez.
- **Esperar uma precondição mais fraca exata e sintática para um laço arbitrário sem um invariante fornecido.** Como a seção de Teoria Central explica, não é um recurso faltando em alguma ferramenta específica; é um choque direto com a mesma indecidibilidade que exclui um verificador universal, e toda ferramenta real baseada em precondição mais fraca pede um invariante fornecido por um humano exatamente por esse motivo, gerando condições de verificação em torno dele em vez de tentar derivá-lo.
- **Esquecer que a simplificação aritmética é parte genuína do resultado, e não um detalhe opcional.** A saída bruta das regras de substituição (`2*(x+1) > 20` no exemplo de sequência, por exemplo) é logicamente correta, mas muitas vezes ilegível ou difícil de entregar a um solver a jusante até ser simplificada com identidades algébricas comuns; pular esse passo não torna o cálculo errado, mas torna o resultado muito mais difícil de usar ou de verificar a olho.

## Resumo

As precondições mais fracas fazem o raciocínio da lógica de Hoare correr de trás para frente: partindo de uma pós-condição desejada, `wp(C, Q)` calcula a condição menos restritiva que precisava valer antes, calculada de forma exata e mecânica para comandos de atribuição, sequência e condicional por regras de substituição dirigidas pela sintaxe, como o exemplo resolvido do cálculo de sequência demonstrou de ponta a ponta. Os laços são a única construção em que esse cálculo exato deixa de funcionar, pelos mesmos motivos de indecidibilidade que atravessam esta disciplina desde o início, e é por isso que as ferramentas práticas usam um invariante de laço fornecido por um humano e geram condições de verificação em torno dele, em vez de tentar derivar a `wp` do laço automaticamente. Esse estilo calculacional, de trás para frente, é precisamente a técnica sobre a qual são construídos os geradores de condições de verificação (a interface automatizada para os solvers SAT e SMT vistos mais adiante nesta disciplina).

## Documentation Links

- [Pierce et al.: Software Foundations](https://softwarefoundations.cis.upenn.edu/): desenvolvimento verificado por máquina de lógica, lógica de Hoare e estilo de assistentes de prova.
- [CMU 15-414: Automated Program Verification](https://www.cs.cmu.edu/~15414/): página do curso sobre verificação automatizada de programas, SMT e geração de condições de verificação.
