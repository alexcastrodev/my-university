---
version: 1.0
updatedAt: 2026-09-07
title: Invariantes de Laço e a Regra do While
summary: Um invariante de laço é a asserção que torna a repetição ilimitada finita o bastante para raciocinar sobre ela. A regra do while transforma o raciocínio de inicialização, preservação e saída em uma prova válida para qualquer número de iterações.
---
## Objetivos de Aprendizagem

- Enunciar a regra do while e explicar cada uma das suas três obrigações de prova: inicialização, preservação e saída.
- Explicar com precisão por que um invariante de laço cumpre o mesmo papel lógico de uma hipótese de indução.
- Construir um invariante de laço para um pequeno laço numérico trabalhando de trás para frente a partir da pós-condição desejada.
- Diagnosticar um invariante fraco demais para implicar a pós-condição na saída do laço e fortalecê-lo corretamente.
- Fazer uma prova completa de um laço de somatório, cumprindo explicitamente as três obrigações.

## Contexto e Motivação

`hoare-logic-rules-of-inference` deu regras dirigidas pela sintaxe para atribuição, sequência e condicionais; todas as construções de uma linguagem imperativa simples, exceto a que de fato torna o raciocínio difícil: o laço. Um laço pode rodar zero vezes, uma vez ou um número ilimitado de vezes, conforme a entrada, e testes só conseguem observar um punhado finito dessas quantidades possíveis de iterações. Uma prova, ao contrário, precisa dizer algo verdadeiro não importa quantas vezes o corpo do laço de fato execute, e precisa fazer isso sem desdobrar o laço em uma análise de casos infinita e ilimitada.

O invariante de laço é a única asserção que torna isso possível, e a analogia com a indução matemática de Matemática Discreta e Lógica não é uma metáfora solta: é exatamente a mesma estrutura lógica, aplicada à execução de programas em vez de aos números naturais. Uma prova por indução estabelece um caso base e um passo indutivo e conclui que a propriedade vale para todo número natural sem nunca ter checado cada um individualmente; uma prova por invariante de laço estabelece que o invariante vale antes de o laço começar e sobrevive a toda execução do corpo, e conclui que ele vale não importa quantas iterações de fato rodaram, sem nunca ter rastreado uma quantidade específica de iterações. Este conceito é também onde o estilo de argumento de troca e raciocínio indutivo sobre algoritmos de `proving-greedy-optimality-activity-selection` e as provas em lógica de Hoare desta disciplina se revelam fazendo estruturalmente o mesmo tipo de trabalho, só que expresso em vocabulários diferentes, para propósitos diferentes.

Vale ser direto sobre onde mora a verdadeira dificuldade, porque é fácil subestimá-la no primeiro contato: com o invariante certo em mãos, aplicar a regra do while é quase mecânico. O desafio real (a parte que exige percepção genuína, e não só seguir regras) é encontrar um invariante que seja ao mesmo tempo fraco o bastante para ser comprovadamente preservado pelo corpo do laço e forte o bastante para, quando a guarda do laço finalmente ficar falsa, implicar a pós-condição a que a prova inteira quer chegar.

## Teoria Central

### As três obrigações

Provar um laço correto com um invariante `I`, guarda `B` e corpo `C` exige cumprir exatamente três obrigações separadas, cada uma com um papel distinto. A inicialização exige que `I` valha na primeiríssima vez que a guarda é checada, antes de o corpo do laço rodar uma única vez; é o caso base da indução. A preservação exige que, supondo que `I` e a guarda `B` valham logo antes de uma execução do corpo, `I` volte a valer imediatamente depois dessa execução; é o passo indutivo, e precisa ser provado para uma iteração arbitrária, e não separadamente para a primeira, a segunda, e assim por diante. A saída exige que, quando o laço finalmente termina (ou seja, `I` ainda vale, mas a guarda `B` ficou falsa), a conjunção `I ∧ ¬B` seja forte o bastante para implicar a pós-condição que a prova quer estabelecer no fim. As três obrigações precisam ser cumpridas; uma prova que só trata da preservação, mas esquece a inicialização, por exemplo, provou que o invariante se sustenta sozinho sem nunca provar que ele de fato começa a valer.

### A regra do while

Formalmente, a regra do while tem o formato:

