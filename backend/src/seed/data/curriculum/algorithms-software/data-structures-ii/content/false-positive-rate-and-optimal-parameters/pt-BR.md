---
version: 1.0
updatedAt: 2026-09-13
title: Taxa de Falso Positivo e Parâmetros Ótimos
summary: A taxa de falso positivo de um filtro de Bloom é aproximadamente (1 - e^(-kn/m))^k, minimizada em k = (m/n)·ln(2), o que dá uma taxa que encolhe exponencialmente conforme mais bits por elemento são alocados, transformando o dimensionamento do filtro em aritmética simples.
---
## Objetivos de Aprendizagem

- Derivar a fórmula aproximada da taxa de falso positivo de um filtro de Bloom: `(1 - e^(-kn/m))^k`, partindo da probabilidade de um único bit permanecer 0.
- Derivar o número de funções hash `k` que minimiza a taxa de falso positivo para `m` e `n` fixos, e enunciar o resultado limpo: `k = (m/n) · ln(2)`.
- Calcular o tamanho necessário do array de bits `m` para atingir uma taxa de falso positivo alvo para um número conhecido de elementos `n`.
- Explicar a troca prática que essa fórmula torna explícita: a taxa de falso positivo diminui exponencialmente em `m/n` (bits por elemento), uma taxa de câmbio genuinamente favorável.
- Dimensionar um filtro de Bloom para um cenário concreto do mundo real, escolhendo tanto `m` quanto `k`.

## Contexto e Motivação

O conceito anterior estabeleceu que um filtro de Bloom troca certeza por espaço permitindo falsos positivos, mas deixou o tamanho dessa troca inteiramente não quantificado: com que frequência, exatamente, um falso positivo acontece, e o que de fato controla essa frequência? Este conceito responde às duas perguntas com uma única derivação, notavelmente limpa, chegando a uma fórmula que transforma o design de filtro de tentativa e erro em aritmética: dado quantos elementos serão inseridos e quão baixa uma taxa de falso positivo é aceitável, a fórmula diz precisamente quão grande fazer o array de bits e quantas funções hash usar.

## Teoria Central

### Passo 1: a probabilidade de um bit específico ainda ser 0 depois de n inserções

Considere uma posição de bit específica no array, e assuma (como uma suposição idealizante, mas padrão) que cada uma das `k` funções hash, para cada uma das `n` chaves inseridas, define uma posição de bit uniformemente aleatória, independente de todo outro cálculo de hash. Cada operação individual de "definir um bit" erra essa posição específica com probabilidade `(1 - 1/m)`. Há `k · n` dessas operações independentes de definição de bit no total (`k` por chave, através de `n` chaves), então a probabilidade de esse bit específico ainda ser 0 depois de todas elas é:

```
P(bit ainda é 0) = (1 - 1/m)^(kn)
```

Usando a aproximação padrão `(1 - 1/m)^m ≈ e^(-1)` para `m` grande (o mesmo limite que define o número de Euler), isso se simplifica para:

```
P(bit ainda é 0) ≈ e^(-kn/m)
```

### Passo 2: a taxa de falso positivo

Um falso positivo ocorre em uma consulta para alguma chave `y` nunca inserida precisamente quando todas as `k` posições de hash de `y` acontecem de já ser 1 (como o Exemplo 1 do conceito anterior ilustrou concretamente). Tratando cada uma dessas `k` posições como sendo independentemente 1 com probabilidade `(1 - e^(-kn/m))` (um menos a probabilidade de "ainda 0" do Passo 1, uma aproximação que é padrão nesta derivação mesmo que as k posições não sejam perfeitamente independentes em um filtro real), a probabilidade de todas as `k` serem 1 simultaneamente é essa probabilidade elevada à `k`-ésima potência:

```
P(falso positivo) ≈ (1 - e^(-kn/m))^k
```

Essa é a fórmula central deste conceito: a taxa de falso positivo depende de exatamente três quantidades, o tamanho do array de bits `m`, o número de funções hash `k`, e o número de elementos inseridos `n`, especificamente através da razão `m/n` (bits alocados por elemento) e da escolha de `k`.

