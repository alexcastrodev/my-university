---
version: 1.0
updatedAt: 2026-09-13
title: Dualidade de Programação Linear e o Fluxo Máximo/Corte Mínimo
summary: O PL de fluxo máximo, com a regra estendida de dualidade para restrições de igualdade (variável dual livre), tem um dual que é exatamente uma relaxação fracionária de corte mínimo; dualidade forte então implica o teorema do fluxo máximo/corte mínimo, uma segunda prova completamente independente da via de Ford-Fulkerson.
---
## Objetivos de Aprendizagem

- Formular o problema do fluxo máximo como um programa linear: um objetivo linear sobre variáveis de fluxo por aresta, sujeito a desigualdades de capacidade e igualdades de conservação de fluxo.
- Enunciar a regra estendida de dualidade que essa formulação exige: a variável dual de uma restrição de igualdade é irrestrita em sinal ("livre"), não exigida a ser não negativa como a variável dual de uma restrição de desigualdade.
- Construir o dual do programa linear de fluxo máximo, e interpretar suas variáveis como uma relaxação fracionária de um corte s-t: um "potencial" de vértice para todo vértice e um "custo de aresta" para toda aresta.
- Verificar, na rede exata que a disciplina de algoritmos deste currículo já resolveu por Ford-Fulkerson, que os valores indicadores do corte mínimo conhecido satisfazem o dual exatamente, com valor objetivo dual igual ao valor de fluxo máximo já conhecido.
- Explicar por que isso dá uma segunda prova completamente independente do teorema do fluxo máximo/corte mínimo, uma fundamentada em dualidade de programação linear em vez do argumento de grafo residual usado anteriormente.

## Contexto e Motivação

Esta trilha abriu construindo programação linear como uma linguagem de modelagem geral, e os vários conceitos anteriores desenvolveram seus dois resultados estruturais mais profundos: a garantia mecânica do método simplex de um vértice ótimo, e a garantia da relação primal-dual de que o valor ótimo de um programa linear sempre é igual exatamente ao valor ótimo de seu dual. Este conceito de encerramento volta esses resultados para um problema que este currículo já resolveu por uma rota inteiramente diferente: o tópico de fluxo em redes da disciplina de algoritmos provou, via grafos residuais de Ford-Fulkerson e um argumento construtivo sobre conjuntos de vértices alcançáveis, que o valor de fluxo máximo de uma rede sempre é igual exatamente à capacidade de seu corte mínimo. Este conceito revela esse mesmo fato como uma consequência direta e inevitável do teorema de dualidade forte provado dois conceitos atrás, uma vez que o problema de fluxo máximo é corretamente escrito como um programa linear, uma prova genuinamente diferente de um teorema que este currículo agora estabeleceu duas vezes, por dois argumentos estruturalmente não relacionados chegando ao resultado idêntico.

## Teoria Central

### O programa linear de fluxo máximo

Relembre as duas condições definidoras de uma rede de fluxo do conceito de fluxo em redes deste currículo: uma restrição de capacidade em toda aresta, `0 ≤ f(u,v) ≤ c(u,v)`, e uma igualdade de conservação em todo vértice além da fonte `s` e do sumidouro `t`, `soma de f(u,v) sobre u = soma de f(v,w) sobre w`. Ambas as condições já são lineares, então o problema do fluxo máximo já é, sem nenhuma tradução necessária, um programa linear: **maximizar** `soma de f(s,v) sobre v`, sujeito à restrição de capacidade de toda aresta e à igualdade de conservação de todo vértice intermediário.

### A regra estendida de dualidade: restrições de igualdade ganham uma variável dual livre

