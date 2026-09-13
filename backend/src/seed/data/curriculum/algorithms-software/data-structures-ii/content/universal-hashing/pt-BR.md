---
version: 1.0
updatedAt: 2026-09-13
title: Hashing Universal
summary: Nenhuma função hash fixa resiste a um adversário que a conhece, então hashing universal sorteia uma função ao acaso de uma família com P(h(x)=h(y)) ≤ 1/m para todo par de chaves distintas, restaurando o desempenho esperado O(1) mesmo contra escolha adversarial de chaves.
---
## Objetivos de Aprendizagem

- Explicar o argumento adversarial contra qualquer função hash única e fixa: um adversário que conhece a função sempre consegue construir n chaves que todas colidem.
- Enunciar precisamente a definição de uma família universal de funções hash: para quaisquer duas chaves distintas, a probabilidade de colisão, sobre uma escolha aleatória de função da família, é no máximo 1/m.
- Descrever, em nível conceitual, como uma família universal concreta (multiplicação-módulo-primo) é construída e por que escolher uma função aleatória nova por instância de tabela hash é a defesa de fato.
- Distinguir o que hashing universal protege (um adversário escolhendo chaves antes de a função ser escolhida) do que não protege (um adversário que de alguma forma descobre a função depois que ela é fixada).
- Explicar por que hashing universal reduz o custo esperado por operação de volta a O(1) mesmo sob escolha adversarial de chaves, conectando de volta ao argumento de probabilidade de colisão do paradoxo do aniversário.

## Contexto e Motivação

O conceito anterior mostrou que colisões não são um caso extremo raro, elas se tornam prováveis surpreendentemente cedo, com aproximadamente `n ≈ √m` chaves, puramente pelo paradoxo do aniversário, sem nenhum adversário envolvido. Aquele argumento assumiu que as chaves eram espalhadas uniformemente ao acaso, o que é exatamente verdade para o problema do aniversário em si, mas é uma suposição que vale questionar para uma tabela hash: e se as chaves não forem aleatórias, porque quem as escolhe sabe exatamente qual função hash a tabela usa?

Isso não é uma preocupação hipotética. Qualquer função hash específica e fixa, por mais cuidadosamente projetada que seja, tem algum conjunto fixo de chaves que todas mapeiam para o mesmo slot (isso é inevitável: uma função hash mapeia um espaço de chaves muito maior para apenas `m` slots, então pelo princípio da casa dos pombos, algumas `m+1` chaves precisam colidir em algum lugar, e na prática, buckets inteiros de chaves colidem juntos). Um adversário que conhece a função hash exata que um sistema usa, o que é uma ameaça realista em qualquer sistema que aceita entrada não confiável (um servidor web espalhando cabeçalhos de requisição em uma tabela, por exemplo), pode pré-calcular um grande conjunto de chaves que todas colidem, submetê-las, e degradar toda operação de O(1) para O(n), um vetor genuíno de negação de serviço documentado em sistemas reais. Hashing universal é a resposta: em vez de se comprometer com uma função fixa que um adversário poderia estudar com antecedência, comprometer-se com uma função escolhida aleatoriamente de uma família bem projetada, escolhida de forma nova, em tempo de execução, de um jeito que o adversário não consegue prever antes de escolher suas chaves.

## Teoria Central

### O argumento adversarial, tornado preciso

Para qualquer função hash fixa `h` mapeando chaves para `m` slots, e para qualquer conjunto de `m + 1` ou mais chaves, o princípio da casa dos pombos garante que pelo menos duas delas colidem sob `h`. Na prática, é possível algo muito pior: como `h` é uma função determinística e publicamente conhecível (seu código-fonte, ou pelo menos seu design geral, geralmente não é segredo), um adversário pode simplesmente calcular `h(k)` para muitas chaves candidatas `k` offline, e selecionar uma coleção arbitrariamente grande que todas resultam no mesmo slot. Submeter essa coleção transforma toda operação daquela tabela hash em uma travessia O(n) de lista encadeada (ou sequência de sondagem), enquanto a mesma `h` fixa continuar sendo usada. Nenhuma função hash única e fixa consegue se defender disso, porque o único requisito do adversário é conhecer `h` com antecedência, algo que vale para toda função fixa, por mais engenhosamente construída que seja.

### A definição de uma família universal