```text
{I ∧ B} C {I}
------------------------------
{I} while B do C {I ∧ ¬B}
```

Lido de cima para baixo: se a única premissa acima da linha (que o corpo `C`, executado a partir de um estado que satisfaz o invariante e a guarda, restabelece o invariante) puder ser provada, então a conclusão abaixo da linha vale para o laço como um todo: partindo de um estado que satisfaz `I`, o laço inteiro (quantas iterações ele de fato levar) termina em um estado que satisfaz `I ∧ ¬B`. Repare no que essa regra *não* exige: ela nunca pede uma prova sobre "o estado depois de 5 iterações" ou "o estado depois de k iterações" para algum `k` específico ou simbólico; a premissa é uma única tripla sobre uma passada arbitrária pelo corpo, e a regra autoriza concluir algo sobre arbitrariamente muitas passadas só a partir dessa tripla. É exatamente o mesmo movimento que a indução matemática faz: provar que um passo funciona em geral e ganhar de graça toda quantidade de iterações.

### A conexão com a indução

Tornando a correspondência com a indução totalmente explícita: a inicialização é o caso base, que estabelece que a propriedade vale no ponto de partida, antes de qualquer passo indutivo. A preservação é o passo de indução, que estabelece que a propriedade sobrevive a mais uma aplicação do processo indutivo, seja ele qual for: mais um número natural na indução comum, mais uma passada pelo corpo do laço aqui. O número de iterações que uma execução específica de fato faz é arbitrário e desconhecido de antemão (depende da entrada), mas a prova em si é inteiramente finita, consistindo exatamente nessas duas obrigações fixas (mais a saída), não importa se o laço, em alguma execução específica, roda três vezes ou três milhões de vezes. É precisamente esse o ganho que faz valer a pena o esforço de encontrar invariantes de laço: um esforço de prova finito compra uma garantia sobre uma quantidade ilimitadamente variável de comportamento em tempo de execução.

### Como encontrar invariantes

Não existe um algoritmo totalmente mecânico para encontrar um bom invariante (essa é a habilidade genuína que este conceito ensina), mas algumas heurísticas confiáveis estreitam bastante a busca. Um ponto de partida produtivo é olhar para a pós-condição desejada e perguntar como *enfraquecê-la* em uma afirmação que possa plausivelmente valer no meio do laço, e não só no fim; a pós-condição é, de certo modo, "como o invariante fica quando a guarda também ficou falsa", então trabalhar de trás para frente a partir dela raramente é esforço perdido. Quase todo laço sobre um array ou uma faixa contada precisa de um limite explícito como parte do invariante, como `0 ≤ i ≤ n`, porque, sem enunciar o limite explicitamente, a obrigação de saída normalmente não consegue determinar o valor exato em que uma variável contadora termina. Além dos limites, o invariante normalmente precisa enunciar a relação exata entre o que foi acumulado até ali e a parte da entrada processada até ali; esse costuma ser o conteúdo matemático substantivo do invariante, e acertá-lo exatamente (e não quase) é o que o exemplo resolvido abaixo demonstra de forma concreta. Por fim, um bom invariante deve evitar afirmar qualquer coisa que o corpo do laço de fato não preserve; um invariante que por acaso é verdadeiro na execução específica que alguém tem em mente, mas que o corpo não garante em geral, vai falhar na obrigação de preservação no momento em que for checado com rigor.

## Exemplos Resolvidos

### Somando números: montando a prova

Considere o laço a seguir, que deve calcular a soma dos inteiros de `0` até `n - 1`:

```text
i := 0; s := 0;
while i < n do
    s := s + i;
    i := i + 1
```

A precondição é `n ≥ 0`, e a pós-condição desejada é a identidade em forma fechada `2*s = n*(n - 1)`, a conhecida soma `0 + 1 + ... + (n-1) = n(n-1)/2`, reescrita sem divisão para manter a aritmética inteiramente nos inteiros. Seguindo a orientação acima, o invariante é construído combinando um limite para o contador do laço com uma relação entre a soma acumulada e a parte da faixa processada até ali. O invariante escolhido é:

```text
I: 0 ≤ i ≤ n ∧ 2*s = i*(i - 1)
```

