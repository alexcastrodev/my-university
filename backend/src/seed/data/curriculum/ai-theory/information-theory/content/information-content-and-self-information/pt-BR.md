---
version: 1.0
updatedAt: 2026-09-07
title: Conteúdo de Informação e Autoinformação
summary: Define a autoinformação de Shannon I(x) = −log₂p(x), a medida baseada em logaritmo de quão surpreendente é um único resultado, e deriva por que o logaritmo (aditivo entre eventos independentes e coerente com a intuição de que resultados mais raros carregam mais informação) é a única medida com as propriedades que Shannon exigiu, e não uma escolha arbitrária.
---
## Objetivos de Aprendizagem

- Definir a autoinformação I(x) = −log₂p(x) para um único resultado de uma variável aleatória discreta.
- Derivar, a partir de um pequeno conjunto de exigências naturais, por que o logaritmo é a única função que pode servir como medida de informação.
- Explicar por que a base 2 é escolhida (a unidade resultante, o bit) e como trocar de base apenas reescala a mesma quantidade.
- Calcular a autoinformação à mão para resultados de probabilidades variadas e explicar intuitivamente a ordenação resultante.

## Contexto e Motivação

O conceito anterior mostrou, por pura contagem, que a compressibilidade tem um teto matemático rígido. Ir além disso (dizer não só "a compressão é limitada", mas "a compressão é limitada a *exatamente esta quantidade de bits*") exige uma forma de quantificar quanta informação um único resultado de fato carrega. O artigo de Shannon de 1948 faz exatamente essa pergunta logo na abertura: se uma mensagem é escolhida de um conjunto de mensagens possíveis, como "a quantidade de informação produzida por essa escolha" deveria ser medida? Este conceito percorre a própria resposta de Shannon, que acaba sendo imposta quase por completo por uma pequena lista de propriedades que qualquer medida razoável de informação deveria ter: o logaritmo não é escolhido por ser conveniente, e sim por ser a única função que satisfaz essas propriedades.

Este é o bloco de construção atômico para o resto da disciplina: a entropia (o próximo conceito) não é nada mais que o valor *esperado* exatamente da quantidade definida aqui, aplicada a uma distribuição de probabilidade inteira em vez de um único resultado.

## Teoria Central

### A intuição: resultados mais raros carregam mais informação

Considere ser informado do resultado de dois eventos diferentes: "o sol nasceu hoje de manhã" (probabilidade essencialmente 1) versus "você acabou de ganhar na loteria" (probabilidade minúscula). O primeiro não diz quase nada que você já não esperasse; o segundo é enormemente informativo, justamente por ser tão improvável. Isso sugere que o conteúdo de informação deveria ser uma função *decrescente* da probabilidade: `I(x)` deveria ser grande quando `p(x)` é pequena, e `I(x) = 0` quando `p(x) = 1` (um resultado do qual você já tinha certeza não carrega nenhuma informação nova).

### Por que especificamente o logaritmo

Shannon exigiu mais uma propriedade além de "decrescente na probabilidade": **aditividade para eventos independentes**. Se `x` e `y` são resultados de dois eventos independentes, saber os dois deveria dar exatamente a soma da informação que cada um dá individualmente, `I(x, y) = I(x) + I(y)`: como saber de um evento não diz nada sobre o outro, não deveria haver "desconto" nem "bônus" por sabê-los juntos. Mas, para eventos independentes, `p(x, y) = p(x)·p(y)` (consequência direta da independência, já estabelecida em `discrete-random-variables-and-pmfs`). A única classe de funções que transforma um *produto* de probabilidades numa *soma* de valores de informação é o logaritmo: `log(p(x)·p(y)) = log(p(x)) + log(p(y))`. Combinado com "decrescente na probabilidade" (então é preciso um sinal negativo, já que `log(p)` é negativo para `p < 1` e diminui conforme `p` diminui em direção a 0) e com a normalização `I(x) = 0` quando `p(x) = 1` (satisfeita automaticamente, já que `log(1) = 0`), isso determina a medida de forma única, a menos da escolha da base do logaritmo:

```text
I(x) = −log_b(p(x))
```

### Escolhendo a base: bits

A base `b` apenas reescala a unidade, exatamente como escolher metros ou pés reescala um comprimento sem mudar o que "comprimento" significa. O artigo de Shannon adota explicitamente a base 2, chamando a unidade resultante de **bit** (termo sugerido por Tukey), escolhida por corresponder à unidade física mais natural de armazenamento de informação: um único dispositivo binário (um interruptor, um flip-flop, um bit de memória) tem exatamente 2 estados possíveis, e `log₂(2) = 1`, então o conteúdo de informação de um resultado com probabilidade exatamente `1/2` (um único lançamento de moeda justa) é exatamente 1 bit. Converter entre bases é um puro reescalonamento: `log₂(p) = ln(p) / ln(2) = log₁₀(p) / log₁₀(2)`, então trocar do logaritmo natural ("nats") ou da base 10 ("dits"/"Hartleys") para bits apenas multiplica por uma constante fixa, sem nunca mudar a forma da medida nem quais resultados carregam mais informação que outros.

