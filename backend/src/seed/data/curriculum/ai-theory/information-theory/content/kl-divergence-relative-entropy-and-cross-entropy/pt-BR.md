---
version: 1.0
updatedAt: 2026-09-07
title: Divergência KL, Entropia Relativa e Entropia Cruzada
summary: A divergência KL D(p‖q) é derivada como o número esperado de bits extras pagos por codificar dados de p com um código feito para q (resolvido concretamente com duas moedas de vieses diferentes), e sua não negatividade (desigualdade de Gibbs) é provada pela desigualdade de Jensen; a entropia cruzada H(p,q) = H(p) + D(p‖q) é então identificada como exatamente a perda que `softmax-and-cross-entropy-loss` de `deep-learning` derivou de forma independente e autocontida, fechando o ciclo que aquele conceito deixou aberto de propósito.
---
## Objetivos de Aprendizagem

- Definir a divergência KL D(p‖q) como o número esperado de bits extras pagos por codificar dados de p usando um código otimizado para q.
- Provar a desigualdade de Gibbs (D(p‖q) ≥ 0, com igualdade se e somente se p = q) pela desigualdade de Jensen.
- Definir a entropia cruzada H(p,q) e derivar a identidade H(p,q) = H(p) + D(p‖q).
- Ligar a entropia cruzada diretamente a `softmax-and-cross-entropy-loss` de `deep-learning`, mostrando que ela é exatamente a H(p,q) definida aqui entre a distribuição verdadeira dos rótulos e a distribuição prevista pelo modelo.
- Explicar por que D(p‖q) não é uma métrica de distância, apesar de informalmente ser chamada de "divergência".

## Contexto e Motivação

A entropia H(X) responde "quantos bits, em média, descrever X realmente exige, dada sua distribuição real?". Uma pergunta muito próxima e igualmente importante é: o que acontece se o código usado não corresponde bem à realidade, se ele foi feito supondo a distribuição `q`, mas os dados na verdade vêm da distribuição `p`? Essa não é uma preocupação hipotética: é *exatamente* a situação em que todo classificador em treinamento está antes de convergir. A distribuição prevista pelo modelo `q` é só uma aproximação da distribuição verdadeira dos rótulos `p`, e a perda de treinamento precisa medir com precisão, em bits, quão errada essa aproximação está.

`softmax-and-cross-entropy-loss` de `ai-theory/deep-learning` derivou a perda de entropia cruzada inteiramente por conta própria, via máxima verossimilhança, observando explicitamente na época que estava adiando "o tratamento teórico-informacional mais completo (divergência KL, entropia)" para uma disciplina futura. Esta é essa disciplina, e este é esse conceito. Tudo o que é derivado aqui sobre entropia cruzada é compatível com o que aquele conceito anterior já estabeleceu por outro ângulo, e o explica diretamente.

## Teoria Central

### Divergência KL: o custo de usar o código errado

Dadas duas distribuições de probabilidade `p` e `q` sobre o mesmo alfabeto, a **divergência de Kullback-Leibler (KL)**, também chamada de **entropia relativa**, é definida como:

```text
D(p‖q) = ∑ₓ p(x)·log₂( p(x) / q(x) )
```

Para ver por que isso é "os bits extras esperados pagos por usar o código de q nos dados de p": lembre de `the-source-coding-theorem` (alguns conceitos adiante, mas a intuição já pode ser enunciada) que um código ótimo para uma distribuição `r` atribui cerca de `−log₂r(x)` bits ao resultado `x`. Se a distribuição *verdadeira* é `p` mas o código foi feito supondo `q`, o resultado `x` (que de fato ocorre com probabilidade `p(x)`) é codificado com `−log₂q(x)` bits, em vez dos `−log₂p(x)` bits que receberia no código ótimo da sua própria distribuição verdadeira. O número esperado de bits efetivamente usados é `∑ₓ p(x)·(−log₂q(x))` (exatamente a entropia cruzada, definida formalmente abaixo), e o número esperado de bits que *teriam* sido usados com o código correto é `H(p) = ∑ₓ p(x)·(−log₂p(x))`. A diferença entre os dois é precisamente `D(p‖q)`:

```text
D(p‖q) = ∑ₓ p(x)·(−log₂q(x)) − ∑ₓ p(x)·(−log₂p(x)) = ∑ₓ p(x)·log₂(p(x)/q(x))
```

ou seja, o número médio de bits *extras*, desperdiçados, gastos especificamente porque o código foi otimizado para a distribuição errada.

### Desigualdade de Gibbs: D(p‖q) ≥ 0, provada pela desigualdade de Jensen

**Afirmação.** Para quaisquer duas distribuições `p`, `q` sobre o mesmo alfabeto, `D(p‖q) ≥ 0`, com igualdade se e somente se `p = q` em todo ponto.