### Passo 3: o número ótimo de funções hash

Para uma razão `m/n` *fixa*, a fórmula da taxa de falso positivo do Passo 2 pode ser minimizada sobre escolhas de `k` usando cálculo comum (derivando em relação a `k` e igualando o resultado a zero). O resultado é uma fórmula limpa e memorável:

```
k_ótimo = (m/n) · ln(2) ≈ 0,693 · (m/n)
```

Isso diz que o melhor número de funções hash é diretamente proporcional a quantos bits são alocados por elemento: mais bits por elemento justifica usar mais funções hash, e nesse `k` ótimo, a fórmula da taxa de falso positivo do Passo 2 se simplifica para:

```
P(falso positivo em k_ótimo) ≈ (1/2)^k_ótimo ≈ 0,6185^(m/n)
```

Essa forma final é a que vale a pena internalizar: a taxa de falso positivo encolhe *exponencialmente* conforme mais bits por elemento são alocados, uma taxa de câmbio genuinamente favorável que é exatamente por que filtros de Bloom são práticos em primeiro lugar. Dobrar os bits por elemento aproximadamente eleva ao quadrado o quão pequena a taxa de falso positivo se torna (já que é uma exponencial em `m/n`), um retorno dramaticamente melhor do que, digamos, uma melhoria linear ofereceria.

### Dimensionando um filtro para uma taxa de falso positivo alvo

O design na prática executa essa cadeia de fórmulas ao contrário: dada uma taxa de falso positivo alvo `p` e um número conhecido (ou bem estimado) de elementos `n`, resolva `p ≈ 0,6185^(m/n)` para `m/n`, depois escolha `k = (m/n) · ln(2)` arredondado para o inteiro mais próximo. Concretamente, tomando o logaritmo natural de ambos os lados de `p ≈ 0,6185^(m/n)`:

```
m/n ≈ ln(p) / ln(0,6185) ≈ -1,44 · ln(p)
m ≈ -1,44 · n · ln(p)
```

## Exemplos Resolvidos

### Exemplo 1: calculando a taxa de falso positivo para um filtro concreto

**Problema:** Um filtro de Bloom tem `m = 10.000.000` bits, `k = 7` funções hash, e `n = 1.000.000` elementos inseridos. Estime a taxa de falso positivo.

**Cálculo:** `kn/m = 7 · 1.000.000 / 10.000.000 = 0,7`. Então `P(bit ainda 0) ≈ e^(-0,7) ≈ 0,4966`, o que significa `P(bit é 1) ≈ 0,5034`. A taxa de falso positivo é então `(0,5034)^7 ≈ 0,0082`, aproximadamente 0,82%, o que significa que cerca de 1 em cada 122 consultas para uma chave genuinamente ausente relataria incorretamente "possivelmente no conjunto".

### Exemplo 2: dimensionando um filtro para uma taxa de falso positivo alvo de 1% com 10 milhões de elementos

**Problema:** Um sistema espera inserir `n = 10.000.000` elementos e quer uma taxa de falso positivo de no máximo `p = 0,01` (1%). Determine `m` e `k`.

**Resolvendo para m:** `m ≈ -1,44 · n · ln(p) = -1,44 · 10.000.000 · ln(0,01) = -1,44 · 10.000.000 · (-4,605) ≈ 66.312.000` bits, cerca de 8,3 MB (66.312.000 / 8 bits por byte).

**Resolvendo para k:** `k_ótimo = (m/n) · ln(2) ≈ (66.312.000 / 10.000.000) · 0,693 ≈ 6,63 · 0,693 ≈ 4,6`, arredondado para `k = 5` (ou o inteiro prático mais próximo, comumente arredondado para baixo ou verificado tanto em 4 quanto em 5 para ver qual dá uma taxa mais próxima do alvo).