Este programa linear tem um tipo de restrição que a receita de dualidade desta trilha (dois conceitos atrás) não cobriu: uma *igualdade*, não uma desigualdade. A regra se estende limpamente, e pode ser derivada diretamente do que já se sabe: uma igualdade `aᵀx = b` é equivalente ao par `aᵀx ≤ b` e `aᵀx ≥ b` (um fato do primeiríssimo conceito desta trilha), que, convertido em duas restrições `≤`, contribui *duas* variáveis duais não negativas, digamos `p ≥ 0` e `q ≥ 0`. Em todo lugar que essas duas variáveis aparecem no dual, elas aparecem só como a combinação `p - q`, já que uma restrição entrou com sinal `+` e a outra com sinal `-` depois da conversão. Como `p` e `q` cada uma varia independentemente sobre todo número real não negativo, sua diferença `p - q` varia sobre **todo número real**, positivo, negativo, ou zero, inteiramente irrestrita. Então: **a variável dual de uma restrição de igualdade é livre (irrestrita em sinal)**, exatamente o único ajuste necessário para estender a receita de dualidade desta trilha às igualdades de conservação do programa linear de fluxo máximo.

### Construindo o dual: potenciais e custos de aresta

Aplicando a receita (agora estendida): uma variável dual por restrição primal. A restrição de capacidade de toda aresta ganha uma variável dual `y(u,v) ≥ 0` (uma desigualdade comum, variável dual não negativa comum). A igualdade de conservação de todo vértice intermediário ganha uma variável dual **livre** `z(v)` (um **potencial**, pela regra recém derivada). Fixando `z(s) = 1` e `z(t) = 0` (uma normalização necessária já que a fonte e o sumidouro não têm nenhuma restrição de conservação própria para contribuir uma variável dual, e sem fixar esses dois o dual inteiro trivialmente minimizaria para `0` definindo todo potencial igual), o dual resulta em:

```
minimizar  soma de c(u,v) · y(u,v), sobre toda aresta
sujeito a  y(u,v) ≥ z(u) - z(v), para toda aresta (u,v)
           y(u,v) ≥ 0
           z(s) = 1, z(t) = 0
```

### Interpretando o dual como um corte relaxado

Esse dual é uma **relaxação fracionária do problema de corte mínimo**. Atribua a todo vértice um potencial `z(v) ∈ {0, 1}` (com `z(s)=1`, `z(t)=0` conforme exigido), interpretado como "de qual lado de um corte esse vértice está" (`1` para o lado da fonte `S`, `0` para o lado do sumidouro `T`). Para uma aresta `(u,v)`, a restrição `y(u,v) ≥ z(u)-z(v)` força `y(u,v) ≥ 1` exatamente quando `z(u)=1` e `z(v)=0`, ou seja, exatamente quando a aresta cruza de `S` para `T`, e não força nada além de `y(u,v) ≥ 0` caso contrário. Minimizar `soma c(u,v)·y(u,v)` então leva `y(u,v)` a exatamente `0` em toda aresta que não cruza e exatamente `1` em toda aresta que cruza, tornando o objetivo dual exatamente `capacidade(S,T)`, a capacidade total das arestas de cruzamento, precisamente a própria definição deste currículo de capacidade de um corte. (É um fato estrutural conhecido e citável, decorrendo da unimodularidade total da matriz de restrições de uma rede de fluxo, que esse programa linear dual sempre tem uma solução ótima com todo `z(v)` e `y(u,v)` assumindo um valor inteiro, de fato `0` ou `1`, então o verdadeiro ótimo dual é sempre alcançado por algum corte genuíno, não meramente aproximado por um compromisso fracionário entre cortes.)

### O teorema, agora como um corolário da dualidade forte

Dualidade forte (dois conceitos atrás) diz que o valor ótimo do programa linear de fluxo máximo é igual exatamente ao valor ótimo de seu dual. O valor ótimo do dual, dado o fato de integralidade recém citado, é exatamente a capacidade do corte de capacidade mínima. Portanto: **valor de fluxo máximo = capacidade de corte mínimo**, o teorema do fluxo máximo/corte mínimo, agora derivado como uma consequência direta do próprio teorema de dualidade forte da programação linear, uma rota de prova genuinamente diferente do argumento de grafo residual de Ford-Fulkerson que este currículo usou para estabelecer o resultado idêntico.