**Prova.** Escreva `D(p‖q) = −∑ₓ p(x)·log₂(q(x)/p(x))` (somando só sobre os `x` com `p(x) > 0`, a convenção padrão). Como `−log₂` é uma função convexa, a desigualdade de Jensen dá `∑ₓ p(x)·(−log₂(q(x)/p(x))) ≥ −log₂(∑ₓ p(x)·q(x)/p(x))`. O lado direito se simplifica: `∑ₓ p(x)·q(x)/p(x) = ∑ₓ q(x) ≤ 1` (somando `q` só sobre os `x` em que `p(x) > 0`, o que é no máximo o suporte inteiro de `q`, então a soma é no máximo 1). Como `−log₂` é decrescente, `−log₂(∑ₓ q(x)) ≥ −log₂(1) = 0`. Encadeando as duas desigualdades: `D(p‖q) ≥ −log₂(1) = 0`. A desigualdade de Jensen é uma igualdade exatamente quando a função convexa é aplicada a um valor que não varia entre os termos ponderados; aqui, exatamente quando `q(x)/p(x)` é constante para todo `x` com `p(x) > 0`, o que, combinado com as duas serem distribuições válidas que somam 1, força `p(x) = q(x)` para todo `x`. ∎

É o mesmo estilo de argumento com a desigualdade de Jensen já usado em `entropy-the-expected-information-content` para limitar a entropia superiormente por `log₂n`: a desigualdade de Jensen, aplicada ao logaritmo côncavo ou convexo, é a técnica de prova única por trás de quase todas as desigualdades fundamentais desta disciplina.

### Entropia cruzada

A **entropia cruzada** entre `p` e `q` é definida diretamente a partir da quantidade identificada acima como "bits esperados efetivamente usados com o código errado":

```text
H(p,q) = −∑ₓ p(x)·log₂ q(x)
```

Rearranjar a definição da divergência KL dá a identidade que liga as três quantidades:

```text
H(p,q) = H(p) + D(p‖q)
```

Como `D(p‖q) ≥ 0` (a desigualdade de Gibbs recém-provada), essa identidade mostra imediatamente que `H(p,q) ≥ H(p)` sempre: a entropia cruzada nunca pode ser *menor* que a entropia verdadeira, com igualdade exatamente quando `q = p` (o código já é ótimo, então não há bits desperdiçados).

### Fechando o ciclo: a perda de entropia cruzada é exatamente H(p,q)

`softmax-and-cross-entropy-loss` de `ai-theory/deep-learning` derivou, via máxima verossimilhança, a perda `L = −log(softmax(z)_y)` para um único exemplo de treinamento com rótulo verdadeiro `y`. Essa derivação trata implicitamente o rótulo verdadeiro como uma **distribuição one-hot** `p`: `p(y) = 1` para a classe verdadeira e `p(x) = 0` para toda outra classe `x`. Substituindo esse `p` na fórmula de entropia cruzada acima, com `q = softmax(z)` como a distribuição prevista pelo modelo:

```text
H(p,q) = −∑ₓ p(x)·log₂q(x) = −1·log₂q(y) − ∑_{x≠y} 0·log₂q(x) = −log₂ q(y) = −log₂ softmax(z)_y
```

Essa é exatamente a perda de entropia cruzada de `deep-learning` (a menos da base do logaritmo: frameworks de deep learning usam por convenção o logaritmo natural em vez da base 2, o que só reescala a perda pela constante `ln(2)` e não muda nenhuma direção de gradiente nem comportamento de otimização). A perda que aquele conceito derivou de forma independente via máxima verossimilhança é, precisamente, a entropia cruzada `H(p,q)` entre a distribuição one-hot verdadeira dos rótulos e a distribuição prevista pelo modelo. E, pela identidade acima, `H(p,q) = H(p) + D(p‖q) = 0 + D(p‖q) = D(p‖q)`, já que uma distribuição one-hot tem entropia zero (`H(p) = 0`, coincidindo com o resultado de `entropy-the-expected-information-content` de que variáveis determinísticas têm entropia zero). Então treinar um classificador minimizando a perda de entropia cruzada é, exatamente, minimizar a divergência KL entre os rótulos verdadeiros e as previsões do modelo: levar a distribuição prevista o mais perto possível, em bits, da verdadeira.

## Exemplos Resolvidos

### Exemplo 1: divergência KL entre duas moedas viciadas

Sejam `p(cara) = 0.9, p(coroa) = 0.1` (a moeda verdadeira) e `q(cara) = 0.5, q(coroa) = 0.5` (uma moeda justa suposta erroneamente).

```text
D(p‖q) = 0.9·log₂(0.9/0.5) + 0.1·log₂(0.1/0.5)
       = 0.9·log₂(1.8) + 0.1·log₂(0.2)
       = 0.9·(0.848) + 0.1·(−2.322)
       = 0.763 − 0.232
       = 0.531 bits
```

Usar um código de moeda justa nesta moeda fortemente viciada desperdiça, em média, cerca de 0.531 bit extra por lançamento em comparação com o código ótimo para a distribuição verdadeira.

### Exemplo 2: conferindo a identidade H(p,q) = H(p) + D(p‖q)