**Interpretação:** Aproximadamente 8,3 MB de memória e 5 funções hash dão cerca de 1% de taxa de falso positivo para 10 milhões de elementos, contra a memória muito maior que um conjunto real de 10 milhões de chaves (cada uma potencialmente com muitos bytes de comprimento) exigiria para ser armazenado diretamente, ilustrando exatamente a troca de espaço por certeza para a qual os conceitos de filtro de Bloom desta disciplina vêm construindo.

## Equívocos Comuns e Armadilhas

- **"Usar mais funções hash sempre torna um filtro de Bloom mais preciso."** O Exemplo 1 e a fórmula k_ótimo mostram que isso é falso além de um certo ponto: funções hash demais definem bits demais por inserção, preenchendo o array mais rápido e *aumentando* a taxa de falso positivo; existe um ótimo genuíno, `k = (m/n) · ln(2)`, não uma relação de "quanto mais melhor".
- **"A taxa de falso positivo depende principalmente de m e k, com n desempenhando um papel secundário."** A estrutura da fórmula (`kn/m` dentro do expoente) mostra que `n` é tão central quanto `m` e `k`; especificamente, é a *razão* `m/n` (bits orçados por elemento) que determina a taxa de falso positivo alcançável, que é exatamente por que o cálculo de dimensionamento do Exemplo 2 começa a partir de um `n` esperado antes de escolher `m`.
- **"Uma taxa de falso positivo de 1% significa que exatamente 1 em cada 100 consultas do mundo real estará errada."** A fórmula dá a probabilidade para uma consulta sobre uma chave que genuinamente nunca foi inserida; se a maioria das consultas na prática são para chaves que *foram* inseridas (que nunca produzem falsos positivos, conforme o conceito anterior), a taxa de erro real observada no mundo real através de todas as consultas pode ser consideravelmente menor do que a porcentagem de destaque da fórmula sugere.
- **"Já que essa derivação usa aproximações, a fórmula não é confiável para design de sistemas reais."** As aproximações (tratar saídas de hash como independentes, usar `e^(-1)` no lugar de `(1-1/m)^m`) são padrão e bem validadas contra cálculos exatos e medição empírica para `m` e `n` realistas; sistemas em produção (bancos de dados, roteadores de rede, navegadores) dimensionam filtros de Bloom reais usando exatamente essa fórmula.

## Resumo

Um único bit permanece 0 depois de `n` inserções com `k` funções hash cada com probabilidade aproximadamente `e^(-kn/m)`, e um falso positivo exige que todas as `k` posições de bit de uma chave consultada sejam 1 simultaneamente, dando uma taxa de falso positivo de aproximadamente `(1 - e^(-kn/m))^k`. Minimizar isso sobre `k` para uma razão de bits por elemento `m/n` fixa dá o ótimo limpo `k = (m/n) · ln(2)`, no qual a taxa de falso positivo se simplifica para aproximadamente `0,6185^(m/n)`, encolhendo exponencialmente conforme mais bits por elemento são alocados. Isso transforma o design de filtro de Bloom em aritmética simples: escolha uma taxa de falso positivo alvo e uma contagem de elementos esperada, resolva para o `m` necessário, e derive `k` a partir da fórmula de k ótimo, exatamente como o Exemplo 2 trabalha para um cenário concreto de 10 milhões de elementos com alvo de 1%. Isso encerra o arco desta disciplina através de estruturas baseadas em hash: de tabelas hash comuns (respostas certas, desempenho limitado por colisão) passando por hashing universal (respostas certas, desempenho resistente a adversário) e hashing perfeito (respostas certas, zero colisões para conjuntos estáticos) até filtros de Bloom (respostas incertas de "talvez", mas a um custo pequeno, precisamente quantificável e controlável, em troca de espaço que nenhuma estrutura exata consegue igualar).

## Documentation Links

- [Bloom, B. H. (1970). "Space/Time Trade-offs in Hash Coding with Allowable Errors." Communications of the ACM.](https://dl.acm.org/doi/10.1145/362686.362692): paper
- [MIT 6.006 - Lecture Notes (OCW)](https://ocw.mit.edu/courses/6-006-introduction-to-algorithms-spring-2020/pages/lecture-notes/): doc