A correção não tenta construir uma função hash imune a esse ataque (tal função não existe), em vez disso ela constrói uma **família** de funções hash, `H`, com uma propriedade estatística específica, e escolhe um membro dessa família ao acaso, em tempo de execução, depois que o adversário já teve que se comprometer com (ou pelo menos, antes de o adversário poder observar) qual membro foi escolhido. Formalmente, `H` é uma **família universal** se, para quaisquer duas chaves *distintas* `x` e `y`, quando `h` é sorteado uniformemente ao acaso de `H`:

```
P(h(x) = h(y)) ≤ 1/m
```

A palavra chave é *qualquer*: esse limite precisa valer para todo par possível de chaves distintas, incluindo pares que um adversário escolheu especificamente na esperança de que colidissem. O que derrota o adversário é que agora a *função* é a variável aleatória, não as chaves: o adversário pode fixar suas chaves com antecedência à vontade, mas não pode saber, no momento em que escolhe essas chaves, qual membro de `H` será sorteado, então não consegue projetar um par garantido a colidir da forma como conseguiria contra uma `h` única e conhecida.

### Uma construção concreta: a família multiplicação-módulo-primo

Uma família universal bem conhecida e prática (devida a Carter e Wegman, 1979) funciona sobre chaves inteiras da seguinte forma: fixe um primo `p` maior que o maior valor de chave possível, e defina, para qualquer escolha de inteiros `a` em `{1, ..., p-1}` e `b` em `{0, ..., p-1}`:

```
h_{a,b}(k) = ((a·k + b) mod p) mod m
```

A família `H` é o conjunto de todas essas funções, uma para cada escolha válida de `(a, b)`. Escolher uma função hash para uma nova instância de tabela hash significa escolher `a` e `b` uniformemente ao acaso (uma vez, quando a tabela é criada) e usar essa única `h_{a,b}` para toda chave inserida depois. Pode-se mostrar, através de um argumento de contagem sobre quantos pares `(a, b)` fazem duas chaves distintas dadas colidirem, que essa família satisfaz exatamente o limite `P(h(x)=h(y)) ≤ 1/m`. Os detalhes dessa prova de contagem são um exercício padrão em um curso com mais espaço para isso do que este conceito tem; a conclusão importante é que tais famílias são conhecidas por existir, são baratas de calcular (uma multiplicação, uma soma, duas operações de módulo), e são usadas em implementações reais de tabela hash especificamente para se defender do cenário adversarial descrito acima.

### Por que isso restaura o desempenho esperado O(1)

Com uma `h_{a,b}` nova e escolhida ao acaso para cada instância de tabela, o adversário volta a enfrentar o que, de sua perspectiva, é uma função imprevisível, exatamente a situação que a análise do paradoxo do aniversário do conceito anterior assumiu desde o início (hashing uniformemente aleatório). A propriedade universal limita diretamente o número *esperado* de outras chaves com as quais qualquer chave dada colide: somar a probabilidade de colisão `≤ 1/m` sobre todas as `n-1` outras chaves dá um número esperado de colisões por chave de no máximo `(n-1)/m = alpha` (o fator de carga de Estruturas de Dados I), que é exatamente o mesmo comprimento de cadeia esperado O(1 + alpha) que a análise comum de encadeamento assumiu sob uma função hash "boa", agora provado que de fato vale, mesmo contra um adversário, desde que o adversário se comprometa com suas chaves sem saber qual `(a, b)` será sorteado.

## Exemplos Resolvidos

### Exemplo 1: por que uma função hash fixa específica é sempre quebrável

**Problema:** Suponha que uma tabela hash sempre use `h(k) = k mod 8` (m = 8 slots), e um adversário saiba disso. Construa 5 chaves que todas colidem.

**Construção:** Quaisquer chaves congruentes entre si módulo 8 colidem: `k = 0, 8, 16, 24, 32` todas satisfazem `k mod 8 = 0`. Um adversário que conhece a fórmula pode gerar quantas dessas chaves quiser, offline, sem nenhum chute envolvido, e submeter todas elas força cada uma delas para o mesmo bucket ou sequência de sondagem, degradando toda operação subsequente que as toque para O(n).

### Exemplo 2: calculando um hash universal e verificando que a garantia é por família, não por instância

**Problema:** Usando `h_{a,b}(k) = ((a·k + b) mod p) mod m` com `p = 17`, `m = 8`, `a = 3`, `b = 5`, calcule `h_{a,b}(4)` e `h_{a,b}(12)`, e explique o que a propriedade universal garante e o que não garante sobre esse par específico.

**Cálculo:** `h(4) = ((3·4 + 5) mod 17) mod 8 = (17 mod 17) mod 8 = 0 mod 8 = 0`. `h(12) = ((3·12 + 5) mod 17) mod 8 = (41 mod 17) mod 8 = 7 mod 8 = 7`. Essas duas chaves não colidem sob essa escolha particular de `(a, b)`.