## Exemplos Resolvidos

### Exemplo 1: verificando o dual na rede exata que este currículo já resolveu

**Problema:** A disciplina de algoritmos deste currículo resolveu a rede de fluxo `s→A:16, s→B:13, A→B:10, A→C:12, B→A:4, B→D:14, C→D:9, C→t:7, D→t:20`, encontrando um fluxo máximo de valor `26` e um corte mínimo `S={s,A,B}`, `T={C,D,t}` com arestas de cruzamento `A→C` (capacidade `12`) e `B→D` (capacidade `14`). Construa a solução dual correspondente e verifique que seu valor objetivo corresponde exatamente a `26`.

**Definindo potenciais a partir do corte:** `z(s)=z(A)=z(B)=1` (o lado `S`), `z(C)=z(D)=z(t)=0` (o lado `T`).

**Verificando a restrição `y(u,v) ≥ z(u)-z(v)` de toda aresta, definindo `y` como o valor mínimo permitido:** `s→A`: `z(s)-z(A)=0`, `y=0`. `s→B`: `0`, `y=0`. `A→B`: `1-1=0`, `y=0`. `A→C`: `1-0=1`, `y=1`. `B→A`: `1-1=0`, `y=0`. `B→D`: `1-0=1`, `y=1`. `C→D`: `0-0=0`, `y=0`. `C→t`: `0`, `y=0`. `D→t`: `0`, `y=0`.

**Calculando o objetivo dual:** `soma c(u,v)·y(u,v) = c(A,C)·1 + c(B,D)·1 = 12 + 14 = 26`, todo outro termo contribuindo `0` já que seu `y` é `0`. Isso corresponde exatamente ao valor de fluxo máximo `26`, confirmando dualidade forte concretamente: os potenciais derivados diretamente do corte mínimo já conhecido dão uma solução dual-factível cujo objetivo é igual exatamente ao ótimo primal, exatamente como o teorema que este conceito deriva prevê.

### Exemplo 2: um corte que não é mínimo dá um limite válido mas mais frouxo (não justo)

**Problema:** Usando a mesma rede, defina potenciais para o corte `S={s}` sozinho (todo outro vértice, incluindo `A` e `B`, no lado `T`), e calcule o objetivo dual resultante, comparando com o verdadeiro ótimo de `26`.

**Definindo potenciais:** `z(s)=1`, todo outro vértice `z=0`.

**Verificando restrições:** `s→A`: `1-0=1`, `y=1`. `s→B`: `1-0=1`, `y=1`. Toda outra aresta tem ambos os extremos do mesmo lado (`T`), dando `z(u)-z(v)=0`, então `y=0` para todas elas.

**Objetivo dual:** `c(s,A)·1 + c(s,B)·1 = 16+13=29`.

**Comparação:** `29` é um valor objetivo dual-factível válido (correspondendo ao corte `{s}` contra tudo mais, capacidade `29`), e dualidade fraca (dois conceitos atrás) garante que é um limite superior genuíno sobre o fluxo máximo (`26 ≤ 29` ✓), mas não é *justo*, esse corte não é o mínimo, e sua capacidade excede estritamente o verdadeiro ótimo. Só o corte de capacidade mínima, `S={s,A,B}` no Exemplo 1, alcança a igualdade exata que a dualidade forte garante existir.

## Equívocos Comuns e Armadilhas