```text
I(x) = −log₂ p(x)   (bits)
```

### Propriedades que saem imediatamente

- **I(x) ≥ 0 sempre**, já que `p(x) ∈ (0, 1]` implica `log₂p(x) ≤ 0`, então `−log₂p(x) ≥ 0`: o conteúdo de informação nunca é negativo.
- **I(x) = 0 exatamente quando p(x) = 1**: um resultado certo não carrega informação, de acordo exato com a intuição.
- **I(x) → ∞ quando p(x) → 0**: um resultado considerado essencialmente impossível, se mesmo assim acontecer, carrega um conteúdo de informação ilimitadamente grande.
- **I é estritamente decrescente em p(x)**: resultados mais raros sempre carregam estritamente mais informação que os mais comuns, sem exceções.

## Exemplos Resolvidos

### Exemplo 1: uma moeda justa vs. uma moeda viciada

Para uma moeda justa, `p(cara) = 0.5`, então `I(cara) = −log₂(0.5) = −(−1) = 1` bit, coincidindo exatamente com a escolha de unidade acima. Para uma moeda fortemente viciada com `p(cara) = 0.9`: `I(cara) = −log₂(0.9) ≈ −(−0.152) = 0.152` bits; observar o resultado muito mais provável carrega bem menos informação. Para o resultado mais raro da mesma moeda viciada, `p(coroa) = 0.1`: `I(coroa) = −log₂(0.1) ≈ 3.322` bits, mais de 20× a informação de observar cara na mesma moeda, refletindo exatamente quanto coroa é mais surpreendente.

### Exemplo 2: um dado justo de 8 faces

Cada face tem probabilidade `p = 1/8`. `I(qualquer face) = −log₂(1/8) = −log₂(2^−3) = 3` bits. Isso coincide com a leitura intuitiva de informação como "quantas perguntas de sim/não são necessárias para determinar o resultado": três perguntas binárias bem escolhidas (é ≤ 4? está na metade correta disso? é o maior ou o menor dos dois restantes?) sempre bastam para identificar um entre 8 resultados igualmente prováveis, e `3 = log₂(8)` exatamente.

### Exemplo 3: autoinformação de um evento raro, com um exemplo numérico real

Uma estação meteorológica registra "sem chuva" em 95% dos dias e "chuva" em 5% dos dias. Saber que é um dia "sem chuva": `I = −log₂(0.95) ≈ −(−0.074) = 0.074` bits, quase nenhuma informação, já que era quase certo de qualquer forma. Saber que é um dia de "chuva": `I = −log₂(0.05) ≈ −(−4.322) = 4.322` bits, quase 60× mais informação vinda do registro mais raro, quantificando com precisão a sensação cotidiana de que "choveu hoje" é mais notícia que "não choveu".

## Equívocos Comuns e Armadilhas

- **"A autoinformação mede quão significativo ou útil um resultado é."** Ela mede apenas quão *estatisticamente surpreendente* o resultado foi, dada a distribuição de probabilidade assumida. Uma sequência rara e totalmente sem sentido de caracteres aleatórios tem autoinformação alta apesar de não carregar conteúdo semântico algum, e o arcabouço de Shannon é explícito ao excluir deliberadamente o significado semântico dessa medida.
- **"Um sinal negativo na fórmula significa que a informação pode ser negativa."** O sinal negativo existe precisamente para *cancelar* o fato de que `log₂p(x)` é negativo para qualquer probabilidade menor que 1; a quantidade final `I(x) = −log₂p(x)` é sempre não negativa, nunca negativa, como mostrado na Teoria Central.
- **"A base 2 do logaritmo é a escolha matematicamente 'correta' e as outras bases estão erradas."** Qualquer base de logaritmo dá uma medida de informação válida e internamente consistente. A base 2 (bits) é simplesmente a escolha convencional e mais útil na prática, coerente com os dispositivos binários usados para armazenar e transmitir informação; trocar de base apenas reescala todos os valores pelo mesmo fator constante e não muda nenhuma comparação ou ordenação entre resultados.

## Resumo

A autoinformação I(x) = −log₂p(x) quantifica quão surpreendente é um único resultado, e o logaritmo não é uma escolha arbitrária: é a única função (a menos da escolha da base) que satisfaz as exigências naturais de que o conteúdo de informação diminua com a probabilidade e se some corretamente entre eventos independentes, já que só o logaritmo converte o produto de probabilidades independentes numa soma de valores de informação. A base 2 dá o bit como unidade, escolhido por corresponder a dispositivos de armazenamento binários, com um lançamento de moeda justa carregando exatamente 1 bit por construção. Essa quantidade de um único resultado é o ingrediente atômico sobre o qual o próximo conceito, a entropia, se constrói diretamente: a entropia não é nada mais que o valor esperado da autoinformação ao longo de uma distribuição inteira.

## Documentation Links

- [Shannon: A Mathematical Theory of Communication (1948)](https://people.math.harvard.edu/~ctm/home/text/others/shannon/entropy/entropy.pdf): doc
- [Stanford EE276 (formerly EE376A): Reading List](https://web.stanford.edu/class/ee376a/reading.html): doc