A segunda parte diz exatamente o que deve ser verdade no meio do caminho: depois de `i` iterações, `s` guarda a soma `0 + 1 + ... + (i - 1)`, cuja forma fechada é `i*(i-1)/2`, reescrita como `2*s = i*(i-1)` para evitar divisão. Esse invariante tem exatamente o formato da pós-condição, mas com `i` no lugar de `n`; uma instância direta da heurística de "enfraquecer a pós-condição para que ela valha no meio do caminho".

### Somando números: as três obrigações cumpridas

**Inicialização.** Antes de a guarda do laço ser checada pela primeira vez, as duas atribuições anteriores definiram `i := 0` e `s := 0`. Substituindo esses valores no invariante: `0 ≤ 0 ≤ n` vale porque a precondição já garante `n ≥ 0`, e `2*0 = 0*(0-1)` se simplifica em `0 = 0`, que vale incondicionalmente. As duas partes de `I` valem, então a inicialização está estabelecida.

**Preservação.** Suponha que `I` valha (ou seja, `0 ≤ i ≤ n ∧ 2*s = i*(i-1)`) e que a guarda `i < n` também valha, exatamente o estado a partir do qual o corpo do laço executa. O corpo roda `s := s + i` seguido de `i := i + 1`. Sejam `s'` e `i'` os valores logo depois que o corpo termina, de modo que `s' = s + i` e `i' = i + 1`. O objetivo é mostrar que `I` volta a valer com esses novos valores: `0 ≤ i' ≤ n ∧ 2*s' = i'*(i'-1)`. O limite vale porque `i < n` (a guarda) junto com `i ≤ n` (de `I`) dá `i' = i + 1 ≤ n`, e `i' ≥ 0` trivialmente, já que `i ≥ 0`. Para a parte aritmética, calcule `2*s' = 2*(s + i) = 2*s + 2*i` e, pelo invariante suposto `2*s = i*(i-1)`, isso vira `i*(i-1) + 2*i = i*i - i + 2*i = i*i + i = i*(i+1) = (i+1)*((i+1)-1) = i'*(i'-1)`, exatamente o que precisava ser mostrado. A preservação está estabelecida para uma passada arbitrária pelo corpo, o que, pela regra do while, é tudo o que se exige, não importa quantas passadas no total uma dada execução do laço faça.

**Saída.** Quando o laço finalmente termina, `I` ainda vale, mas a guarda ficou falsa, então `¬(i < n)` vale, o que significa `i ≥ n`. Combinado com o limite `i ≤ n` de `I`, isso fixa `i` exatamente: `i = n`. Substituir `i = n` na parte aritmética `2*s = i*(i-1)` dá exatamente `2*s = n*(n-1)`, precisamente a pós-condição desejada, sem mais nenhum argumento. Cumpridas as três obrigações, a regra do while conclui a tripla completa: `{n ≥ 0} program {2*s = n*(n-1)}`.

### O limite que falta, e por que ele importa

Para ver de forma concreta por que o limite `0 ≤ i ≤ n` merece seu lugar no invariante, em vez de ser decorativo, considere tirá-lo e trabalhar só com o invariante candidato mais fraco `2*s = i*(i-1)`. A inicialização e a preservação continuam funcionando exatamente como antes, já que nenhum dos passos acima usou de fato o limite na sua aritmética. Mas a obrigação de saída agora não consegue chegar à pós-condição: de `¬(i < n)` sozinho, só decorre `i ≥ n`, e não `i = n`; e, sem saber que `i` é exatamente igual a `n`, a identidade aritmética `2*s = i*(i-1)` diz algo verdadeiro sobre `i`, mas não a pós-condição específica `2*s = n*(n-1)` que se queria. A relação aritmética, embora verdadeira, era fraca demais sozinha para terminar a prova; o limite `i ≤ n` é exatamente a peça que falta e que, combinada com `i ≥ n` vinda da guarda falsa, fixa `i` no único valor `n` de que a pós-condição precisa.

### O caso de zero iterações

