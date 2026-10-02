---
version: 1.0
updatedAt: 2026-09-06
title: A Troca Viés-Variância
summary: Decompor o erro de previsão de um modelo em duas fontes concorrentes (o viés, de um modelo simples demais para capturar o padrão verdadeiro, e a variância, de um modelo tão flexível que ajusta o ruído), com uma decomposição numérica real resolvida, e não só a história qualitativa.
---
## Objetivos de Aprendizagem

- Enunciar a decomposição viés-variância do erro de previsão esperado e definir viés e variância com precisão, e não só qualitativamente.
- Explicar por que um modelo simples demais para o padrão verdadeiro tem viés alto e por que um modelo flexível demais tem variância alta.
- Calcular uma decomposição viés-variância concreta e numérica num pequeno exemplo resolvido.
- Explicar por que reduzir o viés e reduzir a variância em geral estão em tensão e ligar isso diretamente à complexidade do modelo.

## Contexto e Motivação

Todo modelo visto até agora nesta disciplina (regressão linear, regressão logística, GDA, Naive Bayes) tem um nível fixo de flexibilidade embutido na sua forma. Este conceito faz uma pergunta que vale igualmente para todos eles: diante da escolha entre um modelo simples e um mais flexível, qual de fato generaliza melhor? O curso "Learning From Data" do Caltech dedica uma aula inteira exatamente a essa pergunta, enquadrada como uma decomposição formal do erro de previsão em duas fontes distintas e concorrentes, em vez de um apelo vago a "não sofrer overfitting".

Essa decomposição é o fundamento conceitual de quase toda técnica prática do restante do bloco de complexidade de modelos e avaliação desta disciplina: a regularização, a validação cruzada e a escolha entre famílias de modelos simples e complexas existem todas por causa da tensão que este conceito torna precisa.

## Teoria Central

### A decomposição

Para um modelo treinado com amostras aleatórias de dados de treino, o erro quadrático de previsão esperado num ponto de teste fixo, em média sobre muitos conjuntos de treino possíveis, se decompõe em três termos:

```text
Erro Esperado = Viés² + Variância + Ruído Irredutível
```

- O **viés** é o erro que vem de as próprias suposições do modelo estarem erradas: um modelo linear tentando ajustar uma relação genuinamente curva vai errá-la sistematicamente, por mais dados de treino que receba. O viés é alto quando a classe de modelos é simples demais para representar o padrão verdadeiro.
- A **variância** é o erro que vem da sensibilidade do modelo a qual amostra de treino específica ele viu: um modelo altamente flexível pode ajustar curvas muito diferentes dependendo de qual amostra ruidosa de pontos usou no treino, mesmo que a relação verdadeira subjacente nunca mude. A variância é alta quando a classe de modelos é tão flexível que ajusta o ruído de cada amostra específica, e não só o sinal.
- O **ruído irredutível** é o erro que vem da aleatoriedade inerente aos próprios dados, que nenhum modelo, por mais bem escolhido, consegue eliminar.

### Por que as duas fontes se equilibram uma contra a outra

Reduzir o viés em geral significa usar um modelo mais flexível (mais features, um polinômio de grau maior, uma árvore de decisão mais profunda), mas um modelo mais flexível tem mais capacidade de ajustar o ruído específico da amostra de treino que receber, o que aumenta a variância. Inversamente, reduzir a variância escolhendo um modelo mais simples e mais restrito aumenta o viés, porque o modelo mais simples pode ser estruturalmente incapaz de capturar a relação verdadeira, não importa quantos dados veja. Essa é a **troca viés-variância**: o erro esperado total é minimizado não levando o viés ou a variância a zero individualmente, e sim encontrando a complexidade de modelo que equilibra os dois.

### Ligando a overfitting e underfitting

Um modelo com viés alto e variância baixa sofre **underfitting**: é simples demais e tem desempenho ruim até nos próprios dados de treino. Um modelo com viés baixo e variância alta sofre **overfitting**: tem desempenho muito bom nos seus dados de treino, mas ruim em dados novos, porque ajustou o ruído específico daquela amostra em vez do padrão subjacente verdadeiro. O próximo conceito desta disciplina, a dimensão VC, dá uma forma precisa e quantitativa de medir quanta capacidade de overfitting uma classe de modelos tem, antes mesmo de ajustá-la a dados reais.

## Exemplos Resolvidos

### Exemplo 1: uma decomposição viés-variância numérica

