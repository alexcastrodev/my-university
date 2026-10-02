---
version: 1.0
updatedAt: 2026-09-06
title: Teoria da Utilidade e Preferências Racionais
summary: Dadas crenças como probabilidades e preferências como uma função de utilidade, o princípio da utilidade esperada máxima diz que um agente racional deve escolher a ação cujo retorno médio ponderado pela probabilidade é o maior. É uma única regra de decisão que engloba escolhas com e sem incerteza como casos especiais.
---
## Objetivos de Aprendizagem

- Explicar por que maximizar o valor monetário esperado nem sempre é o mesmo que tomar decisões racionais, e o que a teoria da utilidade acrescenta para corrigir isso.
- Enunciar os axiomas da preferência racional (completude, transitividade e os demais) e explicar por que um agente que os viola pode ser explorado.
- Definir o princípio da utilidade esperada máxima (MEU) como a regra de decisão que generaliza o que foi presumido implicitamente em toda a busca adversarial e no expectimax.
- Distinguir funções de utilidade avessas ao risco, neutras ao risco e propensas ao risco, e calcular a utilidade esperada de uma pequena decisão sob cada uma.
- Explicar como a teoria da utilidade conecta o raciocínio probabilístico recém-visto (redes bayesianas, HMMs) à tomada de decisão sequencial vista nos próximos dois conceitos.

## Contexto e Motivação

O expectimax, visto no início desta disciplina, já calculava valores esperados em nós de acaso, mas presumia implicitamente que o retorno numérico bruto (pontos, dinheiro) *era* a coisa certa a maximizar. Este conceito explicita uma premissa que até agora ficou sem ser dita: um agente racional deve maximizar a **utilidade** esperada, e não necessariamente o retorno bruto esperado, e as duas coisas nem sempre coincidem. Uma pessoa que recebe a oferta de escolher entre \$1.000 garantidos ou 50% de chance de ganhar \$2.100 tem mais ou menos o mesmo valor monetário esperado nos dois casos, mas a maioria das pessoas, com toda razão, ficaria com o valor garantido; não por ser irracional, mas porque a *utilidade* do dinheiro (quanto um resultado de fato vale para quem o recebe) não cresce linearmente com o valor bruto em reais ou dólares.

A **teoria da utilidade** formaliza exatamente essa distinção, e o **princípio da utilidade esperada máxima** que ela estabelece é a única regra de decisão em direção à qual esta disciplina inteira vinha construindo implicitamente: ele engloba a tomada de decisão determinística (sem incerteza, a teoria da utilidade se reduz a simplesmente escolher o melhor resultado) e é exatamente a versão generalizada do que o expectimax já calculava em nós de acaso, agora explicitada como o objetivo correto, e não como uma premissa não declarada. É também o conceito que conecta o material de raciocínio probabilístico recém-visto (redes bayesianas, HMMs, que calculam crenças) à tomada de decisão sequencial vista nos próximos dois conceitos (processos de decisão de Markov, que agem com base nessas crenças ao longo do tempo).

## Teoria Central

### Por que maximizar o valor esperado nem sempre é racional

Considere duas opções: a Opção A garante \$1.000; a Opção B oferece 50% de chance de \$2.100 e 50% de chance de \$0. O valor monetário esperado de B (\$1.050) é um pouco maior que os \$1.000 garantidos de A, mas escolher A não é irracional: reflete que perder a chance de ganhar qualquer dinheiro carrega, para muita gente, um custo além do seu valor bruto ("aversão ao risco"). O movimento central da teoria da utilidade é separar o *valor que um resultado tem para o agente* (utilidade) do *retorno numérico bruto* (dinheiro, pontos ou qualquer outra quantidade mensurável), e insistir que a quantidade correta a maximizar é a *utilidade* esperada, e não o retorno bruto esperado.

### Os axiomas da preferência racional

A teoria da utilidade é construída sobre um pequeno conjunto de axiomas a respeito das preferências de um agente entre resultados (ou loterias sobre resultados) que, juntos, são defendidos como os requisitos mínimos para que uma estrutura de preferências possa sequer ser chamada de racional:

- **Ordenabilidade**: para quaisquer dois resultados, o agente prefere um, prefere o outro ou é indiferente; as preferências precisam estar completamente definidas, sem deixar pares em aberto.
- **Transitividade**: se o agente prefere $A$ a $B$, e $B$ a $C$, ele precisa preferir $A$ a $C$.
- **Continuidade, substituibilidade, monotonicidade, decomponibilidade**: condições técnicas adicionais que garantem que as preferências sobre resultados incertos (loterias) se comportem de forma sensata e consistente.