**O que a garantia diz e não diz:** A propriedade universal garante que, *tirando a média sobre todas as escolhas possíveis de `(a, b)`*, a probabilidade de as chaves 4 e 12 colidirem é no máximo 1/8. Ela não diz nada sobre essa `(a, b) = (3, 5)` específica isoladamente, algumas escolhas de `(a, b)` farão 4 e 12 colidirem, outras (como essa) não; a garantia é sobre a família como um todo, que é exatamente por que a defesa exige de fato escolher `(a, b)` ao acaso e mantê-lo desconhecido de um adversário com antecedência, em vez de publicar um único par fixo e "bom" de uma vez.

## Equívocos Comuns e Armadilhas

- **"Uma função hash universal garante que duas chaves específicas nunca colidirão."** Ela garante o enquadramento oposto: para quaisquer duas chaves distintas, a probabilidade de colisão *sobre a escolha aleatória de função* é limitada, mas para uma função específica já escolhida, alguns pares de chaves absolutamente colidirão (o Exemplo 2 mostra que isso pode ir de qualquer jeito dependendo de qual `(a, b)` acontece de ser sorteado).
- **"Hashing universal significa usar uma fórmula hash que 'parece mais aleatória', como adicionar mais multiplicações."** A propriedade sendo projetada é uma garantia probabilística formal sobre uma família inteira de funções, demonstrável por um argumento de contagem, não uma sensação vaga de que a saída "parece" embaralhada; uma fórmula pode parecer complicada e ainda assim não ser universal, e uma simples como a família multiplicação-módulo-primo pode ser provada universal exatamente.
- **"Uma vez que uma função hash universal é escolhida para uma tabela, ela protege contra chaves adversariais futuras tão bem quanto protegeu contra as passadas."** A defesa depende de o adversário não saber qual `(a, b)` foi sorteado *antes* de escolher suas chaves; se a função específica escolhida depois se tornar conhecida (vazada, ou inferida a partir de comportamento observado), um adversário pode então construir um conjunto colidente contra essa função específica, exatamente como no Exemplo 1. Hashing universal se defende contra uma *entrada* de pior caso, não contra um cenário em que a própria função também está comprometida.
- **"Isso é apenas uma preocupação teórica; nenhum sistema real é de fato atacado dessa forma."** Ataques de negação de serviço por complexidade algorítmica explorando funções hash previsíveis em frameworks web e runtimes de linguagem reais (vários afetando sistemas em produção que lidam com chaves de formulário ou JSON não confiáveis) estão bem documentados, que é exatamente por que muitos runtimes de linguagem populares semeiam sua função hash de string padrão aleatoriamente na inicialização do processo, uma aplicação direta e prática da ideia deste conceito.

## Resumo

Nenhuma função hash única e fixa consegue resistir a um adversário que a conhece: o princípio da casa dos pombos garante que chaves colidentes existem, e conhecer a fórmula permite que um adversário as encontre offline e as submeta, degradando toda operação para O(n). Hashing universal se defende disso não construindo uma função inquebrável (nenhuma existe), mas sorteando uma função nova, uniformemente ao acaso, de uma família `H` satisfazendo `P(h(x) = h(y)) ≤ 1/m` para todo par de chaves distintas, de forma que um adversário que precisa se comprometer com suas chaves antes de a função ser sorteada não consegue projetar uma colisão garantida. Uma família concreta e prática (multiplicação-módulo-primo, devida a Carter e Wegman) atinge esse limite com uma fórmula aritmética barata, e escolher seus parâmetros ao acaso no momento da criação da tabela restaura o desempenho esperado O(1 + alpha) que o paradoxo do aniversário mostrou não poder ser dado como certo sob uma função fixa e conhecida. O próximo conceito trata de um problema relacionado, mas diferente: quando o conjunto completo de chaves é conhecido com antecedência (um dicionário estático), colisões podem ser eliminadas completamente, não apenas limitadas em expectativa.

## Documentation Links

- [Carter, J. L., & Wegman, M. N. (1979). "Universal Classes of Hash Functions." Journal of Computer and System Sciences.](https://www.sciencedirect.com/science/article/pii/0022000079900448): paper
- [MIT 6.006 - Lecture Notes (OCW)](https://ocw.mit.edu/courses/6-006-introduction-to-algorithms-spring-2020/pages/lecture-notes/): doc