- **"Todo corte válido dá uma solução dual alcançando a igualdade exata da dualidade forte."** O corte `{s}` do Exemplo 2 dá uma solução dual-*factível* perfeitamente válida (a desigualdade da dualidade fraca vale: `26≤29`), mas só o corte *mínimo* alcança a igualdade exata que o Exemplo 1 verifica; dualidade forte garante que uma solução dual ótima corresponde exatamente ao primal, não que toda solução dual factível o faça.
- **"A variável dual livre `z(v)` pode ser interpretada como uma atribuição de corte mesmo quando assume um valor fracionário entre 0 e 1."** A interpretação limpa de corte (Teoria Central) depende especificamente de `z(v)` assumir um valor inteiro, `0` ou `1`; o fato de integralidade citado (da unimodularidade total da matriz de restrições) é precisamente o que garante que uma solução ótima com essa interpretação limpa existe de fato, um fato estrutural genuinamente não trivial especificamente sobre redes de fluxo, não uma propriedade que todo dual de programa linear tem automaticamente.
- **"Essa prova do fluxo máximo/corte mínimo torna a prova baseada em Ford-Fulkerson da disciplina de algoritmos redundante ou desnecessária."** As duas provas estabelecem o teorema idêntico através de maquinário inteiramente diferente (grafos residuais e alcançabilidade versus dualidade de programação linear), e cada uma ilumina um aspecto diferente de por que o teorema vale; ter duas provas independentes e estruturalmente não relacionadas do mesmo resultado profundo é uma marca de um fato genuinamente fundamental em otimização combinatória, não um sinal de que uma prova era desnecessária.
- **"Já que o primal (fluxo máximo) tem uma variável por aresta, o dual também precisa ter uma variável por aresta."** O dual tem uma variável por *restrição primal*, não por variável primal (a correspondência estabelecida vários conceitos atrás): as arestas (variáveis primais) determinam as *restrições* do dual, enquanto as *restrições* do primal, capacidade por aresta e conservação por vértice, determinam as *variáveis* do dual, `y(u,v)` por aresta e `z(v)` por vértice respectivamente.

## Resumo

O problema do fluxo máximo já é um programa linear: maximize o fluxo total saindo da fonte, sujeito a desigualdades de capacidade por aresta e igualdades de conservação por vértice. Estender a receita de dualidade desta trilha para lidar com restrições de igualdade (cujas variáveis duais são livres, irrestritas em sinal, derivadas diretamente de dividir uma igualdade em duas desigualdades opostas) produz um dual com um potencial `z(v)` por vértice e um custo `y(u,v)` por aresta, minimizando o custo total ponderado de aresta sujeito a `y(u,v) ≥ z(u)-z(v)`. Esse dual é exatamente uma relaxação fracionária do problema de corte mínimo, e um fato de integralidade conhecido garante que seu ótimo é sempre alcançado por uma atribuição de corte `0`/`1` genuína, então dualidade forte implica diretamente que o valor de fluxo máximo é igual à capacidade de corte mínimo, verificado concretamente no Exemplo 1 na rede exata que a disciplina de algoritmos deste currículo já resolveu (ambos os lados iguais a `26`), com o Exemplo 2 mostrando que um corte que não é mínimo ainda dá um limite válido mas mais frouxo (`29`), exatamente a distinção entre dualidade fraca e dualidade forte que esta trilha construiu ao longo do caminho. Esta é a segunda prova, inteiramente independente, do teorema do fluxo máximo/corte mínimo, alcançada através do próprio teorema de dualidade forte da programação linear em vez do argumento de grafo residual de Ford-Fulkerson, encerrando o arco desta trilha desde uma única desigualdade linear até de volta a um resultado marcante em um canto completamente diferente da disciplina de algoritmos deste currículo.

## Documentation Links

- [MIT 6.251 - Introduction to Mathematical Programming (OCW)](https://ocw.mit.edu/courses/6-251j-introduction-to-mathematical-programming-fall-2009/): doc
- [MIT 6.006 - Lecture Notes (OCW)](https://ocw.mit.edu/courses/6-006-introduction-to-algorithms-spring-2020/pages/lecture-notes/): doc