Violar a transitividade, em particular, não é uma peculiaridade inofensiva: um agente que prefere $A$ a $B$, $B$ a $C$ e, ainda assim, $C$ a $A$ pode ser explorado por uma **bomba de dinheiro** (money pump): recebendo repetidamente ofertas de troca ao longo desse ciclo ($C$ por $A$ mais um pequeno pagamento, depois $A$ por $B$ mais um pequeno pagamento, depois $B$ por $C$ mais um pequeno pagamento), esse agente vai pagar para andar em círculo para sempre, terminando exatamente com o mesmo resultado com que começou, mas estritamente mais pobre. A existência dessa exploração é o argumento concreto de por que a transitividade (e os outros axiomas) não são conveniências matemáticas arbitrárias, mas requisitos genuínos para evitar um padrão de escolhas comprovadamente autodestrutivo.

### O princípio da utilidade esperada máxima

Dadas crenças expressas como probabilidades (exatamente o que as redes bayesianas e os HMMs, recém-vistos, calculam) e preferências expressas como uma função de utilidade $U$, o **princípio da utilidade esperada máxima (MEU)** diz que um agente racional deve escolher a ação $a$ que maximiza:

```text
EU(a) = Σ  P(resultado | a) × U(resultado)
      resultados
```

É precisamente o mesmo cálculo de valor esperado já feito nos nós de acaso do expectimax, generalizado de duas formas: o termo de "probabilidade" agora pode vir de um modelo bayesiano completo do mundo, e não apenas de uma distribuição conhecida de dados ou cartas, e o termo de "valor" é explicitamente uma utilidade, e não necessariamente o retorno bruto. Toda técnica desta disciplina que envolve escolher sob incerteza (o expectimax e os processos de decisão de Markov vistos a seguir) é, no fundo, uma instância desse mesmo princípio único.

### Atitudes diante do risco como formatos diferentes de função de utilidade

O *formato* de uma função de utilidade, e não só a ordem que ela induz, codifica a atitude do agente diante do risco:

- **Neutro ao risco**: a utilidade é diretamente proporcional ao retorno bruto (uma linha reta); maximizar a utilidade esperada se reduz a maximizar o valor esperado simples.
- **Avesso ao risco**: a utilidade cresce mais devagar que o retorno bruto em valores mais altos (uma curva côncava); um valor garantido é preferido a uma aposta incerta com o mesmo valor bruto esperado, ou até um pouco maior, exatamente o exemplo dos \$1.000 contra a aposta acima.
- **Propenso ao risco**: a utilidade cresce mais rápido que o retorno bruto em valores mais altos (uma curva convexa); uma aposta incerta é preferida mesmo quando seu valor bruto esperado é menor que o de uma alternativa garantida.

Nenhum desses é mais "racional" que outro em abstrato; a racionalidade, como definida pelos axiomas acima, trata da consistência interna das preferências, e não de qual atitude específica diante do risco um agente tem.

## Exemplos Resolvidos

### Exemplo 1: calculando a utilidade esperada sob uma função de utilidade avessa ao risco

Suponha que a utilidade do dinheiro para um agente seja $U(x) = \sqrt{x}$ (um formato côncavo padrão, avesso ao risco) e que ele esteja escolhendo entre a Opção A (\$1.000 garantidos) e a Opção B (50% de chance de \$2.100, 50% de chance de \$0):

```text
U(A) = √1000 ≈ 31.62   (um resultado certo; sua utilidade "esperada" é só sua utilidade)

EU(B) = 0.5 × √2100 + 0.5 × √0
       = 0.5 × 45.83 + 0.5 × 0
       = 22.91

Compara: U(A) ≈ 31.62  vs  EU(B) ≈ 22.91  →  a Opção A tem utilidade esperada maior.
```

Embora o valor *monetário* esperado da Opção B (\$1.050) seja maior que os \$1.000 garantidos da Opção A, a Opção A tem a maior *utilidade* esperada sob essa função de utilidade avessa ao risco, o que captura com precisão por que escolher o valor garantido é a escolha racional, que maximiza a utilidade esperada, para um agente com essa atitude diante do risco, e não apenas uma preferência emocional ou "irracional" por segurança.

### Exemplo 2: a mesma escolha sob uma função de utilidade neutra ao risco

```text
U(x) = x   (a utilidade é diretamente proporcional ao dinheiro)

U(A) = 1000
EU(B) = 0.5 × 2100 + 0.5 × 0 = 1050

Compara: U(A) = 1000  vs  EU(B) = 1050  →  a Opção B tem utilidade esperada maior.
```

Sob uma função de utilidade neutra ao risco, a ordem se inverte: agora a Opção B é corretamente preferida, porque, sem nenhum desconto de aversão ao risco, maximizar a utilidade esperada se reduz exatamente a maximizar o valor monetário esperado. É a demonstração direta e concreta de que "utilidade" e "retorno bruto" não são a mesma coisa em geral, e de que qual opção é racional escolher depende genuinamente do formato da função de utilidade do agente, e não só dos números brutos.