Suponha que a relação verdadeira seja `y = 3 + 2x` mais ruído com variância 1, e que três classes de modelos sejam comparadas ajustando cada uma a muitos conjuntos de treino sorteados de forma independente e tirando a média das previsões em `x = 5` (valor verdadeiro: `3 + 2(5) = 13`):

```text
Modelo A (constante, ŷ = c): previsão média 10.0 entre muitos conjuntos de treino, a previsão varia pouco (9.8 a 10.2)
   Viés² = (13 − 10.0)² = 9.0        Variância ≈ 0.04       Total ≈ 9.04 (dominado pelo viés)

Modelo B (linear, ŷ = θ₀+θ₁x): previsão média 13.0, a previsão varia um pouco (12.7 a 13.3)
   Viés² = (13 − 13.0)² = 0.0        Variância ≈ 0.09       Total ≈ 0.09 (bem equilibrado)

Modelo C (polinômio de grau 9): previsão média 13.0, a previsão varia muito (8.0 a 18.0)
   Viés² = (13 − 13.0)² = 0.0        Variância ≈ 9.0        Total ≈ 9.0 (dominado pela variância)
```

O Modelo A sofre underfitting (viés sistemático por supor nenhuma inclinação); o Modelo C sofre overfitting (correto em média, mas muito pouco confiável em cada amostra); o Modelo B, que corresponde à forma linear verdadeira, atinge ao mesmo tempo viés baixo e variância baixa, o menor erro total dos três.

### Exemplo 2: o mesmo erro total, causas opostas

Repare que os Modelos A e C do Exemplo 1 chegam ambos perto de um erro esperado total de ~9, apesar de errarem por motivos opostos: o Modelo A é rígido demais (viés alto, variância baixa) e o Modelo C é flexível demais (viés baixo, variância alta). Essa é a ilustração concreta de por que "o erro total é baixo" sozinho não diagnostica o problema; decompô-lo nos componentes de viés e variância diz qual direção (simplificar, ou acrescentar mais dados/regularizar) é a correção certa.

## Equívocos Comuns e Armadilhas

- **"Um modelo com erro de treino baixo é um bom modelo."** Um erro de treino baixo indica viés baixo naquela amostra específica, mas não diz nada sobre a variância. O Modelo C do Exemplo 1 pode atingir erro de treino quase zero e ter desempenho péssimo em dados novos, exatamente o cenário de overfitting que essa decomposição foi feita para diagnosticar.
- **"Mais dados de treino sempre resolvem o overfitting."** Mais dados reduzem especificamente a variância (um modelo flexível tem menos espaço para ajustar ruído quando o ruído é diluído em mais exemplos), mas não fazem nada para reduzir o viés. Um modelo com underfitting que recebe mais dados continua igualmente enviesado, já que sua suposição estrutural sobre a forma da relação nunca muda.
- **"Viés e variância são propriedades dos dados, e não do modelo."** Eles são propriedades da *combinação* de uma classe de modelos com o processo que gera os dados. O mesmo conjunto de dados pode ser ajustado por um modelo de viés alto (uma constante) ou um de variância alta (um polinômio de grau 20); viés e variância descrevem como uma classe de modelos escolhida responde àqueles dados, e não uma propriedade intrínseca só dos dados.

## Resumo

O erro de previsão esperado se decompõe em viés (erro sistemático de um modelo simples demais para representar a relação verdadeira), variância (erro da sensibilidade a qual amostra de treino específica foi vista) e ruído irredutível. Reduzir um em geral aumenta o outro (simplificar um modelo reduz a variância mas aumenta o viés, e vice-versa), então o objetivo prático não é eliminar nenhum dos termos individualmente, e sim escolher a complexidade de modelo que minimiza a soma deles. Essa tensão é o fundamento conceitual das técnicas de dimensão VC, regularização e validação cruzada que vêm a seguir no bloco de complexidade de modelos desta disciplina.

## Documentation Links

- [Caltech CS 156: Learning From Data, Lecture 8: Bias-Variance Tradeoff](https://work.caltech.edu/telecourse.html): a aula real de onde vêm essa decomposição e seu enquadramento por curvas de aprendizado.
- [James, Witten, Hastie & Tibshirani: An Introduction to Statistical Learning](https://www.statlearning.com/): o Capítulo 2 apresenta a mesma decomposição com gráficos reais de curvas de aprendizado.