Usando os mesmos `p` e `q` do Exemplo 1: `H(p) = −(0.9·log₂0.9 + 0.1·log₂0.1) ≈ 0.469` bits (coincidindo exatamente com o Exemplo 1 de `entropy-the-expected-information-content`, já que é a mesma moeda viciada). Entropia cruzada direta: `H(p,q) = −(0.9·log₂0.5 + 0.1·log₂0.5) = −(0.9·(−1) + 0.1·(−1)) = 1` bit (usar um código de moeda justa sempre custa exatamente 1 bit por símbolo, qualquer que seja a distribuição verdadeira, já que `q` é uniforme). Conferindo: `H(p) + D(p‖q) = 0.469 + 0.531 = 1.0` bit, igual exatamente a `H(p,q) = 1`.

### Exemplo 3: perda de entropia cruzada numa previsão concreta de 3 classes, coincidindo exatamente com `deep-learning`

Reaproveitando os números exatos do Exemplo 1 de `softmax-and-cross-entropy-loss`: rótulo verdadeiro `y = 0` (one-hot `p = (1, 0, 0)`), previsão `q = softmax(z) ≈ (0.659, 0.242, 0.099)`.

```text
H(p,q) = −(1·log₂0.659 + 0·log₂0.242 + 0·log₂0.099) = −log₂(0.659) ≈ 0.602 bits
```

Convertendo para logaritmo natural (como `deep-learning` usou): `0.602 bits × ln(2) ≈ 0.602 × 0.693 ≈ 0.417 nats`, coincidindo exatamente com a perda calculada em `softmax-and-cross-entropy-loss`, `≈ 0.417` (aquele conceito trabalhou com logaritmo natural o tempo todo, este com base 2; os dois números diferem só pelo fator constante de conversão `ln(2)` de `information-content-and-self-information`). As derivações dos dois conceitos (uma via máxima verossimilhança, outra via entropia cruzada teórico-informacional) chegam à mesma função de perda, confirmando que sempre descreveram a mesma quantidade por dois ângulos diferentes e igualmente válidos.

## Equívocos Comuns e Armadilhas

- **"A divergência KL é uma métrica de distância entre distribuições, como a distância euclidiana."** D(p‖q) não é simétrica em geral (D(p‖q) ≠ D(q‖p), exceto em casos especiais) e não satisfaz a desigualdade triangular. Chamá-la de "divergência" em vez de "distância" é deliberado: ela mede um custo direcional (codificar os dados de p com o código de q), não uma noção simétrica de proximidade.
- **"Entropia cruzada e divergência KL são basicamente a mesma coisa, então não importa qual delas é minimizada no treinamento."** Elas diferem exatamente por H(p), a entropia da distribuição verdadeira dos rótulos. Quando p é uma distribuição one-hot fixa (como em classificação com rótulos rígidos), H(p) = 0 é uma constante sem gradiente em relação aos parâmetros do modelo, então minimizar H(p,q) e minimizar D(p‖q) são problemas de otimização equivalentes nesse caso específico. Mas essa equivalência depende de H(p) ser constante, o que não vale em geral (por exemplo, com rótulos suaves/suavizados, em que H(p) > 0 e os dois objetivos diferem por essa constante não nula).
- **"A desigualdade de Gibbs só vale aproximadamente, ou só para distribuições 'bem-comportadas'."** A prova na Teoria Central é uma prova completa e geral para quaisquer duas distribuições de probabilidade discretas válidas sobre o mesmo alfabeto; não é uma aproximação nem um resultado de caso especial. É exatamente por isso que a entropia cruzada pode ser usada com total confiança como perda de treinamento: ela é comprovadamente limitada inferiormente pela entropia verdadeira e só pode diminuir conforme a distribuição prevista melhora.

## Resumo

A divergência KL D(p‖q) = ∑ₓp(x)log₂(p(x)/q(x)) mede os bits extras esperados pagos por codificar dados da distribuição verdadeira p com um código feito para uma distribuição diferente q, e a desigualdade de Gibbs (provada aqui pela desigualdade de Jensen aplicada ao convexo −log₂, a mesma técnica usada para limitar a entropia no conceito anterior) garante D(p‖q) ≥ 0 sempre, com igualdade exatamente quando p = q. A entropia cruzada H(p,q) = H(p) + D(p‖q) é o total esperado de bits efetivamente usados com o código descasado, e substituir uma distribuição one-hot de rótulo verdadeiro nessa fórmula reproduz, exatamente, a perda de entropia cruzada que `softmax-and-cross-entropy-loss` de `deep-learning` derivou de forma independente via máxima verossimilhança. Isso fecha o ciclo que aquele conceito deixou aberto de propósito e confirma que treinar um classificador minimizando a perda de entropia cruzada é precisamente minimizar a divergência KL entre os rótulos verdadeiros e as previsões do modelo.

## Documentation Links

- [Stanford EE276: Course Outline](https://web.stanford.edu/class/ee276/outline.html): doc
- [Shannon: A Mathematical Theory of Communication (1948)](https://people.math.harvard.edu/~ctm/home/text/others/shannon/entropy/entropy.pdf): doc