### Exemplo 3: uma bomba de dinheiro por violar a transitividade

```text
Suponha que as preferências de um agente sejam: prefere A a B, prefere B a C, mas
TAMBÉM prefere C a A (violando a transitividade).

Um explorador pode então:
  1. Oferecer trocar o C atual do agente por A, com o agente pagando $0.01
     (o agente aceita, já que prefere A a... espera, ele prefere C a A,
     então reformulando: oferece trocar A por C mais $0.01; o agente,
     preferindo C a A, aceita e paga $0.01. O agente agora tem C.)
  2. Oferecer trocar C por B mais $0.01 (o agente prefere B a C, aceita).
     O agente agora tem B e pagou $0.02 no total.
  3. Oferecer trocar B por A mais $0.01 (o agente prefere A a B, aceita).
     O agente agora tem A de novo, seu resultado ORIGINAL, tendo pago
     $0.03 no total por nada.

Esse ciclo pode se repetir indefinidamente, extraindo dinheiro do agente
para sempre, enquanto ele volta ao ponto de partida a cada vez.
```

Esta é a demonstração precisa e mecânica de por que a transitividade não é um requisito técnico arbitrário: um agente cujas preferências formam um ciclo pode ser transformado em uma "bomba de dinheiro", pagando repetidamente para andar em círculo; um resultado genuinamente ruim e explorável que qualquer noção razoável de racionalidade deveria excluir por construção, e é exatamente isso que o axioma da transitividade faz.

## Equívocos Comuns e Armadilhas

- **"Agentes racionais devem sempre maximizar o valor monetário esperado."** Como mostram os Exemplos 1 e 2, se maximizar o valor bruto esperado é racional depende inteiramente da função de utilidade do agente; um agente avesso ao risco prefere, de forma correta e racional, um resultado garantido de menor valor esperado a uma aposta de maior valor esperado, justamente porque o que o MEU maximiza é a utilidade, e não o retorno bruto.
- **"A aversão ao risco é um viés irracional a ser corrigido."** Aversão ao risco, neutralidade ao risco e propensão ao risco são todas estruturas de preferência internamente consistentes sob os axiomas de racionalidade acima; nenhuma é eleita como a "correta"; a racionalidade trata da consistência interna (sem ciclos, ordenação completa), e não de qual atitude diante do risco o agente tem.
- **"A teoria da utilidade só se aplica a dinheiro."** O mesmo framework se aplica a qualquer resultado sobre o qual um agente tenha preferências (tempo, segurança, reputação ou qualquer combinação de objetivos incomensuráveis); a utilidade é simplesmente a escala numérica única que representa corretamente a ordenação real de preferências do agente, seja como for que ela seja derivada.
- **"O MEU é um princípio novo e separado do que o expectimax já fazia."** Como mostrado acima, o MEU é a generalização direta do cálculo do nó de acaso do expectimax: a mesma estrutura de valor esperado, estendida para permitir uma função de utilidade genuína (e não só o retorno bruto) e probabilidades tiradas de um modelo probabilístico completo, em vez de um dado ou baralho fixos.

## Resumo

A teoria da utilidade separa o retorno numérico bruto de um resultado do seu valor real (utilidade) para o agente, justificada por um pequeno conjunto de axiomas de preferência racional (ordenabilidade, transitividade e condições relacionadas) cuja violação (especificamente da transitividade) pode ser explorada mecanicamente por meio de uma bomba de dinheiro, extraindo valor de um agente que troca em um ciclo de preferências. O princípio da utilidade esperada máxima diz que um agente racional deve escolher a ação que maximiza a soma das utilidades dos resultados possíveis ponderada pela probabilidade; precisamente o mesmo cálculo já feito pelos nós de acaso do expectimax, agora generalizado com uma função de utilidade explícita e probabilidades tiradas de um modelo probabilístico completo. Funções de utilidade avessas ao risco, neutras ao risco e propensas ao risco são formatos diferentes e igualmente racionais que essa função pode ter, e esse princípio (probabilidades vindas da crença, utilidade vinda da preferência, combinadas pela esperança) é exatamente o objetivo que os processos de decisão de Markov do próximo conceito otimizam ao longo de uma sequência inteira de decisões, e não de uma só.

## Documentation Links

- [Russell & Norvig: Artificial Intelligence: A Modern Approach](https://aima.cs.berkeley.edu/contents.html): o tratamento canônico da teoria da utilidade, dos axiomas de racionalidade e do princípio da utilidade esperada máxima.
- [UC Berkeley CS188: Introduction to Artificial Intelligence](https://inst.eecs.berkeley.edu/~cs188/sp24/): curso que cobre a teoria da utilidade como a ponte entre o raciocínio probabilístico e a tomada de decisão sequencial.