Um invariante correto também precisa tratar o caso de o laço rodar zero vezes, já que nada na precondição `n ≥ 0` exclui `n = 0`. Se `n = 0`, a guarda `i < n` é `0 < 0`, falsa de imediato, então o corpo do laço nunca executa. Nesse caso, só a inicialização importa: com `i = 0` e `s = 0`, o invariante `0 ≤ 0 ≤ 0` e `2*0 = 0*(0-1) = 0` valem, exatamente como verificado em geral acima. A saída então se aplica diretamente com `i = n = 0`, dando `2*s = 0*(0-1) = 0`, o que coincide exatamente com `s = 0`. Nada de especial precisou ser acrescentado à prova para tratar esse caso; um invariante enunciado corretamente cobre zero iterações automaticamente, como subproduto só da inicialização, sem nenhum argumento separado. Um invariante que exigisse um caso especial para zero iterações seria sinal de que algo nele foi enunciado de forma estreita demais.

## Equívocos Comuns e Armadilhas

- **Inventar um invariante que só é de fato verdadeiro na saída do laço.** Uma asserção candidata que por acaso coincide exatamente com a pós-condição, mas que o corpo do laço não consegue preservar em cada iteração intermediária, não é um invariante utilizável; ela pode descrever o *destino* corretamente sem descrever nada verdadeiro pelo caminho, e a obrigação de preservação vai falhar no momento em que for checada honestamente.
- **Esquecer os limites dos contadores.** Como o exemplo do limite que falta demonstra de forma concreta, uma relação aritmética entre variáveis acumuladas pode ser perfeitamente verdadeira e ainda assim fraca demais, sozinha, para fixar o valor final exato a que um contador chega; o limite muitas vezes é exatamente o que a obrigação de saída precisa e o que a relação aritmética sozinha não fornece.
- **Provar a preservação, mas nunca checar a inicialização.** Uma prova que só mostra que o invariante sobrevive ao corpo do laço mostrou que o invariante se sustenta sozinho, e não que ele de fato vale em algum momento; é o equivalente, em provas de laço, a provar o passo indutivo sem nunca estabelecer o caso base, e deixa o argumento inteiro logicamente incompleto, por mais cuidadoso que o passo tenha sido.
- **Presumir que um laço roda pelo menos uma vez.** Alguns invariantes são escolhidos de um jeito que depende em silêncio de o corpo ter executado pelo menos uma vez; o exemplo resolvido de zero iterações acima existe especificamente para tornar concreto esse modo de falha; um invariante correto trata `n = 0` (ou qual for o caso de zero iterações de um dado laço) como consequência gratuita da inicialização, e não como um caso especial que exige tratamento separado.
- **Tratar a descoberta do invariante como um passo mecânico de seguir regras.** Uma vez proposto um invariante, checar as três obrigações contra ele é um trabalho quase mecânico, dirigido pela sintaxe; encontrar o invariante, em primeiro lugar, normalmente é a parte criativa e difícil de uma prova de laço, e é exatamente o passo que nenhum procedimento puramente mecânico consegue fazer de forma confiável em geral; é precisamente por isso que ferramentas automatizadas, vistas mais adiante nesta disciplina, tantas vezes pedem que um humano forneça o invariante, em vez de tentar inferi-lo do zero.

## Resumo

Um invariante de laço é uma hipótese de indução para programas, e a regra do while transforma as três obrigações de inicialização, preservação e saída em uma prova completa e finita que cobre toda quantidade possível de iterações que um laço pode de fato rodar. O exemplo resolvido completo (somar os inteiros de `0` a `n-1` com o invariante `0 ≤ i ≤ n ∧ 2*s = i*(i-1)`) mostrou as três obrigações cumpridas explicitamente, mostrou exatamente como uma relação aritmética sozinha pode ser fraca demais sem um limite que a acompanhe e mostrou que um invariante enunciado corretamente trata automaticamente o caso de zero iterações. Como a dificuldade real está em encontrar o invariante certo, e não em checá-lo mecanicamente depois, este conceito é a ponte entre as regras dirigidas pela sintaxe da lógica de Hoare para código sem laços e o raciocínio genuinamente criativo de que `weakest-preconditions` e, mais adiante, a geração automatizada de condições de verificação ainda dependem, em última instância, de um humano para fornecer.

## Documentation Links

- [Hoare: An Axiomatic Basis for Computer Programming (1969)](https://www.cs.cmu.edu/~crary/819-f09/Hoare69.pdf): o artigo original de programação axiomática por trás das triplas de Hoare e das regras de inferência.
- [Pierce et al.: Software Foundations](https://softwarefoundations.cis.upenn.edu/): desenvolvimento verificado por máquina de lógica, lógica de Hoare e estilo de assistentes de prova.
